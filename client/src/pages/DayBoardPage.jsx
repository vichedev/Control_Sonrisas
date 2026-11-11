import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ClipboardList,
  Clock,
  LayoutGrid,
  List,
  LogIn,
  LogOut,
  MoreHorizontal,
  Search,
  ShieldAlert,
  Smiley,
  SmileyAngry,
  SmileyMeh,
  SmileySad,
  SmileyXEyes,
  CloudMoon,
  Thermometer,
  X,
} from '../components/icons'
import { api, apiError, longDate, timeOf, todayKey } from '../api/client'
import { useLoadEffect } from '../api/useLoadEffect'
import { useLiveReload } from '../realtime'
import { useToasts } from '../context/ToastsContext'
import { useAuth } from '../context/AuthContext'
import DayFilters, { lastClassroomId, NoClassroomNotice } from '../components/DayFilters'
import Modal from '../components/Modal'
import { LoadMore, SearchInput } from '../components/DataToolbar'
import { matchChild } from '../components/childSearch'
import ChildPhotoCapture from '../components/consent/ChildPhotoCapture'
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  inputClass,
  Loading,
  PageHeader,
} from '../components/ui'

const MOODS = [
  { value: '', label: 'Sin indicar', icon: null },
  { value: 'happy', label: 'De buen ánimo', icon: Smiley },
  { value: 'calm', label: 'Con calma', icon: SmileyMeh },
  { value: 'sleepy', label: 'Con sueño', icon: CloudMoon },
  { value: 'sad', label: 'Ánimo bajo', icon: SmileySad },
  { value: 'crying', label: 'Llorando', icon: SmileyXEyes },
  { value: 'irritable', label: 'Irritable', icon: SmileyAngry },
  { value: 'sick', label: 'Con malestar', icon: Thermometer },
]

const moodOf = (value) => MOODS.find((m) => m.value === value) || MOODS[0]

const STATUS = {
  present: { label: 'Presente', tone: 'green' },
  checked_out: { label: 'Retirado', tone: 'sky' },
  absent: { label: 'Sin llegar', tone: 'slate' },
  justified: { label: 'Falta justificada', tone: 'amber' },
}

const FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'absent', label: 'Sin llegar' },
  { value: 'present', label: 'Presentes' },
  { value: 'checked_out', label: 'Retirados' },
  { value: 'justified', label: 'Justificadas', hideEmpty: true },
]

const VIEW_KEY = 'sonrisas_dayboard_view'
/** Con salas grandes (o «Todas las salas») se muestran de 40 en 40. */
const PAGE = 40
function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
  }
}

