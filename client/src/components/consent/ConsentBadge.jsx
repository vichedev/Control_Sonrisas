import { Camera, CheckCircle2, CircleDashed, FileText, WhatsappLogo, XCircle } from '../icons'
import { Badge } from '../ui'
import { CONSENT_LABEL, STATUS_LABEL, STATUS_TONE, statusOf } from './consentModel'

const TYPE_ICON = { images: Camera, whatsapp: WhatsappLogo, data_processing: FileText }
const STATUS_ICON = { granted: CheckCircle2, denied: XCircle, pending: CircleDashed }

/** Etiqueta corta del tipo para el modo `showType`. */
const SHORT_TYPE = { images: 'Fotos', whatsapp: 'WhatsApp', data_processing: 'Datos' }

/**
 * Chip de estado de un consentimiento.
 *
 * Props:
 *   status   : 'granted' | 'denied' | 'pending' o el objeto de estado del backend
 *              ({ status, outdated, at, by… }).
 *   type     : 'images' (por defecto) | 'whatsapp' | 'data_processing'.
 *   showType : antepone el tipo ("Fotos: Autorizado"). Útil en listas con varios chips.
 *   iconOnly : sólo icono (con texto accesible), para tablas densas.
 */
export default function ConsentBadge({ status, type = 'images', showType = false, iconOnly = false, className = '' }) {
  const value = statusOf(status)
  const outdated = typeof status === 'object' && status?.outdated
  const TypeIcon = TYPE_ICON[type] || Camera
  const StatusIcon = STATUS_ICON[value] || CircleDashed
  const text = outdated && value === 'pending' ? 'Renovar' : STATUS_LABEL[value]
  const full = `${CONSENT_LABEL[type] || type}: ${text}${outdated ? ' (texto actualizado, falta renovar)' : ''}`

  if (iconOnly) {
    return (
      <Badge tone={STATUS_TONE[value]} className={`!px-1 ${className}`}>
        <span title={full} className="inline-flex items-center gap-0.5">
          <TypeIcon className="w-3.5 h-3.5" aria-hidden="true" />
          <StatusIcon className="w-3 h-3" aria-hidden="true" />
          <span className="sr-only">{full}</span>
        </span>
      </Badge>
    )
  }

  return (
    <Badge tone={STATUS_TONE[value]} className={className}>
      <span title={full} className="inline-flex items-center gap-1">
        <TypeIcon className="w-3.5 h-3.5" aria-hidden="true" />
        {showType && <span>{SHORT_TYPE[type] || type}:</span>}
        <span>{text}</span>
        {!showType && <span className="sr-only"> — {CONSENT_LABEL[type]}</span>}
      </span>
    </Badge>
  )
}

/** Los tres chips juntos (ficha del niño, tablas). `consents` = objeto del backend. */
export function ConsentBadges({ consents, iconOnly = false, className = '' }) {
  if (!consents) return null
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {['images', 'whatsapp', 'data_processing'].map((t) => (
        <ConsentBadge key={t} type={t} status={consents[t]} showType={!iconOnly} iconOnly={iconOnly} />
      ))}
    </span>
  )
}
