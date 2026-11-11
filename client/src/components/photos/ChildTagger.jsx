import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import ChildPicker from '../ChildPicker'
import { Badge } from '../ui'
import { ShieldAlert } from '../icons'
import { Skeleton } from '../ui'

const STATUS_TEXT = { denied: 'No autorizado', pending: 'Pendiente' }

/**
 * "¿Quién sale en la foto?" — selector de niños que respeta el consentimiento de imagen.
 * Los niños sin autorización vigente aparecen deshabilitados y listados con su estado.
 *
 * props: items (de useTaggableChildren), value (ids), onChange(ids), loading,
 *        quickSelect (p. ej. [{ label: 'Participantes', ids }]), canManageConsents
 */
export default function ChildTagger({ items, value, onChange, loading = false, quickSelect = [], canManageConsents = false, label = 'Niños en la foto' }) {
  const blocked = useMemo(() => items.filter((c) => c.imageStatus !== 'granted'), [items])
  const blockedIds = useMemo(() => blocked.map((c) => c.id), [blocked])
  // Una etiqueta preseleccionada de un niño sin permiso se quita (nunca se envía).
  const allowedQuick = useMemo(
    () =>
      quickSelect.map((q) => ({
        ...q,
        ids: (Array.isArray(q.ids) ? q.ids : []).filter((id) => !blockedIds.includes(id)),
      })),
    [quickSelect, blockedIds],
  )

  if (loading) {
    return (
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" aria-busy="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-22 rounded-lg" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      <ChildPicker
        items={items}
        value={value}
        onChange={(ids) => onChange(ids.filter((id) => !blockedIds.includes(id)))}
        disabledIds={blockedIds}
        quickSelect={allowedQuick}
        label={label}
        renderMeta={(c) =>
          c.imageStatus !== 'granted' ? <Badge tone={c.imageStatus === 'denied' ? 'red' : 'amber'}>Sin autorización</Badge> : null
        }
        emptyMessage="No hay niños en esta sala."
      />
      <p className="text-xs text-slate-500 dark:text-white/45 tabular-nums">
        {value.length === 0
          ? 'Sin niños etiquetados: quedará como foto de la sala.'
          : value.length === 1
            ? '1 niño etiquetado: la foto aparecerá en su galería del día.'
            : `${value.length} niños etiquetados: la foto aparecerá en la galería de cada uno.`}
      </p>
      {blocked.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
          <p className="flex items-center gap-1.5 font-medium">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            {blocked.length === 1 ? '1 niño no puede salir en fotos' : `${blocked.length} niños no pueden salir en fotos`}{' '}
            (sin autorización de imagen):
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {blocked.map((c) => (
              <li key={c.id}>
                <Badge tone={c.imageStatus === 'denied' ? 'red' : 'amber'}>
                  {c.name} · {STATUS_TEXT[c.imageStatus] || 'Pendiente'}
                </Badge>
              </li>
            ))}
          </ul>
          <p className="mt-1.5">
            Evita que aparezcan en el encuadre.
            {canManageConsents && (
              <>
                {' '}
                <Link to="/panel/consentimientos" className="font-medium underline underline-offset-2">
                  Ver consentimientos
                </Link>
              </>
            )}
          </p>
        </div>
      )}
    </div>
  )
}
