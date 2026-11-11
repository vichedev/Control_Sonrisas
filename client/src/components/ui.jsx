import { useState } from 'react'
import { mediaUrl } from '../api/client'

/**
 * Piezas de interfaz compartidas por todo el panel. Están aquí y no en un archivo por
 * componente porque son pequeñas y siempre se usan juntas; separarlas sólo añadiría
 * quince importaciones a cada página.
 */

/** Tonos semánticos compartidos (chips, iconos de estadística, barras). */
export const TONES = {
  slate: {
    chip: 'bg-slate-100 text-slate-700 ring-slate-500/15 dark:bg-white/8 dark:text-white/75 dark:ring-white/10',
    icon: 'bg-slate-100 text-slate-600 dark:bg-white/8 dark:text-white/70',
    bar: 'bg-slate-400',
  },
  accent: {
    chip: 'bg-accent-soft text-accent-text ring-accent/20',
    icon: 'bg-accent-soft text-accent-text',
    bar: 'bg-accent',
  },
  green: {
    chip: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20',
    icon: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
    bar: 'bg-emerald-500',
  },
  amber: {
    chip: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-400/20',
    icon: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
    bar: 'bg-amber-500',
  },
  red: {
    chip: 'bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/20',
    icon: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300',
    bar: 'bg-red-500',
  },
  sky: {
    chip: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20',
    icon: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300',
    bar: 'bg-sky-500',
  },
}
// Alias heredados: `rose` = error/no hecho (rojo), `violet` = acento.
TONES.rose = TONES.red
TONES.violet = TONES.accent
const toneOf = (tone) => TONES[tone] || TONES.slate

