import { useEffect, useEffectEvent, useState } from 'react'
import Modal from '../Modal'
import { Button, Field, inputClass, SectionTitle } from '../ui'
import { Save } from '../icons'
import { api, mediaUrl } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useToasts } from '../../context/ToastsContext'
import ChildTagger from './ChildTagger'
import { apiError, blockedFromError, useTaggableChildren } from './photoUtils'

/**
 * Editar una foto ya subida: pie, niños etiquetados y si se comparte con la familia.
 * PATCH /photos/:id { caption, childIds, shareWithFamily } → onSaved(fotoActualizada)
 * Montar sólo cuando hay foto (`{photo && <PhotoEditModal …/>}`).
 */
export default function PhotoEditModal({ photo, onClose, onSaved }) {
  const { canManage } = useAuth()
  const { pushToast } = useToasts()
  const { items, loading } = useTaggableChildren(photo.classroomId || undefined)
  const [caption, setCaption] = useState(photo.caption || '')
  const [tags, setTags] = useState(photo.childIds || (photo.childId ? [photo.childId] : []))
  const [share, setShare] = useState(photo.shareWithFamily !== false)
  const [busy, setBusy] = useState(false)

  // Escape cierra sólo este modal (puede abrirse encima del detalle de una actividad).
  const onEscape = useEffectEvent((e) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    if (!busy) onClose()
  })
  useEffect(() => {
    const h = (e) => onEscape(e)
    document.addEventListener('keydown', h, true)
    return () => document.removeEventListener('keydown', h, true)
  }, [])

  // Un niño ya etiquetado que luego perdió la autorización sigue visible para poder quitarlo.
  const tagged = new Set(tags)
  const pickerItems = items.map((c) => (tagged.has(c.id) && c.imageStatus !== 'granted' ? { ...c, imageStatus: 'granted', revoked: true } : c))
  const extra = (photo.children || []).filter((c) => !items.some((k) => k.id === c.id))
  const all = [...pickerItems, ...extra.map((c) => ({ ...c, imageStatus: 'granted' }))]

  const save = async () => {
    setBusy(true)
    try {
      const { data } = await api.patch(`/photos/${photo.id}`, { caption: caption.trim(), childIds: tags, shareWithFamily: share })
      pushToast({ type: 'success', message: 'Foto actualizada' })
      onSaved?.(data)
      onClose()
    } catch (err) {
      const blocked = blockedFromError(err)
      if (blocked.length) setTags((prev) => prev.filter((id) => !blocked.some((b) => b.id === id)))
      pushToast({ type: 'error', message: apiError(err, 'No se pudo guardar') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      width="lg"
      title="Editar foto"
      subtitle={photo.activityTitle || undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button icon={Save} onClick={save} loading={busy}>
            Guardar cambios
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex gap-3 items-start">
          <img src={mediaUrl(photo.url)} alt="" className="w-28 h-28 sm:w-36 sm:h-36 rounded-lg object-cover shrink-0 bg-slate-100" />
          <div className="flex-1 min-w-0 space-y-3">
            <Field label="Pie de foto">
              <textarea
                value={caption}
                maxLength={280}
                rows={3}
                onChange={(e) => setCaption(e.target.value)}
                className={inputClass}
                placeholder="¿Qué estaban haciendo?"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-accent" checked={share} onChange={(e) => setShare(e.target.checked)} />
              Compartir con las familias
            </label>
          </div>
        </div>
        <section className="space-y-2">
          <SectionTitle>¿Quién sale en la foto?</SectionTitle>
          <ChildTagger items={all} loading={loading} value={tags} onChange={setTags} canManageConsents={canManage} />
        </section>
      </div>
    </Modal>
  )
}
