import { useCallback, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Baby,
  BedDouble,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileWarning,
  Images,
  ListChecks,
  ListTodo,
  MessageCircleHeart,
  NotebookPen,
  Palmtree,
  RefreshCw,
  Search,
  Send,
  UtensilsCrossed,
} from '../components/icons'
import { api, apiError, longDate, mediaUrl, timeOf, todayKey } from '../api/client'
import { useLoadEffect } from '../api/useLoadEffect'
import { useLiveReload } from '../realtime'
import { useToasts } from '../context/ToastsContext'
import { useAuth } from '../context/AuthContext'
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Kbd,
  ProgressBar,
  SectionTitle,
  Skeleton,
  TONES,
} from '../components/ui'
import { OPEN_SEARCH_EVENT } from '../components/navConfig'


const MISSING = new Set(['pending', 'not_recorded'])

// Fondo + color de icono por tono (rose = rojo, violet = acento; ver TONES en ui.jsx).
const TONE = Object.fromEntries(Object.entries(TONES).map(([k, v]) => [k, v.icon]))

function greeting(d = new Date()) {
  const h = d.getHours()
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

const capitalize = (t = '') => t.charAt(0).toUpperCase() + t.slice(1)

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** Resume /reports/checklists en contadores y en la lista "lo que falta". */
function digest(rows) {
  const attended = rows.filter((r) => r.attendance.status !== 'absent')
  const present = rows.filter((r) => r.attendance.status === 'present')
  const left = rows.filter((r) => r.attendance.status === 'checked_out')
  const notArrived = []
  const justified = []
  const noShow = []
  const meals = new Map() // etiqueta → niños sin registro
  const activities = new Map()
  const naps = []
  let mealsExpected = 0
  let mealsDone = 0
  let napsExpected = 0
  let napsDone = 0

  for (const r of rows) {
    const items = r.checklist?.items || []
    const att = items.find((i) => i.key === 'attendance')
    if (r.attendance.status === 'absent') {
      if (att?.status === 'pending') notArrived.push(r)
      else if (att?.status === 'info') justified.push(r)
      else noShow.push(r)
      continue
    }
    for (const it of items) {
      if (it.group === 'meals' && it.key !== 'meal:bottle') {
        mealsExpected += 1
        if (MISSING.has(it.status)) {
          if (!meals.has(it.label)) meals.set(it.label, [])
          meals.get(it.label).push(r)
        } else mealsDone += 1
      } else if (it.key === 'nap') {
        napsExpected += 1
        if (MISSING.has(it.status)) naps.push(r)
        else napsDone += 1
      } else if (it.group === 'activities' && MISSING.has(it.status)) {
        if (!activities.has(it.label)) activities.set(it.label, [])
        activities.get(it.label).push(r)
      }
    }
  }

  const withoutReport = attended.filter((r) => !r.report)
  const leftWithoutReport = left.filter((r) => !r.report)
  const ready = attended.filter((r) => r.report?.status === 'ready')
  const draft = attended.filter((r) => r.report?.status === 'draft')
  const sent = attended.filter((r) => r.report?.status === 'sent')

  return {
    enrolled: rows.length,
    attended,
    present,
    left,
    notArrived,
    justified,
    noShow,
    meals,
    mealsExpected,
    mealsDone,
    naps,
    napsExpected,
    napsDone,
    activities,
    withoutReport,
    leftWithoutReport,
    ready,
    draft,
    sent,
  }
}

const firstNames = (rows, max = 3) => {
  const names = rows.map((r) => r.child.name.split(' ')[0])
  return names.length > max ? `${names.slice(0, max).join(', ')} y ${names.length - max} más` : names.join(', ')
}

/** Resumen del día orientado a la acción: qué falta y dónde hacerlo. */
export default function DashboardPage() {
  const { user, canManage } = useAuth()
  const { pushToast } = useToasts()
  const today = todayKey()

  const [rows, setRows] = useState(null)
  const [notices, setNotices] = useState([])
  const [photos, setPhotos] = useState([])
  const [badges, setBadges] = useState({})
  const [loading, setLoading] = useState(true)

  const loadSeq = useRef(0)
  // `silent`: recarga en vivo (sin girar el botón ni mostrar toasts).
  const load = useCallback(async ({ silent = false } = {}) => {
    const seq = ++loadSeq.current
    if (!silent) setLoading(true)
    try {
      const [cl, nt, ph, bd] = await Promise.all([
        api.get('/reports/checklists', { params: { date: today } }),
        api.get('/daily-logs', { params: { pendingNotice: 'true' } }),
        api.get('/photos', { params: { date: today } }).catch(() => ({ data: [] })),
        api.get('/summary/badges').catch(() => ({ data: {} })),
      ])
      if (seq !== loadSeq.current) return
      setRows(cl.data?.children || [])
      setNotices(nt.data || [])
      setPhotos((ph.data || []).slice(0, 8))
      setBadges(bd.data || {})
    } catch (err) {
      if (!silent) pushToast({ type: 'error', message: apiError(err, 'No se pudo cargar el resumen') })
    } finally {
      if (!silent) setLoading(false)
    }
  }, [today, pushToast])

  useLoadEffect(load)
  const quietReload = useCallback(() => load({ silent: true }), [load])
  // Los avisos pendientes pueden ser de otros días: daily_log sin filtro de fecha.
  useLiveReload(quietReload, {
    entities: ['attendance', 'meal', 'daily_log', 'activity', 'report', 'justification', 'photo', 'task'],
  }, { debounceMs: 1000 })

  const d = useMemo(() => (rows ? digest(rows) : null), [rows])
  const rooms = useMemo(() => {
    const map = new Map()
    for (const r of rows || []) {
      const key = r.child.classroomId || 'none'
      if (!map.has(key)) map.set(key, { id: key, name: r.child.classroomName || 'Sin sala', rows: [] })
      map.get(key).rows.push(r)
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [rows])

  const firstName = (user?.name || '').split(' ')[0]
  const scopeLabel = canManage
    ? 'todo el centro'
    : rooms.length === 1
      ? rooms[0].name
      : rooms.length > 1
        ? `tus ${rooms.length} salas`
        : 'tu sala'

  // --- "Lo que falta ahora", en orden de urgencia
  const todo = []
  if (d) {
    if (notices.length)
      todo.push({
        key: 'notices',
        tone: 'rose',
        icon: AlertTriangle,
        title: `${plural(notices.length, 'aviso pendiente', 'avisos pendientes')} de comunicar a la familia`,
        detail: firstNames(notices.map((n) => ({ child: { name: n.child ? n.child.firstName : 'Niño' } }))),
        to: '/panel/bitacora',
        cta: 'Comunicar',
      })
    if (d.leftWithoutReport.length)
      todo.push({
        key: 'left-noreport',
        tone: 'rose',
        icon: MessageCircleHeart,
        title: `${plural(d.leftWithoutReport.length, 'niño ya salió', 'niños ya salieron')} sin reporte del día`,
        kids: d.leftWithoutReport,
        to: '/panel/reportes',
        cta: 'Generar',
      })
    if (d.notArrived.length)
      todo.push({
        key: 'arrivals',
        tone: 'amber',
        icon: ClipboardList,
        title: `${plural(d.notArrived.length, 'niño aún no llega', 'niños aún no llegan')}`,
        kids: d.notArrived,
        to: '/panel/dia',
        cta: 'Marcar llegada',
      })
    for (const [label, kids] of d.meals)
      todo.push({
        key: `meal-${label}`,
        tone: 'amber',
        icon: UtensilsCrossed,
        title: `${plural(kids.length, 'niño', 'niños')} sin ${label.toLowerCase()} registrado`,
        kids,
        to: '/panel/comidas',
        cta: 'Registrar',
      })
    if (d.naps.length)
      todo.push({
        key: 'naps',
        tone: 'violet',
        icon: BedDouble,
        title: `${plural(d.naps.length, 'siesta', 'siestas')} por registrar`,
        kids: d.naps,
        to: '/panel/bitacora',
        cta: 'Registrar',
      })
    for (const [label, kids] of d.activities)
      todo.push({
        key: `act-${label}`,
        tone: 'violet',
        icon: Palmtree,
        title: `${label}: ${plural(kids.length, 'niño', 'niños')} sin anotar participación`,
        kids,
        to: '/panel/actividades',
        cta: 'Anotar',
      })
    if (d.ready.length)
      todo.push({
        key: 'ready',
        tone: 'sky',
        icon: Send,
        title: `${plural(d.ready.length, 'reporte listo', 'reportes listos')} para enviar`,
        kids: d.ready,
        to: '/panel/reportes',
        cta: 'Enviar',
      })
    const pendingGen = d.withoutReport.length - d.leftWithoutReport.length
    if (pendingGen > 0)
      todo.push({
        key: 'gen',
        tone: 'slate',
        icon: MessageCircleHeart,
        title: `${plural(pendingGen, 'reporte', 'reportes')} por generar antes de la salida`,
        detail: 'Se generan con lo registrado durante el día.',
        to: '/panel/reportes',
        cta: 'Ver',
      })
    if (canManage && badges.pendingJustifications)
      todo.push({
        key: 'just',
        tone: 'amber',
        icon: FileWarning,
        title: `${plural(badges.pendingJustifications, 'ausencia', 'ausencias')} por revisar`,
        to: '/panel/justificaciones',
        cta: 'Revisar',
      })
    if (badges.pendingTasks)
      todo.push({
        key: 'tasks',
        tone: 'slate',
        icon: ListTodo,
        title: `${plural(badges.pendingTasks, 'tarea pendiente', 'tareas pendientes')} del equipo`,
        to: '/panel/pendientes',
        cta: 'Ver',
      })
  }

  return (
    <>
      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500 dark:text-white/50">{capitalize(longDate(today))}</p>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            {greeting()}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-sm text-slate-500 dark:text-white/50 mt-0.5">
            Así va el día en <span className="font-medium text-slate-700 dark:text-white/80">{scopeLabel}</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            icon={RefreshCw}
            onClick={load}
            loading={loading}
            aria-label="Actualizar el resumen"
            title="Actualizar"
          />
          <Link
            to="/panel/seguimiento"
            className="inline-flex items-center gap-2 min-h-10 px-4 rounded-lg text-sm font-medium bg-accent text-accent-fg shadow-xs hover:bg-accent-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
          >
            <ListChecks className="w-4 h-4" /> Abrir seguimiento
          </Link>
        </div>
      </div>

      {/* Progreso del día */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        {!d ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className={`h-[110px] rounded-xl ${i === 4 ? 'col-span-2 lg:col-span-1' : ''}`} />)
        ) : (
          <>
            <ProgressTile
              to="/panel/dia"
              icon={Baby}
              label="En el centro"
              value={d.present.length}
              of={d.enrolled}
              tone="green"
              progress={d.attended.length}
              hint={d.left.length ? `${plural(d.left.length, 'ya salió', 'ya salieron')}` : `${d.enrolled} inscritos`}
            />
            <ProgressTile
              to="/panel/dia"
              icon={ClipboardList}
              label="Sin llegar"
              value={d.notArrived.length}
              tone={d.notArrived.length ? 'amber' : 'green'}
              hint={
                d.justified.length || d.noShow.length
                  ? [
                      d.justified.length && `${d.justified.length} justificada${d.justified.length === 1 ? '' : 's'}`,
                      d.noShow.length && `${d.noShow.length} no vino`,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : d.notArrived.length
                    ? 'Esperando llegada'
                    : 'Todos llegaron'
              }
            />
            <ProgressTile
              to="/panel/comidas"
              icon={UtensilsCrossed}
              label="Comidas"
              value={d.mealsDone}
              of={d.mealsExpected}
              progress={d.mealsDone}
              tone="accent"
              hint={
                !d.mealsExpected
                  ? 'Aún no se sirve'
                  : d.mealsExpected === d.mealsDone
                    ? 'Todo registrado'
                    : `${d.mealsExpected - d.mealsDone} sin registrar`
              }
            />
            <ProgressTile
              to="/panel/bitacora"
              icon={BedDouble}
              label="Siestas"
              value={d.napsDone}
              of={d.napsExpected}
              progress={d.napsDone}
              tone="accent"
              hint={
                !d.napsExpected
                  ? 'Sin siestas aún'
                  : d.napsExpected === d.napsDone
                    ? 'Todo registrado'
                    : `${d.napsExpected - d.napsDone} por registrar`
              }
            />
            <ProgressTile
              className="col-span-2 lg:col-span-1"
              to="/panel/reportes"
              icon={MessageCircleHeart}
              label="Reportes enviados"
              value={d.sent.length}
              of={d.attended.length}
              progress={d.sent.length}
              tone="sky"
              hint={
                d.ready.length
                  ? `${d.ready.length} listo${d.ready.length === 1 ? '' : 's'} por enviar`
                  : `${d.withoutReport.length} por generar`
              }
            />
          </>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-5 items-start">
        {/* Lo que falta ahora */}
        <Card className="lg:col-span-2" padded={false}>
          <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Lo que falta ahora</h2>
            {d && todo.length > 0 && <Badge tone="amber">{plural(todo.length, 'pendiente', 'pendientes')}</Badge>}
          </div>
          {!d ? (
            <div className="px-5 pb-5 space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : todo.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="¡Todo al día!"
              message="No hay nada pendiente por registrar en este momento."
            />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-white/5 border-t border-slate-100 dark:border-white/5">
              {todo.map((t) => (
                <TodoRow key={t.key} item={t} />
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-5">
          {/* Accesos rápidos */}
          <Card>
            <SectionTitle>Accesos rápidos</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['/panel/dia', 'Entradas y salidas', ClipboardList],
                ['/panel/comidas', 'Alimentación', UtensilsCrossed],
                ['/panel/bitacora', 'Bitácora', NotebookPen],
                ['/panel/actividades', 'Actividades', Palmtree],
                ['/panel/reportes', 'Reportes', MessageCircleHeart],
                ['/panel/galeria', 'Fotos', Images],
              ].map(([to, label, Icon]) => (
                <Link
                  key={to}
                  to={to}
                  className="flex flex-col items-start gap-2 min-h-[72px] rounded-lg border border-slate-200 dark:border-white/8 px-3 py-2.5 hover:border-slate-300 hover:bg-slate-50 dark:hover:border-white/15 dark:hover:bg-white/4 transition-colors"
                >
                  <Icon className="w-5 h-5 text-accent-text" />
                  <span className="text-sm font-medium text-slate-700 dark:text-white/80 leading-tight">{label}</span>
                </Link>
              ))}
            </div>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT))}
              className="mt-2 w-full flex items-center gap-2 min-h-11 rounded-lg border border-dashed border-slate-300 dark:border-white/15 px-3 text-sm text-slate-500 dark:text-white/50 hover:border-slate-400 hover:text-slate-800 dark:hover:text-white transition"
            >
              <Search className="w-4 h-4" />
              <span className="flex-1 text-left">Buscar un niño…</span>
              <span className="hidden lg:flex gap-1">
                <Kbd>Ctrl</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>
          </Card>

          {/* Avisos para familias */}
          {notices.length > 0 && (
            <Card>
              <SectionTitle hint={`${notices.length} sin comunicar`}>Avisos para familias</SectionTitle>
              <ul className="space-y-2">
                {notices.slice(0, 4).map((n) => (
                  <li key={n.id}>
                    <Link
                      to="/panel/bitacora"
                      className="flex items-start gap-3 rounded-lg border border-amber-200 dark:border-amber-500/20 bg-amber-50/60 dark:bg-amber-500/10 px-3 py-2.5 hover:border-amber-300 transition"
                    >
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-slate-800 dark:text-white truncate">
                          {n.child ? `${n.child.firstName} ${n.child.lastName}` : 'Niño'}
                          <span className="ml-2 text-xs font-normal text-slate-500 dark:text-white/40">
                            {timeOf(n.occurredAt)}
                          </span>
                        </span>
                        <span className="block text-sm text-slate-600 dark:text-white/60 line-clamp-2">
                          {n.notes || 'Sin detalle'}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {/* Por sala: dirección/coordinación o educadoras con varias salas */}
      {d && (canManage || rooms.length > 1) && rooms.length > 0 && (
        <Card className="mt-5" padded={false}>
          <div className="px-5 pt-5 pb-3">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Por sala</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 dark:text-white/45 border-y border-slate-100 dark:border-white/5 bg-slate-50/60 dark:bg-white/2">
                  <th className="px-5 py-2 font-semibold">Sala</th>
                  <th className="px-3 py-2 font-semibold">En el centro</th>
                  <th className="px-3 py-2 font-semibold">Sin llegar</th>
                  <th className="px-3 py-2 font-semibold">Comidas</th>
                  <th className="px-3 py-2 font-semibold">Siestas</th>
                  <th className="px-3 py-2 font-semibold">Reportes enviados</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {rooms.map((room) => {
                  const r = digest(room.rows)
                  return (
                    <tr key={room.id} className="text-slate-700 dark:text-white/80">
                      <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{room.name}</td>
                      <td className="px-3 py-3 tabular-nums">
                        {r.present.length} <span className="text-slate-400 dark:text-white/40">/ {r.enrolled}</span>
                      </td>
                      <td className="px-3 py-3">
                        {r.notArrived.length ? <Badge tone="amber">{r.notArrived.length} sin llegar</Badge> : <Badge tone="green">Completo</Badge>}
                      </td>
                      <td className="px-3 py-3 w-40">
                        <MiniProgress done={r.mealsDone} total={r.mealsExpected} tone="accent" />
                      </td>
                      <td className="px-3 py-3 w-40">
                        <MiniProgress done={r.napsDone} total={r.napsExpected} tone="accent" />
                      </td>
                      <td className="px-3 py-3 w-40">
                        <MiniProgress done={r.sent.length} total={r.attended.length} tone="accent" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Fotos del día (sólo si hay) */}
      {photos.length > 0 && (
        <Card className="mt-5">
          <SectionTitle
            hint={
              <Link to="/panel/galeria" className="font-medium text-accent-text hover:underline">
                Ver galería
              </Link>
            }
          >
            <span className="inline-flex items-center gap-2">
              <Images className="w-4 h-4" /> Fotos de hoy
            </span>
          </SectionTitle>
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
            {photos.map((p) => (
              <div key={p.id} className="relative aspect-square rounded-lg overflow-hidden bg-slate-100 dark:bg-white/5">
                <img src={mediaUrl(p.url)} alt={p.caption || 'Foto del día'} className="w-full h-full object-cover" />
                {!p.shareWithFamily && (
                  <span className="absolute bottom-1 left-1">
                    <Badge tone="slate">Interna</Badge>
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  )
}

function ProgressTile({ to, icon: Icon, label, value, of, progress, tone, hint, className = '' }) {
  const hasTotal = of != null
  return (
    <Link
      to={to}
      className={`group rounded-xl border border-slate-200 dark:border-white/8 bg-white dark:bg-surface p-3 sm:p-4 shadow-xs hover:border-slate-300 dark:hover:border-white/15 transition-colors flex flex-col focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${className}`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500 dark:text-white/50">{label}</span>
        <span className={`w-7 h-7 rounded-md flex items-center justify-center ${TONE[tone] || TONE.slate}`}>
          <Icon className="w-4 h-4" />
        </span>
      </span>
      <span className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-white">
        {value}
        {hasTotal && <span className="text-sm font-medium text-slate-400 dark:text-white/40"> / {of}</span>}
      </span>
      {hasTotal && (
        <ProgressBar
          className="mt-2"
          value={progress ?? value}
          max={of || 1}
          tone={(progress ?? value) >= of && of > 0 ? 'green' : 'accent'}
          label={`${label}: ${progress ?? value} de ${of}`}
        />
      )}
      {hint && <span className="mt-1.5 text-xs text-slate-500 dark:text-white/50 truncate">{hint}</span>}
    </Link>
  )
}

function MiniProgress({ done, total, tone }) {
  if (!total) return <span className="text-xs text-slate-400 dark:text-white/30">—</span>
  return (
    <span className="flex items-center gap-2">
      <ProgressBar value={done} max={total} tone={done === total ? 'green' : tone} className="flex-1" label={`${done} de ${total}`} />
      <span className="text-xs tabular-nums text-slate-500 dark:text-white/50 w-10 text-right">
        {done}/{total}
      </span>
    </span>
  )
}

function TodoRow({ item }) {
  const Icon = item.icon
  const kids = item.kids || []
  return (
    <li>
      <Link
        to={item.to}
        className="flex items-center gap-3 px-5 py-3 min-h-16 hover:bg-slate-50 dark:hover:bg-white/3 transition focus:outline-none focus-visible:bg-slate-50 dark:focus-visible:bg-white/5"
      >
        <span className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${TONE[item.tone] || TONE.slate}`}>
          <Icon className="w-[18px] h-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-slate-800 dark:text-white">{item.title}</span>
          {(kids.length > 0 || item.detail) && (
            <span className="mt-0.5 flex items-center gap-2 min-w-0">
              {kids.length > 0 && (
                <span className="hidden sm:flex -space-x-2 shrink-0">
                  {kids.slice(0, 4).map((k) => (
                    <span key={k.child.id} className="rounded-full ring-2 ring-white dark:ring-elevated">
                      <Avatar src={k.child.photoUrl} name={k.child.name} size="xs" />
                    </span>
                  ))}
                </span>
              )}
              <span className="text-xs text-slate-500 dark:text-white/50 truncate">
                {item.detail || firstNames(kids)}
              </span>
            </span>
          )}
        </span>
        <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-accent-text">
          <span className="hidden sm:inline">{item.cta}</span>
          <ChevronRight className="w-4 h-4" />
        </span>
      </Link>
    </li>
  )
}
