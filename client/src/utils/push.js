import { api } from '../api/client'

/** Convierte el VAPID public key (URL-base64) al ArrayBuffer que la PushSubscription espera. */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

/** Capacidad del navegador. */
export function pushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

/** Estado actual: 'unsupported' | 'denied' | 'default' | 'granted-unsubscribed' | 'granted-subscribed' */
export async function pushStatus() {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission !== 'granted') return 'default'
  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  if (!reg) return 'granted-unsubscribed'
  const sub = await reg.pushManager.getSubscription()
  return sub ? 'granted-subscribed' : 'granted-unsubscribed'
}

async function getServerKey() {
  const { data } = await api.get('/push/public-key')
  if (!data?.enabled || !data?.publicKey) throw new Error('El servidor no tiene Web Push configurado')
  return data.publicKey
}

async function ensureRegistration() {
  // Cualquier ruta dentro de `/` puede registrarlo; el scope por defecto es la carpeta del SW.
  return navigator.serviceWorker.register('/sw.js', { scope: '/' })
}

function arraysEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Pide permiso, registra el SW y crea la suscripción en el navegador + backend. */
export async function subscribeToPush() {
  if (!pushSupported()) throw new Error('Este navegador no soporta notificaciones push')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Permiso de notificaciones denegado')
  const publicKey = await getServerKey()
  const reg = await ensureRegistration()
  await navigator.serviceWorker.ready
  const desiredKey = urlBase64ToUint8Array(publicKey)

  // Si quedó una suscripción de una VAPID anterior, Chrome rechaza el subscribe()
  // con "push service error". Detectamos cambio de clave y limpiamos.
  let sub = await reg.pushManager.getSubscription()
  if (sub) {
    const existingKey = sub.options?.applicationServerKey
      ? new Uint8Array(sub.options.applicationServerKey)
      : null
    if (!arraysEqual(existingKey, desiredKey)) {
      try { await sub.unsubscribe() } catch { /* puede haber sido invalidada en el server */ }
      try { await api.delete('/push/subscribe', { data: { endpoint: sub.endpoint } }) } catch { /* sin suscripción previa: nada que limpiar */ }
      sub = null
    }
  }

  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: desiredKey,
    })
  }
  await api.post('/push/subscribe', {
    subscription: sub.toJSON(),
    userAgent: navigator.userAgent.slice(0, 240),
  })
  return sub
}

/** Cancela la suscripción local y la elimina del backend. */
export async function unsubscribeFromPush() {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  if (!reg) return
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  try {
    await api.delete('/push/subscribe', { data: { endpoint: sub.endpoint } })
  } catch { /* el endpoint puede no estar en el server, no es bloqueante */ }
  await sub.unsubscribe()
}

export async function sendTestPush() {
  await api.post('/push/test')
}
