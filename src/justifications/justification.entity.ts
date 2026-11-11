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

export type JustificationType =
  | 'enfermedad'
  | 'cita_medica'
  | 'viaje'
  | 'familiar'
  | 'tardanza'
  | 'otro';

export type JustificationStatus = 'pending' | 'approved' | 'rejected';

/**
 * Aviso de ausencia o tardanza de un niño.
 *
 * Lo crea el representante desde el portal familiar (o el personal, si avisan por teléfono)
 * y lo aprueba coordinación. Una justificación aprobada evita que el día cuente como falta
 * injustificada en los reportes de asistencia.
 */
@Entity('justifications')
@Index(['childId', 'dateFrom'])
export class Justification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  childId: string;

  @ManyToOne(() => Child, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'childId' })
  child: Child;

  /** Rango cubierto (puede ser un solo día). */
  @Column({ type: 'date' })
  dateFrom: string;

  @Column({ type: 'date' })
  dateTo: string;

  @Column({ type: 'varchar', length: 16, default: 'otro' })
  type: JustificationType;

  @Column({ type: 'text' })
  reason: string;

  /** Certificado médico u otro documento (PDF/imagen). */
  @Column({ type: 'text', default: '' })
  attachmentUrl: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: JustificationStatus;

  /** Comentario de coordinación al aprobar/rechazar. */
  @Column({ type: 'text', default: '' })
  adminNote: string;

  /** Quién la envió: un representante o un miembro del personal. */
  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @Column({ default: '' })
  createdByName: string;

  @Column('uuid', { nullable: true })
  decidedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