export default function DayBoardPage() {
  const { pushToast } = useToasts()
  const { canManage, isTeacher } = useAuth()
  // null = aún no se sabe; [] = la educadora no tiene sala asignada.
  const [myClassrooms, setMyClassrooms] = useState(null)

  const [date, setDate] = useState(todayKey())
  const [classroomId, setClassroomId] = useState(lastClassroomId)
  const [board, setBoard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [view, setView] = useState(readView)

  const [target, setTarget] = useState(null) // { row, mode: 'in' | 'out' }
  const [busy, setBusy] = useState({}) // childId → true mientras se registra
  const [selected, setSelected] = useState([])
  const [limit, setLimit] = useState(PAGE)
  // Cédulas por niño: el tablero no las trae, se buscan aparte (sólo para buscar).
  const [docs, setDocs] = useState({})
  const [batching, setBatching] = useState(false)

  // `silent`: recarga tras registrar algo, sin parpadeo del spinner.
  const loadSeq = useRef(0)
  const load = useCallback(async (silent) => {
    const seq = ++loadSeq.current
    if (silent !== true) setLoading(true)
    try {
      const res = await api.get('/attendance/board', {
        params: { date, classroomId: classroomId || undefined },
      })
      if (seq !== loadSeq.current) return // llegó una respuesta más nueva
      setBoard(res.data)
    } catch (err) {
      if (silent !== true) pushToast({ type: 'error', message: apiError(err, 'No se pudo cargar el día') })
    } finally {
      setLoading(false)
    }
  }, [date, classroomId, pushToast])

  useLoadEffect(load)
  // En vivo: llegadas/salidas/ausencias registradas por otra educadora o desde otro equipo.
  const quietReload = useCallback(() => load(true), [load])
  useLiveReload(quietReload, { entities: ['attendance', 'justification'], date, classroomId: classroomId || undefined })

  const loadDocs = useCallback(() => {
    api
      .get('/children', { params: { classroomId: classroomId || undefined } })
      .then((r) => {
        const map = {}
        for (const c of r.data || []) if (c.documentId) map[c.id] = c.documentId
        setDocs(map)
      })
      .catch(() => {})
  }, [classroomId])
  useLoadEffect(loadDocs)
  useLiveReload(loadDocs, { entities: ['child'] })

  const changeView = (v) => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* sin almacenamiento */
    }
  }

  const all = useMemo(() => board?.children || [], [board])
  const counts = useMemo(() => {
    const c = { all: all.length, absent: 0, present: 0, checked_out: 0, justified: 0 }
    for (const r of all) c[r.status] = (c[r.status] || 0) + 1
    return c
  }, [all])

  const isToday = date === todayKey()
  const canRecord = isToday || canManage
  // Registro de un toque sólo hoy: en días pasados hay que indicar la hora (modal).
  const canQuick = isToday

  const rows = useMemo(() => {
    // Por la mañana importa quién falta por llegar; por la tarde, quién falta por retirar.
    const morning = isToday && new Date().getHours() < 12
    const order = morning
      ? { absent: 0, present: 1, checked_out: 2, justified: 3 }
      : { present: 0, absent: 1, checked_out: 2, justified: 3 }
    return all
      .filter((r) => {
        if (filter !== 'all' && r.status !== filter) return false
        if (search.trim() && !matchChild({ ...r, documentId: docs[r.childId] }, search)) return false
        return true
      })
      .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))
  }, [all, search, filter, isToday, docs])

  // Al cambiar búsqueda, filtro, sala o día se vuelve a los primeros 40.
  const viewSig = `${search}|${filter}|${classroomId}|${date}`
  const [prevSig, setPrevSig] = useState(viewSig)
  if (prevSig !== viewSig) {
    setPrevSig(viewSig)
    setLimit(PAGE)
  }
  const shownRows = rows.length > PAGE ? rows.slice(0, limit) : rows

  // La selección sólo vale para niños que siguen sin llegada.
  const pendingIds = useMemo(() => new Set(all.filter((r) => !r.arrival).map((r) => r.childId)), [all])
  const chosen = selected.filter((id) => pendingIds.has(id))
  const toggleSelect = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  const visiblePending = rows.filter((r) => !r.arrival).map((r) => r.childId)

  const quickIn = async (row) => {
    setBusy((b) => ({ ...b, [row.childId]: true }))
    try {
      await api.post(`/attendance/children/${row.childId}/in`, {})
      pushToast({ type: 'success', message: `Llegada de ${row.name.split(' ')[0]} registrada` })
      setSelected((prev) => prev.filter((x) => x !== row.childId))
      await load(true)
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo registrar la llegada') })
    } finally {
      setBusy((b) => ({ ...b, [row.childId]: false }))
    }
  }

  // Llegada en bloque: una petición por niño (el endpoint es individual).
  const batchIn = async () => {
    const list = all.filter((r) => chosen.includes(r.childId))
    if (!list.length) return
    setBatching(true)
    const failed = []
    for (const row of list) {
      try {
        await api.post(`/attendance/children/${row.childId}/in`, {})
      } catch {
        failed.push(row.name.split(' ')[0])
      }
    }
    const ok = list.length - failed.length
    if (ok) pushToast({ type: 'success', message: `${ok} llegada(s) registrada(s)` })
    if (failed.length)
      pushToast({ type: 'error', message: `No se pudo registrar: ${failed.join(', ')}` })
    setSelected([])
    setBatching(false)
    load(true)
  }

  const totals = board?.totals || {}
  const blocked = isTeacher && myClassrooms && myClassrooms.length === 0

  return (
    <>
      <PageHeader
        title="Entradas y salidas"
        subtitle={longDate(date)}
        icon={ClipboardList}
        actions={
          <DayFilters
            date={date}
            onDateChange={(d) => {
              setSelected([])
              setDate(d)
            }}
            classroomId={classroomId}
            onClassroomChange={(id) => {
              setSelected([])
              setClassroomId(id)
            }}
            onClassroomsLoaded={setMyClassrooms}
          />
        }
      />

      {totals.flagged > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 dark:border-red-500/25 bg-red-50 dark:bg-red-500/10 px-4 py-3">
          <ShieldAlert className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-800 dark:text-red-200">
            <strong>{totals.flagged}</strong> registro(s) del día están señalados por retiro de una
            persona no autorizada. Revísalos con coordinación.
          </p>
        </div>
      )}

      <Card padded={false} className="overflow-hidden">
        {/* Filtros con conteo: sirven a la vez de resumen del día */}
        <div className="p-3 sm:p-4 border-b border-slate-100 dark:border-white/5 space-y-3">
          <div className="flex items-center gap-2 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 [scrollbar-width:none]">
            {FILTERS.filter((f) => !f.hideEmpty || counts[f.value] > 0).map((f) => {
              const active = filter === f.value
              return (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(f.value)}
                  className={`shrink-0 h-10 px-3.5 rounded-lg text-sm font-medium inline-flex items-center gap-2 transition-colors ${
                    active
                      ? 'bg-accent-soft text-accent-text ring-1 ring-inset ring-accent/30'
                      : 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/10'
                  }`}
                >
                  {f.label}
                  <span
                    className={`min-w-6 px-1.5 py-0.5 rounded-md text-xs tabular-nums ${
                      active ? 'bg-accent/10' : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/50'
                    }`}
                  >
                    {counts[f.value] ?? 0}
                  </span>
                </button>
              )
            })}
            {totals.lateArrivals > 0 && (
              <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300 px-2">
                <Clock className="w-3.5 h-3.5" /> {totals.lateArrivals} tarde
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <SearchInput
              className="flex-1 min-w-0"
              value={search}
              onChange={setSearch}
              placeholder="Buscar por nombre o cédula…"
              aria-label="Buscar niño por nombre o cédula"
            />
            <div
              className="hidden sm:flex shrink-0 rounded-lg border border-slate-200/70 dark:border-white/8 bg-slate-100 dark:bg-white/5 p-0.5"
              role="group"
              aria-label="Vista"
            >
              {[
                ['list', List, 'Lista'],
                ['grid', LayoutGrid, 'Tarjetas'],
              ].map(([v, Icon, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => changeView(v)}
                  className={`h-9 px-3 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                    view === v
                      ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-900/5 dark:bg-white/12 dark:text-white'
                      : 'text-slate-500 dark:text-white/50 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4" /> {label}
                </button>
              ))}
            </div>
          </div>

          {canQuick && visiblePending.length > 1 && (
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={() =>
                  setSelected(chosen.length === visiblePending.length ? [] : visiblePending)
                }
                className="font-medium text-accent-text hover:underline"
              >
                {chosen.length === visiblePending.length
                  ? 'Quitar selección'
                  : `Seleccionar los ${visiblePending.length} sin llegar`}
              </button>
              <span className="text-slate-400 dark:text-white/35">
                para marcar su llegada de una vez
              </span>
            </div>
          )}
        </div>

        {blocked ? (
          <NoClassroomNotice />
        ) : loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="Sin niños que mostrar"
            message={
              all.length ? 'Ningún niño coincide con el filtro.' : 'Inscribe niños en esta sala.'
            }
          />
        ) : view === 'grid' ? (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 p-3 sm:p-4">
            {shownRows.map((row) => (
              <ChildDayCard
                key={row.childId}
                row={row}
                canRecord={canRecord}
                canQuick={canQuick}
                busy={!!busy[row.childId]}
                selected={chosen.includes(row.childId)}
                onSelect={() => toggleSelect(row.childId)}
                onQuickIn={() => quickIn(row)}
                onCheckIn={() => setTarget({ row, mode: 'in' })}
                onCheckOut={() => setTarget({ row, mode: 'out' })}
              />
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {shownRows.map((row) => (
              <ChildDayRow
                key={row.childId}
                row={row}
                canRecord={canRecord}
                canQuick={canQuick}
                busy={!!busy[row.childId]}
                selected={chosen.includes(row.childId)}
                onSelect={() => toggleSelect(row.childId)}
                onQuickIn={() => quickIn(row)}
                onCheckIn={() => setTarget({ row, mode: 'in' })}
                onCheckOut={() => setTarget({ row, mode: 'out' })}
              />
            ))}
          </ul>
        )}
        {!blocked && !loading && rows.length > PAGE && (
          <LoadMore
            className="border-t border-slate-100 dark:border-white/5"
            shown={shownRows.length}
            total={rows.length}
            step={PAGE}
            label="niños"
            onMore={() => setLimit((l) => l + PAGE)}
            onAll={() => setLimit(rows.length)}
          />
        )}
      </Card>

      {/* Barra de llegada en bloque */}
      {chosen.length > 0 && (
        <div className="sticky z-20 mt-3" style={{ bottom: 'calc(var(--bottom-nav-h, 0px) + 0.75rem)' }}>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white/95 dark:bg-elevated/95 backdrop-blur-md shadow-[0_4px_16px_-8px_rgba(15,23,42,0.18)] px-3 py-2.5 sm:px-4">
            <p className="text-sm font-medium text-slate-800 dark:text-white mr-auto">
              {chosen.length} seleccionado{chosen.length === 1 ? '' : 's'}
            </p>
            <Button variant="ghost" icon={X} onClick={() => setSelected([])} className="h-11">
              <span className="hidden sm:inline">Cancelar</span>
            </Button>
            <Button variant="success" icon={LogIn} onClick={batchIn} loading={batching} className="h-11">
              Marcar llegada ({chosen.length})
            </Button>
          </div>
        </div>
      )}

      {target && (
        <AttendanceModal
          target={target}
          date={date}
          onClose={() => setTarget(null)}
          onSaved={() => {
            setTarget(null)
            load(true)
          }}
        />
      )}
    </>
  )
}

/** Casilla de selección para la llegada en bloque (44px de área táctil). */
function SelectBox({ row, selected, onSelect }) {
  return (
    <label className="shrink-0 -m-2 p-2.5 cursor-pointer" title="Seleccionar para marcar llegada">
      <input
        type="checkbox"
        checked={selected}
        onChange={onSelect}
        aria-label={`Seleccionar a ${row.name}`}
        className="w-5 h-5 rounded-md accent-accent cursor-pointer align-middle"
      />
    </label>
  )
}

/** Hora de llegada / retiro en grande: es lo primero que se busca. */
function Times({ row }) {
  const mood = moodOf(row.arrival?.mood)
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-white/50">
      {row.arrival && (
        <span className="inline-flex items-center gap-1">
          <LogIn className="w-3.5 h-3.5 text-emerald-500" />
          <strong className="text-sm font-semibold text-slate-800 dark:text-white tabular-nums">
            {timeOf(row.arrival.createdAt)}
          </strong>
          {row.arrival.scheduleStatus === 'late_arrival' && <Badge tone="amber">Tarde</Badge>}
        </span>
      )}
      {row.departure && (
        <span className="inline-flex items-center gap-1">
          <LogOut className="w-3.5 h-3.5 text-sky-500" />
          <strong className="text-sm font-semibold text-slate-800 dark:text-white tabular-nums">
            {timeOf(row.departure.createdAt)}
          </strong>
          {row.departure.personName && <span className="truncate max-w-40">· {row.departure.personName}</span>}
          {row.departure.flagged && <Badge tone="red">No autorizado</Badge>}
        </span>
      )}
      {row.arrival?.mood && (
        <span className="inline-flex items-center gap-1">
          {mood.icon && <mood.icon className="w-3.5 h-3.5" aria-hidden="true" />} {mood.label}
        </span>
      )}
      {row.arrival?.temperature && (
        <span className="inline-flex items-center gap-0.5">
          <Thermometer className="w-3 h-3" />
          {row.arrival.temperature} °C
        </span>
      )}
      {row.minutesInCenter > 0 && (
        <span className="text-slate-400 dark:text-white/30">
          {Math.floor(row.minutesInCenter / 60)} h {row.minutesInCenter % 60} min
        </span>
      )}
      {row.justification && (
        <span className="text-amber-700 dark:text-amber-300">Justificada: {row.justification.reason}</span>
      )}
    </div>
  )
}

/** Acciones de la fila: un toque para "Llegó"; el modal completo sigue a mano. */
function Actions({ row, canRecord, canQuick, busy, onQuickIn, onCheckIn, onCheckOut, wide }) {
  if (!canRecord) return null
  if (!row.arrival) {
    return canQuick ? (
      <div className={`flex gap-1.5 ${wide ? 'w-full' : ''}`}>
        <Button
          variant="success"
          icon={LogIn}
          onClick={onQuickIn}
          loading={busy}
          className={`h-11 sm:h-10 ${wide ? 'flex-1' : ''}`}
        >
          Llegó
        </Button>
        <Button
          variant="secondary"
          onClick={onCheckIn}
          disabled={busy}
          className="h-11 sm:h-10 px-3"
          aria-label={`Más detalles de la llegada de ${row.name}`}
          title="Llegada con detalles (quién lo trae, ánimo, temperatura…)"
        >
          <MoreHorizontal className="w-4 h-4" />
          <span className="hidden md:inline">Detalles</span>
        </Button>
      </div>
    ) : (
      <Button icon={LogIn} onClick={onCheckIn} className={`h-11 sm:h-10 ${wide ? 'w-full' : ''}`}>
        Registrar llegada
      </Button>
    )
  }
  if (!row.departure) {
    return (
      <Button
        variant="secondary"
        icon={LogOut}
        onClick={onCheckOut}
        className={`h-11 sm:h-10 ${wide ? 'w-full' : ''}`}
      >
        Registrar retiro
      </Button>
    )
  }
  return <span className="text-xs text-slate-400 dark:text-white/30 px-1">Día cerrado</span>
}

function NameBlock({ row }) {
  return (
    <div className="min-w-0 flex-1">
      <Link
        to={`/panel/ninos/${row.childId}`}
        className="font-semibold text-slate-900 dark:text-white hover:underline block truncate"
      >
        {row.name}
      </Link>
      {row.allergies ? (
        <p className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300 truncate">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span className="truncate">Alergias: {row.allergies}</span>
        </p>
      ) : (
        <p className="text-[11px] text-slate-400 dark:text-white/35 truncate">
          {row.classroomName || 'Sin sala'}
        </p>
      )}
    </div>
  )
}

/** Vista lista: una fila por niño, densa en escritorio y cómoda en móvil. */
function ChildDayRow({ row, canRecord, canQuick, busy, selected, onSelect, ...actions }) {
  const status = STATUS[row.status] || STATUS.absent
  const selectable = canQuick && !row.arrival
  return (
    <li
      className={`px-3 sm:px-4 py-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-3 ${
        selected ? 'bg-accent-soft' : ''
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 md:w-72 md:shrink-0">
        {selectable ? (
          <SelectBox row={row} selected={selected} onSelect={onSelect} />
        ) : (
          canQuick && <span className="hidden md:block w-5 shrink-0" aria-hidden />
        )}
        <Avatar src={row.photoUrl} name={row.name} size="sm" />
        <NameBlock row={row} />
        <Badge tone={status.tone} className="shrink-0 md:hidden">
          {status.label}
        </Badge>
      </div>
      <span className="hidden md:block shrink-0">
        <Badge tone={status.tone}>{status.label}</Badge>
      </span>
      <div className="flex items-center justify-between gap-2 md:flex-1 min-w-0">
        <div className="min-w-0">
          <Times row={row} />
        </div>
        <div className="shrink-0">
          <Actions row={row} canRecord={canRecord} canQuick={canQuick} busy={busy} wide={false} {...actions} />
        </div>
      </div>
    </li>
  )
}

/** Vista tarjetas. */
function ChildDayCard({ row, canRecord, canQuick, busy, selected, onSelect, ...actions }) {
  const status = STATUS[row.status] || STATUS.absent
  const selectable = canQuick && !row.arrival
  return (
    <div
      className={`rounded-xl border p-3.5 flex flex-col gap-2.5 ${
        selected
          ? 'border-accent/50 bg-accent-soft'
          : 'border-slate-200 dark:border-white/8 bg-white dark:bg-surface'
      }`}
    >
      <div className="flex items-center gap-3">
        {selectable && <SelectBox row={row} selected={selected} onSelect={onSelect} />}
        <Avatar src={row.photoUrl} name={row.name} size="md" />
        <NameBlock row={row} />
        <Badge tone={status.tone} className="shrink-0">
          {status.label}
        </Badge>
      </div>
      {(row.arrival || row.justification) && <Times row={row} />}
      <div className="mt-auto">
        <Actions row={row} canRecord={canRecord} canQuick={canQuick} busy={busy} wide {...actions} />
      </div>
    </div>
  )
}

function AttendanceModal({ target, date, onClose, onSaved }) {
  const { pushToast } = useToasts()
  const { row, mode } = target
  const isOut = mode === 'out'

  const [guardians, setGuardians] = useState([])
  const [guardianId, setGuardianId] = useState('')
  const [personName, setPersonName] = useState('')
  const [personRelationship, setRelationship] = useState('')
  const [personDocument, setDocument] = useState('')
  const [mood, setMood] = useState('')
  const [temperature, setTemperature] = useState('')
  const [notes, setNotes] = useState('')
  const [photo, setPhoto] = useState('')
  const [override, setOverride] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Registro en un día pasado (sólo dirección/coordinación): hay que indicar la hora,
  // o el backend lo guardaría con la fecha y hora actuales.
  const isPastDay = date !== todayKey()
  const [time, setTime] = useState(isOut ? '16:00' : '08:00')

  useEffect(() => {
    api
      .get(`/children/${row.childId}/guardians`)
      .then((r) => {
        const list = r.data || []
        setGuardians(list)
        // Preselecciona al contacto principal autorizado: es quien viene casi siempre.
        const primary = list.find((g) => g.isPrimary && g.canPickup) || list.find((g) => g.canPickup)
        if (primary) setGuardianId(primary.guardianId)
      })
      .catch(() => {})
  }, [row.childId])

  const selected = guardians.find((g) => g.guardianId === guardianId)
  // Sin representante autorizado elegido, el backend exige confirmación explícita.
  const needsOverride = isOut && !selected?.canPickup

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    let at
    if (isPastDay) {
      const [y, m, d] = date.split('-').map(Number)
      const [hh, mm] = (time || '').split(':').map(Number)
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) {
        setError('Indica la hora del registro')
        return
      }
      // Hora LOCAL del centro convertida a ISO (UTC) para el backend.
      at = new Date(y, m - 1, d, hh, mm).toISOString()
    }
    setSaving(true)
    try {
      await api.post(`/attendance/children/${row.childId}/${isOut ? 'out' : 'in'}`, {
        photo: photo || undefined,
        mood: mood || undefined,
        temperature: temperature ? Number(temperature) : undefined,
        guardianId: guardianId || undefined,
        personName: personName || selected?.name || undefined,
        personRelationship: personRelationship || selected?.relationship || undefined,
        personDocument: personDocument || undefined,
        notes: notes || undefined,
        overrideUnauthorized: needsOverride ? override : undefined,
        at,
      })
      pushToast({
        type: 'success',
        message: isOut ? 'Retiro registrado' : 'Llegada registrada',
      })
      onSaved()
    } catch (err) {
      const msg = apiError(err, 'No se pudo guardar el registro')
      setError(msg)
      pushToast({ type: 'error', message: msg })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isOut ? `Retiro de ${row.name}` : `Llegada de ${row.name}`}
      subtitle={longDate(date)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            loading={saving}
            disabled={needsOverride && !override}
            icon={isOut ? LogOut : LogIn}
          >
            {isOut ? 'Registrar retiro' : 'Registrar llegada'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {row.allergies && (
          <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-500/10 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>Alergias:</strong> {row.allergies}
            </span>
          </p>
        )}

        {isPastDay && (
          <Field
            label={isOut ? 'Hora del retiro' : 'Hora de llegada'}
            hint="Estás registrando un día pasado: indica la hora real."
            required
          >
            <input
              className={inputClass}
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              required
            />
          </Field>
        )}

        <Field label={isOut ? 'Quién lo retira' : 'Quién lo trae'}>
          <select
            className={inputClass}
            value={guardianId}
            onChange={(e) => setGuardianId(e.target.value)}
          >
            <option value="">Otra persona (indicar abajo)</option>
            {guardians.map((g) => (
              <option key={g.guardianId} value={g.guardianId}>
                {g.name}
                {g.relationship ? ` · ${g.relationship}` : ''}
                {g.canPickup ? '' : ' (no autorizado a retirar)'}
              </option>
            ))}
          </select>
        </Field>

        {!guardianId && (
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Nombre">
              <input
                className={inputClass}
                value={personName}
                onChange={(e) => setPersonName(e.target.value)}
                placeholder="Nombre completo"
              />
            </Field>
            <Field label="Parentesco">
              <input
                className={inputClass}
                value={personRelationship}
                onChange={(e) => setRelationship(e.target.value)}
                placeholder="Abuela, tío…"
              />
            </Field>
            <Field label="Cédula">
              <input
                className={inputClass}
                value={personDocument}
                onChange={(e) => setDocument(e.target.value)}
                placeholder="Documento"
              />
            </Field>
          </div>
        )}

        {needsOverride && (
          <label className="flex items-start gap-3 rounded-lg border border-red-200 dark:border-red-500/25 bg-red-50 dark:bg-red-500/10 px-3 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-sm text-red-800 dark:text-red-200">
              <strong>Esta persona no está autorizada a retirar al niño.</strong> Confirmo la
              excepción bajo mi responsabilidad; el registro quedará señalado para coordinación.
            </span>
          </label>
        )}

        <div className="grid sm:grid-cols-[1fr_160px] gap-3">
          <Field label="Estado de ánimo">
            <div className="flex flex-wrap gap-1.5">
              {MOODS.filter((m) => m.value).map((m) => (
                <button
                  key={m.value}
                  type="button"
                  aria-pressed={mood === m.value}
                  onClick={() => setMood(mood === m.value ? '' : m.value)}
                  className={`h-9 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors border ${
                    mood === m.value
                      ? 'border-accent/40 bg-accent-soft text-accent-text'
                      : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/5'
                  }`}
                >
                  {m.icon && <m.icon className="w-4 h-4" aria-hidden="true" />}
                  {m.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Temperatura (°C)" hint="Opcional. Se registra sólo si se mide.">
            <input
              className={inputClass}
              type="number"
              step="0.1"
              min="30"
              max="45"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              placeholder="36.5"
            />
          </Field>
        </div>

        <Field label="Observaciones">
          <textarea
            className={inputClass}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Llegó sin desayunar, trae medicación…"
          />
        </Field>

        {/* La foto de retiro es evidencia: no requiere autorización de imagen. */}
        <ChildPhotoCapture childId={row.childId} value={photo} onChange={setPhoto} exempt={isOut} />

        {error && (
          <p className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
