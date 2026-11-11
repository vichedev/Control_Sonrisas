import { useEffect, useMemo, useState } from 'react'
import Modal from '../Modal'
import { Button, Field, inputClass, SectionTitle } from '../ui'
import { Camera, Upload } from '../icons'
import { api, todayKey } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useToasts } from '../../context/ToastsContext'
import PhotoUploader from './PhotoUploader'
import ChildTagger from './ChildTagger'
import { apiError, blockedFromError, uploadPhoto, useTaggableChildren } from './photoUtils'

/**
 * "Momento del día" / "Fotos de la actividad": varias fotos + pie + niños que salen
 * (+ actividad de hoy opcional). Sube una foto por petición, con progreso por foto;
 * si un niño no tiene autorización de imagen, se le quita la etiqueta y se avisa.
 *
 * props:
 *  - open, onClose, onSaved(photos)
 *  - classroomId     sala (lista de niños y actividades)
 *  - childId         niño desde el que se abrió (etiquetado por defecto)
 *  - defaultChildIds etiquetas iniciales (p. ej. participantes de la actividad)
 *  - activityId      actividad fija (desde la ficha de la actividad)
 *  - activityTitle   para el título
 *  - quickSelect     accesos rápidos del selector de niños
 *  - date            día (por defecto hoy)
 *  - inline          sin modal: se dibuja dentro de otra vista (p. ej. el detalle de la actividad)
 */
