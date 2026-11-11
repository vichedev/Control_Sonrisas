import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search, X } from './icons'
import { emptySelection, isActiveSel, normText } from './dataView'

/** Componentes de búsqueda + filtros. La lógica (useDataView) vive en dataView.js; ver README-tables.md. */

// ── Popover (anclado; hoja inferior en móvil) ───────────────────────────

/**
 * Panel flotante anclado a `anchorRef`. Se dibuja en un portal (no lo recorta el scroll ni
 * un modal). En pantallas < 640px se abre como hoja inferior con fondo.
 */
export function Popover({ open, anchorRef, onClose, children, title, width = 280, align = 'start' }) {
  const panelRef = useRef(null)
  const [pos, setPos] = useState(null)
  const [mobile, setMobile] = useState(false)

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const isMobile = window.innerWidth < 640
      setMobile(isMobile)
      const a = anchorRef.current?.getBoundingClientRect()
      if (!a || isMobile) return setPos({})
      const w = Math.min(width, window.innerWidth - 16)
      let left = align === 'end' ? a.right - w : a.left
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
      const below = window.innerHeight - a.bottom
      const up = below < 260 && a.top > below
      setPos(up ? { left, bottom: window.innerHeight - a.top + 4, width: w } : { left, top: a.bottom + 4, width: w })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, anchorRef, width, align])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || anchorRef.current?.contains(e.target)) return
      onClose()
    }
    // Escape cierra sólo el popover (no el modal que lo contiene).
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
      anchorRef.current?.focus?.()
    }
    const onScroll = (e) => {
      if (panelRef.current?.contains(e.target)) return
      if (window.innerWidth >= 640) onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, onClose, anchorRef])

  if (!open || !pos) return null

  return createPortal(
    mobile ? (
      <div className="fixed inset-0 z-80 flex items-end">
        <div className="absolute inset-0 bg-slate-900/40 dark:bg-black/60 animate-fade-in" onClick={onClose} />
        <div
          ref={panelRef}
          role="dialog"
          aria-label={title}
          className="relative w-full max-h-[75dvh] overflow-y-auto rounded-t-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-elevated shadow-xl pb-[env(safe-area-inset-bottom,0px)] animate-fade-in-up"
        >
          <div className="sticky top-0 flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200/70 dark:border-white/8 bg-white dark:bg-elevated">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
            <button
              type="button"
              onClick={onClose}
              className="-m-2 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-white/10"
              aria-label="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {children}
        </div>
      </div>
    ) : (
      <div
        ref={panelRef}
        role="dialog"
        aria-label={title}
        style={{ position: 'fixed', ...pos }}
        className="z-80 max-h-[min(420px,70vh)] overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-elevated shadow-xl animate-fade-in"
      >
        {children}
      </div>
    ),
    document.body,
  )
}

// ── Chip de filtro con menú ─────────────────────────────────────────────

function selectionLabel(f, s) {
  if (f.type === 'dateRange') {
    const fmt = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '…')
    return `${fmt(s.from)} – ${fmt(s.to)}`
  }
  if (f.multiple) {
    if (s.length === 1) return f.options.find((o) => o.value === s[0])?.label || s[0]
    return `${s.length}`
  }
  return f.options.find((o) => o.value === s)?.label || s
}

