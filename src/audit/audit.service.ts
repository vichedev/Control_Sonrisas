import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction, AuditLog } from './audit-log.entity';

export interface AuditContext {
  actorId?: string | null;
  actorEmail?: string;
  actorName?: string;
  ip?: string;
  userAgent?: string;
}

export interface RecordParams {
  entity: string;
  entityId: string;
  action: AuditAction;
  summary: string;
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
}

// Construimos el regex de chars de control vía String.fromCharCode para evitar
// embeber bytes binarios literales en el código fuente (algunos editores los corrompen).
// Cubre 0x00..0x1f (control C0) + 0x7f (DEL).
const CTRL_RANGE = String.fromCharCode(0) + '-' + String.fromCharCode(0x1f) + String.fromCharCode(0x7f);
const CTRL_RE = new RegExp('[' + CTRL_RANGE + ']+', 'g');

@Injectable()
export class AuditService {
  private readonly log = new Logger('AuditService');

  constructor(
    @InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>,
  ) {}

  /**
   * Sanea texto que va al campo `summary` del audit log para prevenir log injection:
   *   - Reemplaza saltos de línea / retornos de carro (un atacante con un nombre
   *     o motivo malicioso podría meter `\n[fake admin] deleted X` y confundir
   *     a quien lea el log).
   *   - Quita caracteres de control no imprimibles.
   *   - Colapsa whitespace consecutivo a un único espacio.
   *   - Trunca a un máximo razonable para que el campo no crezca sin control.
   */
  private sanitizeSummary(s: string): string {
    if (!s) return '';
    return String(s)
      .replace(CTRL_RE, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000);
  }

  /**
   * Registra una acción admin. Nunca lanza: si falla, sólo loguea
   * (la auditoría no debe bloquear la operación principal).
   *
   * El `summary` se sanea para evitar log injection — los datos del usuario
   * (nombre, motivo, notas) frecuentemente se interpolan ahí.
   */
  async record(ctx: AuditContext, params: RecordParams): Promise<void> {
    try {
      await this.repo.insert({
        actorId: ctx.actorId ?? null,
        actorEmail: ctx.actorEmail ?? '',
        actorName: ctx.actorName ?? '',
        ip: ctx.ip ?? '',
        userAgent: (ctx.userAgent ?? '').slice(0, 300),
        entity: params.entity,
        entityId: params.entityId,
        action: params.action,
        summary: this.sanitizeSummary(params.summary),
        before: params.before ?? null,
        after: params.after ?? null,
      });
    } catch (e: any) {
      this.log.warn(`No se pudo registrar audit log: ${e?.message || e}`);
    }
  }

  async list(opts: {
    entity?: string;
    entityId?: string;
    actorId?: string;
    from?: string;
    to?: string;
    limit?: number;
  }) {
    const qb = this.repo.createQueryBuilder('a').orderBy('a.createdAt', 'DESC');
    if (opts.entity) qb.andWhere('a.entity = :e', { e: opts.entity });
    if (opts.entityId) qb.andWhere('a.entityId = :eid', { eid: opts.entityId });
    if (opts.actorId) qb.andWhere('a.actorId = :aid', { aid: opts.actorId });
    // 'YYYY-MM-DD' se interpreta como día LOCAL (new Date('YYYY-MM-DD') sería UTC y,
    // en Ecuador, "hasta hoy" dejaba fuera lo de hoy).
    const localDay = (d: string, end: boolean) =>
      /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T${end ? '23:59:59.999' : '00:00:00'}`) : new Date(d);
    if (opts.from) qb.andWhere('a.createdAt >= :from', { from: localDay(opts.from, false) });
    if (opts.to) qb.andWhere('a.createdAt <= :to', { to: localDay(opts.to, true) });
    qb.limit(Math.min(opts.limit || 200, 1000));
    return qb.getMany();
  }
}

/** Extrae IP + UA + datos del usuario autenticado desde el Request. */
export function auditCtx(req: any): AuditContext {
  const u = req?.user || {};
  const xff = (req?.headers?.['x-forwarded-for'] || '').toString().split(',')[0].trim();
  return {
    actorId: u.id || null,
    actorEmail: u.email || '',
    actorName: u.name || '',
    ip: xff || req?.ip || '',
    userAgent: req?.headers?.['user-agent'] || '',
  };
}
