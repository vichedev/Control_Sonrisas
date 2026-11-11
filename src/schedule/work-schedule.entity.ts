import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Config de un día de la semana (clave "0"=domingo … "6"=sábado). */
export interface DaySchedule {
  enabled: boolean;
  /** Hora en que abre la guardería / entrada de los niños. */
  start: string; // "HH:mm"
  /** Hora de cierre / retiro de los niños. */
  end: string; // "HH:mm"
  /** Inicio del almuerzo del personal. Vacío = sin receso programado. */
  lunchStart?: string;
  lunchEnd?: string;
}

export interface Holiday {
  date: string; // "YYYY-MM-DD"
  name: string;
}

/**
 * Horario (único) de la guardería. Lo configura la dirección.
 *
 * Sirve para dos cosas: etiquetar la llegada del niño (a tiempo / tarde) y el retiro
 * (a tiempo / tardío), y evaluar la jornada del personal. Si `enabled` es false no se
 * evalúa nada: las horas se registran igual, sin etiqueta.
 */
@Entity('work_schedule')
export class WorkSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: 'Horario de la guardería' })
  name: string;

  @Column({ default: false })
  enabled: boolean;

  /** Config por día de la semana: { "0": {enabled,start,end}, ... "6": {...} } */
  @Column({ type: 'jsonb', nullable: true })
  days: Record<string, DaySchedule> | null;

  // --- Niños ---

  /** Minutos de tolerancia tras la hora de apertura antes de marcar la llegada como tardía. */
  @Column({ type: 'int', default: 15 })
  lateArrivalAfterMinutes: number;

  /**
   * Hora límite de retiro. Pasada esa hora (más la tolerancia) el retiro se etiqueta como
   * tardío, que es lo que muchas guarderías facturan aparte.
   */
  @Column({ type: 'varchar', length: 5, default: '' })
  pickupDeadline: string; // "HH:mm" o ''

  @Column({ type: 'int', default: 10 })
  latePickupAfterMinutes: number;

  /**
   * Hora a la que se generan automáticamente los reportes diarios pendientes.
   * Vacío = sólo generación manual.
   */
  @Column({ type: 'varchar', length: 5, default: '17:00' })
  reportGenerationTime: string;

  // --- Personal ---

  @Column({ default: true })
  staffAttendanceEnabled: boolean;

  /** Minutos tras la hora de entrada para empezar a contar tardanza del personal. */
  @Column({ type: 'int', default: 5 })
  lateAfterMinutes: number;

  @Column({ type: 'int', default: 120 })
  absentAfterMinutes: number;

  @Column({ default: false })
  overtimeEnabled: boolean;

  @Column({ type: 'int', default: 0 })
  overtimeAfterMinutes: number;

  @Column({ default: false })
  earlyLeaveEnabled: boolean;

  @Column({ type: 'int', default: 5 })
  earlyLeaveBeforeMinutes: number;

  /** Días festivos / no laborables (además de los días cerrados de la semana). */
  @Column({ type: 'jsonb', nullable: true })
  holidays: Holiday[] | null;

  // --- Datos del centro (aparecen en los reportes que recibe la familia) ---

  @Column({ default: '' })
  centerName: string;

  @Column({ default: '' })
  centerAddress: string;

  @Column({ default: '' })
  centerPhone: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