export function FilterMenu({ filter: f, value, onChange }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const btnRef = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  const isActive = isActiveSel(f, value)
  const Icon = f.icon
  const opts = useMemo(() => {
    if (!q) return f.options
    const nq = normText(q)
    return f.options.filter((o) => normText(o.label).includes(nq))
  }, [f.options, q])

  const toggleMulti = (v) => {
    const cur = Array.isArray(value) ? value : []
    onChange(cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v])
  }

  const optionBtn = (o, selected, onClick) => (
    <button
      key={o.value}
      type="button"
      role={f.multiple ? 'menuitemcheckbox' : 'menuitemradio'}
      aria-checked={selected}
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 min-h-11 sm:min-h-9 text-sm text-left transition focus:outline-none focus-visible:bg-slate-50 dark:focus-visible:bg-white/5 ${
        selected
          ? 'bg-accent-soft text-accent-text font-medium'
          : 'text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-white/5'
      }`}
    >
      <span
        className={`w-4 h-4 shrink-0 inline-flex items-center justify-center ${
          f.multiple ? `rounded border ${selected ? 'bg-accent border-accent text-accent-fg' : 'border-slate-300 dark:border-white/20'}` : ''
        }`}
      >
        {selected && <Check className="w-3 h-3" />}
      </span>
      <span className="flex-1 min-w-0 truncate">{o.label}</span>
      {f.counts && (
        <span className="text-xs tabular-nums text-slate-400 dark:text-white/40">{f.counts[o.value] || 0}</span>
      )}
    </button>
  )

  return (
    <>
      <span
        className={`inline-flex items-stretch shrink-0 rounded-lg text-xs font-medium whitespace-nowrap transition ${
          isActive
            ? 'bg-accent-soft text-accent-text ring-1 ring-inset ring-accent/25'
            : 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/65'
        }`}
      >
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={`inline-flex items-center gap-1.5 pl-3 ${isActive ? 'pr-1.5' : 'pr-2.5'} min-h-9 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${
            isActive ? '' : 'hover:bg-slate-50 dark:hover:bg-white/10'
          }`}
        >
          {Icon && <Icon className="w-3.5 h-3.5 opacity-70" />}
          <span>{f.label}</span>
          {isActive && (
            <span className="font-semibold max-w-36 truncate">: {selectionLabel(f, value)}</span>
          )}
          <ChevronDown className={`w-3 h-3 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {isActive && (
          <button
            type="button"
            onClick={() => onChange(emptySelection(f))}
            className="px-1.5 rounded-r-lg hover:bg-accent-soft-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
            aria-label={`Quitar filtro ${f.label}`}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </span>

      <Popover open={open} anchorRef={btnRef} onClose={close} title={f.label}>
        {f.type === 'dateRange' ? (
          <div className="p-3 space-y-2.5">
            <label className="block text-xs font-medium text-slate-500 dark:text-white/50">
              Desde
              <input
                type="date"
                value={value?.from || ''}
                max={value?.to || undefined}
                onChange={(e) => onChange({ ...value, from: e.target.value })}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent-ring"
              />
            </label>
            <label className="block text-xs font-medium text-slate-500 dark:text-white/50">
              Hasta
              <input
                type="date"
                value={value?.to || ''}
                min={value?.from || undefined}
                onChange={(e) => onChange({ ...value, to: e.target.value })}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent-ring"
              />
            </label>
            <div className="flex justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => onChange(emptySelection(f))}
                className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-white/50 dark:hover:text-white min-h-9"
              >
                Quitar fechas
              </button>
              <button
                type="button"
                onClick={close}
                className="px-3 min-h-9 rounded-lg bg-accent text-accent-fg hover:bg-accent-hover text-xs font-semibold"
              >
                Listo
              </button>
            </div>
          </div>
        ) : (
          <div role="menu" className="py-1">
            {f.options.length > 8 && (
              <div className="px-2 pb-1 pt-1">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={`Buscar ${f.label.toLowerCase()}…`}
                    aria-label={`Buscar ${f.label.toLowerCase()}`}
                    className="w-full pl-8 pr-2 py-2 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-accent-ring"
                  />
                </div>
              </div>
            )}
            {!f.multiple &&
              !q &&
              optionBtn(
                { value: '', label: f.allLabel || 'Todos' },
                value === '',
                () => {
                  onChange('')
                  close()
                },
              )}
            {f.multiple && !q && f.counts && (
              <p className="px-3 py-1.5 text-[11px] text-slate-400 dark:text-white/40">Puedes elegir varios</p>
            )}
            {opts.map((o) =>
              f.multiple
                ? optionBtn(o, Array.isArray(value) && value.includes(o.value), () => toggleMulti(o.value))
                : optionBtn(o, value === o.value, () => {
                    onChange(o.value)
                    close()
                  }),
            )}
            {!opts.length && <p className="px-3 py-3 text-sm text-slate-500 dark:text-white/50">Sin opciones</p>}
            {f.multiple && (
              <div className="flex justify-between gap-2 px-3 pt-2 pb-1 mt-1 border-t border-slate-100 dark:border-white/5">
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-white/50 dark:hover:text-white min-h-9"
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  onClick={close}
                  className="px-3 min-h-9 rounded-lg bg-accent text-accent-fg hover:bg-accent-hover text-xs font-semibold"
                >
                  Listo
                </button>
              </div>
            )}
          </div>
        )}
      </Popover>
    </>
  )
}

// ── Barra ───────────────────────────────────────────────────────────────

/** Campo de búsqueda con icono y botón de limpiar. */
export function SearchInput({ value, onChange, placeholder = 'Buscar…', className = '', inputRef, ...rest }) {
  return (
    <div className={`relative ${className}`}>
      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={rest['aria-label'] || placeholder}
        className="w-full pl-9 pr-9 min-h-10 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-accent-ring [&::-webkit-search-cancel-button]:hidden"
        {...rest}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-white/10 dark:hover:text-white/80"
          aria-label="Limpiar búsqueda"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

/**
 * Barra de búsqueda + chips de filtro + acciones. Recibe el `view` de `useDataView`.
 *   searchPlaceholder · actions (nodo a la derecha) · extra (nodo junto a los chips)
 *   showCount (default true): "12 de 240" cuando hay búsqueda o filtros.
 *   bordered (default false): con borde inferior, para ir dentro de una tarjeta.
 */
export function DataToolbar({
  view,
  searchPlaceholder = 'Buscar…',
  actions,
  extra,
  showCount = true,
  bordered = false,
  className = '',
}) {
  const filtering = !!view.search || view.activeCount > 0
  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${
        bordered ? 'px-3 sm:px-4 py-3 border-b border-slate-200 dark:border-white/8' : ''
      } ${className}`}
    >
      {view.hasSearch && (
        <SearchInput
          value={view.search}
          onChange={view.setSearch}
          placeholder={searchPlaceholder}
          className="flex-1 basis-full sm:basis-56 min-w-0"
        />
      )}
      {(view.filters.length > 0 || extra) && (
        <div
          className="flex items-center gap-1.5 overflow-x-auto max-w-full -mx-1 px-1 py-0.5 [scrollbar-width:none]"
          role="group"
          aria-label="Filtros"
        >
          {view.filters.map((f) => (
            <FilterMenu key={f.key} filter={f} value={view.values[f.key]} onChange={(v) => view.setFilter(f.key, v)} />
          ))}
          {extra}
          {view.activeCount > 0 && (
            <button
              type="button"
              onClick={view.clearFilters}
              className="shrink-0 px-2 min-h-9 text-xs font-medium text-accent-text hover:underline whitespace-nowrap"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      )}
      {showCount && filtering && (
        <span className="text-xs text-slate-500 dark:text-white/50 tabular-nums whitespace-nowrap" aria-live="polite">
          {view.filtered.length} de {view.total}
        </span>
      )}
      {actions && <div className="flex items-center gap-2 ml-auto">{actions}</div>}
    </div>
  )
}

export default DataToolbar

/**
 * Pie "Mostrando 30 de 240 · Ver 30 más" para listas que no son tabla (tarjetas, trackers).
 *   const [limit, setLimit] = useState(30); items.slice(0, limit)
 *   <LoadMore shown={Math.min(limit, n)} total={n} onMore={() => setLimit((l) => l + 30)} />
 */
export function LoadMore({ shown, total, step = 30, onMore, onAll, label = 'elementos', className = '' }) {
  if (total <= 0) return null
  const rest = total - shown
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2.5 text-xs text-slate-500 dark:text-white/50 tabular-nums ${className}`}>
      <span>
        Mostrando {shown} de {total} {label}
      </span>
      {rest > 0 && (
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMore}
            className="px-3 min-h-9 rounded-lg font-semibold text-accent-text hover:bg-accent-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
          >
            Ver {Math.min(step, rest)} más
          </button>
          {onAll && rest > step && (
            <button
              type="button"
              onClick={onAll}
              className="px-3 min-h-9 rounded-lg font-medium text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/5"
            >
              Ver todos
            </button>
          )}
        </span>
      )}
    </div>
  )
}
