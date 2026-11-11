import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export type StaffAttendanceType = 'in' | 'lunch_out' | 'lunch_in' | 'out';

/**
 * Marcaje del personal (educadoras, auxiliares, coordinación).
 *
 * Se conserva del sistema anterior porque la guardería sigue necesitando control de la
 * jornada del equipo, pero sin reconocimiento facial: la foto es opcional y sólo sirve
 * como constancia.
 */
@Entity('staff_attendances')
@Index(['userId', 'createdAt'])
export class StaffAttendance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 12 })
  type: StaffAttendanceType;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'text', default: '' })
  photoUrl: string;

  @Column({ type: 'text', default: '' })
  notes: string;

  /** '' | 'on_time' | 'late' | 'overtime' | 'early_leave' | 'rest_day' | 'holiday' */
  @Column({ type: 'varchar', length: 16, default: '' })
  scheduleStatus: string;

  @Column({ type: 'int', default: 0 })
  scheduleMinutes: number;

  /** True si lo creó un administrador a mano en lugar de marcarlo la propia persona. */
  @Column({ default: false })
  manual: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
