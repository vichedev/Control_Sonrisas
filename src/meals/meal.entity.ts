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

export type MealType =
  | 'breakfast'
  | 'snack_am'
  | 'lunch'
  | 'snack_pm'
  | 'bottle';

/** Cuánto comió. Es lo primero que pregunta la familia, así que se guarda como dato, no como texto libre. */
export type MealIntake = 'all' | 'most' | 'half' | 'little' | 'none';

/**
 * Registro de alimentación de un niño en una comida concreta del día.
 *
 * Se registra por sala en bloque (todos comen el mismo menú) y luego se ajusta niño a niño
 * la cantidad y las observaciones.
 */
@Entity('meals')
@Index(['childId', 'date'])
@Index(['date', 'type'])
export class Meal {
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
  type: MealType;

  /** Qué se sirvió: "Puré de zanahoria con pollo y jugo de mora". */
  @Column({ type: 'text', default: '' })
  menu: string;

  @Column({ type: 'varchar', length: 8, default: 'all' })
  intake: MealIntake;

  /** Observaciones: "no quiso la verdura", "repitió dos veces", "rechazó por dolor de garganta". */
  @Column({ type: 'text', default: '' })
  notes: string;

  @Column({ type: 'text', default: '' })
  photoUrl: string;

  /** Hora real en que comió. */
  @Column({ type: 'timestamptz', nullable: true })
  servedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  recordedById: string | null;

  @Column({ default: '' })
  recordedByName: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
