import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  DataSource,
  EntitySubscriberInterface,
  InsertEvent,
  QueryRunner,
  RemoveEvent,
  SoftRemoveEvent,
  TransactionCommitEvent,
  TransactionRollbackEvent,
  UpdateEvent,
} from 'typeorm';
import { Subject } from 'rxjs';
import { RealtimeService } from './realtime.service';
import { ChildClassroomCache } from './child-classroom.cache';
import { RealtimeAction, RealtimeEntity, RealtimeEvent } from './realtime.types';
import { ChildAttendance } from '../attendance/child-attendance.entity';
import { StaffAttendance } from '../attendance/staff-attendance.entity';
import { Meal } from '../meals/meal.entity';
import { DailyLog } from '../daily-logs/daily-log.entity';
import { Activity } from '../activities/activity.entity';
import { ActivityParticipant } from '../activities/activity-participant.entity';
import { DailyReport } from '../reports/daily-report.entity';
import { Justification } from '../justifications/justification.entity';
import { Child } from '../children/child.entity';
import { ChildGuardian } from '../children/child-guardian.entity';
import { Classroom } from '../classrooms/classroom.entity';
import { Photo } from '../photos/photo.entity';
import { Task } from '../tasks/task.entity';
import { User } from '../users/user.entity';

/** Entidad TypeORM → nombre del evento. */
const ENTITY_MAP = new Map<Function, RealtimeEntity>([
  [ChildAttendance, 'attendance'],
  [StaffAttendance, 'staff_attendance'],
  [Meal, 'meal'],
  [DailyLog, 'daily_log'],
  [Activity, 'activity'],
  [ActivityParticipant, 'activity'],
  [DailyReport, 'report'],
  [Justification, 'justification'],
  [Child, 'child'],
  [Photo, 'photo'],
  [Task, 'task'],
]);

/** Cambios de usuario que afectan a sesiones/alcance (no `lastLoginAt`). */
const USER_SECURITY_FIELDS = ['tokenVersion', 'active', 'mustChangePassword', 'role', 'classroomId'];

/** Aviso interno: cambió quién ve qué (enlaces familia, salas, cuentas). */
export interface ScopeChange {
  kind: 'guardian_links' | 'classrooms' | 'users';
  userId?: string | null;
}

type Pending = { ev: RealtimeEvent; depth: number };

const str = (v: any): string | null => (v === undefined || v === null || v === '' ? null : String(v));
const day = (v: any): string | null => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

/**
 * Captura de cambios SIN tocar los servicios de dominio: un EntitySubscriber de TypeORM
 * registrado a mano en el DataSource.
 *
 * - Dentro de una transacción los eventos se encolan en el queryRunner y sólo se emiten
 *   tras el COMMIT (se descartan en ROLLBACK, incluidos savepoints anidados).
 * - Fuera de transacción se emiten al momento.
 * - `classroomId` se completa con la sala del niño si falta.
 * - `RealtimeService.events$` recibe cada evento individual con su `record`.
 */
@Injectable()
export class RealtimeCapture implements OnModuleInit, EntitySubscriberInterface<any> {
  private readonly log = new Logger('RealtimeCapture');
  private readonly pending = new WeakMap<QueryRunner, Pending[]>();
  private chain: Promise<void> = Promise.resolve();
  /** Cambios de alcance (los consume el stream para refrescar permisos). */
  readonly scope$ = new Subject<ScopeChange>();

  constructor(
    private readonly ds: DataSource,
    private readonly realtime: RealtimeService,
    private readonly rooms: ChildClassroomCache,
  ) {}

  onModuleInit(): void {
    if (!this.ds.subscribers.includes(this)) this.ds.subscribers.push(this);
  }

  // ── Hooks TypeORM ─────────────────────────────────────────────────────────

  afterInsert(e: InsertEvent<any>): void {
    this.safe(() => this.handle('created', e.metadata?.target, e.entity, undefined, undefined, e.queryRunner));
  }

  afterUpdate(e: UpdateEvent<any>): void {
    this.safe(() =>
      this.handle('updated', e.metadata?.target, e.entity, e.databaseEntity, undefined, e.queryRunner),
    );
  }

  afterRemove(e: RemoveEvent<any>): void {
    this.safe(() =>
      this.handle('deleted', e.metadata?.target, e.entity, e.databaseEntity, e.entityId, e.queryRunner),
    );
  }

  afterSoftRemove(e: SoftRemoveEvent<any>): void {
    this.safe(() =>
      this.handle('deleted', e.metadata?.target, e.entity, e.databaseEntity, e.entityId, e.queryRunner),
    );
  }

  afterTransactionCommit(e: TransactionCommitEvent): void {
    this.safe(() => {
      const qr = e.queryRunner;
      const list = this.pending.get(qr);
      if (!list?.length) return;
      const depth = this.depthOf(qr);
      if (depth > 0) {
        // Savepoint liberado: sus eventos pasan al nivel exterior.
        list.forEach((p) => (p.depth = Math.min(p.depth, depth)));
        return;
      }
      this.pending.delete(qr);
      list.forEach((p) => this.dispatch(p.ev));
    });
  }

