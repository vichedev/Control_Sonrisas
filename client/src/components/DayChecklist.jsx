import {
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  Clock,
  Info,
  Lock,
  MinusCircle,
  XCircle,
} from './icons'

/**
 * Lista de "qué se hizo y qué no" del día de un niño.
 *
 * La misma pieza la ven la familia (portal) y el personal (antes de enviar el reporte),
 * así ambos leen exactamente lo mismo. Cada estado lleva icono + texto, nunca sólo color.
 *
 * Props:
 *   checklist : { date, childPresent, dayClosed, summary: {done, notDone, pending}, items: [...] }
 *   compact   : versión reducida (sin agrupar por secciones, menos espacio).
 */

export const CHECK_STATUS = {
  done: {
    label: 'Hecho',
    icon: CheckCircle2,
    chip: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  partial: {
    label: 'A medias',
    icon: MinusCircle,
    chip: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-400/20',
    iconColor: 'text-amber-500',
  },
  not_done: {
    label: 'No se hizo',
    icon: XCircle,
    chip: 'bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/20',
    iconColor: 'text-red-500 dark:text-red-400',
  },
  pending: {
    label: 'Pendiente',
    icon: CircleDashed,
    chip: 'bg-slate-100 text-slate-600 ring-slate-500/15 dark:bg-white/8 dark:text-white/60 dark:ring-white/10',
    iconColor: 'text-slate-400 dark:text-white/40',
  },
  not_recorded: {
    label: 'Sin registrar',
    icon: CircleHelp,
    chip: 'bg-slate-50 text-slate-500 ring-slate-500/10 dark:bg-white/5 dark:text-white/40 dark:ring-white/8',
    iconColor: 'text-slate-400 dark:text-white/30',
  },
  info: {
    label: 'Info',
    icon: Info,
    chip: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20',
    iconColor: 'text-sky-600 dark:text-sky-400',
  },
}

const GROUPS = [
  ['attendance', 'Asistencia'],
  ['meals', 'Alimentación'],
  ['rest', 'Descanso'],
  ['activities', 'Actividades'],
  ['care', 'Cuidado'],
  ['health', 'Salud'],
]

export function StatusChip({ status }) {
  const cfg = CHECK_STATUS[status] || CHECK_STATUS.not_recorded
  const Icon = cfg.icon
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium leading-4 ring-1 ring-inset whitespace-nowrap ${cfg.chip}`}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      {cfg.label}
    </span>
  )
}

/**
 * Anillo de progreso del día: porcentaje de lo previsto que ya se hizo.
 * `summary` = { done, notDone, pending }.
 */
export function ProgressRing({ summary, size = 88, stroke = 9 }) {
  const s = summary || {}
  const done = s.done || 0
  const total = done + (s.notDone || 0) + (s.pending || 0)
  const pct = total ? Math.round((done / total) * 100) : 0
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={total ? `${done} de ${total} actividades del día hechas` : 'Sin actividades registradas'}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          className="stroke-slate-200 dark:stroke-white/10" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100}
          className="stroke-emerald-500 transition-[stroke-dashoffset] duration-700" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-xl font-semibold tabular-nums text-slate-900 dark:text-white">
          {total ? `${done}/${total}` : '—'}
        </span>
        <span className="text-[10px] font-medium text-slate-500 dark:text-white/45 mt-1">
          hecho
        </span>
      </div>
    </div>
  )
}

/** Barra resumen: Hecho N · No se hizo N · Pendiente N (icono + texto). */
export function ChecklistSummary({ summary, className = '' }) {
  const s = summary || {}
  const parts = [
    ['done', CheckCircle2, 'Hecho', s.done || 0, 'text-emerald-700 dark:text-emerald-300'],
    ['not_done', XCircle, 'No se hizo', s.notDone || 0, 'text-red-700 dark:text-red-300'],
    ['pending', Clock, 'Pendiente', s.pending || 0, 'text-slate-600 dark:text-white/60'],
  ]
  return (
    <p
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-medium ${className}`}
      aria-label={`Hecho ${s.done || 0}, no se hizo ${s.notDone || 0}, pendiente ${s.pending || 0}`}
    >
      {parts.map(([key, PartIcon, label, n, color]) => (
        <span key={key} className={`inline-flex items-center gap-1.5 ${color}`}>
          <PartIcon className="w-4 h-4" aria-hidden="true" />
          {label} <strong className="font-semibold tabular-nums">{n}</strong>
        </span>
      ))}
    </p>
  )
}

function ItemRow({ item, compact }) {
  const cfg = CHECK_STATUS[item.status] || CHECK_STATUS.not_recorded
  const Icon = cfg.icon
  return (
    <li className={`flex items-start gap-2.5 ${compact ? 'py-1.5' : 'py-2'}`}>
      <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${cfg.iconColor}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-slate-800 dark:text-white">
            {item.label}
            {typeof item.count === 'number' && item.count > 1 && (
              <span className="text-slate-400 dark:text-white/40 font-normal"> ×{item.count}</span>
            )}
          </span>
          <StatusChip status={item.status} />
        </div>
        {item.detail && (
          <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5 break-words">{item.detail}</p>
        )}
      </div>
    </li>
  )
}

export default function DayChecklist({ checklist, compact = false }) {
  if (!checklist) return null
  const items = Array.isArray(checklist.items) ? checklist.items : []

  const known = new Set(GROUPS.map(([g]) => g))
  const grouped = GROUPS.map(([key, title]) => [key, title, items.filter((i) => i.group === key)])
  const others = items.filter((i) => !known.has(i.group))
  if (others.length) grouped.push(['other', 'Otros', others])

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <ChecklistSummary summary={checklist.summary} />
        {checklist.dayClosed ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-white/40">
            <Lock className="w-3.5 h-3.5" aria-hidden="true" /> Jornada cerrada
          </span>
        ) : (
          checklist.childPresent && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
              En curso
            </span>
          )
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-white/30">Todavía no hay nada registrado.</p>
      ) : compact ? (
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {items.map((item, i) => (
            <ItemRow key={item.key || i} item={item} compact />
          ))}
        </ul>
      ) : (
        <div className="space-y-3">
          {grouped
            .filter(([, , list]) => list.length > 0)
            .map(([key, title, list]) => (
              <section key={key} aria-label={title}>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/40">
                  {title}
                </h3>
                <ul className="divide-y divide-slate-100 dark:divide-white/5">
                  {list.map((item, i) => (
                    <ItemRow key={item.key || i} item={item} />
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </div>
  )
}
