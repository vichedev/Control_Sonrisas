import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Classroom } from '../classrooms/classroom.entity';
import { ActivityParticipant } from './activity-participant.entity';

export type ActivityCategory =
  | 'motor'
  | 'arte'
  | 'musica'
  | 'lectura'
  | 'juego'
  | 'aprendizaje'
  | 'exterior'
  | 'sensorial'
  | 'higiene'
  | 'otro';

export type ActivityStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';

/**
 * Actividad del día.
 *
 * A diferencia del sistema anterior (una tarea por trabajador), aquí la actividad es GRUPAL:
 * la hace una sala completa y después se anota, niño a niño, cómo participó cada uno
 * (`ActivityParticipant`). Eso es lo que permite armar el reporte individual del día sin
 * duplicar la descripción de la actividad para cada niño.
 */
@Entity('activities')
@Index(['date', 'classroomId'])
export class Activity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'varchar', length: 16, default: 'otro' })
  category: ActivityCategory;

  /** Sala que la realiza. Null = actividad de toda la guardería. */
  @Column({ type: 'uuid', nullable: true })
  classroomId: string | null;

  @ManyToOne(() => Classroom, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'classroomId' })
  classroom: Classroom | null;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  durationMinutes: number;

  /** Foto principal, la que encabeza la actividad en el reporte. */
  @Column({ type: 'text', default: '' })
  coverPhotoUrl: string;

  @Column({ type: 'varchar', length: 16, default: 'in_progress' })
  status: ActivityStatus;

  /** Qué se observó en el grupo / cómo salió. */
  @Column({ type: 'text', default: '' })
  summary: string;

  /** Si es false, la actividad no aparece en el reporte que reciben las familias. */
  @Column({ default: true })
  shareWithFamilies: boolean;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @Column({ default: '' })
  createdByName: string;

  @OneToMany(() => ActivityParticipant, (p) => p.activity)
  participants: ActivityParticipant[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
