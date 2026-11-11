import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { RealtimeService } from './realtime.service';
import { RealtimeCapture } from './realtime.capture';
import { ChildClassroomCache } from './child-classroom.cache';
import { RealtimeEvent, RealtimePublicEvent } from './realtime.types';
import { ScopeService } from '../common/scope/scope.service';
import { ChildGuardian } from '../children/child-guardian.entity';
import { User } from '../users/user.entity';

const HEARTBEAT_MS = 25_000;
/** Re-validar usuario (activo + tokenVersion) y refrescar su alcance. */
const REVALIDATE_MS = 4 * 60_000;
/** Ventana de agrupación de ráfagas hacia el navegador. */
const COALESCE_MS = 300;
const MAX_PER_USER = 5;
/** Cliente que no lee: se corta antes de acumular memoria. */
const MAX_BUFFER = 512 * 1024;

const STAFF_ONLY = new Set(['staff_attendance', 'task']);

interface Conn {
  id: number;
  userId: string;
  role: string;
  classroomId: string | null;
  tv: number;
  res: Response;
  /** Educadora: salas a cargo. */
  rooms: Set<string>;
  /** Representante: sus niños y las salas de esos niños (fotos grupales, actividades). */
  kids: Set<string>;
  kidRooms: Set<string>;
  pending: Map<string, RealtimePublicEvent>;
  flushTimer?: NodeJS.Timeout;
  timers: NodeJS.Timeout[];
  closed: boolean;
}

/**
 * Conexiones SSE abiertas y su filtro por rol.
 * Al navegador sólo viajan ids (`RealtimePublicEvent`), nunca `record`: el cliente vuelve
 * a pedir los datos por su API normal, que ya aplica el alcance.
 */
@Injectable()
export class RealtimeStreamService implements OnModuleInit, OnModuleDestroy, BeforeApplicationShutdown {
  private readonly log = new Logger('RealtimeStream');
  private readonly conns = new Map<number, Conn>();
  private seq = 0;
  private subs: Subscription[] = [];

  constructor(
    private readonly realtime: RealtimeService,
    private readonly capture: RealtimeCapture,
    private readonly rooms: ChildClassroomCache,
    private readonly scope: ScopeService,
    private readonly ds: DataSource,
  ) {}

  onModuleInit(): void {
    this.subs.push(this.realtime.events$.subscribe((ev) => void this.route(ev)));
    // Enlaces familia / salas / cuentas cambiaron → re-validar y refrescar alcance (agrupado).
    this.subs.push(
      this.capture.scope$.pipe(debounceTime(1000)).subscribe(() => void this.revalidateAll()),
    );
  }

  onModuleDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    this.subs = [];
  }

  beforeApplicationShutdown(): void {
    // Sin esto, `server.close()` esperaría a que los navegadores cuelguen.
    for (const c of [...this.conns.values()]) this.close(c);
  }

  get size(): number {
    return this.conns.size;
  }

  // ── Apertura ─────────────────────────────────────────────────────────────

  async open(req: Request, res: Response): Promise<void> {
    const user: any = (req as any).user;
    const payload = decodeJwt(req.headers.authorization);
    const conn: Conn = {
      id: ++this.seq,
      userId: user.id,
      role: user.role,
      classroomId: user.classroomId ?? null,
      tv: typeof payload?.tv === 'number' ? payload.tv : 0,
      res,
      rooms: new Set(),
      kids: new Set(),
      kidRooms: new Set(),
      pending: new Map(),
      timers: [],
      closed: false,
    };
    await this.refreshScope(conn);
    if (req.socket?.destroyed) return; // el cliente se fue mientras cargábamos el alcance

    // Tope por usuario: se cierra la más antigua (pestañas viejas).
    const mine = [...this.conns.values()].filter((c) => c.userId === conn.userId);
    while (mine.length >= MAX_PER_USER) this.close(mine.shift()!);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    req.socket?.setNoDelay?.(true);
    req.socket?.setKeepAlive?.(true, HEARTBEAT_MS);

    this.conns.set(conn.id, conn);
    const cleanup = () => this.close(conn);
    req.on('close', cleanup);
    res.on('error', cleanup);

    this.write(conn, `retry: 3000\nevent: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

    conn.timers.push(setInterval(() => this.write(conn, `: ping\n\n`), HEARTBEAT_MS));
    conn.timers.push(setInterval(() => void this.revalidate([conn]), REVALIDATE_MS));
    // El stream no sobrevive al token: al expirar se corta y el cliente reconecta con uno nuevo.
    if (typeof payload?.exp === 'number') {
      const ms = payload.exp * 1000 - Date.now();
      conn.timers.push(setTimeout(() => this.close(conn, 'expired'), Math.max(0, Math.min(ms, 2 ** 31 - 1))));
    }
  }

  // ── Enrutado de eventos ──────────────────────────────────────────────────

  private async route(ev: RealtimeEvent): Promise<void> {
    if (!this.conns.size) return;
    // Eventos emitidos a mano por otros módulos pueden venir sin sala.
    if (!ev.classroomId && ev.childId && ev.entity !== 'child') {
      try {
        ev = { ...ev, classroomId: await this.rooms.get(ev.childId) };
      } catch {
        /* sigue sin sala */
      }
    }
    const pub: RealtimePublicEvent = {
      entity: ev.entity,
      action: ev.action,
      id: ev.id ?? null,
      childId: ev.childId ?? null,
      classroomId: ev.classroomId ?? null,
      date: ev.date ?? null,
    };
    for (const c of this.conns.values()) {
      if (!c.closed && this.canSee(c, ev)) this.enqueue(c, pub);
    }
  }

  /** Filtro por rol. Ante la duda, NO se envía. */
  private canSee(c: Conn, ev: RealtimeEvent): boolean {
    switch (c.role) {
      case 'admin':
      case 'coordinator':
        return true;
      case 'teacher': {
        if (ev.entity === 'staff_attendance') return !!ev.userId && ev.userId === c.userId;
        if (ev.entity === 'task' && ev.userId && ev.userId === c.userId) return true;
        if (ev.classroomId && c.rooms.has(ev.classroomId)) return true;
        if (ev.previousClassroomId && c.rooms.has(ev.previousClassroomId)) return true;
        // Actividad de toda la guardería (sin sala).
        return ev.entity === 'activity' && !!ev.id && !ev.classroomId && !ev.childId;
      }
      case 'guardian': {
        if (STAFF_ONLY.has(ev.entity)) return false;
        if (ev.familyVisible === false) return false;
        if (ev.childId) return c.kids.has(ev.childId);
        if (ev.entity === 'photo' || ev.entity === 'activity') {
          if (ev.classroomId) return c.kidRooms.has(ev.classroomId);
          return ev.entity === 'activity' && !!ev.id; // actividad de toda la guardería
        }
        return false;
      }
      default:
        return false;
    }
  }

  /** Agrupa ráfagas (p. ej. 20 comidas en bloque) por entidad + sala durante 300 ms. */
  private enqueue(c: Conn, ev: RealtimePublicEvent): void {
    const key = `${ev.entity}|${ev.classroomId || ''}`;
    const prev = c.pending.get(key);
    if (!prev) c.pending.set(key, ev);
    else {
      // Un campo que difiere pasa a null = "comodín" para el cliente.
      c.pending.set(key, {
        entity: ev.entity,
        action: prev.action === ev.action ? ev.action : 'updated',
        id: prev.id === ev.id ? ev.id : null,
        childId: prev.childId === ev.childId ? ev.childId : null,
        classroomId: ev.classroomId,
        date: prev.date === ev.date ? ev.date : null,
      });
    }
    if (!c.flushTimer) c.flushTimer = setTimeout(() => this.flush(c), COALESCE_MS);
  }

  private flush(c: Conn): void {
    c.flushTimer = undefined;
    if (c.closed || !c.pending.size) return;
    const chunk = [...c.pending.values()].map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
    c.pending.clear();
    this.write(c, chunk);
  }

  private write(c: Conn, chunk: string): void {
    if (c.closed) return;
    try {
      if (c.res.writableLength > MAX_BUFFER) return this.close(c);
      c.res.write(chunk);
      (c.res as any).flush?.();
    } catch {
      this.close(c);
    }
  }

  private close(c: Conn, reason?: 'logout' | 'expired'): void {
    if (c.closed) return;
    c.closed = true;
    this.conns.delete(c.id);
    c.timers.forEach((t) => clearTimeout(t));
    if (c.flushTimer) clearTimeout(c.flushTimer);
    c.pending.clear();
    try {
      // Aviso al cliente: `logout` = no reintentar; `expired` = reintentar con token nuevo.
      if (reason && !c.res.writableEnded) c.res.write(`event: ${reason}\ndata: {}\n\n`);
      if (!c.res.writableEnded) c.res.end();
    } catch {
      /* socket ya cerrado */
    }
  }

  // ── Alcance y re-validación ─────────────────────────────────────────────

  private async refreshScope(c: Conn): Promise<void> {
    if (c.role === 'teacher') {
      const ids = await this.scope.allowedClassroomIds({
        id: c.userId,
        role: c.role,
        classroomId: c.classroomId,
      });
      c.rooms = new Set(ids || []);
    } else if (c.role === 'guardian') {
      const links = await this.ds
        .getRepository(ChildGuardian)
        .find({ where: { guardianId: c.userId }, select: ['id', 'childId'] });
      const kids = links.map((l) => l.childId);
      c.kids = new Set(kids);
      c.kidRooms = new Set(await this.rooms.roomsOf(kids));
    }
  }

  private revalidateAll(): Promise<void> {
    return this.revalidate([...this.conns.values()]);
  }

  /** Cierra los streams de cuentas desactivadas / con sesión revocada; refresca alcance. */
  private async revalidate(list: Conn[]): Promise<void> {
    const open = list.filter((c) => !c.closed);
    if (!open.length) return;
    try {
      const ids = [...new Set(open.map((c) => c.userId))];
      const users = await this.ds.getRepository(User).find({
        where: { id: In(ids) },
        select: ['id', 'active', 'tokenVersion', 'mustChangePassword', 'role', 'classroomId'],
      });
      const byId = new Map(users.map((u) => [u.id, u]));
      for (const c of open) {
        const u = byId.get(c.userId);
        if (!u || !u.active || (u.tokenVersion || 0) !== c.tv || u.mustChangePassword || u.role !== c.role) {
          this.close(c, 'logout');
          continue;
        }
        c.classroomId = u.classroomId ?? null;
        await this.refreshScope(c);
      }
    } catch (err: any) {
      this.log.warn(`re-validación falló: ${err?.message || err}`);
    }
  }
}

/** Payload del JWT (ya verificado por el guard; aquí sólo se lee `tv` y `exp`). */
function decodeJwt(header?: string): { tv?: number; exp?: number } | null {
  try {
    const token = String(header || '').replace(/^Bearer\s+/i, '');
    const part = token.split('.')[1];
    return part ? JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) : null;
  } catch {
    return null;
  }
}
