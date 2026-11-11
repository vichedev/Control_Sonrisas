/* Service Worker para Sonrisas — Web Push notifications.
 *
 * Se registra desde el cliente con scope '/' tras el primer login.
 * Maneja eventos `push` (mostrar notificación) y `notificationclick` (abrir/foco
 * de la ventana correspondiente).
 */

self.addEventListener('install', () => {
  // Activar inmediatamente la nueva versión sin esperar al cierre de pestañas.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'Sonrisas', body: event.data?.text() || '' } }
  const title = data.title || 'Sonrisas'
  const body = data.body || ''
  const url = data.url || '/'
  const tag = data.tag || undefined
  const icon = data.icon || '/favicon.svg'
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: icon,
      tag,
      data: { url },
      renotify: !!tag,
      timestamp: Date.now(),
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // Si ya hay una ventana abierta del sitio, le damos foco y la navegamos.
    for (const c of all) {
      try {
        const u = new URL(c.url)
        if (u.origin === self.location.origin) {
          await c.focus()
          if (c.navigate) await c.navigate(url)
          return
        }
      } catch {
        // La ventana pudo cerrarse entre matchAll() y focus(): se abre una nueva abajo.
      }
    }
    await self.clients.openWindow(url)
  })())
})
