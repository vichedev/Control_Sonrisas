import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * Bitácora de recordatorios enviados. Evita repetir el mismo aviso varias veces al día:
 * la clave única (subjectId, day, kind) es lo que hace idempotente al planificador.
 */
@Entity('reminder_sent')
@Unique(['subjectId', 'day', 'kind'])
@Index(['day'])
export class ReminderSent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Usuario o niño al que se refiere el recordatorio. */
  @Column('uuid')
  subjectId: string;

  /** 'YYYY-MM-DD' local. */
  @Column({ type: 'date' })
  day: string;

  /** 'pending_checkout' | 'pending_reports' | 'pending_notice' | … */
  @Column({ type: 'varchar', length: 32 })
  kind: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
