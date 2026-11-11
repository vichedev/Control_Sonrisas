import { useRealtimeStatus } from './hooks'

const LABEL = { live: 'En vivo', connecting: 'Conectando…', offline: 'Reconectando…' }

/** Punto + texto con el estado del tiempo real. Para cabeceras de página. */
export function LiveIndicator({ className = '', compact = false }) {
  const status = useRealtimeStatus()
  const live = status === 'live'
  const dot = live ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-400' : 'bg-slate-400'
  return (
    <span
      role="status"
      aria-live="polite"
      title={live ? 'Los datos se actualizan solos' : 'Sin conexión en tiempo real: reintentando'}
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${
        live ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-white/50'
      } ${className}`}
    >
      <span className="relative flex h-2 w-2">
        {live && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 motion-safe:animate-ping" />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dot}`} />
      </span>
      {!compact && LABEL[status]}
      {compact && <span className="sr-only">{LABEL[status]}</span>}
    </span>
  )
}

export default LiveIndicator
