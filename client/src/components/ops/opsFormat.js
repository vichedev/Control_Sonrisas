/** Utilidades de formato para las páginas de Respaldos y Sistema. */

export function fmtBytes(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  if (v < 1024) return `${v} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let x = v / 1024
  let i = 0
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024
    i++
  }
  return `${x.toFixed(x >= 100 ? 0 : 1)} ${units[i]}`
}

export function fmtDateTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('es-EC', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fmtRelative(d) {
  if (!d) return ''
  const diff = Date.now() - new Date(d).getTime()
  const min = Math.round(diff / 60000)
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} días`
}

/** Mensaje legible de un error de axios. */
export function errMsg(e, fallback = 'Ocurrió un error') {
  const m = e?.response?.data?.message
  if (Array.isArray(m)) return m.join(' · ')
  if (typeof m === 'string' && m) return m
  if (!e?.response) return 'Sin conexión con el servidor'
  return fallback
}

export const KIND_META = {
  nightly: { label: 'Nocturno', tone: 'slate' },
  manual: { label: 'Manual', tone: 'accent' },
  'pre-update': { label: 'Antes de actualizar', tone: 'sky' },
  'pre-restore': { label: 'Antes de restaurar', tone: 'amber' },
  'pre-rollback': { label: 'Antes de volver atrás', tone: 'amber' },
  uploaded: { label: 'Subido', tone: 'green' },
  legacy: { label: 'Formato anterior', tone: 'slate' },
}

export const JOB_ACTION_LABEL = {
  update: 'Actualización',
  rollback: 'Vuelta atrás',
  restore: 'Restauración',
  install: 'Instalación',
  redeploy: 'Reconstrucción',
}

export const JOB_STATE_META = {
  queued: { label: 'En cola', tone: 'slate' },
  running: { label: 'En curso', tone: 'sky' },
  success: { label: 'Completado', tone: 'green' },
  failed: { label: 'Falló', tone: 'red' },
  rejected: { label: 'Rechazado', tone: 'red' },
  'rolled-back': { label: 'Revertido', tone: 'amber' },
  'rollback-failed': { label: 'Crítico', tone: 'red' },
  'build-failed': { label: 'Falló la compilación', tone: 'red' },
  aborted: { label: 'Cancelado', tone: 'amber' },
}

/** ¿La fecha es más antigua que `hours` horas? */
export function olderThanHours(d, hours) {
  return !d || Date.now() - new Date(d).getTime() > hours * 3600_000
}
