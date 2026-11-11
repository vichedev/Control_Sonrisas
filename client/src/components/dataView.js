import { useCallback, useDeferredValue, useMemo, useState } from 'react'

/**
 * Búsqueda + filtros reutilizables para tablas y listas (ver README-tables.md).
 *
 *   const view = useDataView({ rows, searchKeys: ['fullName', 'documentId'], filters, storageKey: 'staff' })
 *   <DataToolbar view={view} searchPlaceholder="Buscar…" actions={<Button>…</Button>} />
 *   view.filtered → filas que pasan búsqueda + filtros
 *
 * Filtro (`filters[]`):
 *   { key, label, icon?, multiple?, type?: 'select' | 'dateRange',
 *     options?: [{ value, label }] | [[value, label]] | (rows) => options   (si falta: valores distintos)
 *     value?: (row) => valor | valor[]        (por defecto row[key]; array = coincide si alguno coincide)
 *     match?: (row, selected) => boolean      (lógica propia; selected = string | string[] | {from,to})
 *     optionLabel?: (value) => string, emptyLabel?: 'Sin sala' (incluye filas sin valor),
 *     defaultValue?, allLabel?: 'Todas', counts?: false }
 */

// ── Utilidades ──────────────────────────────────────────────────────────

/** Minúsculas y sin tildes ("María" → "maria"). */
export function normText(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

export function getByPath(obj, path) {
  if (!obj) return undefined
  if (typeof path !== 'string' || !path.includes('.')) return obj[path]
  return path.split('.').reduce((acc, p) => (acc == null ? acc : acc[p]), obj)
}

const STORE_PREFIX = 'sonrisas.table.'

/** Lee la configuración guardada de una tabla (localStorage, tolerante a errores). */
export function readTableStore(storageKey) {
  if (!storageKey) return {}
  try {
    const raw = window.localStorage.getItem(STORE_PREFIX + storageKey)
    const v = raw ? JSON.parse(raw) : {}
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

/** Mezcla `patch` en la configuración guardada de la tabla. */
export function writeTableStore(storageKey, patch) {
  if (!storageKey) return
  try {
    const next = { ...readTableStore(storageKey), ...patch }
    window.localStorage.setItem(STORE_PREFIX + storageKey, JSON.stringify(next))
  } catch {
    // modo privado / almacenamiento bloqueado: no pasa nada
  }
}

const EMPTY = '__empty__'

export function emptySelection(f) {
  if (f.type === 'dateRange') return { from: '', to: '' }
  return f.multiple ? [] : ''
}

export function isActiveSel(f, sel) {
  if (sel == null) return false
  if (f.type === 'dateRange') return !!(sel.from || sel.to)
  if (f.multiple) return Array.isArray(sel) && sel.length > 0
  return sel !== ''
}

function rowValues(f, row) {
  const raw = f.value ? f.value(row) : getByPath(row, f.key)
  const arr = Array.isArray(raw) ? raw : [raw]
  const out = arr.map((v) => (v == null || v === '' ? EMPTY : String(v)))
  return out.length ? out : [EMPTY]
}

function matchRow(f, row, sel) {
  if (f.match) return f.match(row, sel)
  if (f.type === 'dateRange') {
    const raw = f.value ? f.value(row) : getByPath(row, f.key)
    const arr = Array.isArray(raw) ? raw : [raw]
    const from = String(arr[0] || '').slice(0, 10)
    const to = String(arr[1] || arr[0] || '').slice(0, 10)
    if (!from) return false
    return (!sel.from || to >= sel.from) && (!sel.to || from <= sel.to)
  }
  const vals = rowValues(f, row)
  if (f.multiple) return sel.some((s) => vals.includes(String(s)))
  return vals.includes(String(sel))
}

function normalizeOptions(opts) {
  return (opts || []).map((o) =>
    Array.isArray(o) ? { value: String(o[0]), label: o[1] } : { ...o, value: String(o.value) },
  )
}

function resolveOptions(f, rows) {
  if (f.type === 'dateRange') return []
  if (typeof f.options === 'function') return normalizeOptions(f.options(rows))
  if (f.options) return normalizeOptions(f.options)
  const seen = new Map()
  for (const r of rows) {
    for (const v of rowValues(f, r)) {
      if (v === EMPTY || seen.has(v)) continue
      seen.set(v, f.optionLabel ? f.optionLabel(v) : v)
    }
  }
  const list = [...seen].map(([value, label]) => ({ value, label: String(label) }))
  list.sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base', numeric: true }))
  if (f.emptyLabel) list.push({ value: EMPTY, label: f.emptyLabel })
  return list
}

/** ¿La fila coincide con TODAS las palabras de la búsqueda (en cualquiera de los campos)? */
function makeMatcher(searchKeys, searchFn, q) {
  const words = normText(q).trim().split(/\s+/).filter(Boolean)
  if (!words.length) return null
  if (searchFn) return (r) => searchFn(r, normText(q).trim(), q)
  if (!searchKeys?.length) return null
  return (r) => {
    const hay = searchKeys
      .map((k) => {
        const v = typeof k === 'function' ? k(r) : getByPath(r, k)
        return v == null ? '' : normText(Array.isArray(v) ? v.join(' ') : v)
      })
      .join(' \u0001 ')
    return words.every((w) => hay.includes(w))
  }
}

// ── Hook ────────────────────────────────────────────────────────────────

/**
 * Estado de búsqueda + filtros con contadores por opción (facetados: cada contador tiene en
 * cuenta la búsqueda y los demás filtros). Recuerda los filtros en localStorage si hay `storageKey`.
 */
export function useDataView({ rows, searchKeys, searchFn, filters, storageKey, initialSearch = '' }) {
  const safeRows = useMemo(() => (Array.isArray(rows) ? rows : []), [rows])
  const specs = useMemo(() => (filters || []).filter(Boolean), [filters])
  const [search, setSearch] = useState(initialSearch)
  const deferredSearch = useDeferredValue(search)

  const [values, setValues] = useState(() => {
    const saved = readTableStore(storageKey).filters || {}
    const init = {}
    for (const f of specs) {
      const s = saved[f.key]
      const valid =
        s !== undefined &&
        (f.type === 'dateRange' ? s && typeof s === 'object' : f.multiple ? Array.isArray(s) : typeof s === 'string')
      init[f.key] = valid ? s : (f.defaultValue ?? emptySelection(f))
    }
    return init
  })

  const sel = useCallback((f) => values[f.key] ?? emptySelection(f), [values])

  const setFilter = useCallback(
    (key, value) => {
      setValues((prev) => {
        const next = { ...prev, [key]: value }
        writeTableStore(storageKey, { filters: next })
        return next
      })
    },
    [storageKey],
  )

  const clearFilters = useCallback(() => {
    const next = {}
    for (const f of specs) next[f.key] = emptySelection(f)
    setValues(next)
    writeTableStore(storageKey, { filters: next })
  }, [specs, storageKey])

  const searched = useMemo(() => {
    const m = makeMatcher(searchKeys, searchFn, deferredSearch)
    return m ? safeRows.filter(m) : safeRows
  }, [safeRows, searchKeys, searchFn, deferredSearch])

  const active = useMemo(() => specs.filter((f) => isActiveSel(f, sel(f))), [specs, sel])

  const filtered = useMemo(() => {
    if (!active.length) return searched
    return searched.filter((r) => active.every((f) => matchRow(f, r, sel(f))))
  }, [searched, active, sel])

  // Opciones + contadores facetados.
  const resolved = useMemo(
    () =>
      specs.map((f) => {
        const options = resolveOptions(f, safeRows)
        let counts = null
        if (f.type !== 'dateRange' && f.counts !== false) {
          const others = active.filter((o) => o.key !== f.key)
          const base = others.length ? searched.filter((r) => others.every((o) => matchRow(o, r, sel(o)))) : searched
          counts = {}
          if (f.match) {
            for (const o of options) counts[o.value] = base.filter((r) => f.match(r, f.multiple ? [o.value] : o.value)).length
          } else {
            for (const r of base) for (const v of new Set(rowValues(f, r))) counts[v] = (counts[v] || 0) + 1
          }
          counts[''] = base.length
        }
        return { ...f, options, counts }
      }),
    [specs, safeRows, searched, active, sel],
  )

  return {
    rows: safeRows,
    search,
    setSearch,
    searching: search !== deferredSearch,
    values,
    setFilter,
    clearFilters,
    filters: resolved,
    activeCount: active.length,
    filtered,
    total: safeRows.length,
    hasSearch: !!(searchKeys?.length || searchFn),
    clearAll: () => {
      setSearch('')
      clearFilters()
    },
  }
}

