import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, Users, X } from './icons'
import { Avatar } from './ui'
import { SearchInput } from './DataToolbar'
import { formatDocumentId, highlightParts, matchChild, toPickerChild } from './childSearch'

/**
 * Selector de niños escalable para modales (ver README-tables.md).
 *
 * - Hasta `compactThreshold` niños (12): rejilla de avatares de 1 toque (como siempre).
 * - Más: buscador (nombre o cédula, sin tildes, resalta coincidencias), chips de filtro con
 *   contadores, accesos rápidos ("Todos los presentes"), seleccionados arriba como chips
 *   ("3 seleccionados · Limpiar"), lista de 30 en 30 ("Ver más" / al desplazar) y teclado
 *   (↑ ↓ Inicio Fin, Enter o Espacio marca).
 *
 * Props:
 *   items (o children)  [{ id, name | fullName | firstName+lastName, photoUrl?, documentId?, classroomName?, code? }]
 *   value               multiple → array de ids; single → id | ''
 *   onChange(next)      multiple → array de ids; single → id
 *   multiple = true
 *   quickSelect         [{ label, ids: string[] | (items) => string[], mode?: 'replace' | 'add' }]
 *   showAllNone         botones "Todos" / "Ninguno" (default = multiple). Con filtro/búsqueda, "Todos" marca los visibles.
 *   filters             [{ key, label, match: (child) => boolean }] (chips con contador; "Todos" implícito)
 *   defaultFilter       key del filtro inicial ('' = todos)
 *   placeholder         'Buscar por nombre o cédula…'
 *   showDocument = true · showClassroom = auto (si hay más de una sala)
 *   compactThreshold = 12 · pageSize = 30 · maxListHeight = 'min(52vh, 420px)'
 *   renderMeta(child)   nodo a la derecha de cada fila (p. ej. "Llegó 08:10")
 *   disabledIds         ids no seleccionables (se muestran atenuados)
 *   label               nombre accesible del listado ('Niños')
 *   emptyMessage
 */
