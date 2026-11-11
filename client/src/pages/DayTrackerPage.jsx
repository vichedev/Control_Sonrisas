import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowUpRight,
  Camera,
  CameraSlash,
  CheckCheck,
  CircleDashed,
  FileCheck2,
  ListChecks,
  LogIn,
  Plus,
  RefreshCw,
  Search,
  UserX,
} from '../components/icons'
import { api, apiError, longDate, todayKey } from '../api/client'
import { useLoadEffect } from '../api/useLoadEffect'
import { useLiveReload, useRealtimeStatus } from '../realtime'
import { useToasts } from '../context/ToastsContext'
import { useAuth } from '../context/AuthContext'
import DayFilters, { NoClassroomNotice } from '../components/DayFilters'
import ConfirmDialog from '../components/ConfirmDialog'
import { ProgressRing } from '../components/DayChecklist'
import { Avatar, Badge, Card, EmptyState, Loading, PageHeader, StatTile, inputClass } from '../components/ui'
import TrackerCell from '../components/tracker/TrackerCell'
import QuickSheet from '../components/tracker/QuickSheet'
import MomentCaptureModal from '../components/photos/MomentCaptureModal'
import { LoadMore, SearchInput } from '../components/DataToolbar'
import { matchChild } from '../components/childSearch'
import {
  MEAL_LABEL,
  MEAL_ORDER,
  bulkMealTargets,
  buildColumns,
  cellFor,
  pendingCells,
} from '../components/tracker/trackerModel'

const EXTRA_KEY = 'sonrisas.tracker.extraMeals'
const REFRESH_MS = 60000

function readExtra() {
  try {
    const v = JSON.parse(localStorage.getItem(EXTRA_KEY) || '[]')
    return Array.isArray(v) ? v.filter((t) => MEAL_ORDER.includes(t)) : []
  } catch {
    return []
  }
}

const ATTENDANCE = {
  present: { label: 'En sala', tone: 'green' },
  checked_out: { label: 'Retirado', tone: 'sky' },
  absent: { label: 'Sin llegar', tone: 'slate' },
}

function attendanceBadge(row) {
  if (row.attendance.status === 'absent') {
    const att = (row.checklist?.items || []).find((i) => i.key === 'attendance')
    if (att?.status === 'info') return { label: 'Ausencia justificada', tone: 'amber' }
    if (att?.status === 'not_done') return { label: 'No asistió', tone: 'red' }
  }
  return ATTENDANCE[row.attendance.status] || ATTENDANCE.absent
}

function AllergyBadge({ allergies, compact }) {
  if (!allergies?.trim()) return null
  return (
    <Badge tone="red" className="max-w-full">
      <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span className={compact ? 'truncate max-w-28' : 'truncate max-w-40'} title={allergies}>
        Alergia: {allergies}
      </span>
    </Badge>
  )
}

/** Sin autorización de imagen (LOPDP): la educadora lo ve antes de tomar fotos. */
function NoPhotoBadge() {
  return (
    <Badge tone="slate" className="whitespace-nowrap">
      <span title="Sin autorización de fotos" className="inline-flex items-center gap-1">
        <CameraSlash className="w-3 h-3 shrink-0" aria-hidden="true" />
        Sin fotos
        <span className="sr-only"> (la familia no autorizó fotos o aún no responde)</span>
      </span>
    </Badge>
  )
}

/** Fotos del día del niño + acción rápida "Foto". Sin autorización de imagen, sólo el aviso. */
function PhotoAction({ count = 0, blocked, onOpen, name, size = 'sm' }) {
  if (blocked) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-white/35" title="Sin autorización de fotos">
        <CameraSlash className="w-3.5 h-3.5" aria-hidden="true" /> No
      </span>
    )
  }
  const big = size === 'lg'
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Foto o momento de ${name}${count ? ` (${count} hoy)` : ''}`}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${
        big ? 'min-h-11 px-3 text-xs' : 'min-h-9 px-2 text-[11px]'
      } ${
        count
          ? 'border-accent/30 bg-accent-soft text-accent-text hover:bg-accent-soft-strong'
          : 'border-dashed border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/15 dark:bg-white/3 dark:text-white/70 dark:hover:bg-white/5'
      }`}
    >
      <Camera className="w-4 h-4" aria-hidden="true" />
      {count ? <span className="tabular-nums">{count}</span> : 'Foto'}
    </button>
  )
}

