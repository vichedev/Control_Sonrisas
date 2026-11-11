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

/** `in` = llegada a la guardería, `out` = retiro. */
export type ChildAttendanceType = 'in' | 'out';

/** Estado con el que llega o se va el niño. Alimenta el reporte diario. */
export type ChildMood =
  | ''
  | 'happy'
  | 'calm'
  | 'sleepy'
  | 'sad'
  | 'crying'
  | 'irritable'
  | 'sick';

/**
 * Entrada o salida de un niño.
 *
 * Siempre la registra un miembro del personal (`recordedById`) — el niño no interactúa con la
 * app. La foto es opcional pero recomendada: deja constancia del estado en que llegó o se fue.
 */
@Entity('child_attendances')
@Index(['childId', 'createdAt'])
@Index(['date', 'type'])
// Una sola llegada y un solo retiro por niño y día (evita dobles toques).
@Index('UQ_child_attendance_day_type', ['childId', 'date', 'type'], { unique: true })
export class ChildAttendance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  childId: string;

  @ManyToOne(() => Child, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'childId' })
  child: Child;

  @Column({ type: 'varchar', length: 8 })
  type: ChildAttendanceType;

  /** Día local del registro (YYYY-MM-DD). Redundante con createdAt pero hace triviales
   *  las consultas "qué pasó hoy" sin depender de la zona horaria del servidor. */
  @Column({ type: 'date' })
  date: string;

  /** Foto tomada en el momento (opcional). */
  @Column({ type: 'text', default: '' })
  photoUrl: string;

  @Column({ type: 'varchar', length: 12, default: '' })
  mood: ChildMood;

  /** Temperatura en °C al llegar, si se toma. Null si no se midió. */
  @Column({ type: 'float', nullable: true })
  temperature: number | null;

  // --- Quién entrega / retira al niño ---

  @Column({ default: '' })
  personName: string;

  @Column({ default: '' })
  personRelationship: string;

  /** Cédula de quien retira: lo que se comprueba de verdad en la puerta. */
  @Column({ default: '' })
  personDocument: string;

  /** Representante registrado que entregó/retiró, si se seleccionó de la lista. */
  @Column({ type: 'uuid', nullable: true })
  guardianId: string | null;

  /**
   * True si el retiro lo hizo alguien que NO está en la lista de autorizados.
   * No bloquea la operación (a veces es legítimo y urgente) pero queda señalado
   * y aparece en la bandeja de revisión de coordinación.
   */
  @Column({ default: false })
  flagged: boolean;

  @Column({ type: 'text', default: '' })
  flagReason: string;

  @Column({ type: 'text', default: '' })
  notes: string;

  /**
   * Evaluación contra el horario configurado:
   * '' | 'on_time' | 'late_arrival' | 'early_pickup' | 'late_pickup'
   */
  @Column({ type: 'varchar', length: 16, default: '' })
  scheduleStatus: string;

  /** Minutos de desfase respecto al horario (tardanza o retiro tardío). */
  @Column({ type: 'int', default: 0 })
  scheduleMinutes: number;

  /** Miembro del personal que hizo el registro. */
  @Column({ type: 'uuid', nullable: true })
  recordedById: string | null;

  @Column({ default: '' })
  recordedByName: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
