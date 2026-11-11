import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Nivel pedagógico de la sala, por rango de edad. */
export type ClassroomLevel =
  | 'lactantes'
  | 'maternal'
  | 'caminadores'
  | 'prekinder'
  | 'kinder'
  | 'otro';

/**
 * Sala / nivel de la guardería (p. ej. "Maternal A", "Caminadores").
 * Agrupa a los niños y es la unidad sobre la que se registran las actividades del día.
 */
@Entity('classrooms')
export class Classroom {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', length: 16, default: 'otro' })
  level: ClassroomLevel;

  /** Rango de edad en MESES (0-24 lactantes, 24-36 maternal…). Informativo. */
  @Column({ type: 'int', default: 0 })
  ageMinMonths: number;

  @Column({ type: 'int', default: 0 })
  ageMaxMonths: number;

  /** Cupo máximo. 0 = sin límite definido. */
  @Column({ type: 'int', default: 0 })
  capacity: number;

  /** Color hex para distinguirla en el panel (#22d3ee). */
  @Column({ type: 'varchar', length: 9, default: '#38bdf8' })
  color: string;

  /** Educadora principal a cargo (users.id con rol teacher). */
  @Column({ type: 'uuid', nullable: true })
  teacherId: string | null;

  @Column({ type: 'text', default: '' })
  notes: string;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
