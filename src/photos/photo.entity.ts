import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { PhotoChild } from './photo-child.entity';

/** A qué está asociada la foto. */
export type PhotoSubject = 'child' | 'activity' | 'moment' | 'meal' | 'attendance' | 'general';

export const PHOTO_SUBJECTS: PhotoSubject[] = ['child', 'activity', 'moment', 'meal', 'attendance', 'general'];

/**
 * Galería de fotos.
 *
 * Las entidades del día (entrada, comida, actividad, bitácora) guardan su propia `photoUrl`
 * principal; esta tabla es el índice transversal que permite responder "todas las fotos de
 * Martina del 3 de agosto" en una sola consulta, y decidir cuáles se comparten con la familia.
 */
@Entity('photos')
@Index(['childId', 'date'])
@Index(['date', 'subject'])
@Index(['activityId'])
export class Photo {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  url: string;

  @Column({ type: 'varchar', length: 12, default: 'general' })
  subject: PhotoSubject;

  /** Id de la entidad origen (actividad, comida, marcaje…). */
  @Column({ type: 'uuid', nullable: true })
  subjectId: string | null;

  /**
   * Primer niño etiquetado (compatibilidad). Las etiquetas completas están en `tags`
   * (photo_children). Null + sin etiquetas = foto grupal de la sala.
   */
  @Column({ type: 'uuid', nullable: true })
  childId: string | null;

  @Column({ type: 'uuid', nullable: true })
  classroomId: string | null;

  @Column({ type: 'uuid', nullable: true })
  activityId: string | null;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'text', default: '' })
  caption: string;

  /** Momento en que se tomó (ordena la galería del día). */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  takenAt: Date;

  /** Niños que aparecen en la foto. */
  @OneToMany('PhotoChild', 'photo')
  tags: PhotoChild[];

  /**
   * Si es false, la foto queda sólo para el personal y nunca se adjunta a un reporte
   * ni aparece en el portal familiar. Por defecto true.
   */
  @Column({ default: true })
  shareWithFamily: boolean;

  @Column({ type: 'uuid', nullable: true })
  uploadedById: string | null;

  @Column({ default: '' })
  uploadedByName: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
