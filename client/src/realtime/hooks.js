import { useContext, useEffect, useEffectEvent } from 'react'
import { RealtimeContext, matchesFilter } from './context'

/** 'connecting' | 'live' | 'offline' */
export function useRealtimeStatus() {
  return useContext(RealtimeContext).status
}

/**
 * Callback por cada evento que encaja con el filtro.
 * El filtro y el callback pueden cambiar en cada render sin re-suscribir.
 * @param {{entities?:string[], childId?:string|string[], classroomId?:string|string[], date?:string}|null} filter
 * @param {(ev:{entity:string, action:string, id:string|null, childId:string|null, classroomId:string|null, date:string|null}) => void} onEvent
 */
export function useRealtime(filter, onEvent) {
  const { subscribe } = useContext(RealtimeContext)
  const handle = useEffectEvent((ev) => {
    if (matchesFilter(ev, filter)) onEvent(ev)
  })
  useEffect(() => subscribe((ev) => handle(ev)), [subscribe])
}

/**
 * Recarga la página cuando llegan cambios que le afectan (y al reconectar tras un corte).
 * `reload` es la misma función `load` que ya usa la página; se llama sin argumentos.
 * Debounce de 600 ms (máx. ~3× si los eventos no paran) para que una ráfaga = 1 recarga.
 */
export function useLiveReload(reload, filter, { debounceMs = 600, enabled = true } = {}) {
  const { subscribe, onReconnect } = useContext(RealtimeContext)
  const fire = useEffectEvent(() => reload())
  const matches = useEffectEvent((ev) => matchesFilter(ev, filter))

  useEffect(() => {
    if (!enabled) return undefined
    let timer = null
    let first = 0
    const schedule = () => {
      const now = Date.now()
      if (!timer) first = now
      clearTimeout(timer)
      // No posponer indefinidamente si los eventos no paran.
      const wait = Math.max(0, Math.min(debounceMs, first + debounceMs * 3 - now))
      timer = setTimeout(() => {
        timer = null
        fire()
      }, wait)
    }
    const offEvent = subscribe((ev) => {
      if (matches(ev)) schedule()
    })
    const offReconnect = onReconnect(schedule)
    return () => {
      offEvent()
      offReconnect()
      clearTimeout(timer)
    }
  }, [subscribe, onReconnect, debounceMs, enabled])
}
