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
import { ChildGuardian } from './child-guardian.entity';

export type ChildGender = 'f' | 'm' | 'other';

/**
 * Niño inscrito en la guardería.
 *
 * No es un usuario: no tiene correo ni contraseña y nunca inicia sesión. Quien accede al
 * sistema en su nombre es el personal (que registra) y sus representantes (que consultan
 * el portal familiar), enlazados a través de `ChildGuardian`.
 */
@Entity('children')
@Index(['classroomId', 'active'])
// Cédula única sólo cuando existe (muchos niños aún no la tienen).
@Index('UQ_children_documentId', ['documentId'], { unique: true, where: '"documentId" IS NOT NULL' })
export class Child {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Matrícula / código interno. */
  @Column({ type: 'varchar', length: 40, nullable: true, unique: true })
  code: string | null;

  /**
   * Cédula ecuatoriana o pasaporte (normalizado: sin espacios/guiones, mayúsculas).
   * Opcional: null si aún no se ha sacado. Ver `document-id.util.ts`.
   */
  @Column({ type: 'varchar', length: 20, nullable: true })
  documentId: string | null;

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  @Column({ type: 'date' })
  birthDate: string;

  @Column({ type: 'varchar', length: 8, default: 'other' })
  gender: ChildGender;

  /** Foto de perfil del niño (carnet). */
  @Column({ type: 'text', default: '' })
  photoUrl: string;

  @Column({ type: 'uuid', nullable: true })
  classroomId: string | null;

  @ManyToOne(() => Classroom, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'classroomId' })
  classroom: Classroom | null;

  // --- Ficha de salud (visible para el personal y para sus representantes) ---

  /** Alergias conocidas. Se muestra destacado en el panel del día: es información crítica. */
  @Column({ type: 'text', default: '' })
  allergies: string;

  @Column({ type: 'text', default: '' })
  medicalConditions: string;

  /** Medicación habitual y pauta. */
  @Column({ type: 'text', default: '' })
  medications: string;

  @Column({ type: 'varchar', length: 8, default: '' })
  bloodType: string;

  @Column({ default: '' })
  pediatricianName: string;

  @Column({ default: '' })
  pediatricianPhone: string;

  @Column({ default: '' })
  insurance: string;

  /** Contacto de emergencia distinto de los representantes. */
  @Column({ default: '' })
  emergencyContactName: string;

  @Column({ default: '' })
  emergencyContactPhone: string;

  // --- Rutinas y preferencias ---

  /** Restricciones o preferencias alimentarias (sin lactosa, vegetariano…). */
  @Column({ type: 'text', default: '' })
  dietaryNotes: string;

  /** Hábitos de sueño: a qué hora duerme, si necesita peluche, cuánto suele dormir. */
  @Column({ type: 'text', default: '' })
  napNotes: string;

  /** Personas autorizadas a retirarlo además de los representantes registrados. */
  @Column({ type: 'text', default: '' })
  authorizedPickupNotes: string;

  /** Observaciones internas del personal. Los representantes NO ven este campo. */
  @Column({ type: 'text', default: '' })
  internalNotes: string;

  @Column({ type: 'date', nullable: true })
  enrolledAt: string | null;

  @Column({ default: true })
  active: boolean;

  @OneToMany(() => ChildGuardian, (cg) => cg.child)
  guardianLinks: ChildGuardian[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
