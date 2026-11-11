import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Activity } from './activity.entity';
import { Child } from '../children/child.entity';

/** Cómo participó el niño. `absent` = estaba, pero no quiso o no pudo participar. */
export type Participation = 'excellent' | 'good' | 'regular' | 'low' | 'absent';

/** Participación de un niño concreto en una actividad de su sala. */
@Entity('activity_participants')
@Index(['activityId', 'childId'], { unique: true })
export class ActivityParticipant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  activityId: string;

  @ManyToOne(() => Activity, (a) => a.participants, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'activityId' })
  activity: Activity;

  @Column('uuid')
  childId: string;

  @ManyToOne(() => Child, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'childId' })
  child: Child;

  @Column({ type: 'varchar', length: 12, default: 'good' })
  participation: Participation;

  /** Observación individual: "pintó con las manos por primera vez". Va tal cual al reporte. */
  @Column({ type: 'text', default: '' })
  note: string;
}
