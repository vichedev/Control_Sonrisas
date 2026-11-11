import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlarmClock,
  BellRing,
  Check,
  Clock,
  Droplets,
  HeartPulse,
  Moon,
  NotebookPen,
  Plus,
  Search,
  ShieldAlert,
  Smile,
  StickyNote,
  Sun,
  Sunrise,
  Sunset,
  Trash2,
  Users,
} from '../components/icons'
import { api, apiError, longDate, timeOf, todayKey } from '../api/client'
import { useLoadEffect } from '../api/useLoadEffect'
import { useLiveReload } from '../realtime'
import { useToasts } from '../context/ToastsContext'
import { useAuth } from '../context/AuthContext'
import DayFilters from '../components/DayFilters'
import ChildPicker from '../components/ChildPicker'
import { LoadMore, SearchInput } from '../components/DataToolbar'
import { matchChild } from '../components/childSearch'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
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

/** Tipos de anotación: icono + texto siempre (nunca sólo icono). */
const LOG_KINDS = [
  {
    value: 'nap',
    label: 'Siesta',
    icon: Moon,
    tone: 'slate',
    tile: 'bg-slate-100 text-slate-600 dark:bg-white/8 dark:text-white/70',
  },
  {
    value: 'hygiene',
    label: 'Pañal / Higiene',
    short: 'Higiene',
    icon: Droplets,
    tone: 'slate',
    tile: 'bg-slate-100 text-slate-600 dark:bg-white/8 dark:text-white/70',
  },
  {
    value: 'health',
    label: 'Salud',
    icon: HeartPulse,
    tone: 'amber',
    tile: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
  },
  {
    value: 'incident',
    label: 'Incidente',
    icon: ShieldAlert,
    tone: 'red',
    tile: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300',
  },
  {
    value: 'mood',
    label: 'Ánimo',
    icon: Smile,
    tone: 'slate',
    tile: 'bg-slate-100 text-slate-600 dark:bg-white/8 dark:text-white/70',
  },
  {
    value: 'note',
    label: 'Nota',
    icon: StickyNote,
    tone: 'slate',
    tile: 'bg-slate-100 text-slate-600 dark:bg-white/8 dark:text-white/70',
  },
]

/** Siesta que no se hizo: se registra igual, sin horas ni duración. */
const NAP_SKIPPED = 'no_durmio'

