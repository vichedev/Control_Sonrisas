import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Configuración (única) de marca/branding del sitio: nombre de empresa, logo,
 * color principal. Se sirve público en GET /branding para que el login y el
 * resto de páginas puedan personalizarse sin redeploy.
 */
@Entity('app_branding')
export class AppBranding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: 'Sonrisas' })
  companyName: string;

  @Column({ default: 'Control de asistencia con reconocimiento facial' })
  tagline: string;

  /** URL pública de la imagen del logo. Vacío → se usa el isotipo por defecto. */
  @Column({ type: 'text', default: '' })
  logoUrl: string;

  /** Color principal (hex). El frontend lo usa para tonos de acento. */
  @Column({ type: 'varchar', length: 9, default: '#4f46e5' })
  primaryColor: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
