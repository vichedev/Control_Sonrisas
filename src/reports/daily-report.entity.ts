import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Child } from '../children/child.entity';

/**
 * - `draft`: se está armando (el día no ha cerrado).
 * - `ready`: generado y revisado, listo para enviar.
 * - `sent`: ya salió hacia la familia.
 */
export type DailyReportStatus = 'draft' | 'ready' | 'sent';

/**
 * Reporte diario de un niño: el resumen que recibe la familia por WhatsApp al cerrar el día.
 *
 * `snapshot` congela los datos tal como estaban al generarlo. Es deliberado: si mañana se
 * corrige una comida o se borra una actividad, el reporte que la familia ya recibió sigue
 * coincidiendo con lo que dice el sistema.
 */
@Entity('daily_reports')
@Index(['childId', 'date'], { unique: true })
export class DailyReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  childId: string;

  @ManyToOne(() => Child, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'childId' })
  child: Child;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 8, default: 'draft' })
  status: DailyReportStatus;

  /** Texto final del mensaje de WhatsApp. Editable por la educadora antes de enviar. */
  @Column({ type: 'text', default: '' })
  messageText: string;

  /** Nota personal que la educadora añade al final del reporte. */
  @Column({ type: 'text', default: '' })
  teacherNote: string;

  /** True si la educadora editó el texto a mano: regenerar no lo pisa (salvo `force`). */
  @Column({ default: false })
  edited: boolean;

  /** URLs de las fotos que acompañan al reporte. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  photoUrls: string[];

  /** Copia congelada de asistencia, comidas, actividades y bitácora del día. */
  @Column({ type: 'jsonb', nullable: true })
  snapshot: Record<string, any> | null;

  // --- Envío ---

  @Column({ type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  /** 'manual' (enlace wa.me abierto por la educadora) | 'cloud' (WhatsApp Cloud API). */
  @Column({ type: 'varchar', length: 12, default: '' })
  sentVia: string;

  /** Números a los que se envió, separados por coma. */
  @Column({ type: 'text', default: '' })
  sentTo: string;

  @Column({ type: 'uuid', nullable: true })
  sentById: string | null;

  @Column({ default: '' })
  sentByName: string;

  @Column({ type: 'uuid', nullable: true })
  generatedById: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