export default function ChildPicker({
  items,
  children,
  value,
  onChange,
  multiple = true,
  quickSelect = [],
  showAllNone,
  filters = [],
  defaultFilter = '',
  placeholder = 'Buscar por nombre o cédula…',
  showDocument = true,
  showClassroom,
  compactThreshold = 12,
  pageSize = 30,
  maxListHeight = 'min(52vh, 420px)',
  renderMeta,
  disabledIds,
  label = 'Niños',
  emptyMessage = 'No hay niños para elegir.',
}) {
  const list = useMemo(() => {
    const source = Array.isArray(items) ? items : Array.isArray(children) ? children : []
    return source.map(toPickerChild)
  }, [items, children])
  const selected = useMemo(
    () => new Set(multiple ? (Array.isArray(value) ? value : []) : value ? [value] : []),
    [value, multiple],
  )
  const disabled = useMemo(() => new Set(disabledIds || []), [disabledIds])
  const withAllNone = showAllNone ?? multiple
  const multiRoom = useMemo(() => new Set(list.map((c) => c.classroomName).filter(Boolean)).size > 1, [list])
  const showRoom = showClassroom ?? multiRoom

  const [q, setQ] = useState('')
  const [filter, setFilter] = useState(defaultFilter)
  const [limit, setLimit] = useState(pageSize)
  const [active, setActive] = useState(0)
  const listRef = useRef(null)
  const baseId = useId()

  const compact = list.length <= compactThreshold

  const searched = useMemo(() => (q ? list.filter((c) => matchChild(c, q)) : list), [list, q])
  const filterCounts = useMemo(() => {
    const out = { '': searched.length }
    for (const f of filters) out[f.key] = searched.filter(f.match).length
    return out
  }, [searched, filters])
  const visible = useMemo(() => {
    const f = filters.find((x) => x.key === filter)
    return f ? searched.filter(f.match) : searched
  }, [searched, filters, filter])

  // Nueva búsqueda / filtro → vuelve al principio de la lista (ajuste en render).
  const sig = `${q}|${filter}`
  const [prevSig, setPrevSig] = useState(sig)
  if (sig !== prevSig) {
    setPrevSig(sig)
    setLimit(pageSize)
    setActive(0)
  }

  const shown = compact ? visible : visible.slice(0, limit)
  const remaining = visible.length - shown.length

  const emit = (set) => onChange?.(multiple ? list.filter((c) => set.has(c.id)).map((c) => c.id) : [...set][0] || '')

  const toggle = (id) => {
    if (disabled.has(id)) return
    if (!multiple) return onChange?.(id)
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    emit(next)
  }

  const applyQuick = (qs) => {
    const ids = typeof qs.ids === 'function' ? qs.ids(list) : qs.ids || []
    const next = qs.mode === 'add' ? new Set([...selected, ...ids]) : new Set(ids)
    for (const id of disabled) next.delete(id)
    emit(next)
  }

  const selectVisible = () => {
    const next = new Set(selected)
    for (const c of visible) if (!disabled.has(c.id)) next.add(c.id)
    emit(next)
  }
  const clearAll = () => emit(new Set())

  // Mantener visible la opción activa al navegar con teclado.
  useEffect(() => {
    if (compact) return
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [active, compact])

  const onKeyDown = (e) => {
    if (!shown.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.min(active + 1, visible.length - 1)
      if (next >= shown.length) setLimit((l) => l + pageSize)
      setActive(next)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Home' && e.currentTarget === listRef.current) {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End' && e.currentTarget === listRef.current) {
      e.preventDefault()
      setActive(shown.length - 1)
    } else if (e.key === 'Enter' || (e.key === ' ' && e.currentTarget === listRef.current)) {
      e.preventDefault()
      const c = shown[Math.min(active, shown.length - 1)]
      if (c) toggle(c.id)
    } else if (e.key === 'Escape' && q) {
      e.preventDefault()
      e.stopPropagation()
      setQ('')
    }
  }

  const onScroll = (e) => {
    const el = e.currentTarget
    if (remaining > 0 && el.scrollTop + el.clientHeight > el.scrollHeight - 120) setLimit((l) => l + pageSize)
  }

  const selectedList = multiple ? list.filter((c) => selected.has(c.id)) : []
  const filtering = !!q || !!filter

  if (!list.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 dark:border-white/10 px-4 py-6 text-center text-sm text-slate-500 dark:text-white/50">
        <Users className="w-5 h-5 mx-auto mb-1.5 text-slate-400" />
        {emptyMessage}
      </div>
    )
  }

  const quickBar = (withAllNone || quickSelect.length > 0) && (
    <div className="flex flex-wrap items-center gap-1.5">
      {quickSelect.map((qs) => (
        <QuickBtn key={qs.label} onClick={() => applyQuick(qs)}>
          {qs.label}
        </QuickBtn>
      ))}
      {withAllNone && (
        <>
          <QuickBtn onClick={selectVisible}>{filtering && !compact ? `Marcar los ${visible.length} visibles` : 'Todos'}</QuickBtn>
          <QuickBtn onClick={clearAll} disabled={!selected.size}>
            Ninguno
          </QuickBtn>
        </>
      )}
    </div>
  )

  const filterBar = filters.length > 0 && (
    <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5 [scrollbar-width:none]" role="group" aria-label="Filtrar niños">
      {[{ key: '', label: 'Todos' }, ...filters].map((f) => (
        <button
          key={f.key || 'all'}
          type="button"
          aria-pressed={filter === f.key}
          onClick={() => setFilter(f.key)}
          className={`shrink-0 inline-flex items-center gap-1.5 px-3 min-h-9 rounded-lg text-xs font-medium whitespace-nowrap transition ${
            filter === f.key
              ? 'bg-accent-soft text-accent-text ring-1 ring-inset ring-accent/25'
              : 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10'
          }`}
        >
          {f.label}
          <span className="min-w-5 px-1.5 rounded-full text-[11px] tabular-nums bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/50">
            {filterCounts[f.key] ?? 0}
          </span>
        </button>
      ))}
    </div>
  )

  // ── Modo compacto: rejilla de 1 toque ──
  if (compact) {
    return (
      <div className="space-y-2.5">
        {(quickBar || filterBar) && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {filterBar}
            {quickBar}
          </div>
        )}
        {multiple && (
          <p className="text-xs text-slate-500 dark:text-white/50 tabular-nums" aria-live="polite">
            {selected.size ? `${selected.size} de ${list.length} seleccionados` : 'Toca para elegir'}
          </p>
        )}
        <div
          role="listbox"
          aria-label={label}
          aria-multiselectable={multiple || undefined}
          className="grid grid-cols-3 sm:grid-cols-4 gap-2"
        >
          {visible.map((c) => {
            const on = selected.has(c.id)
            const off = disabled.has(c.id)
            return (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={on}
                disabled={off}
                onClick={() => toggle(c.id)}
                className={`relative flex flex-col items-center gap-1.5 px-1.5 py-2.5 min-h-22 rounded-lg border text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring disabled:opacity-40 ${
                  on
                    ? 'bg-accent-soft border-accent/40 text-accent-text'
                    : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-white/10'
                }`}
              >
                <Avatar src={c.photoUrl} name={c.name} size="md" />
                <span className="text-xs font-medium leading-tight line-clamp-2">{c.name.split(' ')[0]}</span>
                {on && (
                  <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-accent text-accent-fg inline-flex items-center justify-center">
                    <Check className="w-3 h-3" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
        {!visible.length && <p className="text-sm text-slate-500 dark:text-white/50 py-3 text-center">Ningún niño en este filtro.</p>}
      </div>
    )
  }

  // ── Modo lista (muchos niños) ──
  const activeIdx = Math.min(active, shown.length - 1)
  return (
    <div className="space-y-2.5">
      {multiple && selectedList.length > 0 && (
        <div className="rounded-lg bg-slate-50 dark:bg-white/4 border border-slate-200/70 dark:border-white/8 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <p className="text-xs font-semibold text-slate-700 dark:text-white/80 tabular-nums" aria-live="polite">
              {selectedList.length} seleccionado{selectedList.length === 1 ? '' : 's'}
            </p>
            <button type="button" onClick={clearAll} className="text-xs font-medium text-accent-text hover:underline min-h-8 px-1">
              Limpiar
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            {selectedList.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1 pl-1 pr-0.5 py-0.5 rounded-md bg-white dark:bg-white/8 border border-slate-200 dark:border-white/10 text-xs text-slate-700 dark:text-white/80"
              >
                <Avatar src={c.photoUrl} name={c.name} size="xs" />
                <span className="max-w-32 truncate">{c.name}</span>
                <button
                  type="button"
                  onClick={() => toggle(c.id)}
                  aria-label={`Quitar a ${c.name}`}
                  className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-white/10"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <SearchInput
        value={q}
        onChange={setQ}
        placeholder={placeholder}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded="true"
        aria-controls={`${baseId}-list`}
        aria-activedescendant={shown.length ? `${baseId}-opt-${activeIdx}` : undefined}
        aria-label={placeholder}
        autoComplete="off"
      />
      {filterBar}
      {quickBar}

      <div
        id={`${baseId}-list`}
        ref={listRef}
        role="listbox"
        aria-label={label}
        aria-multiselectable={multiple || undefined}
        tabIndex={0}
        aria-activedescendant={shown.length ? `${baseId}-opt-${activeIdx}` : undefined}
        onKeyDown={onKeyDown}
        onScroll={onScroll}
        style={{ maxHeight: maxListHeight }}
        className="overflow-y-auto overscroll-contain rounded-lg border border-slate-200 dark:border-white/10 divide-y divide-slate-100 dark:divide-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
      >
        {shown.map((c, i) => {
          const on = selected.has(c.id)
          const off = disabled.has(c.id)
          const isActive = i === activeIdx
          return (
            <div
              key={c.id}
              id={`${baseId}-opt-${i}`}
              data-idx={i}
              role="option"
              aria-selected={on}
              aria-disabled={off || undefined}
              onClick={() => {
                setActive(i)
                toggle(c.id)
              }}
              onMouseMove={() => !isActive && setActive(i)}
              className={`flex items-center gap-3 px-3 min-h-13 cursor-pointer select-none transition ${
                off ? 'opacity-40 cursor-not-allowed' : ''
              } ${on ? 'bg-accent-soft/70' : ''} ${isActive ? 'bg-slate-50 dark:bg-white/5' : ''}`}
            >
              <span
                aria-hidden="true"
                className={`w-5 h-5 shrink-0 inline-flex items-center justify-center border transition ${
                  multiple ? 'rounded' : 'rounded-full'
                } ${on ? 'bg-accent border-accent text-accent-fg' : 'border-slate-300 dark:border-white/20 bg-white dark:bg-transparent'}`}
              >
                {on && <Check className="w-3 h-3" />}
              </span>
              <Avatar src={c.photoUrl} name={c.name} size="sm" />
              <span className="min-w-0 flex-1 py-1.5">
                <span className="block text-sm font-medium text-slate-900 dark:text-white truncate">
                  <Highlight text={c.name} query={q} />
                </span>
                {(showDocument || (showRoom && c.classroomName)) && (
                  <span className="block text-xs text-slate-500 dark:text-white/45 truncate tabular-nums">
                    {showDocument &&
                      (c.documentId ? (
                        <>
                          CI <Highlight text={formatDocumentId(c.documentId)} query={/\d/.test(q) ? q.replace(/[\s.-]/g, '') : ''} />
                        </>
                      ) : (
                        <span className="text-slate-400 dark:text-white/30">Sin cédula</span>
                      ))}
                    {showDocument && showRoom && c.classroomName && ' · '}
                    {showRoom && c.classroomName}
                  </span>
                )}
              </span>
              {renderMeta && <span className="shrink-0 text-xs text-slate-500 dark:text-white/50">{renderMeta(c)}</span>}
            </div>
          )
        })}
        {!shown.length && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-slate-600 dark:text-white/60">Ningún niño coincide{q ? ` con «${q}»` : ''}.</p>
            {filtering && (
              <button
                type="button"
                onClick={() => {
                  setQ('')
                  setFilter('')
                }}
                className="mt-2 text-xs font-medium text-accent-text hover:underline min-h-9"
              >
                Ver todos
              </button>
            )}
          </div>
        )}
        {remaining > 0 && (
          <button
            type="button"
            onClick={() => setLimit((l) => l + pageSize)}
            className="w-full min-h-11 text-xs font-semibold text-accent-text hover:bg-slate-50 dark:hover:bg-white/5"
          >
            Ver más ({remaining} restantes)
          </button>
        )}
      </div>
      <p className="text-[11px] text-slate-400 dark:text-white/35 tabular-nums">
        {visible.length} de {list.length} niños
        <span className="hidden sm:inline"> · ↑ ↓ para moverte, Enter para marcar</span>
      </p>
    </div>
  )
}

function Highlight({ text, query }) {
  const parts = highlightParts(text, query)
  return parts.map((p, i) =>
    p.hit ? (
      <mark key={i} className="bg-amber-100 dark:bg-amber-400/25 text-inherit rounded-sm">
        {p.text}
      </mark>
    ) : (
      <span key={i}>{p.text}</span>
    ),
  )
}

function QuickBtn({ children, ...rest }) {
  return (
    <button
      type="button"
      {...rest}
      className="shrink-0 px-2.5 min-h-9 rounded-lg text-xs font-medium text-slate-600 dark:text-white/65 border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition"
    >
      {children}
    </button>
  )
}