/** Texto legible de cada código de detalle (lo que guarda el backend). */
const DETAIL_LABEL = {
  siesta: 'Siesta',
  [NAP_SKIPPED]: 'No durmió',
  panal_mojado: 'Pañal mojado',
  panal_deposicion: 'Pañal con deposición',
  panal_seco: 'Pañal seco',
  bano: 'Fue al baño',
  accidente: 'Accidente (se mojó)',
  fiebre: 'Fiebre',
  medicacion: 'Medicación',
  malestar: 'Malestar',
  vomito: 'Vómito',
  golpe: 'Golpe',
  caida: 'Caída',
  mordida: 'Mordida',
  rasguno: 'Rasguño',
  alegre: 'Alegre',
  tranquilo: 'Tranquilo',
  llanto: 'Llanto',
  irritable: 'Irritable',
  sueno: 'Con sueño',
}
const detailLabel = (d) => {
  if (!d) return ''
  if (DETAIL_LABEL[d]) return DETAIL_LABEL[d]
  const s = d.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Opciones rápidas por tipo (la siesta tiene su propio formulario). */
const DETAIL_OPTIONS = {
  hygiene: ['panal_mojado', 'panal_deposicion', 'panal_seco', 'bano', 'accidente'],
  health: ['fiebre', 'medicacion', 'malestar', 'vomito'],
  incident: ['golpe', 'caida', 'mordida', 'rasguno'],
  mood: ['alegre', 'tranquilo', 'sueno', 'llanto', 'irritable'],
  note: [],
  nap: [],
}

const kindOf = (v) => LOG_KINDS.find((k) => k.value === v) || LOG_KINDS[LOG_KINDS.length - 1]
const childNameOf = (log) =>
  log.child ? `${log.child.firstName} ${log.child.lastName}`.trim() : 'Niño'
const isOngoingNap = (log) => log.kind === 'nap' && log.detail !== NAP_SKIPPED && !log.endedAt

const pad = (n) => String(n).padStart(2, '0')
const nowHHMM = () => {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
/** 'HH:mm' del día indicado → ISO completo. */
const isoAt = (date, hhmm) => {
  if (!hhmm) return undefined
  const [y, m, d] = date.split('-').map(Number)
  const [h, min] = hhmm.split(':').map(Number)
  return new Date(y, m - 1, d, h, min).toISOString()
}
const minutesLabel = (min) => {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

/** Franjas del día para agrupar la línea de tiempo. */
const DAY_PARTS = [
  { key: 'morning', label: 'Mañana', icon: Sunrise, test: (h) => h < 12 },
  { key: 'midday', label: 'Mediodía', icon: Sun, test: (h) => h >= 12 && h < 15 },
  { key: 'afternoon', label: 'Tarde', icon: Sunset, test: (h) => h >= 15 },
]

const VIEW_KEY = 'sonrisas_bitacora_view'
const readView = () => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'child' ? 'child' : 'time'
  } catch {
    return 'time'
  }
}

/** Reloj que avanza cada 30 s (para "durmiendo hace X min"). */
function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

/** Tandas: anotaciones en la vista por hora, niños en la vista por niño. */
const LOG_PAGE = 60
const CHILD_PAGE = 20

/** Bitácora del día: siestas, cambios, salud, incidentes y observaciones. */
export default function DailyLogsPage() {
  const { pushToast } = useToasts()
  const { canManage } = useAuth()
  const now = useNow()

  const [date, setDate] = useState(todayKey())
  const [classroomId, setClassroomId] = useState('')
  const [kind, setKind] = useState('')
  const [view, setView] = useState(readView)
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(null) // tipo preseleccionado o null
  const [toDelete, setToDelete] = useState(null)
  const [busyIds, setBusyIds] = useState([])
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(LOG_PAGE)
  // Cédulas por niño: ni la bitácora ni el tablero las traen (sirven para buscar).
  const [docs, setDocs] = useState({})

  const isToday = date === todayKey()

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

  const loadSeq = useRef(0)
  // `silent`: recarga en vivo (sin spinner ni toasts, conserva el scroll).
  const load = useCallback(async ({ silent = false } = {}) => {
    const seq = ++loadSeq.current
    if (!silent) setLoading(true)
    try {
      // Se trae todo el día: los avisos y siestas en curso se muestran aunque haya filtro.
      const res = await api.get('/daily-logs', {
        params: { date, classroomId: classroomId || undefined },
      })
      if (seq !== loadSeq.current) return
      setLogs(res.data || [])
    } catch (err) {
      if (!silent) pushToast({ type: 'error', message: apiError(err, 'No se pudo cargar la bitácora') })
    } finally {
      if (!silent) setLoading(false)
    }
  }, [date, classroomId, pushToast])

  useLoadEffect(load)
  const quietReload = useCallback(() => load({ silent: true }), [load])
  useLiveReload(quietReload, { entities: ['daily_log', 'attendance'], date, classroomId: classroomId || undefined })

  const changeView = (v) => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* sin almacenamiento: no pasa nada */
    }
  }

  const withBusy = async (id, fn) => {
    setBusyIds((l) => [...l, id])
    try {
      await fn()
    } finally {
      setBusyIds((l) => l.filter((x) => x !== id))
    }
  }

  const markNotified = (log) =>
    withBusy(log.id, async () => {
      try {
        await api.post(`/daily-logs/${log.id}/notified`)
        setLogs((list) => list.map((l) => (l.id === log.id ? { ...l, guardianNotified: true } : l)))
        pushToast({ type: 'success', message: `Aviso a la familia de ${childNameOf(log)} marcado como hecho` })
      } catch (err) {
        pushToast({ type: 'error', message: apiError(err) })
      }
    })

  /** Cierra una siesta en curso: hora de despertar = ahora (o la hora indicada). */
  const wakeUp = (log, hhmm) =>
    withBusy(log.id, async () => {
      try {
        const endedAt = hhmm ? isoAt(date, hhmm) : new Date().toISOString()
        const res = await api.patch(`/daily-logs/${log.id}`, { endedAt })
        setLogs((list) => list.map((l) => (l.id === log.id ? { ...l, ...res.data, child: l.child } : l)))
        pushToast({ type: 'success', message: `${childNameOf(log)} despertó` })
      } catch (err) {
        pushToast({ type: 'error', message: apiError(err) })
      }
    })

  const wakeAll = async (list) => {
    for (const log of list) await wakeUp(log)
  }

  const remove = async () => {
    const log = toDelete
    try {
      await api.delete(`/daily-logs/${log.id}`)
      setToDelete(null)
      setLogs((list) => list.filter((l) => l.id !== log.id))
      pushToast({ type: 'success', message: 'Anotación eliminada' })
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err) })
    }
  }

  const pending = logs.filter((l) => l.notifyGuardian && !l.guardianNotified)
  const sleeping = logs.filter(isOngoingNap)
  const query = search.trim()
  const visible = useMemo(
    () =>
      [...logs]
        .filter((l) => !kind || l.kind === kind)
        .filter((l) => !query || matchChild({ name: childNameOf(l), documentId: docs[l.childId] }, query))
        .sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt)),
    [logs, kind, query, docs],
  )

  // Días largos: por tandas (vista por hora = anotaciones; vista por niño = niños).
  const pageSig = `${query}|${kind}|${view}|${date}|${classroomId}`
  const [prevPageSig, setPrevPageSig] = useState(pageSig)
  if (prevPageSig !== pageSig) {
    setPrevPageSig(pageSig)
    setLimit(view === 'child' ? CHILD_PAGE : LOG_PAGE)
  }
  const countBy = (k) => logs.filter((l) => l.kind === k).length

  const groups = useMemo(() => {
    if (view === 'child') {
      const map = new Map()
      for (const l of visible) {
        const key = l.childId
        if (!map.has(key)) map.set(key, { key, child: l.child, name: childNameOf(l), items: [] })
        map.get(key).items.push(l)
      }
      return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
    }
    const shownLogs = visible.slice(0, limit)
    return DAY_PARTS.map((p) => ({
      key: p.key,
      label: p.label,
      icon: p.icon,
      items: shownLogs.filter((l) => p.test(new Date(l.occurredAt).getHours())),
    })).filter((g) => g.items.length)
  }, [visible, view, limit])
  const totalUnits = view === 'child' ? groups.length : visible.length
  const shownGroups = view === 'child' ? groups.slice(0, limit) : groups
  const shownUnits = Math.min(limit, totalUnits)
  const step = view === 'child' ? CHILD_PAGE : LOG_PAGE

  const rowProps = {
    canManage,
    busyIds,
    onNotified: markNotified,
    onDelete: setToDelete,
  }

  return (
    <>
      <PageHeader
        title="Bitácora del día"
        subtitle={longDate(date)}
        icon={NotebookPen}
        actions={
          <>
            <DayFilters
              date={date}
              onDateChange={setDate}
              classroomId={classroomId}
              onClassroomChange={setClassroomId}
            />
            <span className="hidden sm:inline-flex">
              <Button icon={Plus} onClick={() => setCreating('nap')}>
                Anotar
              </Button>
            </span>
          </>
        }
      />

      {/* Barra de anotación rápida: un toque por tipo */}
      <Card className="mb-4" padded={false}>
        <div className="p-3 sm:p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/45 mb-2">
            Anotar rápido
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {LOG_KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => setCreating(k.value)}
                className="min-h-16 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/4 hover:border-slate-300 hover:bg-slate-50 dark:hover:border-white/20 dark:hover:bg-white/8 transition-colors flex flex-col items-center justify-center gap-1 px-2 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
              >
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${k.tile}`}>
                  <k.icon className="w-4 h-4" />
                </span>
                <span className="text-xs font-medium text-slate-700 dark:text-white/80 text-center leading-tight">
                  {k.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </Card>

      {loading ? (
        <Card>
          <Loading />
        </Card>
      ) : (
        <>
          {pending.length > 0 && (
            <section
              className="mb-4 rounded-xl border border-amber-200 dark:border-amber-400/20 bg-white dark:bg-surface shadow-xs p-3 sm:p-4"
              aria-label="Avisos pendientes a la familia"
            >
              <div className="flex items-center gap-2 mb-2">
                <BellRing className="w-4 h-4 text-amber-600 dark:text-amber-300" />
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Avisar a la familia ({pending.length})
                </h2>
                <span className="text-xs text-slate-500 dark:text-white/45 hidden sm:inline">
                  Comunícalo hoy y márcalo como hecho.
                </span>
              </div>
              <ul className="space-y-2">
                {pending.map((log) => {
                  const k = kindOf(log.kind)
                  return (
                    <li
                      key={log.id}
                      className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 dark:bg-white/4 border border-slate-100 dark:border-white/5 px-3 py-2"
                    >
                      <Avatar src={log.child?.photoUrl} name={childNameOf(log)} size="sm" />
                      <div className="flex-1 min-w-40">
                        <p className="text-sm font-semibold text-slate-800 dark:text-white">
                          {childNameOf(log)}{' '}
                          <span className="font-normal text-slate-500 dark:text-white/40">
                            · {k.short || k.label} · {timeOf(log.occurredAt)}
                          </span>
                        </p>
                        <p className="text-sm text-slate-600 dark:text-white/60">{describe(log)}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="success"
                        icon={Check}
                        className="min-h-11"
                        loading={busyIds.includes(log.id)}
                        onClick={() => markNotified(log)}
                      >
                        Ya avisé
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {sleeping.length > 0 && (
            <section
              className="mb-4 rounded-xl border border-slate-200 dark:border-white/8 bg-white dark:bg-surface shadow-xs p-3 sm:p-4"
              aria-label="Siestas en curso"
            >
              <div className="flex items-center gap-2 mb-2">
                <Moon className="w-4 h-4 text-accent-text" />
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex-1">
                  Durmiendo ahora ({sleeping.length})
                </h2>
                {isToday && sleeping.length > 1 && (
                  <Button size="sm" variant="secondary" icon={AlarmClock} onClick={() => wakeAll(sleeping)}>
                    Despertaron todos
                  </Button>
                )}
              </div>
              <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {sleeping.map((log) => (
                  <SleepingRow
                    key={log.id}
                    log={log}
                    now={now}
                    isToday={isToday}
                    busy={busyIds.includes(log.id)}
                    onWake={wakeUp}
                  />
                ))}
              </ul>
            </section>
          )}

          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mb-1 flex-1 min-w-0 basis-full sm:basis-auto">
              <FilterChip active={!kind} onClick={() => setKind('')}>
                Todo · {logs.length}
              </FilterChip>
              {LOG_KINDS.map((k) => (
                <FilterChip
                  key={k.value}
                  active={kind === k.value}
                  onClick={() => setKind(kind === k.value ? '' : k.value)}
                >
                  <k.icon className="w-3.5 h-3.5" /> {k.short || k.label} · {countBy(k.value)}
                </FilterChip>
              ))}
            </div>
            <div
              role="group"
              aria-label="Agrupar"
              className="inline-flex rounded-lg bg-slate-100 dark:bg-white/5 p-1 shrink-0"
            >
              {[
                ['time', 'Por hora', Clock],
                ['child', 'Por niño', Users],
              ].map(([v, label, Icon]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => changeView(v)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    view === v
                      ? 'bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-500 dark:text-white/50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>
          </div>

          {logs.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <SearchInput
                className="flex-1 min-w-48 sm:max-w-sm"
                value={search}
                onChange={setSearch}
                placeholder="Buscar niño por nombre o cédula…"
                aria-label="Buscar anotaciones de un niño por nombre o cédula"
              />
              {query && (
                <span className="text-xs text-slate-500 dark:text-white/45 tabular-nums" aria-live="polite">
                  {visible.length} {visible.length === 1 ? 'anotación' : 'anotaciones'}
                </span>
              )}
            </div>
          )}

          {visible.length === 0 && query ? (
            <Card>
              <EmptyState
                icon={Search}
                title="Sin anotaciones de ese niño"
                message={`Nada coincide con «${query}»${kind ? ' en este tipo' : ''}.`}
                action={
                  <Button variant="secondary" onClick={() => setSearch('')}>
                    Limpiar búsqueda
                  </Button>
                }
              />
            </Card>
          ) : visible.length === 0 ? (
            <Card>
              <EmptyState
                icon={NotebookPen}
                title={kind ? 'Nada de este tipo hoy' : 'Sin anotaciones'}
                message="Registra siestas, cambios, salud e incidentes: todo eso va al reporte de la familia."
                action={
                  <Button icon={Plus} onClick={() => setCreating(kind || 'nap')}>
                    Anotar
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="space-y-4">
              {shownGroups.map((g) => (
                <Card key={g.key} padded={false}>
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 dark:border-white/5">
                    {view === 'child' ? (
                      <Avatar src={g.child?.photoUrl} name={g.name} size="xs" />
                    ) : (
                      <g.icon className="w-4 h-4 text-slate-400 dark:text-white/40" />
                    )}
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-white flex-1">
                      {view === 'child' ? g.name : g.label}
                    </h3>
                    <span className="text-xs text-slate-400 dark:text-white/30">
                      {g.items.length} {g.items.length === 1 ? 'anotación' : 'anotaciones'}
                    </span>
                  </div>
                  <ul className="divide-y divide-slate-100 dark:divide-white/5">
                    {g.items.map((log) => (
                      <LogRow key={log.id} log={log} showChild={view !== 'child'} {...rowProps} />
                    ))}
                  </ul>
                </Card>
              ))}
              {totalUnits > step && (
                <Card padded={false}>
                  <LoadMore
                    shown={shownUnits}
                    total={totalUnits}
                    step={step}
                    label={view === 'child' ? 'niños' : 'anotaciones'}
                    onMore={() => setLimit((l) => l + step)}
                    onAll={() => setLimit(totalUnits)}
                  />
                </Card>
              )}
            </div>
          )}
        </>
      )}

      {/* Acción principal al alcance del pulgar en móvil */}
      <div className="h-20 sm:hidden" aria-hidden />
      <div className="sm:hidden fixed bottom-[calc(var(--bottom-nav-h)+1rem)] right-4 z-30">
        <Button
          icon={Plus}
          size="lg"
          className="rounded-xl min-h-14 shadow-xl"
          onClick={() => setCreating('nap')}
        >
          Anotar
        </Button>
      </div>

      {creating && (
        <QuickLogSheet
          date={date}
          classroomId={classroomId}
          initialKind={creating}
          docs={docs}
          onClose={() => setCreating(null)}
          onSaved={() => {
            setCreating(null)
            load({ silent: true })
          }}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        variant="danger"
        title="¿Eliminar esta anotación?"
        message={
          toDelete
            ? `${kindOf(toDelete.kind).label} de ${childNameOf(toDelete)} a las ${timeOf(toDelete.occurredAt)}. Ya no aparecerá en el reporte.`
            : ''
        }
        confirmText="Eliminar"
        onConfirm={remove}
      />
    </>
  )
}

/** Resumen legible de una anotación ("Pañal mojado · Se cambió con crema"). */
function describe(log) {
  if (isOngoingNap(log)) return 'Sigue durmiendo'
  const parts = []
  const label = detailLabel(log.detail)
  if (label && !(log.kind === 'nap' && log.detail === 'siesta')) parts.push(label)
  if (log.notes) parts.push(log.notes)
  if (log.temperature) parts.push(`${log.temperature} °C`)
  if (log.kind === 'nap' && log.durationMinutes) parts.push(`Durmió ${minutesLabel(log.durationMinutes)}`)
  if (!parts.length) return kindOf(log.kind).label
  return parts.join(' · ')
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
        active
          ? 'bg-accent-soft text-accent-text ring-1 ring-inset ring-accent/25'
          : 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  )
}

function SleepingRow({ log, now, isToday, busy, onWake }) {
  const [time, setTime] = useState('')
  const mins = Math.max(0, Math.round((now - new Date(log.occurredAt).getTime()) / 60000))
  return (
    <li className="flex items-center gap-3 rounded-lg bg-slate-50 dark:bg-white/4 border border-slate-100 dark:border-white/5 px-3 py-2">
      <Avatar src={log.child?.photoUrl} name={childNameOf(log)} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{childNameOf(log)}</p>
        <p className="text-xs text-slate-500 dark:text-white/50">
          Durmiendo desde {timeOf(log.occurredAt)}
          {isToday ? ` · ${minutesLabel(mins)}` : ''}
        </p>
      </div>
      {isToday ? (
        <Button
          size="sm"
          variant="secondary"
          icon={Sun}
          className="min-h-11"
          loading={busy}
          onClick={() => onWake(log)}
        >
          Despertó
        </Button>
      ) : (
        <div className="flex items-center gap-1">
          <input
            type="time"
            aria-label={`Hora de despertar de ${childNameOf(log)}`}
            className={`${inputClass} w-28`}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
          <Button size="sm" variant="secondary" disabled={!time} loading={busy} onClick={() => onWake(log, time)}>
            Guardar
          </Button>
        </div>
      )}
    </li>
  )
}

function LogRow({ log, showChild, canManage, busyIds, onNotified, onDelete }) {
  const k = kindOf(log.kind)
  const name = childNameOf(log)
  const time = `${timeOf(log.occurredAt)}${log.endedAt ? ` – ${timeOf(log.endedAt)}` : ''}`
  return (
    <li className="px-4 py-3 flex items-start gap-3">
      <span className="w-16 shrink-0 text-xs font-semibold tabular-nums text-slate-500 dark:text-white/50 pt-1.5">
        {timeOf(log.occurredAt)}
      </span>
      {showChild && <Avatar src={log.child?.photoUrl} name={name} size="sm" />}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {showChild && <span className="text-sm font-semibold text-slate-800 dark:text-white">{name}</span>}
          <Badge tone={k.tone}>
            <k.icon className="w-3 h-3" /> {k.short || k.label}
          </Badge>
          {log.endedAt && (
            <span className="text-xs text-slate-400 dark:text-white/30 tabular-nums">{time}</span>
          )}
        </div>
        <p className="text-sm text-slate-600 dark:text-white/60 mt-0.5 wrap-break-word">{describe(log)}</p>
        {log.notifyGuardian && (
          <p className="mt-1">
            {log.guardianNotified ? (
              <Badge tone="green">
                <Check className="w-3 h-3" /> Familia avisada
              </Badge>
            ) : (
              <button
                type="button"
                onClick={() => onNotified(log)}
                disabled={busyIds.includes(log.id)}
                className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300 hover:underline"
              >
                <BellRing className="w-3 h-3" /> Pendiente de avisar · marcar como avisado
              </button>
            )}
          </p>
        )}
      </div>
      {canManage && (
        <Button
          size="sm"
          variant="ghost"
          icon={Trash2}
          aria-label={`Eliminar anotación de ${name}`}
          onClick={() => onDelete(log)}
        />
      )}
    </li>
  )
}

/** Hoja de anotación rápida: tipo → niños → lo mínimo de cada tipo. */
function QuickLogSheet({ date, classroomId, initialKind, docs, onClose, onSaved }) {
  const { pushToast } = useToasts()
  const [board, setBoard] = useState(null)
  const [selected, setSelected] = useState([])
  const [kind, setKind] = useState(initialKind || 'nap')
  const [detail, setDetail] = useState('')
  const [notes, setNotes] = useState('')
  const [temperature, setTemperature] = useState('')
  const [startTime, setStartTime] = useState(nowHHMM)
  const [endTime, setEndTime] = useState('')
  const [napSkipped, setNapSkipped] = useState(false)
  // null = sin decidir: incidente y salud se avisan por defecto.
  const [notifyOverride, setNotifyOverride] = useState(null)
  const [photo, setPhoto] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    api
      .get('/attendance/board', { params: { date, classroomId: classroomId || undefined } })
      .then((r) => alive && setBoard(r.data?.children || []))
      .catch(() => alive && setBoard([]))
    return () => {
      alive = false
    }
  }, [date, classroomId])

  const isPresent = (c) => c.status === 'present' || c.status === 'checked_out'
  const present = (board || []).filter(isPresent)
  const pickerItems = useMemo(
    () => (board || []).map((c) => ({ ...c, id: c.childId, documentId: docs?.[c.childId] || '' })),
    [board, docs],
  )
  const notifyGuardian = notifyOverride ?? (kind === 'incident' || kind === 'health')
  const options = DETAIL_OPTIONS[kind] || []
  const single = selected.length === 1

  const pickKind = (v) => {
    setKind(v)
    setDetail('')
    setNapSkipped(false)
    setNotifyOverride(null)
  }

  const submit = async (e) => {
    e?.preventDefault()
    setError('')
    if (!selected.length) {
      setError('Elige al menos un niño')
      return
    }
    const isNap = kind === 'nap'
    if (isNap && !napSkipped && endTime && startTime && endTime <= startTime) {
      setError('La hora de despertar debe ser posterior a la de inicio')
      return
    }
    if (!isNap && kind !== 'note' && !detail && !notes.trim()) {
      setError('Elige una opción o escribe una nota')
      return
    }
    setSaving(true)
    try {
      const common = {
        kind,
        date,
        detail: isNap ? (napSkipped ? NAP_SKIPPED : 'siesta') : detail || undefined,
        notes: notes.trim() || undefined,
        occurredAt: isoAt(date, startTime),
        endedAt: isNap && !napSkipped ? isoAt(date, endTime) : undefined,
        notifyGuardian,
      }
      const temp = temperature ? Number(temperature) : undefined
      if (single) {
        await api.post('/daily-logs', {
          ...common,
          childId: selected[0],
          temperature: temp,
          photo: photo || undefined,
        })
      } else if (temp !== undefined) {
        // El alta en bloque no admite temperatura: una por niño.
        await Promise.all(
          selected.map((childId) => api.post('/daily-logs', { ...common, childId, temperature: temp })),
        )
      } else {
        await api.post('/daily-logs/bulk', { ...common, childIds: selected })
      }
      const k = kindOf(kind)
      pushToast({
        type: 'success',
        message:
          selected.length === 1
            ? `${k.short || k.label} anotada`
            : `${k.short || k.label} anotada para ${selected.length} niños`,
      })
      onSaved()
    } catch (err) {
      const msg = apiError(err, 'No se pudo guardar')
      setError(msg)
      pushToast({ type: 'error', message: msg })
    } finally {
      setSaving(false)
    }
  }

  const k = kindOf(kind)

  return (
    <Modal
      open
      onClose={onClose}
      width="lg"
      title={`Anotar: ${k.label}`}
      subtitle={longDate(date)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving} disabled={!selected.length} className="min-h-11">
            {selected.length
              ? `Guardar para ${selected.length} ${selected.length === 1 ? 'niño' : 'niños'}`
              : 'Elige niños'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        {/* 1. Tipo */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2" role="radiogroup" aria-label="Tipo de anotación">
          {LOG_KINDS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={kind === opt.value}
              onClick={() => pickKind(opt.value)}
              className={`min-h-14 rounded-lg border flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition ${
                kind === opt.value
                  ? 'border-accent bg-accent-soft ring-1 ring-accent'
                  : 'border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'
              }`}
            >
              <opt.icon className="w-4 h-4 text-slate-600 dark:text-white/70" />
              <span className="text-[11px] font-semibold text-slate-700 dark:text-white/80 leading-tight text-center">
                {opt.short || opt.label}
              </span>
            </button>
          ))}
        </div>

        {/* 2. Niños: rejilla de 1 toque en salas pequeñas; buscador (nombre o cédula) en las grandes */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/45 mb-2">
            ¿Quién? {selected.length > 0 && `· ${selected.length} elegido(s)`}
          </p>
          {board === null ? (
            <Loading label="Cargando niños…" />
          ) : (
            <>
              {board.length > 0 && !present.length && (
                <p className="text-xs text-amber-700 dark:text-amber-300 mb-2">
                  Nadie tiene llegada registrada en este día: se muestran todos.
                </p>
              )}
              <ChildPicker
                items={pickerItems}
                value={selected}
                onChange={(ids) => {
                  // La foto es de un niño concreto: al cambiar la selección se descarta.
                  setPhoto('')
                  setSelected(ids)
                }}
                multiple
                showAllNone={false}
                quickSelect={
                  present.length
                    ? [{ label: 'Todos los presentes', ids: () => present.map((c) => c.childId) }]
                    : [{ label: 'Todos', ids: (all) => all.map((c) => c.id) }]
                }
                filters={
                  present.length && present.length < board.length
                    ? [
                        { key: 'present', label: 'Presentes', match: isPresent },
                        { key: 'pending', label: 'Sin llegar', match: (c) => !isPresent(c) },
                      ]
                    : []
                }
                defaultFilter={present.length && present.length < board.length ? 'present' : ''}
                renderMeta={(c) =>
                  isPresent(c) ? null : <span className="text-[11px] text-slate-400 dark:text-white/40">Sin llegada</span>
                }
                label="Niños para la anotación"
                emptyMessage="No hay niños en esta sala."
              />
            </>
          )}
        </div>

        {/* 3. Campos del tipo */}
        {kind === 'nap' ? (
          <div className="space-y-3">
            <div className="inline-flex rounded-lg bg-slate-100 dark:bg-white/5 p-1" role="group" aria-label="¿Durmió?">
              {[
                [false, 'Durmió / está durmiendo'],
                [true, 'No durmió'],
              ].map(([v, label]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={napSkipped === v}
                  onClick={() => setNapSkipped(v)}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${
                    napSkipped === v
                      ? 'bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-500 dark:text-white/50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {!napSkipped && (
              <div className="grid sm:grid-cols-2 gap-3">
                <TimeField label="Se durmió" value={startTime} onChange={setStartTime} />
                <TimeField
                  label="Despertó"
                  value={endTime}
                  onChange={setEndTime}
                  hint="Déjalo vacío si sigue durmiendo: luego tocas «Despertó»."
                  clearable
                />
              </div>
            )}
          </div>
        ) : (
          <>
            {options.length > 0 && (
              <div>
                <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/45 mb-1.5">
                  ¿Qué pasó?
                </span>
                <div className="flex flex-wrap gap-2">
                  {options.map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={detail === s}
                      onClick={() => setDetail(detail === s ? '' : s)}
                      className={`min-h-11 px-4 rounded-lg text-sm font-medium transition border ${
                        detail === s
                          ? 'border-accent bg-accent-soft text-accent-text ring-1 ring-accent'
                          : 'border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/5'
                      }`}
                    >
                      {detailLabel(s)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <TimeField label="Hora" value={startTime} onChange={setStartTime} />
              {(kind === 'health' || kind === 'incident') && (
                <Field label="Temperatura (°C)" hint="Opcional.">
                  <input
                    className={`${inputClass} min-h-11`}
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    min="30"
                    max="45"
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                    placeholder="37.5"
                  />
                </Field>
              )}
            </div>
          </>
        )}

        <Field label={kind === 'note' ? 'Observación' : 'Nota (opcional)'}>
          <textarea
            className={inputClass}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={
              kind === 'incident'
                ? 'Se golpeó la rodilla jugando; se limpió y se aplicó frío.'
                : kind === 'note'
                  ? 'Compartió sus juguetes con todos.'
                  : 'Algo que la familia deba saber…'
            }
          />
        </Field>

        {/* Avisar a la familia */}
        <label className="flex items-start gap-3 rounded-lg border border-slate-200 dark:border-white/10 p-3 cursor-pointer">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={notifyGuardian}
            onChange={(e) => setNotifyOverride(e.target.checked)}
          />
          <span
            aria-hidden
            className={`mt-0.5 shrink-0 w-11 h-6 rounded-full transition relative peer-focus-visible:ring-2 peer-focus-visible:ring-accent-ring ${
              notifyGuardian ? 'bg-accent' : 'bg-slate-300 dark:bg-white/20'
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                notifyGuardian ? 'left-5.5' : 'left-0.5'
              }`}
            />
          </span>
          <span className="text-sm">
            <span className="font-semibold text-slate-800 dark:text-white">
              Avisar a la familia hoy {notifyGuardian ? '· Sí' : '· No'}
            </span>
            <span className="block text-xs text-slate-500 dark:text-white/40">
              Queda arriba en «Avisar a la familia» hasta que lo marques como avisado y encabeza el
              reporte diario.
            </span>
          </span>
        </label>

        {/* Foto sólo con un niño elegido y con su autorización de imagen. */}
        {single && <ChildPhotoCapture key={selected[0]} childId={selected[0]} value={photo} onChange={setPhoto} collapsed />}

        {error && (
          <p
            role="alert"
            className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2"
          >
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}

function TimeField({ label, value, onChange, hint, clearable }) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex gap-2">
        <input
          className={`${inputClass} min-h-11`}
          type="time"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button type="button" variant="secondary" className="min-h-11 shrink-0" onClick={() => onChange(nowHHMM())}>
          Ahora
        </Button>
        {clearable && value && (
          <Button type="button" variant="ghost" className="min-h-11 shrink-0" onClick={() => onChange('')}>
            Quitar
          </Button>
        )}
      </div>
    </Field>
  )
}
