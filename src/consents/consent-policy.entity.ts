import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { ConsentType } from './consent.types';

/**
 * Texto de una política de consentimiento, versionado.
 *
 * Editar un texto crea SIEMPRE una versión nueva; las anteriores se conservan como
 * prueba de qué se le mostró a cada familia cuando decidió.
 */
@Entity('consent_policies')
@Index(['type', 'version'], { unique: true })
@Index(['type', 'active'])
export class ConsentPolicy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  type: ConsentType;

  @Column({ type: 'int' })
  version: number;

  /**
   * Las decisiones tomadas desde esta versión siguen valiendo. Si el cambio exige
   * renovar el consentimiento, coincide con `version`; si es una corrección menor,
   * hereda la de la versión anterior.
   */
  @Column({ type: 'int' })
  baseVersion: number;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  /** Texto plano con saltos de línea. `{centro}` se sustituye por el nombre del centro. */
  @Column({ type: 'text' })
  body: string;

  /** true = acuse obligatorio (tratamiento de datos). */
  @Column({ type: 'boolean', default: false })
  required: boolean;

  /** Sólo una versión activa por tipo. */
  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'timestamptz' })
  publishedAt: Date;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @Column({ type: 'varchar', length: 160, default: '' })
  createdByName: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
