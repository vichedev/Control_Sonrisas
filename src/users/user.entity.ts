import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ChildGuardian } from '../children/child-guardian.entity';

/**
 * Roles del sistema Sonrisas.
 *
 * - `admin`: dirección. Acceso total: salas, personal, configuración, auditoría, seguridad.
 * - `coordinator`: coordinación pedagógica. Ve todo, aprueba justificaciones, asigna pendientes
 *   y envía reportes; no toca configuración, auditoría ni administra cuentas.
 * - `teacher`: educadora / auxiliar. Registra entradas, salidas, comidas, actividades y bitácora
 *   de los niños, y marca su propia asistencia.
 * - `guardian`: representante (madre, padre, tutor). Sólo entra al portal familiar para ver el
 *   historial, las fotos y los reportes de SUS niños. No ve nada del resto de la guardería.
 */
export type UserRole = 'admin' | 'coordinator' | 'teacher' | 'guardian';

/** Roles que trabajan en la guardería (todo lo que no es representante). */
export const STAFF_ROLES: UserRole[] = ['admin', 'coordinator', 'teacher'];

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  /** Hash bcrypt. `select: false`: no se devuelve en las consultas salvo que se pida explícitamente. */
  @Column({ select: false })
  password: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', length: 16, default: 'teacher' })
  role: UserRole;

  // --- Datos de la persona ---

  /** Cédula / documento de identidad */
  @Column({ type: 'varchar', length: 40, nullable: true, unique: true })
  code: string | null;

  /** Cargo: Educadora, Auxiliar, Coordinadora, Nutricionista… (vacío para representantes) */
  @Column({ default: '' })
  position: string;

  /**
   * Sala principal asignada (sólo educadoras). Es organizativo: el permiso real de escritura
   * lo da el rol, no la sala.
   */
  @Column({ type: 'uuid', nullable: true })
  classroomId: string | null;

  /** Teléfono. Para representantes es el número al que se envía el reporte por WhatsApp. */
  @Column({ default: '' })
  phone: string;

  /** Foto de perfil */
  @Column({ type: 'text', default: '' })
  photoUrl: string;

  /** Si está activo puede iniciar sesión */
  @Column({ default: true })
  active: boolean;

  /**
   * Notas internas del personal sobre esta persona. Sólo visibles para admin/coordinación —
   * el propio usuario nunca ve este campo. Límite aplicado en el DTO (4000 chars).
   */
  @Column({ type: 'text', default: '' })
  internalNotes: string;

  // --- 2FA (TOTP, compatible con Google/Microsoft Authenticator) ---
  /** Secreto base32 generado al activar 2FA. `select: false`: no se devuelve nunca, salvo consulta explícita. */
  @Column({ type: 'varchar', length: 64, default: '', select: false })
  totpSecret: string;

  @Column({ default: false })
  totpEnabled: boolean;

  /**
   * Versión del token JWT. Cada vez que se rota (cambio de pw, "cerrar todas las sesiones")
   * se incrementa, lo que invalida cualquier JWT emitido con la versión anterior.
   */
  @Column({ type: 'int', default: 0 })
  tokenVersion: number;

  /** Si es true, el frontend obliga a fijar una contraseña nueva antes de usar la app. */
  @Column({ default: false })
  mustChangePassword: boolean;

  // --- Bloqueo por intentos fallidos (anti fuerza bruta) ---
  @Column({ type: 'int', default: 0 })
  failedLoginAttempts: number;

  /** Si está en el futuro, la cuenta rechaza cualquier login hasta esa hora. */
  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  /** Niños a cargo (sólo para role = 'guardian'). */
  @OneToMany(() => ChildGuardian, (cg) => cg.guardian)
  childLinks: ChildGuardian[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
