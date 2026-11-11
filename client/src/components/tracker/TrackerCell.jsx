import { Link } from 'react-router-dom'
import { ArrowUpRight, Moon, Plus, Sparkles } from '../icons'
import { CHECK_STATUS } from '../DayChecklist'

/**
 * Celda de estado del seguimiento: icono + texto corto, nunca sólo color.
 * Si tiene acción abre la hoja rápida; si sólo tiene enlace, navega.
 */
export default function TrackerCell({ cell, label, onOpen, size = 'md' }) {
  const isNone = cell.status === 'none'
  const cfg = CHECK_STATUS[cell.status]
  let Icon = cfg?.icon
  if (cell.sleeping) Icon = Moon
  if (isNone && cell.action) Icon = cell.emphasis ? Sparkles : Plus
  if (isNone && !cell.action && cell.link) Icon = ArrowUpRight

  const tone = isNone
    ? cell.emphasis
      ? 'border border-dashed border-accent/50 text-accent-text hover:bg-accent-soft'
      : cell.action || cell.link
        ? 'border border-dashed border-slate-300 text-slate-500 dark:border-white/15 dark:text-white/45 hover:bg-slate-50 dark:hover:bg-white/5'
        : 'text-slate-300 dark:text-white/20'
    : `ring-1 ring-inset ${cfg.chip}`

  const sizing = size === 'lg' ? 'min-h-11 px-3 text-xs' : 'min-h-8 px-2 text-[11px]'
  const cls = `inline-flex w-full items-center justify-center gap-1 rounded-md font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${sizing} ${tone}`
  const content = (
    <>
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
      <span className="truncate">{cell.text}</span>
    </>
  )
  const aria = `${label}: ${cell.title || cell.text}`

  if (cell.action) {
    return (
      <button type="button" onClick={onOpen} className={`${cls} cursor-pointer`} title={cell.title || undefined} aria-label={aria}>
        {content}
      </button>
    )
  }
  if (cell.link) {
    return (
      <Link to={cell.link} className={cls} title={cell.title || undefined} aria-label={aria}>
        {content}
      </Link>
    )
  }
  return (
    <span className={cls} title={cell.title || undefined} aria-label={aria}>
      {content}
    </span>
  )
}
