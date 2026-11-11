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
import type { ConsentMethod, ConsentType } from './consent.types';

/**
 * Historial de decisiones de consentimiento (sólo se inserta, nunca se edita).
 * El estado vigente es el último registro de cada niño + tipo.
 */
@Entity('child_consents')
@Index(['childId', 'type', 'createdAt'])
@Index(['guardianId'])
export class ChildConsent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  childId: string;

  // Si se elimina la ficha del niño, su historial de consentimientos se va con ella.
  @ManyToOne(() => Child, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'childId' })
  child?: Child;

  /** Representante que decidió. Null si lo registró el personal sin cuenta asociada. */
  @Column({ type: 'uuid', nullable: true })
  guardianId: string | null;

  @Column({ type: 'varchar', length: 160, default: '' })
  guardianName: string;

  @Column({ type: 'varchar', length: 20 })
  type: ConsentType;

  @Column({ type: 'boolean' })
  granted: boolean;

  @Column({ type: 'int' })
  policyVersion: number;

  @Column({ type: 'varchar', length: 12 })
  method: ConsentMethod;

  /** Personal que registró un consentimiento presencial (formulario en papel). */
  @Column({ type: 'uuid', nullable: true })
  recordedById: string | null;

  @Column({ type: 'varchar', length: 160, default: '' })
  recordedByName: string;

  @Column({ type: 'text', default: '' })
  note: string;

  @Column({ type: 'varchar', length: 64, default: '' })
  ip: string;

  @Column({ type: 'varchar', length: 300, default: '' })
  userAgent: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
