import {
  CreateDateColumn,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Photo } from './photo.entity';
import { Child } from '../children/child.entity';

/**
 * Etiqueta "este niño sale en esta foto". Una foto puede mostrar a varios niños;
 * la galería del día de cada niño se arma con estas filas (más el `Photo.childId` heredado).
 */
@Entity('photo_children')
@Unique('UQ_photo_children_pair', ['photoId', 'childId'])
@Index(['childId'])
export class PhotoChild {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  photoId: string;

  @ManyToOne(() => Photo, (p) => p.tags, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'photoId' })
  photo: Photo;

  @Column('uuid')
  childId: string;

  @ManyToOne(() => Child, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'childId' })
  child: Child;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
