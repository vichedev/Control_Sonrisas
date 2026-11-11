import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns,
  Inbox,
  MoreVertical,
} from './icons'
import { DataToolbar, Popover } from './DataToolbar'
import { getByPath, readTableStore, useDataView, writeTableStore } from './dataView'

export { DataToolbar, SearchInput, FilterMenu } from './DataToolbar'

/**
 * Tabla inteligente y responsiva (guía completa en README-tables.md).
 *
 * Props:
 *   rows           : array de objetos a mostrar.
 *   columns        : [{ key, label, render?, className?, primary?, hideOnMobile?, mobileLabel?, sortValue?, mobileFull?,
 *                       defaultHidden?, alwaysVisible? }]
 *                    - key         : identificador único de la columna.
 *                    - label       : texto del header (puede ser '' para columnas de acciones).
 *                    - render(row) : función que retorna el contenido de la celda.
 *                    - primary     : true → se muestra grande arriba en la card mobile.
 *                    - hideOnMobile: true → no aparece en la card mobile (va en "Más detalles").
 *                    - mobileLabel : label más corto para usar en la card mobile.
 *                    - className   : clases extra para la celda (ej. 'text-right').
 *                    - sortValue(row): si existe, el header es clicable y ordena por ese valor.
 *                    - mobileFull  : ocupa todo el ancho en la card mobile. Las columnas sin
 *                                    label (acciones) van arriba a la derecha de la card.
 *                    - defaultHidden / alwaysVisible: para `columnToggle`.
 *   rowKey         : nombre de propiedad o función que devuelve la key React de cada fila. Default 'id'.
 *   loading        : booleano — muestra skeleton.
 *   searchKeys     : campos (o funciones row→texto) para la búsqueda libre (sin tildes, todas las palabras).
 *                    Si se omite (y no hay searchFn), la barra de búsqueda no aparece.
 *   searchFn(row, qNorm, qRaw): búsqueda propia (alternativa a searchKeys).
 *   searchPlaceholder
 *   filters        : filtros desplegables con contadores (ver DataToolbar.jsx / README-tables.md).
 *   storageKey     : recuerda tamaño de página, filtros y columnas ocultas (localStorage).
 *   defaultSort    : { key, dir: 'asc' | 'desc' }.
 *   renderExpanded(row): fila desplegable (chevron en desktop; dentro de "Más detalles" en móvil).
 *   expandOnRowClick: con renderExpanded, el clic en la fila la despliega (default: si no hay onRowClick).
 *   columnToggle   : botón "Columnas" en desktop para ocultar/mostrar columnas.
 *   itemLabel      : ['registro', 'registros'] — texto del pie.
 *   initialPageSize: tamaño inicial (default 25).
 *   pageSizeOptions: array con opciones de tamaño (default [10, 25, 50, 100]).
 *   onRowClick(row): callback al hacer click en una fila.
 *   emptyMessage   : texto cuando rows está vacío.
 *   emptyAfterSearch: texto cuando no hay resultados tras filtrar.
 *   emptyIcon / emptyAction: icono y botón (CTA) opcionales del estado vacío.
 *   toolbar        : node React opcional a la derecha del search (ej. botón "Exportar").
 *   stickyHeader   : default true. El encabezado queda fijo al desplazarse dentro de la tabla.
 *   maxHeight      : alto máximo del cuerpo en desktop (default '70vh' si stickyHeader). null = sin límite.
 *   rowClassName(row): clases extra para la fila (desktop y card mobile).
 *   onCount(n)     : total tras filtrar. onFiltered(rows): filas tras filtrar (p. ej. para exportar).
 */
