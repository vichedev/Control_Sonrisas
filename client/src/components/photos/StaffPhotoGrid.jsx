import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Badge } from '../ui'
import { Clock, EyeOff, Pencil, Sparkles, Trash2, Users } from '../icons'
import { api, mediaUrl } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useToasts } from '../../context/ToastsContext'
import ConfirmDialog from '../ConfirmDialog'
import Lightbox from './Lightbox'
import PhotoEditModal from './PhotoEditModal'
import { apiError, photoTime, tagsLabel } from './photoUtils'

/**
 * Rejilla de fotos del personal: hora, pie, niños etiquetados, actividad y
 * acciones (editar etiquetas / pie, borrar). `onChange(next)` recibe la lista actualizada.
 */
export default function StaffPhotoGrid({ photos, onChange, showActivity = true, columns = 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4', emptyText }) {
  const { user, canManage } = useAuth()
  const { pushToast } = useToasts()
  const [viewing, setViewing] = useState(-1)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [busy, setBusy] = useState(false)

  const canDelete = (p) => canManage || p.uploadedById === user?.id

  const remove = async () => {
    setBusy(true)
    try {
      await api.delete(`/photos/${deleting.id}`)
      onChange?.(photos.filter((p) => p.id !== deleting.id))
      pushToast({ type: 'success', message: 'Foto eliminada' })
      setDeleting(null)
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo eliminar') })
    } finally {
      setBusy(false)
    }
  }

  if (!photos.length) {
    return emptyText ? <p className="text-sm text-slate-500 dark:text-white/45 py-2">{emptyText}</p> : null
  }

  const actionBtn =
    'inline-flex items-center gap-1 min-h-9 px-2 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-white/70 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring'

  return (
    <>
      <ul className={`grid ${columns} gap-3`}>
        {photos.map((p, i) => (
          <li key={p.id} className="rounded-xl border border-slate-200 dark:border-white/8 bg-white dark:bg-surface overflow-hidden shadow-xs flex flex-col">
            <button
              type="button"
              onClick={() => setViewing(i)}
              className="relative block aspect-4/3 bg-slate-100 dark:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
              aria-label={`Ver foto${p.caption ? `: ${p.caption}` : ''}`}
            >
              <img src={mediaUrl(p.url)} alt={p.caption || ''} loading="lazy" className="w-full h-full object-cover" />
              {p.shareWithFamily === false && (
                <span className="absolute top-2 left-2">
                  <Badge tone="slate" className="bg-white/90!">
                    <EyeOff className="w-3 h-3" /> Sólo personal
                  </Badge>
                </span>
              )}
            </button>
            <div className="p-2.5 flex-1 flex flex-col gap-1.5">
              {p.caption && <p className="text-sm text-slate-800 dark:text-white/85 leading-snug line-clamp-2">{p.caption}</p>}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-white/45">
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <Clock className="w-3.5 h-3.5" /> {photoTime(p.takenAt || p.createdAt)}
                </span>
                <span className="inline-flex items-center gap-1 min-w-0">
                  <Users className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate" title={(p.children || []).map((c) => c.name).join(', ')}>{tagsLabel(p.children)}</span>
                </span>
              </div>
              {showActivity && p.activityTitle && (
                <span>
                  <Badge tone="accent">
                    <Sparkles className="w-3 h-3" /> {p.activityTitle}
                  </Badge>
                </span>
              )}
              <div className="mt-auto flex items-center gap-1 pt-1 -ml-1">
                <button type="button" className={actionBtn} onClick={() => setEditing(p)}>
                  <Pencil className="w-4 h-4" /> Editar
                </button>
                {canDelete(p) && (
                  <button type="button" className={`${actionBtn} hover:text-red-600!`} onClick={() => setDeleting(p)}>
                    <Trash2 className="w-4 h-4" /> Borrar
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <Lightbox
        items={photos}
        index={viewing}
        onIndex={setViewing}
        onClose={() => setViewing(-1)}
        renderMeta={(p) =>
          p.children?.length ? (
            <p className="mt-1.5 text-xs text-white/70">Salen: {p.children.map((c) => c.name).join(', ')}</p>
          ) : (
            <p className="mt-1.5 text-xs text-white/70">Foto de la sala (sin niños etiquetados)</p>
          )
        }
      />

      {/* En portal: dentro de otro modal (detalle de actividad) un `fixed` quedaría recortado. */}
      {editing &&
        createPortal(
        <PhotoEditModal
          photo={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => onChange?.(photos.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)))}
        />,
          document.body,
        )}

      {createPortal(
      <ConfirmDialog
        open={!!deleting}
        onClose={() => !busy && setDeleting(null)}
        onConfirm={remove}
        loading={busy}
        variant="danger"
        title="¿Borrar esta foto?"
        message="Se quitará de la galería y del portal de las familias. No se puede deshacer."
        confirmText="Borrar foto"
      />,
        document.body,
      )}
    </>
  )
}
