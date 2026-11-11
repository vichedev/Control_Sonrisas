import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, ChevronLeft, ChevronRight, Eye, EyeOff, Images, Pencil, Sparkles, Trash2, Users, X } from '../components/icons'
import { api, apiError, mediaUrl, shortDate, todayKey } from '../api/client'
import { useLoadEffect } from '../api/useLoadEffect'
import { useLiveReload } from '../realtime'
import { useToasts } from '../context/ToastsContext'
import { useAuth } from '../context/AuthContext'
import DayFilters from '../components/DayFilters'
import ConfirmDialog from '../components/ConfirmDialog'
import MomentCaptureModal from '../components/photos/MomentCaptureModal'
import PhotoEditModal from '../components/photos/PhotoEditModal'
import { photoTime, tagsLabel, useTaggableChildren } from '../components/photos/photoUtils'
import { Badge, Button, Card, EmptyState, inputClass, Loading, PageHeader } from '../components/ui'

/** Origen de la foto (campo `subject` del backend). */
const SUBJECT_LABEL = {
  activity: 'Actividades',
  moment: 'Momentos',
  child: 'Bitácora / niño',
  meal: 'Comidas',
  attendance: 'Llegadas',
  general: 'Grupales',
}

/** Galería de fotos del día, con control de qué se comparte con las familias. */
export default function GalleryPage() {
  const { pushToast } = useToasts()
  const { canManage, user } = useAuth()

  const [date, setDate] = useState(todayKey())
  const [classroomId, setClassroomId] = useState('')
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [share, setShare] = useState('') // '' | 'shared' | 'internal'
  const [subject, setSubject] = useState('')
  const [viewIndex, setViewIndex] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const [editing, setEditing] = useState(null)
  const [childId, setChildId] = useState('')
  const { items: kids } = useTaggableChildren(classroomId || undefined)

  const loadSeq = useRef(0)
  // `silent`: recarga en vivo, sin spinner ni toasts.
  const load = useCallback(async ({ silent = false } = {}) => {
    const seq = ++loadSeq.current
    if (!silent) setLoading(true)
    try {
      const res = await api.get('/photos', {
        // Con niño: todas las fotos en las que sale (aunque sean de otra sala).
        params: childId ? { date, childId } : { date, classroomId: classroomId || undefined },
      })
      if (seq !== loadSeq.current) return
      setPhotos(res.data || [])
    } catch (err) {
      if (!silent) pushToast({ type: 'error', message: apiError(err, 'No se pudo cargar la galería') })
    } finally {
      if (!silent) setLoading(false)
    }
  }, [date, classroomId, childId, pushToast])

  useLoadEffect(load)
  const quietReload = useCallback(() => load({ silent: true }), [load])
  // Con el visor abierto no se recarga (cambiaría la foto bajo el dedo); se pone al día al cerrarlo.
  const viewing = viewIndex !== null
  useLiveReload(quietReload, { entities: ['photo'], date, classroomId: classroomId || undefined }, { enabled: !viewing && !editing })

  const visible = useMemo(
    () =>
      photos.filter(
        (p) =>
          (!share || (share === 'shared' ? p.shareWithFamily : !p.shareWithFamily)) &&
          (!subject || p.subject === subject),
      ),
    [photos, share, subject],
  )
  const subjects = [...new Set(photos.map((p) => p.subject).filter(Boolean))]
  const internalCount = photos.filter((p) => !p.shareWithFamily).length
  const current = viewIndex != null ? visible[viewIndex] : null

  const toggleShare = async (photo) => {
    const next = !photo.shareWithFamily
    // Optimista: se revierte si falla.
    setPhotos((list) => list.map((p) => (p.id === photo.id ? { ...p, shareWithFamily: next } : p)))
    try {
      await api.patch(`/photos/${photo.id}`, { shareWithFamily: next })
      pushToast({
        type: 'success',
        message: next ? 'Ahora la familia la ve en su portal' : 'Foto marcada como interna',
      })
    } catch (err) {
      setPhotos((list) => list.map((p) => (p.id === photo.id ? { ...p, shareWithFamily: !next } : p)))
      pushToast({ type: 'error', message: apiError(err) })
    }
  }

  const remove = async () => {
    const photo = toDelete
    try {
      await api.delete(`/photos/${photo.id}`)
      setToDelete(null)
      setViewIndex(null)
      setPhotos((list) => list.filter((p) => p.id !== photo.id))
      pushToast({ type: 'success', message: 'Foto eliminada' })
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err) })
    }
  }

  return (
    <>
      <PageHeader
        title="Galería de fotos"
        subtitle={`${photos.length} foto(s) · ${shortDate(date)}`}
        icon={Images}
        actions={
          <>
            <DayFilters
              date={date}
              onDateChange={setDate}
              classroomId={classroomId}
              onClassroomChange={setClassroomId}
            />
            <div className="w-full sm:w-52">
              <select
                value={childId}
                onChange={(e) => setChildId(e.target.value)}
                className={`${inputClass} min-h-9`}
                aria-label="Filtrar por niño"
              >
                <option value="">Todos los niños</option>
                {kids.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            </div>
            <Button icon={Camera} onClick={() => setUploading(true)}>
              Añadir fotos
            </Button>
          </>
        }
      />

      {photos.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3">
          <Chip active={!share && !subject} onClick={() => { setShare(''); setSubject('') }}>
            Todas · {photos.length}
          </Chip>
          <Chip active={share === 'shared'} onClick={() => setShare(share === 'shared' ? '' : 'shared')}>
            <Eye className="w-3.5 h-3.5" /> Compartidas · {photos.length - internalCount}
          </Chip>
          <Chip active={share === 'internal'} onClick={() => setShare(share === 'internal' ? '' : 'internal')}>
            <EyeOff className="w-3.5 h-3.5" /> Internas · {internalCount}
          </Chip>
          {subjects.length > 1 &&
            subjects.map((s) => (
              <Chip key={s} active={subject === s} onClick={() => setSubject(subject === s ? '' : s)}>
                {SUBJECT_LABEL[s] || s} · {photos.filter((p) => p.subject === s).length}
              </Chip>
            ))}
        </div>
      )}

      <Card padded={false}>
        {loading ? (
          <Loading />
        ) : photos.length === 0 ? (
          <EmptyState
            icon={Images}
            title={childId ? 'Sin fotos de este niño ese día' : 'Sin fotos ese día'}
            message="Las fotos de momentos, actividades, llegadas, comidas y bitácora se recopilan aquí automáticamente."
            action={
              <Button icon={Camera} onClick={() => setUploading(true)}>
                Añadir fotos
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState icon={Images} title="Ninguna foto con ese filtro" />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2 sm:gap-3 p-2 sm:p-4">
            {visible.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setViewIndex(i)}
                aria-label={`Ver foto${p.caption ? `: ${p.caption}` : ''}`}
                className="group relative aspect-square rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
              >
                <img
                  src={mediaUrl(p.url)}
                  alt={p.caption || ''}
                  loading="lazy"
                  className="w-full h-full object-cover group-hover:opacity-90 transition"
                />
                {!p.shareWithFamily && (
                  <span className="absolute top-1.5 left-1.5">
                    <Badge tone="slate">
                      <EyeOff className="w-3 h-3" /> Interna
                    </Badge>
                  </span>
                )}
                <span className="absolute bottom-0 inset-x-0 bg-black/55 text-white px-2 py-1.5 text-left">
                  {p.caption && <span className="block text-[11px] truncate">{p.caption}</span>}
                  <span className="flex items-center gap-1 text-[10px] text-white/80 min-w-0">
                    <Users className="w-3 h-3 shrink-0" />
                    <span className="truncate">{tagsLabel(p.children)}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {current && (
        <Lightbox
          photo={current}
          index={viewIndex}
          total={visible.length}
          canDelete={canManage || current.uploadedById === user?.id}
          onEdit={() => setEditing(current)}
          onPrev={() => setViewIndex((i) => (i - 1 + visible.length) % visible.length)}
          onNext={() => setViewIndex((i) => (i + 1) % visible.length)}
          onClose={() => {
            setViewIndex(null)
            quietReload()
          }}
          onToggleShare={() => toggleShare(current)}
          onDelete={() => setToDelete(current)}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        variant="danger"
        title="¿Eliminar esta foto?"
        message="Desaparece de la galería, del portal de la familia y de los reportes."
        confirmText="Eliminar"
        onConfirm={remove}
      />

      {uploading && (
        <MomentCaptureModal
          open
          date={date}
          classroomId={classroomId || undefined}
          childId={childId || undefined}
          onClose={() => setUploading(false)}
          onSaved={() => quietReload()}
        />
      )}

      {editing && (
        <PhotoEditModal
          photo={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => setPhotos((list) => list.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)))}
        />
      )}
    </>
  )
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
        active
          ? 'bg-accent-soft text-accent-text ring-1 ring-inset ring-accent/25'
          : 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  )
}

/** Visor a pantalla completa: flechas/teclado para pasar fotos, Escape para cerrar. */
function Lightbox({ photo, index, total, canDelete, onEdit, onPrev, onNext, onClose, onToggleShare, onDelete }) {
  useEffect(() => {
    const onKey = (e) => {
      // Con un diálogo encima (editar), las teclas son suyas.
      if (document.querySelector('[role="dialog"][aria-labelledby]')) return
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') onPrev()
      else if (e.key === 'ArrowRight') onNext()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose, onPrev, onNext])

  const navBtn =
    'absolute top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center'

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" role="dialog" aria-modal="true" aria-label="Visor de fotos">
      <div className="flex items-center gap-3 px-4 py-3 text-white">
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{photo.caption || 'Foto'}</p>
          <p className="text-xs text-white/60">
            {shortDate(photo.date)} {photoTime(photo.takenAt || photo.createdAt)} · {index + 1} de {total}
            {photo.uploadedByName ? ` · ${photo.uploadedByName}` : ''}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-white/80">
            <span className="inline-flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              {photo.children?.length ? photo.children.map((c) => c.name).join(', ') : 'Foto de la sala (sin niños etiquetados)'}
            </span>
            {photo.activityTitle && (
              <span className="inline-flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" /> {photo.activityTitle}
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar visor"
          className="w-11 h-11 rounded-full hover:bg-white/10 flex items-center justify-center"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="relative flex-1 min-h-0 flex items-center justify-center px-2" onClick={onClose}>
        <img
          src={mediaUrl(photo.url)}
          alt={photo.caption || ''}
          className="max-w-full max-h-full object-contain rounded-lg"
          onClick={(e) => e.stopPropagation()}
        />
        {total > 1 && (
          <>
            <button
              type="button"
              aria-label="Foto anterior"
              className={`${navBtn} left-3`}
              onClick={(e) => {
                e.stopPropagation()
                onPrev()
              }}
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              type="button"
              aria-label="Foto siguiente"
              className={`${navBtn} right-3`}
              onClick={(e) => {
                e.stopPropagation()
                onNext()
              }}
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        <span
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold ${
            photo.shareWithFamily ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/10 text-white/80'
          }`}
        >
          {photo.shareWithFamily ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          {photo.shareWithFamily ? 'La ve la familia' : 'Interna (sólo personal)'}
        </span>
        <Button variant="secondary" className="min-h-11" onClick={onToggleShare}>
          {photo.shareWithFamily ? 'Marcar como interna' : 'Compartir con la familia'}
        </Button>
        <Button variant="secondary" icon={Pencil} className="min-h-11" onClick={onEdit}>
          Editar niños y pie
        </Button>
        {canDelete && (
          <Button variant="danger" icon={Trash2} className="min-h-11" onClick={onDelete}>
            Eliminar
          </Button>
        )}
      </div>
    </div>
  )
}
