import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Ajustes de los avisos automáticos por WhatsApp (fila única).
 * Sólo aplican al WhatsApp vinculado: nunca se abren enlaces wa.me por un aviso automático.
 */
@Entity('whatsapp_settings')
export class WhatsappSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Interruptor general. Apagado hasta que dirección vincule el número y lo active. */
  @Column({ default: false })
  enabled: boolean;

  /** Llegada a la guardería. */
  @Column({ default: true })
  notifyArrival: boolean;

  /** Retiro (salida). */
  @Column({ default: true })
  notifyPickup: boolean;

  /** Aviso de salud o incidente marcado "avisar a la familia". */
  @Column({ default: true })
  notifyHealth: boolean;

  /** Justificación de ausencia aprobada o rechazada. */
  @Column({ default: true })
  notifyJustification: boolean;

  /** Horario de silencio 'HH:mm' (no se envían avisos). Vacío = sin silencio. */
  @Column({ type: 'varchar', length: 5, default: '20:00' })
  quietStart: string;

  @Column({ type: 'varchar', length: 5, default: '06:30' })
  quietEnd: string;

  /** Firma al pie de cada aviso. Vacía = nombre del centro (branding). */
  @Column({ type: 'varchar', length: 120, default: '' })
  signature: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