export default function MomentCaptureModal({
  open,
  onClose,
  onSaved,
  classroomId,
  childId,
  defaultChildIds,
  activityId: fixedActivityId,
  activityTitle,
  quickSelect = [],
  date,
  inline = false,
  defaultShare = true,
}) {
  const { canManage } = useAuth()
  const { pushToast } = useToasts()
  const day = date || todayKey()
  const { items: kids, loading: kidsLoading } = useTaggableChildren(classroomId, { enabled: open })
  const [photos, setPhotos] = useState([])
  const [tags, setTags] = useState(() => defaultChildIds || (childId ? [childId] : []))
  const [activityId, setActivityId] = useState(fixedActivityId || '')
  const [activities, setActivities] = useState([])
  const [shareWithFamily, setShareWithFamily] = useState(defaultShare)
  const [busy, setBusy] = useState(false)

  // Actividades de hoy de la sala, para enlazar el momento (opcional).
  useEffect(() => {
    if (!open || fixedActivityId || !classroomId) return undefined
    let cancelled = false
    api
      .get('/activities', { params: { date: day, classroomId } })
      .then(({ data }) => !cancelled && setActivities(Array.isArray(data) ? data : data?.items || []))
      .catch(() => !cancelled && setActivities([]))
    return () => {
      cancelled = true
    }
  }, [open, fixedActivityId, classroomId, day])

  // Las etiquetas por defecto sin autorización se quitan en cuanto se conoce el estado.
  const allowedTags = useMemo(() => {
    if (kidsLoading) return tags
    const ok = new Set(kids.filter((k) => k.imageStatus === 'granted').map((k) => k.id))
    return tags.filter((id) => ok.has(id))
  }, [tags, kids, kidsLoading])

  const pending = photos.filter((p) => p.status !== 'done')
  const doneCount = photos.length - pending.length

  const close = () => {
    if (busy) return
    onClose?.()
  }

  const save = async () => {
    if (!pending.length) return
    setBusy(true)
    let currentTags = allowedTags
    const saved = []
    let failed = 0
    for (const it of pending) {
      setPhotos((prev) => prev.map((p) => (p.key === it.key ? { ...p, status: 'uploading', progress: 0, error: '' } : p)))
      try {
        const photo = await uploadPhoto(
          {
            dataUrl: it.dataUrl,
            childIds: currentTags,
            caption: it.caption,
            activityId: activityId || undefined,
            classroomId: classroomId || undefined,
            subject: activityId ? 'activity' : currentTags.length ? 'moment' : 'general',
            date: day,
            shareWithFamily,
          },
          (progress) => setPhotos((prev) => prev.map((p) => (p.key === it.key ? { ...p, progress } : p))),
        )
        saved.push(photo)
        setPhotos((prev) => prev.map((p) => (p.key === it.key ? { ...p, status: 'done', progress: 1 } : p)))
      } catch (err) {
        failed += 1
        const blocked = blockedFromError(err)
        if (blocked.length) {
          // Se quitan de la foto y se avisa: la educadora decide si reintenta.
          const ids = blocked.map((b) => b.id)
          currentTags = currentTags.filter((id) => !ids.includes(id))
          setTags((prev) => prev.filter((id) => !ids.includes(id)))
        }
        const message = blocked.length
          ? `Sin autorización de imagen: ${blocked.map((b) => b.name).join(', ')}. Se quitó de la foto; pulsa «Reintentar».`
          : apiError(err, 'No se pudo subir la foto')
        setPhotos((prev) => prev.map((p) => (p.key === it.key ? { ...p, status: 'error', error: message } : p)))
      }
    }
    setBusy(false)
    if (saved.length) onSaved?.(saved)
    if (!failed) {
      pushToast({ type: 'success', message: saved.length === 1 ? 'Foto guardada' : `${saved.length} fotos guardadas` })
      onClose?.()
    } else {
      pushToast({
        type: 'error',
        message: saved.length ? `${saved.length} guardadas, ${failed} con error` : 'No se pudo guardar ninguna foto',
      })
    }
  }

  const title = fixedActivityId ? 'Fotos de la actividad' : 'Momento del día'
  const subtitle = fixedActivityId && activityTitle ? activityTitle : 'Fotos de lo que están haciendo, para sus familias'
  const anyError = photos.some((p) => p.status === 'error')

  const footer = (
    <div className="flex w-full flex-wrap items-center justify-between gap-3">
      <span className="text-xs text-slate-500 dark:text-white/45 tabular-nums">
        {photos.length === 0
          ? 'Añade al menos una foto'
          : `${pending.length} por subir${doneCount ? ` · ${doneCount} guardadas` : ''}`}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={close} disabled={busy}>
          {doneCount && !pending.length ? 'Cerrar' : 'Cancelar'}
        </Button>
        <Button icon={anyError ? Upload : Camera} onClick={save} loading={busy} disabled={!pending.length}>
          {anyError ? 'Reintentar' : pending.length > 1 ? `Guardar ${pending.length} fotos` : 'Guardar foto'}
        </Button>
      </div>
    </div>
  )

  const body = (
    <div className="space-y-5">
      <section className="space-y-2">
        <SectionTitle>Fotos</SectionTitle>
        <PhotoUploader items={photos} setItems={setPhotos} disabled={busy} />
      </section>

      <section className="space-y-2">
        <SectionTitle hint={allowedTags.length ? `${allowedTags.length} seleccionados` : undefined}>¿Quién sale en la foto?</SectionTitle>
        <ChildTagger
          items={kids}
          loading={kidsLoading}
          value={allowedTags}
          onChange={setTags}
          quickSelect={quickSelect}
          canManageConsents={canManage}
        />
      </section>

      {!fixedActivityId && activities.length > 0 && (
        <Field label="Actividad (opcional)" hint="Enlázala si la foto es de una actividad de hoy.">
          <select value={activityId} onChange={(e) => setActivityId(e.target.value)} className={inputClass} disabled={busy}>
            <option value="">Sin actividad · momento del día</option>
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </Field>
      )}

      <label className="flex items-start gap-3 rounded-lg border border-slate-200 dark:border-white/10 px-3 py-2.5 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5 w-4 h-4 accent-accent"
          checked={shareWithFamily}
          onChange={(e) => setShareWithFamily(e.target.checked)}
          disabled={busy}
        />
        <span className="text-sm">
          <span className="font-medium text-slate-900 dark:text-white">Compartir con las familias</span>
          <span className="block text-xs text-slate-500 dark:text-white/45">
            Aparece en el portal familiar de cada niño etiquetado y en su reporte del día.
          </span>
        </span>
      </label>
    </div>
  )

  if (inline) {
    return (
      <div className="space-y-4 rounded-xl border border-slate-200 dark:border-white/10 p-3 sm:p-4">
        {body}
        <div className="border-t border-slate-100 dark:border-white/5 pt-3">{footer}</div>
      </div>
    )
  }

  return (
    <Modal open={open} onClose={close} width="lg" title={title} subtitle={subtitle} footer={footer}>
      {body}
    </Modal>
  )
}