export default function SmartTable({
  rows,
  columns,
  rowKey = 'id',
  loading = false,
  searchKeys,
  searchFn,
  searchPlaceholder = 'Buscar…',
  filters,
  storageKey,
  defaultSort = null,
  renderExpanded,
  expandOnRowClick,
  columnToggle = false,
  itemLabel = ['registro', 'registros'],
  initialPageSize = 25,
  pageSizeOptions = [10, 25, 50, 100],
  onRowClick,
  emptyMessage = 'Sin datos.',
  emptyAfterSearch = 'Sin resultados con esos filtros.',
  emptyIcon: EmptyIcon = Inbox,
  emptyAction,
  toolbar,
  stickyHeader = true,
  maxHeight,
  rowClassName,
  onCount,
  onFiltered,
}) {
  const view = useDataView({ rows, searchKeys, searchFn, filters, storageKey })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    const saved = Number(readTableStore(storageKey).pageSize)
    return pageSizeOptions.includes(saved) ? saved : initialPageSize
  })
  const [hidden, setHidden] = useState(() => {
    const saved = readTableStore(storageKey).hidden
    return new Set(Array.isArray(saved) ? saved : columns.filter((c) => c.defaultHidden).map((c) => c.key))
  })
  const [expandedIds, setExpandedIds] = useState(new Set())
  const [sort, setSort] = useState(defaultSort) // { key, dir: 'asc' | 'desc' }

  // Volver a la página 1 cuando cambian los datos, la búsqueda o los filtros. Se ajusta
  // durante el render (patrón recomendado por React) en vez de con un efecto en cascada.
  const signature = `${view.rows.length}|${view.search}|${JSON.stringify(view.values)}`
  const [prevSig, setPrevSig] = useState(signature)
  if (prevSig !== signature) {
    setPrevSig(signature)
    setPage(1)
  }

  const filtered = view.filtered

  // Orden opcional (sólo columnas con sortValue).
  const sortCol = sort && columns.find((c) => c.key === sort.key && c.sortValue)
  const sortFn = sortCol?.sortValue
  const sortDir = sort?.dir
  const sorted = useMemo(() => {
    if (!sortFn) return filtered
    const dir = sortDir === 'desc' ? -1 : 1
    const keyed = filtered.map((r) => [sortFn(r), r])
    keyed.sort(([va], [vb]) => {
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), 'es', { sensitivity: 'base', numeric: true }) * dir
    })
    return keyed.map(([, r]) => r)
    // sortFn cambia de identidad en cada render de la página: se ordena por clave de columna.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort?.key, sortDir])

  const changePageSize = (size) => {
    setPageSize(size)
    setPage(1)
    writeTableStore(storageKey, { pageSize: size })
  }
  const toggleSort = (key) => {
    setSort((s) => (!s || s.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null))
    setPage(1)
  }
  const toggleColumn = (key) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      writeTableStore(storageKey, { hidden: [...next] })
      return next
    })
  }

  const total = sorted.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * pageSize
  const end = Math.min(total, start + pageSize)
  const pageRows = sorted.slice(start, end)

  useEffect(() => { onCount?.(total) }, [total, onCount])
  useEffect(() => { onFiltered?.(sorted) }, [sorted, onFiltered])

  const getRowKey = (r, i) =>
    typeof rowKey === 'function'
      ? rowKey(r, i)
      : (r && r[rowKey] != null ? r[rowKey] : i)

  const toggleable = columnToggle ? columns.filter((c) => c.label && !c.alwaysVisible && !c.primary) : []
  const desktopColumns = columnToggle ? columns.filter((c) => !hidden.has(c.key) || !toggleable.includes(c)) : columns
  const mobileColumns = columns.filter((c) => !c.hideOnMobile)
  const mobileExtraColumns = columns.filter((c) => c.hideOnMobile)
  const primaryColumn = mobileColumns.find((c) => c.primary) || mobileColumns[0]
  // Columnas sin título (acciones) van arriba a la derecha de la card; mobileFull, a todo el ancho.
  const cornerMobileColumns = mobileColumns.filter((c) => c !== primaryColumn && !c.label && !c.mobileFull)
  const gridMobileColumns = mobileColumns.filter((c) => c !== primaryColumn && c.label && !c.mobileFull)
  const fullMobileColumns = mobileColumns.filter((c) => c !== primaryColumn && c.mobileFull)
  const hasMobileExtra = mobileExtraColumns.length > 0 || !!renderExpanded
  const rowExpands = !!renderExpanded && (expandOnRowClick ?? !onRowClick)

  const toggleExpand = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const cell = (c, r) => (c.render ? c.render(r) : (getByPath(r, c.key) ?? '—'))
  const bodyMaxHeight = maxHeight === undefined ? (stickyHeader ? '70vh' : null) : maxHeight
  const showPagination = total > Math.min(...pageSizeOptions, pageSize)
  const filtering = !!view.search || view.activeCount > 0
  const showToolbar = view.hasSearch || toolbar || view.filters.length > 0 || toggleable.length > 0
  const [one, many] = itemLabel

  return (
    <div className="rounded-xl bg-white dark:bg-surface border border-slate-200 dark:border-white/8 overflow-hidden shadow-xs">
      {showToolbar && (
        <DataToolbar
          view={view}
          bordered
          searchPlaceholder={searchPlaceholder}
          actions={
            toolbar || toggleable.length ? (
              <>
                {toolbar}
                {toggleable.length > 0 && <ColumnToggle columns={toggleable} hidden={hidden} onToggle={toggleColumn} />}
              </>
            ) : null
          }
          showCount={false}
          extra={
            filtering ? (
              <span className="shrink-0 text-[11px] text-slate-500 dark:text-white/50 font-medium tabular-nums whitespace-nowrap px-1" aria-live="polite">
                {total} resultado{total === 1 ? '' : 's'}
              </span>
            ) : null
          }
        />
      )}

      {/* Loading skeleton */}
      {loading ? (
        <div className="p-4 sm:p-5 space-y-2.5" aria-busy="true" aria-label="Cargando">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-white/5 animate-pulse shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-1/3 rounded bg-slate-100 dark:bg-white/5 animate-pulse" />
                <div className="h-2.5 w-1/2 rounded bg-slate-100/70 dark:bg-white/4 animate-pulse" />
              </div>
              <div className="hidden md:block h-3 w-24 rounded bg-slate-100 dark:bg-white/5 animate-pulse" />
            </div>
          ))}
        </div>
      ) : total === 0 ? (
        <div className="py-12 px-6 text-center">
          <span className="inline-flex w-12 h-12 rounded-xl bg-slate-100 dark:bg-white/5 items-center justify-center mb-3">
            <EmptyIcon className="w-6 h-6 text-slate-400 dark:text-white/30" />
          </span>
          <p className="text-sm font-semibold text-slate-600 dark:text-white/60">
            {filtering ? emptyAfterSearch : emptyMessage}
          </p>
          {filtering ? (
            <button
              type="button"
              onClick={view.clearAll}
              className="mt-3 text-xs font-medium text-accent-text hover:underline min-h-9"
            >
              {view.activeCount ? 'Limpiar búsqueda y filtros' : 'Limpiar búsqueda'}
            </button>
          ) : (
            emptyAction && <div className="mt-4 flex justify-center">{emptyAction}</div>
          )}
        </div>
      ) : (
        <>
          {/* DESKTOP: tabla con encabezado fijo; desplaza dentro si hay muchas filas */}
          <div
            className="hidden md:block overflow-auto"
            style={bodyMaxHeight ? { maxHeight: bodyMaxHeight } : undefined}
          >
            <table className="w-full text-sm">
              <thead
                className={`text-left text-xs text-slate-500 dark:text-white/50 ${
                  stickyHeader ? 'sticky top-0 z-10' : ''
                }`}
              >
                <tr className="bg-slate-50 dark:bg-elevated shadow-[inset_0_-1px_0] dark:shadow-white/10">
                  {renderExpanded && <th scope="col" className="w-10 px-2"><span className="sr-only">Desplegar</span></th>}
                  {desktopColumns.map((c) => {
                    const active = sort?.key === c.key
                    const SortIcon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                        className={`px-4 py-2.5 font-medium whitespace-nowrap ${c.className || ''}`}
                      >
                        {c.sortValue ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(c.key)}
                            className={`inline-flex items-center gap-1 hover:text-slate-800 dark:hover:text-white ${
                              active ? 'text-slate-800 dark:text-white' : ''
                            }`}
                          >
                            {c.label}
                            <SortIcon className={`w-3 h-3 ${active ? '' : 'opacity-40'}`} />
                          </button>
                        ) : (
                          c.label
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {pageRows.map((r, i) => {
                  const id = getRowKey(r, i)
                  const isExpanded = expandedIds.has(id)
                  const click = onRowClick ? () => onRowClick(r) : rowExpands ? () => toggleExpand(id) : undefined
                  return (
                    <Fragment key={id}>
                      <tr
                        onClick={click ? (e) => {
                          if (e.target.closest('button, a, input, select, textarea, [data-stop]')) return
                          click()
                        } : undefined}
                        className={`${click ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-white/4' : 'hover:bg-slate-50/60 dark:hover:bg-white/2'} ${isExpanded ? 'bg-slate-50/70 dark:bg-white/3' : ''} transition ${rowClassName?.(r) || ''}`}
                      >
                        {renderExpanded && (
                          <td className="px-2 py-3 align-middle w-10">
                            <button
                              type="button"
                              onClick={() => toggleExpand(id)}
                              aria-expanded={isExpanded}
                              aria-label={isExpanded ? 'Ocultar detalles' : 'Ver detalles'}
                              className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-white/10 dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
                            >
                              <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                            </button>
                          </td>
                        )}
                        {desktopColumns.map((c) => (
                          <td key={c.key} className={`px-4 py-3 align-middle ${c.className || ''}`}>
                            {cell(c, r)}
                          </td>
                        ))}
                      </tr>
                      {renderExpanded && isExpanded && (
                        <tr className="bg-slate-50/70 dark:bg-white/3">
                          <td />
                          <td colSpan={desktopColumns.length} className="px-4 pb-4 pt-1">
                            {renderExpanded(r)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* MOBILE: cards. Las columnas con hideOnMobile y renderExpanded van tras "Más detalles". */}
          <ul className="md:hidden divide-y divide-slate-100 dark:divide-white/5">
            {pageRows.map((r, i) => {
              const id = getRowKey(r, i)
              const isExpanded = expandedIds.has(id)
              return (
                <li
                  key={id}
                  className={`p-4 ${onRowClick ? 'cursor-pointer active:bg-slate-50 dark:active:bg-white/5' : ''} transition ${rowClassName?.(r) || ''}`}
                  onClick={onRowClick ? (e) => {
                    if (e.target.closest('[data-stop]')) return
                    onRowClick(r)
                  } : undefined}
                >
                  {/* Bloque principal (columna primary, grande arriba) + acciones en la esquina */}
                  <div className="flex items-start gap-2 mb-2.5">
                    {primaryColumn && <div className="min-w-0 flex-1">{cell(primaryColumn, r)}</div>}
                    {cornerMobileColumns.map((c) => (
                      <div key={c.key} data-stop className="shrink-0 -mt-1 -mr-1">
                        {cell(c, r)}
                      </div>
                    ))}
                  </div>

                  {/* Resto de columnas visibles en mobile como label:value */}
                  {gridMobileColumns.length > 0 && (
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      {gridMobileColumns.map((c) => {
                        const value = cell(c, r)
                        const isEmpty = value === '—' || value == null
                        return (
                          <div key={c.key} className={`flex flex-col min-w-0 ${isEmpty ? 'opacity-60' : ''}`}>
                            <dt className="text-[11px] font-medium text-slate-500 dark:text-white/45">{c.mobileLabel || c.label}</dt>
                            <dd className="text-slate-700 dark:text-white/85 min-w-0 wrap-break-word">{value}</dd>
                          </div>
                        )
                      })}
                    </dl>
                  )}

                  {/* Columnas a todo el ancho (acciones) */}
                  {fullMobileColumns.map((c) => (
                    <div key={c.key} data-stop className="mt-3 min-w-0">
                      {c.label && (
                        <p className="text-[11px] font-medium text-slate-500 dark:text-white/45 mb-0.5">{c.mobileLabel || c.label}</p>
                      )}
                      {cell(c, r)}
                    </div>
                  ))}

                  {/* Sección colapsable: columnas hideOnMobile + renderExpanded */}
                  {hasMobileExtra && (
                    <>
                      <button
                        type="button"
                        data-stop
                        aria-expanded={isExpanded}
                        onClick={(e) => { e.stopPropagation(); toggleExpand(id) }}
                        className="mt-2 -ml-1 inline-flex items-center gap-1 min-h-9 px-1 text-xs font-medium text-accent-text hover:underline"
                      >
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        {isExpanded ? 'Ocultar detalles' : 'Más detalles'}
                      </button>
                      {isExpanded && (
                        <div data-stop className="mt-1 pt-2 border-t border-slate-200/60 dark:border-white/5">
                          {mobileExtraColumns.length > 0 && (
                            <dl className="grid grid-cols-1 gap-2 text-xs">
                              {mobileExtraColumns.map((c) => (
                                <div key={c.key} className="flex flex-col min-w-0">
                                  {(c.mobileLabel || c.label) && (
                                    <dt className="text-[11px] font-medium text-slate-500 dark:text-white/45">{c.mobileLabel || c.label}</dt>
                                  )}
                                  <dd className="text-slate-700 dark:text-white/85 min-w-0 wrap-break-word">{cell(c, r)}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                          {renderExpanded && <div className={mobileExtraColumns.length ? 'mt-3' : ''}>{renderExpanded(r)}</div>}
                        </div>
                      )}
                    </>
                  )}
                </li>
              )
            })}
          </ul>

          {/* Footer: paginación (sólo si hace falta; si no, el total) */}
          {showPagination ? (
            <Pagination
              page={safePage}
              totalPages={totalPages}
              pageSize={pageSize}
              pageSizeOptions={pageSizeOptions}
              total={total}
              start={start}
              end={end}
              onPage={setPage}
              onPageSize={changePageSize}
              itemLabel={many}
            />
          ) : (
            <div className="px-4 py-2.5 border-t border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/2 text-xs text-slate-500 dark:text-white/50 tabular-nums">
              {total} {total === 1 ? one : many}
              {filtering && view.total !== total ? ` de ${view.total}` : ''}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Menú "Columnas" (desktop): mostrar/ocultar columnas opcionales. */
function ColumnToggle({ columns, hidden, onToggle }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const hiddenCount = columns.filter((c) => hidden.has(c.key)).length
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="hidden md:inline-flex items-center gap-1.5 px-3 min-h-9 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-xs font-medium text-slate-600 dark:text-white/65 hover:bg-slate-50 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
      >
        <Columns className="w-3.5 h-3.5" />
        Columnas
        {hiddenCount > 0 && <span className="text-slate-400 tabular-nums">({columns.length - hiddenCount}/{columns.length})</span>}
      </button>
      <Popover open={open} anchorRef={ref} onClose={() => setOpen(false)} title="Columnas visibles" width={240} align="end">
        <div className="py-1.5">
          <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Columnas visibles</p>
          {columns.map((c) => (
            <label key={c.key} className="flex items-center gap-2.5 px-3 min-h-9 text-sm text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer">
              <input type="checkbox" className="accent-accent w-4 h-4" checked={!hidden.has(c.key)} onChange={() => onToggle(c.key)} />
              {c.label}
            </label>
          ))}
        </div>
      </Popover>
    </>
  )
}

function Pagination({ page, totalPages, pageSize, pageSizeOptions, total, start, end, onPage, onPageSize, itemLabel }) {
  // Ventana de páginas: muestra hasta 5 botones alrededor del actual.
  const window = 5
  let pStart = Math.max(1, page - Math.floor(window / 2))
  let pEnd = Math.min(totalPages, pStart + window - 1)
  if (pEnd - pStart < window - 1) pStart = Math.max(1, pEnd - window + 1)
  const pages = []
  for (let p = pStart; p <= pEnd; p++) pages.push(p)

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-3 border-t border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/2 text-xs">
      <div className="flex items-center gap-3">
        <span className="text-slate-500 dark:text-white/50 tabular-nums">
          <span className="hidden sm:inline">Mostrando </span>
          {total === 0 ? '0' : `${start + 1}–${end}`} de <strong className="text-slate-700 dark:text-white/80">{total}</strong>
          <span className="hidden sm:inline"> {itemLabel}</span>
        </span>
        <label className="inline-flex items-center gap-1.5 text-slate-500 dark:text-white/50">
          <span className="hidden sm:inline">Por página</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            aria-label="Filas por página"
            className="px-2 min-h-9 sm:min-h-8 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-semibold text-slate-700 dark:text-white/80 focus:outline-none focus:ring-2 focus:ring-accent-ring"
          >
            {pageSizeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      <nav className="flex items-center gap-1" aria-label="Paginación">
        <PageBtn disabled={page === 1} onClick={() => onPage(1)} title="Primera" className="hidden sm:inline-flex"><ChevronsLeft className="w-4 h-4" /></PageBtn>
        <PageBtn disabled={page === 1} onClick={() => onPage(page - 1)} title="Anterior"><ChevronLeft className="w-4 h-4" /></PageBtn>
        {pStart > 1 && <span className="px-1 text-slate-400 dark:text-white/30">…</span>}
        {pages.map((p) => (
          <button
            type="button"
            key={p}
            onClick={() => onPage(p)}
            aria-current={p === page ? 'page' : undefined}
            className={`min-w-9 h-9 sm:min-w-8 sm:h-8 px-1.5 rounded-lg text-xs font-semibold tabular-nums transition ${
              p === page
                ? 'bg-accent-soft text-accent-text ring-1 ring-inset ring-accent/25'
                : 'text-slate-600 dark:text-white/65 hover:bg-slate-100 dark:hover:bg-white/5'
            }`}
          >
            {p}
          </button>
        ))}
        {pEnd < totalPages && <span className="px-1 text-slate-400 dark:text-white/30">…</span>}
        <PageBtn disabled={page === totalPages} onClick={() => onPage(page + 1)} title="Siguiente"><ChevronRight className="w-4 h-4" /></PageBtn>
        <PageBtn disabled={page === totalPages} onClick={() => onPage(totalPages)} title="Última" className="hidden sm:inline-flex"><ChevronsRight className="w-4 h-4" /></PageBtn>
      </nav>
    </div>
  )
}

function PageBtn({ children, title, className = 'inline-flex', ...rest }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      {...rest}
      className={`${className} min-w-9 h-9 sm:min-w-8 sm:h-8 px-1.5 items-center justify-center rounded-lg text-slate-500 dark:text-white/55 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition`}
    >
      {children}
    </button>
  )
}


/**
 * Menú "Más acciones" (⋮) para agrupar las acciones secundarias de una fila o tarjeta.
 * items: [{ label, icon?, onClick, danger?, hidden?, disabled?, className? }]
 * Se posiciona `fixed` para que no lo recorte el scroll de la tabla.
 */
export function RowMenu({ items, label = 'Más acciones', className = '' }) {
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const menuRef = useRef(null)
  const visible = (items || []).filter((it) => it && !it.hidden)

  useEffect(() => {
    if (!pos) return
    const close = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return
      if (e.type === 'mousedown' && (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target))) return
      setPos(null)
    }
    const onScroll = () => setPos(null)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    menuRef.current?.querySelector('button')?.focus()
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [pos])

  if (!visible.length) return null

  const toggle = (e) => {
    e.stopPropagation()
    if (pos) return setPos(null)
    const r = btnRef.current.getBoundingClientRect()
    const estimated = visible.length * 44 + 12
    const up = r.bottom + estimated > window.innerHeight - 8 && r.top > estimated
    setPos({
      right: Math.max(8, window.innerWidth - r.right),
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    })
  }

  return (
    <span className={`relative inline-flex ${className}`} data-stop onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        className="w-10 h-10 sm:w-9 sm:h-9 inline-flex items-center justify-center rounded-lg text-slate-500 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-800 dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring transition"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {pos && (
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', ...pos }}
          className="z-70 min-w-52 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-elevated shadow-xl animate-fade-in"
        >
          {visible.map((it) => {
            const Icon = it.icon
            return (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={(e) => {
                  e.stopPropagation()
                  setPos(null)
                  it.onClick?.()
                }}
                className={`w-full flex items-center gap-2.5 px-3.5 min-h-10 text-sm font-medium text-left transition disabled:opacity-40 focus:outline-none ${it.className || ''} ${
                  it.danger
                    ? 'text-red-600 dark:text-red-400 hover:bg-red-50 focus:bg-red-50 dark:hover:bg-red-500/10 dark:focus:bg-red-500/10'
                    : 'text-slate-700 dark:text-white/80 hover:bg-slate-50 focus:bg-slate-50 dark:hover:bg-white/5 dark:focus:bg-white/5'
                }`}
              >
                {Icon && <Icon className="w-4 h-4 shrink-0 opacity-70" />}
                {it.label}
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}

/** Filtros rápidos en forma de chips, con contador opcional. options: [[value, label], ...] */
export function FilterChips({ value, onChange, options, counts = {}, className = 'mb-3' }) {
  return (
    <div className={`flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 ${className}`} role="group" aria-label="Filtro">
      {options.map(([key, label]) => (
        <button
          key={key || 'all'}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={`inline-flex items-center gap-1.5 px-3 min-h-9 rounded-lg text-xs font-medium whitespace-nowrap transition ${
            value === key
              ? 'bg-accent-soft text-accent-text ring-1 ring-inset ring-accent/25'
              : 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10'
          }`}
        >
          {label}
          {counts[key] != null && (
            <span
              className={`min-w-5 px-1.5 rounded-full text-[11px] tabular-nums ${
                value === key ? 'bg-accent/15 text-accent-text' : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/50'
              }`}
            >
              {counts[key]}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