  afterTransactionRollback(e: TransactionRollbackEvent): void {
    this.safe(() => {
      const qr = e.queryRunner;
      const list = this.pending.get(qr);
      if (!list) return;
      const depth = this.depthOf(qr);
      const keep = list.filter((p) => p.depth <= depth);
      if (depth === 0 || !keep.length) this.pending.delete(qr);
      else this.pending.set(qr, keep);
    });
  }

  // ── Interno ───────────────────────────────────────────────────────────────

  private safe(fn: () => void): void {
    // Nunca romper una escritura del dominio por el tiempo real.
    try {
      fn();
    } catch (err: any) {
      this.log.warn(`captura falló: ${err?.message || err}`);
    }
  }

  private depthOf(qr: QueryRunner): number {
    const d = (qr as any)?.transactionDepth;
    if (typeof d === 'number') return d;
    return qr?.isTransactionActive ? 1 : 0;
  }

  private handle(
    action: RealtimeAction,
    target: any,
    entity: any,
    previous: any,
    entityId: any,
    qr: QueryRunner | undefined,
  ): void {
    if (!target || typeof target !== 'function') return;

    // Tablas que sólo cambian permisos (no se emiten al navegador).
    if (target === ChildGuardian) return this.scope$.next({ kind: 'guardian_links' });
    if (target === Classroom) return this.scope$.next({ kind: 'classrooms' });
    if (target === User) {
      const keys = Object.keys(entity || {});
      const relevant = action !== 'updated' || !keys.length || keys.some((k) => USER_SECURITY_FIELDS.includes(k));
      if (relevant) this.scope$.next({ kind: 'users', userId: str(entity?.id ?? previous?.id) });
      return;
    }

    const name = ENTITY_MAP.get(target);
    if (!name) return;
    const ev = this.toEvent(name, target, action, entity, previous, entityId);
    if (qr && qr.isTransactionActive) {
      const list = this.pending.get(qr) || [];
      list.push({ ev, depth: Math.max(1, this.depthOf(qr)) });
      this.pending.set(qr, list);
    } else {
      this.dispatch(ev);
    }
  }

  private toEvent(
    name: RealtimeEntity,
    target: Function,
    action: RealtimeAction,
    entity: any,
    previous: any,
    entityId: any,
  ): RealtimeEvent {
    const rawId = entityId && typeof entityId === 'object' ? entityId.id : entityId;
    const id = str(entity?.id ?? previous?.id ?? rawId);
    // Sin id = update/delete masivo por QueryBuilder: `entity` son sólo los valores puestos.
    const hasRow = !!id;
    let row = entity;
    if (hasRow && previous) {
      // `save` parcial: completar con lo que había en BD (mismo prototipo de la entidad).
      row = Object.assign(Object.create(Object.getPrototypeOf(entity ?? previous)), previous, entity);
    }
    if (hasRow && row && row.id == null) {
      // `remove` borra el id de la entidad: copia (no se toca el objeto del servicio).
      row = Object.assign(Object.create(Object.getPrototypeOf(row)), row, { id });
    }
    const pick = (k: string) => row?.[k] ?? previous?.[k];

    const ev: RealtimeEvent = {
      entity: name,
      action,
      id,
      childId: str(pick('childId')),
      classroomId: str(pick('classroomId')),
      date: day(pick('date')),
      record: hasRow ? row : undefined,
      previous: previous || undefined,
    };

    if (target === Child) {
      ev.childId = id;
      if (previous && str(previous.classroomId) !== ev.classroomId) {
        ev.previousClassroomId = str(previous.classroomId);
      }
      if (id) {
        if (action === 'deleted') this.rooms.invalidate(id);
        else if (row && 'classroomId' in row) this.rooms.set(id, str(row.classroomId));
        else this.rooms.invalidate(id);
      }
    } else if (target === ActivityParticipant) {
      ev.id = str(pick('activityId'));
    } else if (target === Justification) {
      ev.date = day(pick('dateFrom'));
    } else if (target === StaffAttendance) {
      ev.userId = str(pick('userId'));
    } else if (target === Task) {
      ev.userId = str(pick('assigneeId'));
      ev.date = day(pick('dueAt'));
    } else if (target === Photo) {
      ev.familyVisible = row?.shareWithFamily !== false || previous?.shareWithFamily === true;
    } else if (target === Activity) {
      ev.familyVisible = row?.shareWithFamilies !== false || previous?.shareWithFamilies === true;
    } else if (target === DailyReport) {
      ev.familyVisible = pick('status') === 'sent' || previous?.status === 'sent';
    }
    return ev;
  }

  /** Completa la sala (si falta) y emite, conservando el orden de llegada. */
  private dispatch(ev: RealtimeEvent): void {
    this.chain = this.chain
      .then(async () => {
        if (!ev.classroomId && ev.childId && ev.entity !== 'child') {
          try {
            ev.classroomId = await this.rooms.get(ev.childId);
          } catch {
            /* sin sala: se emite igual */
          }
        }
        this.realtime.emit(ev);
      })
      .catch((err) => this.log.warn(`emit falló: ${err?.message || err}`));
  }
}
