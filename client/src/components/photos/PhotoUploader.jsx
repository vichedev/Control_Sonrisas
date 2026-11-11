import { useRef, useState } from 'react'
import { AlertCircle, Camera, CheckCircle2, Images, Loader2, Trash2 } from '../icons'
import { inputClass } from '../ui'
import { MAX_PHOTOS, compressImage } from './photoUtils'

let seq = 0

/**
 * Selector de fotos (cámara o archivos, varias a la vez) con vista previa y pie por foto.
 * Comprime en el cliente (lado mayor 1600 px, JPEG 0.8) en cuanto se eligen.
 *
 * Controlado: `items` = [{ key, dataUrl, caption, status: 'ready'|'uploading'|'done'|'error', progress, error }]
 * y `setItems` (acepta función, como un setState).
 */
export default function PhotoUploader({ items, setItems, disabled = false, max = MAX_PHOTOS, captionPlaceholder = '¿Qué estaba haciendo? (opcional)' }) {
  const cameraRef = useRef(null)
  const filesRef = useRef(null)
  const [processing, setProcessing] = useState(0)
  const [error, setError] = useState('')

  const room = max - items.length - processing

  const addFiles = async (fileList) => {
    setError('')
    const files = [...(fileList || [])].filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    const take = files.slice(0, Math.max(0, room))
    if (files.length > take.length) setError(`Máximo ${max} fotos por envío.`)
    setProcessing((n) => n + take.length)
    for (const file of take) {
      try {
        const dataUrl = await compressImage(file)
        seq += 1
        setItems((prev) => [...prev, { key: `p${Date.now()}-${seq}`, dataUrl, caption: '', status: 'ready', progress: 0, error: '' }])
      } catch {
        setError('Alguna imagen no se pudo leer. Prueba con otra.')
      } finally {
        setProcessing((n) => n - 1)
      }
    }
  }

  const update = (key, patch) => setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  const remove = (key) => setItems((prev) => prev.filter((it) => it.key !== key))

  const pickBtn =
    'flex-1 inline-flex items-center justify-center gap-2 min-h-12 px-4 rounded-lg border text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring disabled:opacity-50 disabled:cursor-not-allowed'

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          disabled={disabled || room <= 0}
          className={`${pickBtn} border-accent/30 bg-accent-soft text-accent-text hover:bg-accent-soft-strong`}
        >
          <Camera className="w-5 h-5" /> Tomar foto
        </button>
        <button
          type="button"
          onClick={() => filesRef.current?.click()}
          disabled={disabled || room <= 0}
          className={`${pickBtn} border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10`}
        >
          <Images className="w-5 h-5" /> Elegir de la galería
        </button>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <input
          ref={filesRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {error && (
        <p className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </p>
      )}

      {(items.length > 0 || processing > 0) && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {items.map((it) => (
            <li
              key={it.key}
              className={`rounded-xl border overflow-hidden bg-white dark:bg-surface ${
                it.status === 'error' ? 'border-red-300 dark:border-red-500/40' : 'border-slate-200 dark:border-white/8'
              }`}
            >
              <div className="relative aspect-4/3 bg-slate-100 dark:bg-white/5">
                <img src={it.dataUrl} alt="Vista previa" className="w-full h-full object-cover" />
                {it.status === 'uploading' && (
                  <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-2 text-white text-xs font-medium">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    Subiendo… {Math.round((it.progress || 0) * 100)}%
                  </div>
                )}
                {it.status === 'done' && (
                  <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md bg-emerald-600 text-white text-[11px] font-medium px-1.5 py-0.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Guardada
                  </span>
                )}
                {it.status !== 'uploading' && it.status !== 'done' && !disabled && (
                  <button
                    type="button"
                    onClick={() => remove(it.key)}
                    className="absolute top-2 right-2 inline-flex items-center gap-1 min-h-9 px-2 rounded-lg bg-black/55 text-white text-xs font-medium hover:bg-black/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    aria-label="Quitar esta foto"
                  >
                    <Trash2 className="w-4 h-4" /> Quitar
                  </button>
                )}
              </div>
              <div className="p-2 space-y-1.5">
                <input
                  type="text"
                  value={it.caption}
                  maxLength={280}
                  onChange={(e) => update(it.key, { caption: e.target.value })}
                  disabled={disabled || it.status === 'uploading' || it.status === 'done'}
                  placeholder={captionPlaceholder}
                  aria-label="Pie de foto"
                  className={inputClass}
                />
                {it.status === 'error' && it.error && (
                  <p className="flex gap-1.5 text-xs text-red-600 dark:text-red-400">
                    <AlertCircle className="w-4 h-4 shrink-0" /> {it.error}
                  </p>
                )}
              </div>
            </li>
          ))}
          {Array.from({ length: processing }).map((_, i) => (
            <li
              key={`proc-${i}`}
              className="rounded-xl border border-dashed border-slate-300 dark:border-white/10 aspect-4/3 flex items-center justify-center gap-2 text-xs text-slate-500"
            >
              <Loader2 className="w-4 h-4 animate-spin" /> Preparando foto…
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-slate-500 dark:text-white/45">
        {items.length
          ? `${items.length} de ${max} fotos. Se reducen automáticamente antes de subirlas.`
          : `Hasta ${max} fotos por vez. Se reducen automáticamente antes de subirlas.`}
      </p>
    </div>
  )
}
