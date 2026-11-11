import { AlertTriangle, CheckCircle2 } from '../icons'
import { useClassroomPhotoCheck, useImageConsent } from './consentModel'

const PENDING_HINT = 'Pendiente = la familia aún no responde; mientras tanto no se le toman fotos.'

/**
 * Aviso de consentimiento de imagen antes de tomar una foto.
 *
 * Modo grupal  — `classroomId`: lista los niños de la sala que NO deben aparecer en la foto.
 *               También acepta `withoutConsent` ya cargado ([{ id, name, status }]) para no repetir la consulta.
 * Modo niño    — `childId`: avisa si a ese niño no se le puede tomar foto individual.
 *
 * Props: classroomId?, childId?, withoutConsent?, showOk? (muestra una línea verde si todo está en orden),
 *        className?. No renderiza nada mientras carga.
 */
export default function ConsentWarning({ classroomId, childId, withoutConsent, showOk = false, className = '' }) {
  if (childId) return <ChildWarning childId={childId} showOk={showOk} className={className} />
  return (
    <GroupWarning classroomId={withoutConsent ? null : classroomId} preset={withoutConsent} showOk={showOk} className={className} />
  )
}

function GroupWarning({ classroomId, preset, showOk, className }) {
  const check = useClassroomPhotoCheck(classroomId)
  const list = preset || check.withoutConsent
  if (!preset && (check.loading || !classroomId)) return null
  if (!list.length) {
    return showOk ? <OkLine className={className}>Todos los niños de la sala tienen autorización de imagen.</OkLine> : null
  }
  const denied = list.filter((c) => c.status === 'denied')
  const pending = list.filter((c) => c.status !== 'denied')
  return (
    <div
      role="note"
      className={`flex gap-3 rounded-lg border border-amber-300/70 dark:border-amber-400/25 bg-amber-50 dark:bg-amber-500/10 px-3.5 py-3 text-sm text-amber-900 dark:text-amber-100 ${className}`}
    >
      <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-300 mt-0.5" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium">
          {list.length === 1 ? 'Este niño no debe aparecer en la foto' : `Estos ${list.length} niños no deben aparecer en la foto`}
        </p>
        {denied.length > 0 && (
          <p className="mt-1">
            <span className="font-medium">Sin autorización:</span> {denied.map((c) => c.name).join(', ')}
          </p>
        )}
        {pending.length > 0 && (
          <p className="mt-1">
            <span className="font-medium">Pendiente de respuesta:</span> {pending.map((c) => c.name).join(', ')}
          </p>
        )}
        {pending.length > 0 && <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-100/70">{PENDING_HINT}</p>}
      </div>
    </div>
  )
}

function ChildWarning({ childId, showOk, className }) {
  const { loading, status, allowed, name } = useImageConsent(childId)
  if (loading) return null
  if (allowed) {
    return showOk ? <OkLine className={className}>{name ? `${name}: foto autorizada por la familia.` : 'Foto autorizada por la familia.'}</OkLine> : null
  }
  return (
    <div
      role="alert"
      className={`flex gap-3 rounded-lg border border-red-300/70 dark:border-red-400/25 bg-red-50 dark:bg-red-500/10 px-3.5 py-3 text-sm text-red-900 dark:text-red-100 ${className}`}
    >
      <AlertTriangle className="w-5 h-5 shrink-0 text-red-600 dark:text-red-300 mt-0.5" aria-hidden="true" />
      <div>
        <p className="font-medium">
          {status === 'denied'
            ? `La familia${name ? ` de ${name}` : ''} no autorizó fotos.`
            : `Falta la autorización de imagen${name ? ` de ${name}` : ''}.`}
        </p>
        <p className="mt-0.5">No se puede guardar una foto individual. Puede registrar el resto sin foto.</p>
      </div>
    </div>
  )
}

function OkLine({ children, className }) {
  return (
    <p className={`flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 ${className}`}>
      <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
      {children}
    </p>
  )
}
