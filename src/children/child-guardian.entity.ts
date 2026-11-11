import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Child } from './child.entity';
import { User } from '../users/user.entity';

/**
 * Enlace niño ↔ representante.
 *
 * Es la tabla que decide TODO el acceso del portal familiar: un representante sólo puede ver
 * los niños con los que tiene una fila aquí. Un niño puede tener varios representantes
 * (madre, padre, abuela) y un representante varios niños (hermanos).
 */
@Entity('child_guardians')
@Index(['childId', 'guardianId'], { unique: true })
export class ChildGuardian {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  childId: string;

  @ManyToOne(() => Child, (c) => c.guardianLinks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'childId' })
  child: Child;

  /** Usuario con rol `guardian`. */
  @Column('uuid')
  guardianId: string;

  @ManyToOne(() => User, (u) => u.childLinks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'guardianId' })
  guardian: User;

  /** Parentesco: madre, padre, abuela, tío, tutor legal… */
  @Column({ default: '' })
  relationship: string;

  /** Contacto principal: a quien se llama primero ante una urgencia. */
  @Column({ default: false })
  isPrimary: boolean;

  /** Autorizado a retirar al niño de la guardería. */
  @Column({ default: true })
  canPickup: boolean;

  /** Recibe el reporte diario por WhatsApp. */
  @Column({ default: true })
  receivesReport: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