export function PageHeader({ title, subtitle, icon: Icon, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 mb-6">
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <span className="shrink-0 w-9 h-9 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/70 flex items-center justify-center shadow-xs">
            <Icon className="w-[18px] h-[18px]" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-slate-500 dark:text-white/50">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ children, className = '', padded = true }) {
  return (
    <div
      className={`rounded-xl border border-slate-200 dark:border-white/8 bg-white dark:bg-surface shadow-xs ${
        padded ? 'p-5' : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}

export function SectionTitle({ children, hint }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/45">
        {children}
      </h2>
      {hint && <span className="text-xs text-slate-400 dark:text-white/35">{hint}</span>}
    </div>
  )
}

const BUTTON_VARIANTS = {
  primary: 'bg-accent text-accent-fg shadow-xs hover:bg-accent-hover',
  secondary:
    'bg-white dark:bg-white/5 text-slate-700 dark:text-white/90 border border-slate-200 dark:border-white/10 shadow-xs hover:bg-slate-50 dark:hover:bg-white/10',
  ghost:
    'text-slate-600 dark:text-white/70 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-white/8 dark:hover:text-white',
  success: 'bg-emerald-600 text-white shadow-xs hover:bg-emerald-700 dark:hover:bg-emerald-500',
  danger: 'bg-red-600 text-white shadow-xs hover:bg-red-700 dark:hover:bg-red-500',
  warning: 'bg-amber-500 text-slate-950 shadow-xs hover:bg-amber-400',
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading = false,
  className = '',
  ...rest
}) {
  const sizes = {
    sm: 'min-h-8 px-2.5 py-1 text-xs gap-1.5',
    md: 'min-h-9 px-3.5 py-1.5 text-sm gap-2',
    lg: 'min-h-11 px-5 py-2 text-[15px] gap-2',
  }
  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-transparent disabled:opacity-50 disabled:cursor-not-allowed ${
        BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.primary
      } ${sizes[size] || sizes.md} ${className}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        Icon && <Icon className="w-4 h-4" />
      )}
      {children}
    </button>
  )
}

export function Badge({ children, tone = 'slate', className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium leading-4 ring-1 ring-inset whitespace-nowrap ${
        toneOf(tone).chip
      } ${className}`}
    >
      {children}
    </span>
  )
}

export function Field({ label, hint, children, required }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-slate-700 dark:text-white/75 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-slate-500 dark:text-white/40 mt-1">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full px-3 py-2 rounded-lg border border-slate-300/80 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/30 shadow-xs focus:outline-none focus:border-accent focus:ring-3 focus:ring-accent-ring text-sm transition-colors disabled:bg-slate-50 dark:disabled:bg-white/3 disabled:text-slate-500'

export function EmptyState({ icon: Icon, title, message, action }) {
  return (
    <div className="text-center py-12 px-6">
      {Icon && (
        <span className="inline-flex w-11 h-11 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 items-center justify-center mb-3">
          <Icon className="w-5 h-5 text-slate-400 dark:text-white/40" />
        </span>
      )}
      <p className="font-semibold text-slate-800 dark:text-white/85">{title}</p>
      {message && <p className="text-sm text-slate-500 dark:text-white/45 mt-1 max-w-md mx-auto">{message}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export function StatTile({ label, value, tone = 'slate', icon: Icon, hint }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/8 bg-white dark:bg-surface shadow-xs p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500 dark:text-white/50">{label}</span>
        {Icon && (
          <span className={`w-7 h-7 rounded-md flex items-center justify-center ${toneOf(tone).icon}`}>
            <Icon className="w-4 h-4" />
          </span>
        )}
      </div>
      <p className="text-2xl font-semibold tracking-tight tabular-nums mt-1 text-slate-900 dark:text-white">{value}</p>
      {hint && <p className="text-xs text-slate-500 dark:text-white/45 mt-0.5">{hint}</p>}
    </div>
  )
}

/** Avatar de un niño o de una persona. Cae a las iniciales si no hay foto. */
export function Avatar({ src, name = '', size = 'md', ring }) {
  // Si la foto no carga, se muestran las iniciales en lugar del texto alternativo cortado.
  const [failedSrc, setFailedSrc] = useState(null)
  const sizes = {
    xs: 'w-7 h-7 text-[10px]',
    sm: 'w-9 h-9 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-16 h-16 text-lg',
    xl: 'w-24 h-24 text-2xl',
  }
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

  return (
    <span
      className={`${sizes[size] || sizes.md} shrink-0 rounded-full overflow-hidden bg-slate-100 dark:bg-white/10 flex items-center justify-center font-semibold text-slate-600 dark:text-white/75 ${
        ring ? `ring-2 ${ring}` : 'ring-1 ring-inset ring-slate-900/5 dark:ring-white/10'
      }`}
      title={name}
    >
      {src && failedSrc !== src ? (
        <img
          src={mediaUrl(src)}
          alt=""
          className="w-full h-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        initials || '·'
      )}
    </span>
  )
}

/** Indicador de carga centrado. */
export function Loading({ label = 'Cargando…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-slate-500 dark:text-white/50 text-sm">
      <span className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      {label}
    </div>
  )
}

/* ------------------------------------------------------------------------------------
 * Primitivas añadidas (aditivas: no cambian nada de lo anterior).
 * ---------------------------------------------------------------------------------- */

/** Tecla de atajo: <Kbd>Ctrl</Kbd><Kbd>K</Kbd>. */
export function Kbd({ children, className = '' }) {
  return (
    <kbd
      className={`inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded border border-slate-200 dark:border-white/15 bg-slate-50 dark:bg-white/10 text-[10px] font-medium font-sans text-slate-500 dark:text-white/60 ${className}`}
    >
      {children}
    </kbd>
  )
}

/** Bloque gris animado para reservar espacio mientras carga. */
export function Skeleton({ className = 'h-4 w-full' }) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded-md bg-slate-200/70 dark:bg-white/10 ${className}`}
    />
  )
}

const PROGRESS_TONES = Object.fromEntries(Object.entries(TONES).map(([k, v]) => [k, v.bar]))

/** Barra de progreso con etiqueta accesible. `value` y `max` son números. */
export function ProgressBar({ value = 0, max = 100, tone = 'green', label, className = '' }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, Math.round((value / max) * 100))) : 0
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      className={`h-1.5 w-full rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden ${className}`}
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ${PROGRESS_TONES[tone] || PROGRESS_TONES.green}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/**
 * Selector de opciones excluyentes (pestañas pequeñas).
 * options: [{ value, label, icon?, count? }]. Cada opción lleva texto, nunca sólo icono.
 */
export function SegmentedControl({ options = [], value, onChange, size = 'md', className = '', ariaLabel }) {
  const sizes = { sm: 'min-h-7 px-2.5 text-xs', md: 'min-h-9 px-3 text-sm' }
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`inline-flex flex-wrap gap-0.5 p-0.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200/70 dark:border-white/8 ${className}`}
    >
      {options.map((o) => {
        const active = o.value === value
        const Icon = o.icon
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange?.(o.value)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${
              sizes[size] || sizes.md
            } ${
              active
                ? 'bg-white dark:bg-white/12 text-slate-900 dark:text-white shadow-xs ring-1 ring-slate-900/5 dark:ring-white/5'
                : 'text-slate-600 hover:text-slate-900 dark:text-white/55 dark:hover:text-white'
            }`}
          >
            {Icon && <Icon className="w-4 h-4" />}
            {o.label}
            {o.count != null && (
              <span className="tabular-nums text-[11px] text-slate-500 dark:text-white/45">{o.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Barra de acciones pegada al borde inferior (guardar, enviar…). Se queda por encima de
 * la barra de navegación inferior del móvil gracias a la variable CSS `--bottom-nav-h`.
 * Úsala al final del contenido de la página: es `sticky`, no tapa nada al hacer scroll.
 */
export function StickyActionBar({ children, info, className = '' }) {
  return (
    <div
      className={`sticky z-20 mt-4 -mx-4 sm:-mx-5 lg:mx-0 px-4 py-3 lg:rounded-xl border-t lg:border border-slate-200 dark:border-white/10 bg-white/95 dark:bg-elevated/95 backdrop-blur-md shadow-[0_-4px_16px_-8px_rgba(15,23,42,0.12)] flex flex-wrap items-center gap-3 ${className}`}
      style={{ bottom: 'var(--bottom-nav-h, 0px)' }}
    >
      {info && <div className="min-w-0 flex-1 text-sm text-slate-600 dark:text-white/60">{info}</div>}
      <div className={`flex flex-wrap items-center gap-2 ${info ? '' : 'flex-1 justify-end'}`}>{children}</div>
    </div>
  )
}
