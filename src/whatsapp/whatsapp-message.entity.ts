import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * - `queued`: creado, aún no se intentó enviar.
 * - `manual_pending`: el proveedor manual generó el enlace wa.me; espera a que la educadora pulse enviar.
 * - `sent`: confirmado por el proveedor (o marcado como enviado por quien lo mandó a mano).
 * - `failed`: el proveedor devolvió error.
 */
export type WhatsappStatus = 'queued' | 'manual_pending' | 'sent' | 'failed';

/**
 * Bitácora de todo lo que sale por WhatsApp.
 *
 * Existe independientemente del proveedor: con el envío manual deja constancia de a quién se
 * le abrió el chat y con qué texto; con la Cloud API guarda además el id del mensaje de Meta.
 * Sin esta tabla no habría forma de responder "¿le llegó el reporte del martes a la mamá?".
 */
@Entity('whatsapp_messages')
@Index(['createdAt'])
@Index(['childId'])
export class WhatsappMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Número destino en formato internacional sin '+' (5939XXXXXXX). */
  @Column({ default: '' })
  toPhone: string;

  @Column({ default: '' })
  toName: string;

  @Column({ type: 'uuid', nullable: true })
  childId: string | null;

  @Column({ type: 'uuid', nullable: true })
  guardianId: string | null;

  @Column({ type: 'uuid', nullable: true })
  reportId: string | null;

  /** 'manual' | 'cloud' | 'linked' */
  @Column({ type: 'varchar', length: 12, default: 'manual' })
  provider: string;

  @Column({ type: 'varchar', length: 16, default: 'queued' })
  status: WhatsappStatus;

  @Column({ type: 'text', default: '' })
  body: string;

  /** Enlace wa.me generado (sólo proveedor manual). */
  @Column({ type: 'text', default: '' })
  link: string;

  /** Id del mensaje devuelto por la Cloud API de Meta. */
  @Column({ default: '' })
  externalId: string;

  @Column({ type: 'text', default: '' })
  errorMessage: string;

  @Column({ type: 'uuid', nullable: true })
  sentById: string | null;

  /**
   * Origen del mensaje: 'report' | 'direct' | 'test' | 'arrival' | 'pickup' | 'health' |
   * 'justification'. Null en mensajes antiguos.
   */
  @Index()
  @Column({ type: 'varchar', length: 24, nullable: true })
  source: string | null;

  /** Id del registro que originó el aviso (asistencia, bitácora…). Sirve para no duplicar. */
  @Column({ type: 'uuid', nullable: true })
  sourceRef: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
