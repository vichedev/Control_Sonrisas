import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type AuditAction =
  | 'update'
  | 'delete'
  | 'create'
  /** Inicio de sesión correcto. */
  | 'login'
  /** Credencial incorrecta (contraseña o código 2FA). */
  | 'login_failed'
  /** Login rechazado por cuenta bloqueada / desactivada. */
  | 'login_blocked'
  /** Evento de seguridad de la propia cuenta: cambio de contraseña, 2FA, cierre de sesiones. */
  | 'security';

/**
 * Registro inmutable de acciones administrativas sensibles (correcciones o
 * eliminaciones de marcajes, actividades o trabajadores). El admin puede
 * consultarlo pero NO modificarlo desde la app — para alterar la auditoría
 * habría que entrar a la BD directamente.
 */
@Entity('audit_log')
@Index(['entity', 'entityId'])
@Index(['actorId', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Usuario que realizó el cambio (null para acciones del sistema). */
  @Column('uuid', { nullable: true })
  actorId: string | null;

  @Column({ default: '' })
  actorEmail: string;

  @Column({ default: '' })
  actorName: string;

  /** 'attendance' | 'activity' | 'user' | 'work_schedule' | … */
  @Column({ type: 'varchar', length: 40 })
  entity: string;

  @Column({ type: 'varchar', length: 64 })
  entityId: string;

  @Column({ type: 'varchar', length: 16 })
  action: AuditAction;

  /** Resumen legible que el admin verá ("Corrigió entrada de Juan Pérez"). */
  @Column({ type: 'text', default: '' })
  summary: string;

  /** Snapshot antes del cambio (parcial — sólo los campos relevantes). */
  @Column({ type: 'jsonb', nullable: true })
  before: Record<string, any> | null;

  /** Snapshot después del cambio. Null en delete. */
  @Column({ type: 'jsonb', nullable: true })
  after: Record<string, any> | null;

  @Column({ default: '' })
  ip: string;

  @Column({ default: '' })
  userAgent: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
