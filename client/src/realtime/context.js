import { createContext } from 'react'

/** Valor por defecto: sin provider, los hooks no hacen nada (no rompen la página). */
export const RealtimeContext = createContext({
  status: 'offline',
  subscribe: () => () => {},
  onReconnect: () => () => {},
})

const asList = (v) => (v === undefined || v === null || v === '' ? null : Array.isArray(v) ? v : [v])

/**
 * ¿El evento le interesa a este filtro?
 * Un campo null en el evento es COMODÍN (ráfagas agrupadas por el servidor, o cambios
 * masivos sin id): ante la duda se recarga.
 *
 * @param {{entity:string, childId?:string|null, classroomId?:string|null, date?:string|null}} ev
 * @param {{entities?:string[], childId?:string|string[], classroomId?:string|string[], date?:string}} [filter]
 */
export function matchesFilter(ev, filter) {
  if (!filter) return true
  if (filter.entities?.length && !filter.entities.includes(ev.entity)) return false
  const checks = [
    ['childId', asList(filter.childId)],
    ['classroomId', asList(filter.classroomId)],
    ['date', asList(filter.date)],
  ]
  for (const [k, want] of checks) {
    if (want && ev[k] && !want.includes(ev[k])) return false
  }
  return true
}