function ChildIdentity({ row, compact, pending = 0, noPhoto = false }) {
  const badge = attendanceBadge(row)
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Avatar src={row.child.photoUrl} name={row.child.name} size={compact ? 'sm' : 'md'} />
      <div className="min-w-0">
        <Link
          to={`/panel/ninos/${row.child.id}`}
          className="block font-semibold text-sm text-slate-900 dark:text-white truncate hover:text-accent-text"
        >
          {row.child.name}
        </Link>
        <div className="flex flex-wrap items-center gap-1 mt-0.5">
          <Badge tone={badge.tone}>{badge.label}</Badge>
          {pending > 0 && <Badge tone="amber">Faltan {pending}</Badge>}
          <AllergyBadge allergies={row.child.allergies} compact={compact} />
          {noPhoto && <NoPhotoBadge />}
        </div>
      </div>
    </div>
  )
}

/** Niños por tanda en salas grandes (o «Todas las salas»). */
const TRACKER_PAGE = 30

export default function DayTrackerPage() {
  const { pushToast } = useToasts()
  const { isTeacher } = useAuth()
  const [myClassrooms, setMyClassrooms] = useState(null)
  const [date, setDate] = useState(todayKey())
  const [classroomId, setClassroomId] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [extraMeals, setExtraMeals] = useState(readExtra)
  const [target, setTarget] = useState(null)
  const [bulk, setBulk] = useState(null) // { type, rows }
  const [bulkBusy, setBulkBusy] = useState(false)
  const [savingIds, setSavingIds] = useState(() => new Set())
  const isToday = date === todayKey()
  const reqRef = useRef(0)

  const fetchData = useCallback(
    async (silent) => {
      const id = ++reqRef.current
      if (silent) setRefreshing(true)
      else setLoading(true)
      try {
        const res = await api.get('/reports/checklists', {
          params: { date, classroomId: classroomId || undefined },
        })
        if (id === reqRef.current) setData(res.data)
      } catch (err) {
        if (!silent) pushToast({ type: 'error', message: apiError(err, 'No se pudo cargar el seguimiento') })
      } finally {
        if (id === reqRef.current) {
          setLoading(false)
          setRefreshing(false)
          setSavingIds(new Set())
        }
      }
    },
    [date, classroomId, pushToast],
  )

  const load = useCallback(() => fetchData(false), [fetchData])
  useLoadEffect(load)

  // Niños sin autorización de imagen: /children trae el estado compacto de consentimientos.
  // De paso guarda las cédulas (el tablero no las trae) para buscar por cédula.
  const [noPhotoIds, setNoPhotoIds] = useState(() => new Set())
  const [docs, setDocs] = useState({})
  const loadConsents = useCallback(async () => {
    try {
      const res = await api.get('/children', { params: { classroomId: classroomId || undefined } })
      setNoPhotoIds(new Set((res.data || []).filter((c) => c.consents && c.consents.images !== 'granted').map((c) => c.id)))
      const map = {}
      for (const c of res.data || []) if (c.documentId) map[c.id] = c.documentId
      setDocs(map)
    } catch {
      // complementario: sin la lista no se muestra el aviso
    }
  }, [classroomId])
  useLoadEffect(loadConsents)

  // Fotos del día por niño (etiquetas incluidas), para el indicador y la acción "Foto".
  const [photoCounts, setPhotoCounts] = useState({})
  const [moment, setMoment] = useState(null) // { childId, classroomId }
  const loadPhotos = useCallback(async () => {
    try {
      const res = await api.get('/photos', { params: { date, classroomId: classroomId || undefined } })
      const counts = {}
      for (const p of res.data || []) for (const id of p.childIds || (p.childId ? [p.childId] : [])) counts[id] = (counts[id] || 0) + 1
      setPhotoCounts(counts)
    } catch {
      // complementario: sin conteo se muestra "Foto"
    }
  }, [date, classroomId])
  useLoadEffect(loadPhotos)
  useLiveReload(loadPhotos, { entities: ['photo'], date })

  // En vivo: cualquier registro del día (de esta u otra educadora) refresca la tabla.
  const live = useRealtimeStatus() === 'live'
  const quietReload = useCallback(() => fetchData(true), [fetchData])
  useLiveReload(quietReload, {
    entities: ['attendance', 'meal', 'daily_log', 'activity', 'report', 'justification', 'photo'],
    date,
    classroomId: classroomId || undefined,
  })

  // Respaldo sin tiempo real: se refresca solo cada minuto, y al volver a la pestaña.
  useEffect(() => {
    if (!isToday || live) return
    const tick = () => {
      if (document.visibilityState === 'visible') fetchData(true)
    }
    const timer = setInterval(tick, REFRESH_MS)
    const onVis = () => document.visibilityState === 'visible' && fetchData(true)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [isToday, live, fetchData])

  const rows = useMemo(() => data?.children || [], [data])
  const columns = useMemo(() => buildColumns(rows, extraMeals), [rows, extraMeals])
  const opts = useMemo(() => ({ isToday }), [isToday])

  const enriched = useMemo(
    () => rows.map((r) => ({ row: r, pending: pendingCells(r, columns, opts) })),
    [rows, columns, opts],
  )

  const stats = useMemo(() => {
    let present = 0
    let notArrived = 0
    let pending = 0
    let reports = 0
    let reportable = 0
    for (const { row, pending: p } of enriched) {
      if (row.attendance.status === 'present') present++
      const arr = cellFor(row, columns[0], opts)
      if (row.attendance.status === 'absent' && arr.status === 'pending') notArrived++
      pending += p.length
      if (row.attendance.status !== 'absent') reportable++
      if (row.report && (row.report.status === 'ready' || row.report.status === 'sent')) reports++
    }
    return { present, notArrived, pending, reports, reportable }
  }, [enriched, columns, opts])

  // Búsqueda por nombre o cédula; los contadores de los chips respetan la búsqueda.
  const searched = useMemo(() => {
    const q = search.trim()
    if (!q) return enriched
    return enriched.filter(({ row }) =>
      matchChild({ name: row.child.name, code: row.child.code, documentId: docs[row.child.id] }, q),
    )
  }, [enriched, search, docs])
  const filterMatch = useMemo(
    () => ({
      all: () => true,
      pending: ({ pending }) => pending.length > 0,
      absent: ({ row }) => row.attendance.status === 'absent' && cellFor(row, columns[0], opts).status === 'pending',
      nophoto: ({ row }) => noPhotoIds.has(row.child.id),
    }),
    [columns, opts, noPhotoIds],
  )
  const filterCounts = useMemo(() => {
    const out = {}
    for (const [k, fn] of Object.entries(filterMatch)) out[k] = searched.filter(fn).length
    return out
  }, [searched, filterMatch])
  const visible = useMemo(() => searched.filter(filterMatch[filter] || filterMatch.all), [searched, filterMatch, filter])

  // Salas grandes: de TRACKER_PAGE en TRACKER_PAGE. Vuelve al principio al cambiar búsqueda/filtro/sala/día.
  const [limit, setLimit] = useState(TRACKER_PAGE)
  const pageSig = `${search}|${filter}|${classroomId}|${date}`
  const [prevPageSig, setPrevPageSig] = useState(pageSig)
  if (prevPageSig !== pageSig) {
    setPrevPageSig(pageSig)
    setLimit(TRACKER_PAGE)
  }
  const shown = visible.length > TRACKER_PAGE ? visible.slice(0, limit) : visible

  const hiddenMeals = MEAL_ORDER.filter((t) => !columns.some((c) => c.mealType === t))

  const addMeal = (type) => {
    const next = [...new Set([...extraMeals, type])]
    setExtraMeals(next)
    try {
      localStorage.setItem(EXTRA_KEY, JSON.stringify(next))
    } catch {
      /* sin almacenamiento */
    }
  }

  // Tras guardar: marca la fila, aplica lo obvio al instante (comidas) y refresca.
  const onSaved = (childId, patch) => {
    setSavingIds((prev) => new Set(prev).add(childId))
    if (patch?.key?.startsWith('meal:') && patch.intake) {
      const map = { all: ['done', 'Comió todo'], most: ['done', 'Comió casi todo'], half: ['done', 'Comió la mitad'], little: ['partial', 'Comió poco'], none: ['not_done', 'No comió'] }
      const [status, detail] = map[patch.intake] || []
      if (status && patch.key !== 'meal:bottle') {
        setData((prev) =>
          prev && {
            ...prev,
            children: prev.children.map((r) => {
              if (r.child.id !== childId) return r
              const items = [...(r.checklist?.items || [])]
              const i = items.findIndex((x) => x.key === patch.key)
              const item = { key: patch.key, group: 'meals', label: MEAL_LABEL[patch.key.slice(5)], status, detail }
              if (i >= 0) items[i] = item
              else items.push(item)
              return { ...r, checklist: { ...r.checklist, items } }
            }),
          },
        )
      }
    }
    fetchData(true)
  }

  const confirmBulk = async () => {
    if (!bulk) return
    setBulkBusy(true)
    try {
      await api.post('/meals/bulk', {
        type: bulk.type,
        ...(isToday ? {} : { date }),
        ...(classroomId ? { classroomId } : {}),
        entries: bulk.rows.map((r) => ({ childId: r.child.id, intake: 'all' })),
      })
      pushToast({ type: 'success', message: `${MEAL_LABEL[bulk.type]}: ${bulk.rows.length} niño(s) comieron todo` })
      setBulk(null)
      fetchData(true)
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo guardar') })
    } finally {
      setBulkBusy(false)
    }
  }

  const openBulk = (type) => {
    const list = bulkMealTargets(rows, type)
    if (list.length) setBulk({ type, rows: list })
  }

  const bulkMeals = columns.filter((c) => c.mealType && c.mealType !== 'bottle')
  const mobileBulk = bulkMeals
    .map((c) => ({ col: c, n: bulkMealTargets(rows, c.mealType).length }))
    .filter((x) => x.n > 0)
  const noRoom = isTeacher && myClassrooms && myClassrooms.length === 0

  return (
    <>
      <PageHeader
        title="Seguimiento del día"
        subtitle={`${longDate(date)} · lo hecho y lo que falta de cada niño`}
        icon={ListChecks}
        actions={
          <DayFilters
            date={date}
            onDateChange={setDate}
            classroomId={classroomId}
            onClassroomChange={setClassroomId}
            onClassroomsLoaded={setMyClassrooms}
          />
        }
      />

      {noRoom ? (
        <Card><NoClassroomNotice /></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mb-4">
            <StatTile label="Presentes" value={stats.present} tone="green" icon={LogIn} />
            <StatTile label="Sin llegar" value={stats.notArrived} tone="slate" icon={UserX} />
            <StatTile label="Pendientes" value={stats.pending} tone="amber" icon={CircleDashed} hint="registros por hacer" />
            <StatTile
              label="Reportes"
              value={`${stats.reports}/${stats.reportable}`}
              tone="sky"
              icon={FileCheck2}
              hint="listos o enviados"
            />
          </div>

          <Card padded={false} className="overflow-hidden">
            {/* Barra de búsqueda y filtros */}
            <div className="flex flex-wrap items-center gap-2 p-3 sm:p-4 border-b border-slate-100 dark:border-white/5">
              <SearchInput
                className="w-full sm:w-64 lg:w-72 shrink-0"
                value={search}
                onChange={setSearch}
                placeholder="Buscar por nombre o cédula…"
                aria-label="Buscar niño por nombre o cédula"
              />
              <div
                className="flex gap-1.5 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 [scrollbar-width:none] max-w-full"
                role="group"
                aria-label="Filtrar niños"
              >
                {[
                  ['all', 'Todos'],
                  ['pending', 'Con pendientes'],
                  ['absent', 'Sin llegar'],
                  ['nophoto', 'Sin fotos autorizadas'],
                ]
                  .filter(([value]) => value !== 'nophoto' || noPhotoIds.size > 0 || filter === 'nophoto')
                  .map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFilter(value)}
                      aria-pressed={filter === value}
                      className={`shrink-0 inline-flex items-center gap-1.5 min-h-10 px-3 rounded-lg text-sm sm:text-xs font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${
                        filter === value
                          ? 'bg-accent-soft text-accent-text ring-1 ring-inset ring-accent/30'
                          : 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10'
                      }`}
                    >
                      {label}
                      <span
                        className={`min-w-5 px-1.5 rounded-md text-[11px] tabular-nums ${
                          filter === value ? 'bg-accent/10' : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/50'
                        }`}
                      >
                        {filterCounts[value] ?? 0}
                      </span>
                    </button>
                  ))}
              </div>
              <div className="flex items-center gap-2 ml-auto">
                {hiddenMeals.length > 0 && (
                  <label className="relative">
                    <span className="sr-only">Añadir columna de comida</span>
                    <Plus className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" aria-hidden="true" />
                    <select
                      value=""
                      onChange={(e) => e.target.value && addMeal(e.target.value)}
                      className={`${inputClass} w-auto pl-8 text-xs font-semibold`}
                    >
                      <option value="">Comida</option>
                      {hiddenMeals.map((t) => (
                        <option key={t} value={t}>{MEAL_LABEL[t]}</option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => fetchData(true)}
                  className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:text-white/50 dark:hover:bg-white/10"
                  aria-label="Actualizar"
                  title={isToday ? 'Se actualiza solo cada minuto' : 'Actualizar'}
                >
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Móvil: acciones en bloque por comida */}
            {mobileBulk.length > 0 && (
              <div className="sm:hidden flex gap-2 overflow-x-auto px-3 py-2 border-b border-slate-100 dark:border-white/5">
                {mobileBulk.map(({ col: c, n }) => {
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => openBulk(c.mealType)}
                      className="shrink-0 min-h-11 inline-flex items-center gap-1.5 px-3 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30 disabled:opacity-40"
                    >
                      <CheckCheck className="w-4 h-4" aria-hidden="true" />
                      {c.label}: todos comieron todo {n > 0 && `(${n})`}
                    </button>
                  )
                })}
              </div>
            )}

            {loading && !data ? (
              <Loading />
            ) : visible.length === 0 ? (
              <EmptyState
                icon={ListChecks}
                title={rows.length ? 'Nada que mostrar con este filtro' : 'No hay niños en esta sala'}
                message={rows.length ? (filter === 'pending' ? '¡Todo al día! No quedan pendientes.' : 'Cambia el filtro o la búsqueda.') : 'Inscribe niños o elige otra sala.'}
              />
            ) : (
              <>
                {/* Escritorio / tablet: matriz */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm border-separate border-spacing-0">
                    <thead>
                      <tr className="text-left">
                        <th scope="col" className="sticky left-0 z-10 bg-slate-50 dark:bg-elevated px-4 py-2 text-xs font-medium text-slate-500 dark:text-white/45 border-b border-slate-100 dark:border-white/5 w-52 min-w-52 max-w-52">
                          Niño
                        </th>
                        {columns.map((c) => {
                          const n = c.mealType && c.mealType !== 'bottle' ? bulkMealTargets(rows, c.mealType).length : 0
                          return (
                            <th
                              key={c.key}
                              scope="col"
                              className="bg-slate-50 dark:bg-elevated px-1 py-2 align-bottom text-[11px] font-medium text-slate-500 dark:text-white/45 border-b border-slate-100 dark:border-white/5 min-w-20"
                            >
                              <span className="block text-center leading-tight">{c.label}</span>
                              {n > 0 && (
                                <button
                                  type="button"
                                  onClick={() => openBulk(c.mealType)}
                                  className="mt-1 w-full inline-flex items-center justify-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/20"
                                  title={`Marcar a los ${n} presentes sin registro: Comió todo`}
                                >
                                  <CheckCheck className="w-3 h-3" aria-hidden="true" /> Todos ({n})
                                </button>
                              )}
                            </th>
                          )
                        })}
                        <th scope="col" className="bg-slate-50 dark:bg-elevated px-2 py-2 align-bottom text-[11px] font-medium text-slate-500 dark:text-white/45 border-b border-slate-100 dark:border-white/5 min-w-20 text-center">
                          Fotos
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map(({ row, pending }) => (
                        <tr
                          key={row.child.id}
                          className={`group ${savingIds.has(row.child.id) ? 'opacity-60' : ''} ${row.attendance.status === 'absent' ? 'bg-slate-50/50 dark:bg-white/1' : ''}`}
                        >
                          <th scope="row" className="sticky left-0 z-10 bg-white dark:bg-elevated group-hover:bg-slate-50 dark:group-hover:bg-elevated pl-4 pr-2 py-2 text-left font-normal w-52 min-w-52 max-w-52 border-b border-slate-100 dark:border-white/5">
                            <ChildIdentity row={row} pending={pending.length} noPhoto={noPhotoIds.has(row.child.id)} />
                          </th>
                          {columns.map((c) => {
                            const cell = cellFor(row, c, opts)
                            return (
                              <td key={c.key} className="px-1 py-2 border-b border-slate-100 dark:border-white/5 group-hover:bg-slate-50/60 dark:group-hover:bg-white/2">
                                <TrackerCell cell={cell} label={`${c.label} de ${row.child.name}`} onOpen={() => setTarget({ row, col: c, cell })} />
                              </td>
                            )
                          })}
                          <td className="px-2 py-2 border-b border-slate-100 dark:border-white/5 group-hover:bg-slate-50/60 dark:group-hover:bg-white/2 text-center">
                            <PhotoAction
                              count={photoCounts[row.child.id] || 0}
                              blocked={noPhotoIds.has(row.child.id)}
                              name={row.child.name}
                              onOpen={() => setMoment({ childId: row.child.id, classroomId: row.child.classroomId || classroomId || undefined })}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Móvil: una tarjeta por niño, lo que falta primero */}
                <ul className="sm:hidden divide-y divide-slate-100 dark:divide-white/5">
                  {shown.map(({ row, pending }) => {
                    const cells = columns.map((c) => ({ col: c, cell: cellFor(row, c, opts) }))
                    const rest = cells.filter(({ cell }) => cell.status !== 'pending' && cell.text !== '—')
                    return (
                      <li key={row.child.id} className={`p-3 ${savingIds.has(row.child.id) ? 'opacity-60' : ''}`}>
                        <div className="flex items-center justify-between gap-2">
                          <ChildIdentity row={row} compact noPhoto={noPhotoIds.has(row.child.id)} />
                          <div className="flex items-center gap-2 shrink-0">
                            {!noPhotoIds.has(row.child.id) && (
                              <PhotoAction
                                size="lg"
                                count={photoCounts[row.child.id] || 0}
                                name={row.child.name}
                                onOpen={() => setMoment({ childId: row.child.id, classroomId: row.child.classroomId || classroomId || undefined })}
                              />
                            )}
                            {row.attendance.status !== 'absent' && <ProgressRing summary={row.checklist?.summary} size={44} stroke={5} />}
                          </div>
                        </div>
                        {pending.length > 0 && (
                          <div className="mt-2.5">
                            <p className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-1.5">
                              Falta ({pending.length})
                            </p>
                            <div className="grid grid-cols-2 gap-1.5">
                              {pending.map(({ col, cell }) =>
                                !cell.action && cell.link ? (
                                  <Link
                                    key={col.key}
                                    to={cell.link}
                                    className="min-h-11 flex items-center justify-between gap-1 px-3 rounded-lg border border-dashed border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:bg-white/3 dark:text-white/80 dark:hover:bg-white/5"
                                  >
                                    <span className="truncate">{col.label}</span>
                                    <ArrowUpRight className="w-4 h-4 shrink-0" aria-hidden="true" />
                                  </Link>
                                ) : (
                                <button
                                  key={col.key}
                                  type="button"
                                  disabled={!cell.action}
                                  onClick={() => setTarget({ row, col, cell })}
                                  className="min-h-11 flex items-center justify-between gap-1 px-3 rounded-lg border border-dashed border-slate-300 bg-white text-left text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:bg-white/3 dark:text-white/80 dark:hover:bg-white/5 disabled:opacity-60"
                                >
                                  <span className="truncate">{col.label}</span>
                                  {cell.action && <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />}
                                </button>
                                ),
                              )}
                            </div>
                          </div>
                        )}
                        {rest.length > 0 && (
                          <dl className="mt-2.5 grid grid-cols-2 gap-x-2 gap-y-1.5">
                            {rest.map(({ col, cell }) => (
                              <div key={col.key} className="min-w-0">
                                <dt className="text-[11px] font-medium text-slate-500 dark:text-white/45 truncate">{col.label}</dt>
                                <dd>
                                  <TrackerCell cell={cell} size="lg" label={`${col.label} de ${row.child.name}`} onOpen={() => setTarget({ row, col, cell })} />
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </li>
                    )
                  })}
                </ul>
                {visible.length > TRACKER_PAGE && (
                  <LoadMore
                    className="border-t border-slate-100 dark:border-white/5"
                    shown={shown.length}
                    total={visible.length}
                    step={TRACKER_PAGE}
                    label="niños"
                    onMore={() => setLimit((l) => l + TRACKER_PAGE)}
                    onAll={() => setLimit(visible.length)}
                  />
                )}
              </>
            )}
          </Card>
          {isToday && (
            <p className="mt-2 text-xs text-slate-400 dark:text-white/30">
              Se actualiza solo cada minuto. La salida se registra en{' '}
              <Link to="/panel/dia" className="font-semibold hover:underline">Entradas y salidas</Link> (verifica quién retira).
            </p>
          )}
        </>
      )}

      {target && (
        <QuickSheet
          key={`${target.row.child.id}:${target.col.key}`}
          target={target}
          date={date}
          isToday={isToday}
          onClose={() => setTarget(null)}
          onSaved={onSaved}
        />
      )}

      {moment && (
        <MomentCaptureModal
          open
          childId={moment.childId}
          classroomId={moment.classroomId}
          date={date}
          onClose={() => setMoment(null)}
          onSaved={loadPhotos}
        />
      )}

      <ConfirmDialog
        open={!!bulk}
        onClose={() => !bulkBusy && setBulk(null)}
        onConfirm={confirmBulk}
        loading={bulkBusy}
        variant="success"
        icon={CheckCheck}
        title={bulk ? `${MEAL_LABEL[bulk.type]}: todos comieron todo` : ''}
        message={bulk ? `Se anotará "Comió todo" a ${bulk.rows.length} niño(s) presentes que aún no tienen registro. Los que ya tienen, no cambian.` : ''}
        details={bulk ? bulk.rows.map((r) => r.child.name).join(', ') : null}
        confirmText="Sí, marcar"
      />
    </>
  )
}
