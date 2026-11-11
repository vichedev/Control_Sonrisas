import { useEffect, useState } from 'react'
import PhotoCapture from '../PhotoCapture'
import { Camera, Info } from '../icons'
import { Button } from '../ui'
import ConsentWarning from './ConsentWarning'
import { useImageConsent } from './consentModel'

/**
 * Foto de UN niño respetando su consentimiento de imagen (LOPDP).
 * Sin autorización vigente oculta la cámara y muestra el aviso; el resto del formulario sigue usable.
 *
 * `exempt` (evidencia de retiro): la cámara sigue disponible; sin autorización la foto
 * queda como constancia interna y no se comparte con la familia.
 * `collapsed`: empieza como botón "Añadir foto" (formularios donde la foto es poco habitual).
 */
export default function ChildPhotoCapture({ childId, value, onChange, label = 'Foto (opcional)', compact = true, exempt = false, collapsed = false }) {
  const { loading, allowed } = useImageConsent(childId)
  const blocked = !loading && !allowed && !exempt
  const [open, setOpen] = useState(!collapsed)

  // Si cambia el niño y el nuevo no tiene autorización, se descarta la foto ya tomada.
  useEffect(() => {
    if (blocked && value) onChange('')
  }, [blocked, value, onChange])

  if (!childId) return null
  if (loading) return null
  if (blocked) return <ConsentWarning childId={childId} />
  if (!open && !value) {
    return (
      <Button type="button" variant="secondary" icon={Camera} onClick={() => setOpen(true)}>
        Añadir foto
      </Button>
    )
  }
  return (
    <div className="space-y-2">
      <PhotoCapture value={value} onChange={onChange} label={label} compact={compact} />
      {exempt && !allowed && (
        <p className="flex gap-2 text-xs text-slate-500 dark:text-white/45">
          <Info className="w-4 h-4 shrink-0" aria-hidden="true" />
          Sin autorización de imagen: la foto queda sólo como constancia interna del retiro y no se comparte con la familia.
        </p>
      )}
    </div>
  )
}
