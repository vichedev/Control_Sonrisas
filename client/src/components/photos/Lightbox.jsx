import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Clock, Download, Loader2, Sparkles, Users, X } from '../icons'
import { mediaUrl } from '../../api/client'
import { downloadPhoto, othersLabel, photoTime } from './photoUtils'

/**
 * Visor de fotos a pantalla completa: flechas, teclado (← → Esc), deslizar en táctil
 * y botón de descarga. `items`: [{ id, url, caption, takenAt, activityTitle, othersCount }].
 * `renderMeta(photo)` añade contenido propio bajo el pie (p. ej. niños etiquetados en el panel).
 */
export default function Lightbox({ items, index, onIndex, onClose, downloadName = 'foto', renderMeta }) {
  const photo = items?.[index]
  const count = items?.length || 0
  const touch = useRef(null)
  const closeRef = useRef(null)
  const [downloading, setDownloading] = useState(false)

  const go = (delta) => {
    if (!count) return
    onIndex((index + delta + count) % count)
  }
  // En captura y deteniendo la propagación: un Modal debajo no se cierra también.
  const onKey = useEffectEvent((e) => {
    if (!['Escape', 'ArrowRight', 'ArrowLeft'].includes(e.key)) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') onClose()
    else go(e.key === 'ArrowRight' ? 1 : -1)
  })
  const open = !!photo

  useEffect(() => {
    if (!open) return undefined
    const handler = (e) => onKey(e)
    document.addEventListener('keydown', handler, true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', handler, true)
      document.body.style.overflow = prev
    }
  }, [open])

  if (!photo) return null

  const onTouchStart = (e) => {
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY }
  }
  const onTouchEnd = (e) => {
    const start = touch.current
    touch.current = null
    if (!start) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1)
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) onClose()
  }

  const download = async () => {
    setDownloading(true)
    await downloadPhoto(photo, downloadName)
    setDownloading(false)
  }

  const time = photoTime(photo.takenAt || photo.createdAt)
  const others = othersLabel(photo.othersCount)
  const btn =
    'inline-flex items-center justify-center gap-2 min-h-11 min-w-11 px-3 rounded-lg text-sm font-medium text-white/90 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60'

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-black/95 text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Visor de fotos"
    >
      <div className="flex items-center justify-between gap-2 px-2 sm:px-4 py-2">
        <span className="text-sm tabular-nums text-white/70 px-2">
          {index + 1} de {count}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={download} className={btn} disabled={downloading}>
            {downloading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
            <span className="hidden sm:inline">Descargar</span>
          </button>
          <button ref={closeRef} type="button" onClick={onClose} className={btn} aria-label="Cerrar visor">
            <X className="w-5 h-5" />
            <span className="hidden sm:inline">Cerrar</span>
          </button>
        </div>
      </div>

      <div
        className="relative flex-1 min-h-0 flex items-center justify-center px-2 sm:px-16 select-none"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <img
          key={photo.id}
          src={mediaUrl(photo.url)}
          alt={photo.caption || 'Foto'}
          className="max-h-full max-w-full object-contain rounded-md"
          draggable={false}
        />
        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              className="hidden sm:inline-flex absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              aria-label="Foto anterior"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              className="hidden sm:inline-flex absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              aria-label="Foto siguiente"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </>
        )}
      </div>

      <div className="px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] max-w-3xl w-full mx-auto">
        {photo.caption && <p className="text-[15px] leading-snug text-white">{photo.caption}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/60">
          {time && (
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> {time}
            </span>
          )}
          {photo.activityTitle && (
            <span className="inline-flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" /> {photo.activityTitle}
            </span>
          )}
          {others && (
            <span className="inline-flex items-center gap-1">
              <Users className="w-3.5 h-3.5" /> {others}
            </span>
          )}
        </div>
        {renderMeta?.(photo)}
        {count > 1 && (
          <div className="sm:hidden mt-3 flex justify-between">
            <button type="button" onClick={() => go(-1)} className={btn}>
              <ChevronLeft className="w-5 h-5" /> Anterior
            </button>
            <button type="button" onClick={() => go(1)} className={btn}>
              Siguiente <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
