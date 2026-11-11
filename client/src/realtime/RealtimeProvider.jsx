/**
 * Tiempo real — las pantallas se actualizan solas cuando alguien registra algo.
 *
 * El backend empuja por SSE (GET /api/realtime/stream) avisos MÍNIMOS:
 *   { entity, action, id, childId, classroomId, date }
 * (nunca datos del niño). La página vuelve a pedir sus datos por su API de siempre,
 * que ya aplica el alcance por rol. entity ∈ attendance | staff_attendance | meal |
 * daily_log | activity | report | justification | child | photo | task.
 *
 * Montaje (una vez, dentro de <AuthProvider>):
 *   const { user } = useAuth()
 *   <RealtimeProvider enabled={!!user && !user.mustChangePassword}>…</RealtimeProvider>
 *   - `enabled`: conectar o no (por defecto true; sin token no conecta igualmente).
 *   - `token`: opcional. Si no se pasa, se lee localStorage 'sonrisas_token' y se vigila
 *     (login/logout/cambio de clave en ésta u otra pestaña → reconecta solo).
 *
 * En una página:
 *   const load = useCallback(async () => { … }, [date, classroomId])
 *   useLoadEffect(load)
 *   useLiveReload(load, { entities: ['meal'], date, classroomId })
 *   → llama a load() (con debounce de 600 ms) cuando llega un evento que encaja, y
 *     también al reconectar tras estar desconectado (para ponerse al día).
 *   Filtro: { entities?, childId?, classroomId?, date? } (childId/classroomId admiten
 *   array). Un campo null en el evento cuenta como comodín.
 *   Opciones: { debounceMs = 600, enabled = true }.
 *
 * Bajo nivel: useRealtime(filter, (ev) => …) — callback por evento.
 * Estado: useRealtimeStatus() → 'connecting' | 'live' | 'offline'.
 * Indicador: <LiveIndicator /> (punto + "En vivo" / "Reconectando…").
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { TOKEN_KEY } from '../api/client'
import { RealtimeContext } from './context'
import { RealtimeConnection } from './connection'

const DEFAULT_URL = `${import.meta.env.VITE_API_URL || '/api'}/realtime/stream`

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

/** Token de localStorage, vigilado (evento `storage` de otras pestañas + sondeo de 2 s). */
function useStoredToken(active) {
  const [token, setToken] = useState(readToken)
  useEffect(() => {
    if (!active) return undefined
    const sync = () => setToken(readToken())
    const timer = setInterval(sync, 2000)
    window.addEventListener('storage', sync)
    sync()
    return () => {
      clearInterval(timer)
      window.removeEventListener('storage', sync)
    }
  }, [active])
  return token
}

export function RealtimeProvider({ children, enabled = true, token: tokenProp, url = DEFAULT_URL }) {
  const stored = useStoredToken(tokenProp === undefined)
  const token = tokenProp === undefined ? stored : tokenProp
  const [status, setStatus] = useState('offline')
  const listeners = useRef(new Set())
  const reconnectListeners = useRef(new Set())

  useEffect(() => {
    if (!enabled || !token) return undefined
    let wasLive = false
    const conn = new RealtimeConnection({
      url,
      getToken: () => token,
      onStatus: setStatus,
      onEvent: (ev) => {
        for (const fn of [...listeners.current]) {
          try {
            fn(ev)
          } catch (err) {
            console.error('[realtime] listener', err)
          }
        }
      },
      onLive: () => {
        // La primera conexión no es "re"conexión: las páginas ya cargaron sus datos.
        if (wasLive) reconnectListeners.current.forEach((fn) => fn())
        wasLive = true
      },
    })
    conn.start()
    const kick = () => conn.kick()
    const onVisible = () => document.visibilityState === 'visible' && conn.kick()
    window.addEventListener('online', kick)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', kick)
      document.removeEventListener('visibilitychange', onVisible)
      conn.stop()
      setStatus('offline')
    }
  }, [enabled, token, url])

  // Funciones estables: los hooks no se re-suscriben cuando cambia `status`.
  const api = useMemo(
    () => ({
      subscribe: (fn) => {
        listeners.current.add(fn)
        return () => listeners.current.delete(fn)
      },
      onReconnect: (fn) => {
        reconnectListeners.current.add(fn)
        return () => reconnectListeners.current.delete(fn)
      },
    }),
    [],
  )
  const value = useMemo(() => ({ ...api, status }), [api, status])

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

export default RealtimeProvider
