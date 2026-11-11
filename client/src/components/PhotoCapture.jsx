import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, RefreshCcw, Trash2, Upload, VideoOff } from './icons'
import { Button } from './ui'

/** Reescala un data URL a un ancho máximo y lo recomprime en JPEG. */
function downscaleDataUrl(dataUrl, maxW = 1024, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width)
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => reject(new Error('No se pudo procesar la imagen'))
    img.src = dataUrl
  })
}

/**
 * Captura de foto: cámara del dispositivo o archivo del equipo.
 *
 * Sin reconocimiento facial ni prueba de vida — aquí la foto es un recuerdo o una
 * constancia, no una credencial. Siempre se reescala antes de subirla: una foto de
 * móvil sin comprimir son 4-6 MB y el reporte diario puede llevar varias.
 */
export default function PhotoCapture({ value, onChange, label = 'Foto', compact = false }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const fileRef = useRef(null)
  const [active, setActive] = useState(false)
  const [error, setError] = useState('')
  const [facingMode, setFacingMode] = useState('environment')
  const unmountedRef = useRef(false)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setActive(false)
  }, [])

  // Apagar la cámara al desmontar: dejar el stream vivo mantiene el LED encendido
  // y bloquea el dispositivo para el resto de la aplicación.
  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      stop()
    }
  }, [stop])

  const start = async (facing = facingMode) => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 } },
        audio: false,
      })
      // Si el componente se desmontó mientras el navegador pedía permiso, el stream
      // llega tarde: apagarlo ya para no dejar la cámara encendida.
      if (unmountedRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      // Un stream anterior (doble clic, cambio de cámara) se apaga antes de reemplazarlo.
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = stream
      setActive(true)
      // El elemento <video> se monta en el mismo render en que `active` pasa a true,
      // así que la asignación del stream espera a que exista.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
      })
    } catch {
      setError('No se pudo abrir la cámara. Revisa los permisos del navegador.')
    }
  }

  const shoot = async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    const raw = canvas.toDataURL('image/jpeg', 0.92)
    stop()
    onChange(await downscaleDataUrl(raw))
  }

  const pickFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('El archivo debe ser una imagen')
      return
    }
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        onChange(await downscaleDataUrl(String(reader.result)))
        setError('')
      } catch {
        setError('No se pudo leer la imagen')
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const flip = () => {
    const next = facingMode === 'environment' ? 'user' : 'environment'
    setFacingMode(next)
    if (active) {
      stop()
      // Reabrir con la otra cámara: se pasa explícita porque `facingMode` aquí es el valor viejo.
      setTimeout(() => {
        if (!unmountedRef.current) start(next)
      }, 60)
    }
  }

  return (
    <div>
      {label && (
        <span className="block text-[13px] font-medium text-slate-700 dark:text-white/75 mb-1.5">
          {label}
        </span>
      )}

      {/* Compacto y sin foto: un recuadro bajo, para no ocupar media pantalla */}
      <div
        className={`relative rounded-xl overflow-hidden ${
          !value && !active
            ? `border-2 border-dashed border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/3 ${
                compact ? 'h-20' : 'aspect-4/3'
              }`
            : `border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 ${
                compact ? 'aspect-video max-h-64' : 'aspect-4/3'
              }`
        }`}
      >
        {value ? (
          <img src={value} alt="Foto capturada" className="w-full h-full object-cover" />
        ) : active ? (
          <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
        ) : (
          <div
            className={`w-full h-full flex items-center justify-center text-slate-400 dark:text-white/30 ${
              compact ? 'gap-2' : 'flex-col gap-2'
            }`}
          >
            <VideoOff className={compact ? 'w-5 h-5' : 'w-8 h-8'} />
            <span className="text-xs">Sin foto</span>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{error}</p>}

      <div className="flex flex-wrap gap-2 mt-2 [&>button]:min-h-10">
        {value ? (
          <Button type="button" variant="secondary" size="sm" icon={Trash2} onClick={() => onChange('')}>
            Quitar
          </Button>
        ) : active ? (
          <>
            <Button type="button" size="sm" icon={Camera} onClick={shoot}>
              Tomar foto
            </Button>
            <Button type="button" variant="secondary" size="sm" icon={RefreshCcw} onClick={flip}>
              Girar
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={stop}>
              Cancelar
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="secondary" size="sm" icon={Camera} onClick={() => start()}>
              Cámara
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={Upload}
              onClick={() => fileRef.current?.click()}
            >
              Subir
            </Button>
          </>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickFile} />
      </div>
    </div>
  )
}
