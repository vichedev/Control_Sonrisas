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
import { User } from '../users/user.entity';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * Pendiente asignado a un miembro del personal.
 *
 * Es el "recordatorio de la coordinadora": preparar el material de plástica, llamar a la
 * mamá de Martina, reponer pañales. Deliberadamente simple — no es un gestor de proyectos.
 */
@Entity('tasks')
@Index(['assigneeId', 'status'])
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Persona responsable. */
  @Column('uuid')
  assigneeId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assigneeId' })
  assignee: User;

  @Column({ type: 'uuid', nullable: true })
  assignedById: string | null;

  @Column({ default: '' })
  assignedByName: string;

  @Column()
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'varchar', length: 12, default: 'normal' })
  priority: TaskPriority;

  /** Sala a la que se refiere el pendiente, si aplica. */
  @Column({ type: 'uuid', nullable: true })
  classroomId: string | null;

  /** Niño al que se refiere, si aplica ("hablar con la familia de…"). */
  @Column({ type: 'uuid', nullable: true })
  childId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  dueAt: Date | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: TaskStatus;

  @Column({ type: 'text', default: '' })
  completionNote: string;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
