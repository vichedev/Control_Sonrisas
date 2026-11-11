import { useCallback, useEffect, useState } from 'react'
import { api, apiError, mediaUrl } from '../../api/client'

/** Máximo de fotos por "momento" (cada una va en su propia petición). */
export const MAX_PHOTOS = 10

/**
 * Reduce una imagen a `maxSide` px (lado mayor) y la recomprime en JPEG.
 * Respeta la orientación EXIF de las fotos del móvil (createImageBitmap 'from-image').
 */
export async function compressImage(file, { maxSide = 1600, quality = 0.8 } = {}) {
  let source
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    source = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('No se pudo leer la imagen'))
      img.src = URL.createObjectURL(file)
    })
  }
  const w0 = source.width
  const h0 = source.height
  const scale = Math.min(1, maxSide / Math.max(w0, h0))
  const w = Math.round(w0 * scale)
  const h = Math.round(h0 * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(source, 0, 0, w, h)
  source.close?.()
  if (source.src?.startsWith?.('blob:')) URL.revokeObjectURL(source.src)
  return canvas.toDataURL('image/jpeg', quality)
}

/**
 * Sube UNA foto con sus etiquetas. Devuelve la foto creada.
 * Lanza el error de axios (403 trae `blocked: [{id,name}]`).
 */
export async function uploadPhoto({ dataUrl, childIds = [], caption = '', activityId, classroomId, subject, date, shareWithFamily }, onProgress) {
  const body = { photo: dataUrl, childIds, caption: caption.trim() }
  if (activityId) body.activityId = activityId
  if (classroomId) body.classroomId = classroomId
  if (subject) body.subject = subject
  if (date) body.date = date
  if (shareWithFamily !== undefined) body.shareWithFamily = shareWithFamily
  const res = await api.post('/photos', body, {
    onUploadProgress: (e) => onProgress?.(e.total ? e.loaded / e.total : 0),
  })
  return res.data?.photos?.[0] || null
}

/** Niños bloqueados por falta de autorización, a partir del error 403 del backend. */
export function blockedFromError(err) {
  const b = err?.response?.data?.blocked
  return Array.isArray(b) ? b : []
}

export { apiError }

/**
 * Niños que se pueden etiquetar (sala o salas de la educadora) con su estado de imagen.
 * GET /consents/children → [{ id, name, photoUrl, classroomId, classroomName, consents }]
 */
export function useTaggableChildren(classroomId, { enabled = true } = {}) {
  const [state, setState] = useState({ key: null, items: [], error: '' })
  const key = `${classroomId || ''}`
  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/consents/children', { params: classroomId ? { classroomId } : {} })
      setState({
        key,
        error: '',
        items: (data || []).map((c) => ({
          id: c.id,
          name: c.name,
          photoUrl: c.photoUrl,
          classroomId: c.classroomId,
          classroomName: c.classroomName,
          imageStatus: c.consents?.images?.status || 'pending',
        })),
      })
    } catch (err) {
      setState({ key, items: [], error: apiError(err, 'No se pudieron cargar los niños') })
    }
  }, [classroomId, key])
  useEffect(() => {
    if (!enabled) return undefined
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load, enabled])
  const loading = enabled && state.key !== key
  return { loading, items: loading ? [] : state.items, error: state.error, reload: load }
}

/** 'HH:mm' de una fecha ISO. */
export function photoTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })
}

/** "con 3 compañeros" / "con 1 compañero" (familias: nunca nombres de otros niños). */
export function othersLabel(n) {
  if (!n) return ''
  return n === 1 ? 'con 1 compañero' : `con ${n} compañeros`
}

/** Descarga una foto con un nombre legible (fetch + blob: funciona con el token de medios). */
export async function downloadPhoto(photo, baseName = 'foto') {
  const src = mediaUrl(photo.url)
  const date = (photo.date || photo.takenAt || '').slice(0, 10)
  const ext = (photo.url.split('?')[0].split('.').pop() || 'jpg').toLowerCase()
  const name = `${baseName}${date ? `-${date}` : ''}-${(photo.id || '').slice(0, 6)}.${ext}`
  try {
    const res = await fetch(src)
    if (!res.ok) throw new Error(String(res.status))
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    return true
  } catch {
    return false
  }
}

/** Agrupa por día ('YYYY-MM-DD') conservando el orden. */
export function groupByDay(photos) {
  const map = new Map()
  for (const p of photos) {
    const d = p.date || (p.takenAt || '').slice(0, 10)
    if (!map.has(d)) map.set(d, [])
    map.get(d).push(p)
  }
  return [...map.entries()]
}

/** Nombres cortos de los niños etiquetados ("Sofía, Mateo y 2 más"). */
export function tagsLabel(children = []) {
  const names = children.map((c) => (c.name || '').split(' ')[0]).filter(Boolean)
  if (!names.length) return 'Foto de la sala'
  if (names.length <= 2) return names.join(' y ')
  return `${names.slice(0, 2).join(', ')} y ${names.length - 2} más`
}
