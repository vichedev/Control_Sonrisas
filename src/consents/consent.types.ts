/** Tipos de consentimiento que gestiona el sistema. */
export const CONSENT_TYPES = ['data_processing', 'images', 'whatsapp'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

/** Cómo se obtuvo: desde el portal familiar o por formulario en papel registrado por el personal. */
export const CONSENT_METHODS = ['portal', 'presencial'] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

export type ConsentStatusValue = 'granted' | 'denied' | 'pending';

/** Estado vigente de un consentimiento de un niño. */
export interface ConsentStatus {
  status: ConsentStatusValue;
  /** Fecha de la decisión vigente (null si nunca se decidió). */
  at: Date | null;
  /** Nombre de quien decidió (representante) o registró (personal). */
  by: string;
  method: ConsentMethod | null;
  /** Versión del texto que se aceptó/rechazó. */
  version: number | null;
  /** Versión vigente del texto. */
  currentVersion: number;
  /** true: había una autorización sobre un texto anterior que exige renovarse. */
  outdated: boolean;
}

export type ChildConsentSummary = Record<ConsentType, ConsentStatus>;

export const CONSENT_LABEL: Record<ConsentType, string> = {
  data_processing: 'Tratamiento de datos',
  images: 'Uso de imagen',
  whatsapp: 'Avisos por WhatsApp',
};
