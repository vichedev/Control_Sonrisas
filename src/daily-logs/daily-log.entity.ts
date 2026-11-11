import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Child } from '../children/child.entity';

/**
 * Tipo de anotación de la bitácora del día.
 *
 * - `nap`: siesta (usa `occurredAt` + `endedAt`).
 * - `hygiene`: cambio de pañal, control de esfínteres, accidente.
 * - `health`: fiebre, medicación administrada, malestar.
 * - `incident`: golpe, caída, mordida — lo que hay que contarle a la familia sí o sí.
 * - `mood`: cambio de ánimo relevante durante el día.
 * - `note`: observación libre de la educadora.
 */
export type DailyLogKind = 'nap' | 'hygiene' | 'health' | 'incident' | 'mood' | 'note';

/**
 * Bitácora del día de un niño: siestas, cambios, salud, incidentes y observaciones.
 *
 * Un único modelo para todas ellas (en vez de cinco tablas) porque en la práctica se
 * consultan siempre juntas, ordenadas por hora: la "línea de tiempo del día" del niño.
 */
@Entity('daily_logs')
@Index(['childId', 'date'])
@Index(['date', 'kind'])
export class DailyLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  childId: string;

  @ManyToOne(() => Child, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'childId' })
  child: Child;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 12 })
  kind: DailyLogKind;

  /**
   * Subtipo dentro del `kind`. Ej.: para `hygiene` → 'panal_mojado' | 'panal_deposicion' |
   * 'bano' | 'accidente'; para `health` → 'fiebre' | 'medicacion' | 'malestar'.
   * Texto libre acotado para no cerrar el modelo a una lista que cada guardería usa distinto.
   */
  @Column({ type: 'varchar', length: 32, default: '' })
  detail: string;

  @Column({ type: 'timestamptz' })
  occurredAt: Date;

  /** Sólo para siestas: hora de despertar. */
  @Column({ type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  durationMinutes: number;

  @Column({ type: 'text', default: '' })
  notes: string;

  /** Temperatura en °C, para `health`. */
  @Column({ type: 'float', nullable: true })
  temperature: number | null;

  @Column({ type: 'text', default: '' })
  photoUrl: string;

  /**
   * Marca la anotación como "hay que avisar a la familia ahora, no al cierre del día".
   * Aparece destacada en el panel y encabeza el reporte diario.
   */
  @Column({ default: false })
  notifyGuardian: boolean;

  /** Se puso en true cuando ya se avisó (por WhatsApp o en persona). */
  @Column({ default: false })
  guardianNotified: boolean;

  @Column({ type: 'uuid', nullable: true })
  recordedById: string | null;

  @Column({ default: '' })
  recordedByName: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
