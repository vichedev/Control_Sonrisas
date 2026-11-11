/**
 * Conexión SSE con fetch en streaming (no EventSource: así el token va en la cabecera
 * Authorization y nunca en la URL). Sin React: la usa RealtimeProvider.
 *
 * - Reconexión con backoff exponencial 1 s → 30 s (con jitter).
 * - Se detiene ante 401/403 o `event: logout` (sesión inválida): no insiste.
 * - Watchdog: si en 60 s no llega nada (ni el ping de 25 s), reconecta.
 */

const MIN_DELAY = 1000
const MAX_DELAY = 30000
const WATCHDOG_MS = 60000

export class RealtimeConnection {
  /**
   * @param {object} o
   * @param {string} o.url
   * @param {() => (string|null)} o.getToken
   * @param {(s: 'connecting'|'live'|'offline') => void} o.onStatus
   * @param {(ev: object) => void} o.onEvent
   * @param {() => void} o.onLive   cada vez que el stream queda en vivo
   * @param {(status: number) => void} [o.onAuthError]
   */
  constructor(o) {
    this.o = o
    this.running = false
    this.ctrl = null
    this.retryTimer = null
    this.watchdog = null
    this.delay = MIN_DELAY
    this.status = 'offline'
  }

  start() {
    if (this.running) return
    this.running = true
    this.delay = MIN_DELAY
    this.connect()
  }

  stop() {
    this.running = false
    clearTimeout(this.retryTimer)
    clearTimeout(this.watchdog)
    this.ctrl?.abort()
    this.ctrl = null
    this.setStatus('offline')
  }

  /** Reintentar YA (volvió la red / la pestaña se hizo visible). */
  kick() {
    if (!this.running || this.status === 'live' || this.ctrl) return
    clearTimeout(this.retryTimer)
    this.delay = MIN_DELAY
    this.connect()
  }

  setStatus(s) {
    if (this.status === s) return
    this.status = s
    this.o.onStatus(s)
  }

  armWatchdog() {
    clearTimeout(this.watchdog)
    this.watchdog = setTimeout(() => this.ctrl?.abort(), WATCHDOG_MS)
  }

  scheduleRetry() {
    if (!this.running) return
    this.setStatus('offline')
    const wait = Math.round(this.delay * (0.8 + Math.random() * 0.4))
    this.delay = Math.min(this.delay * 2, MAX_DELAY)
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => this.connect(), wait)
  }

  async connect() {
    if (!this.running) return
    const token = this.o.getToken()
    if (!token) return this.stop()
    this.setStatus('connecting')
    const ctrl = new AbortController()
    this.ctrl = ctrl
    let fatal = false
    try {
      const res = await fetch(this.o.url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        cache: 'no-store',
        signal: ctrl.signal,
      })
      if (res.status === 401 || res.status === 403) {
        fatal = true
        this.o.onAuthError?.(res.status)
        return
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      this.armWatchdog()
      fatal = await this.read(res.body)
    } catch {
      // red caída / abortado: se reintenta abajo
    } finally {
      clearTimeout(this.watchdog)
      if (this.ctrl === ctrl) this.ctrl = null
      if (fatal) this.stop()
      else if (this.running) this.scheduleRetry()
    }
  }

  /** Parser SSE mínimo. Devuelve true si el servidor pidió no reconectar. */
  async read(body) {
    const reader = body.pipeThrough(new TextDecoderStream()).getReader()
    let buf = ''
    let fatal = false
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      this.armWatchdog()
      buf += value
      let m
      while ((m = /\r?\n\r?\n/.exec(buf))) {
        const block = buf.slice(0, m.index)
        buf = buf.slice(m.index + m[0].length)
        let event = 'message'
        const data = []
        for (const line of block.split(/\r?\n/)) {
          if (!line || line.startsWith(':')) continue // comentario / ping
          const i = line.indexOf(':')
          const field = i < 0 ? line : line.slice(0, i)
          const val = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '')
          if (field === 'event') event = val
          else if (field === 'data') data.push(val)
        }
        if (event === 'ready') {
          this.delay = MIN_DELAY
          this.setStatus('live')
          this.o.onLive()
        } else if (event === 'logout') {
          fatal = true
        } else if (event === 'message' && data.length) {
          try {
            this.o.onEvent(JSON.parse(data.join('\n')))
          } catch {
            // evento mal formado: se ignora
          }
        }
      }
    }
    return fatal
  }
}
