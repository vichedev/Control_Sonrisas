import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Baby,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  HeartPulse,
  History,
  Images,
  LogIn,
  LogOut,
  MessageCircleHeart,
  Moon,
  NotebookPen,
  Palette,
  RefreshCw,
  Sun,
  Utensils,
} from '../../components/icons'
import { addDays, api, apiError, longDate, timeOf, todayKey } from '../../api/client'
import { useLoadEffect } from '../../api/useLoadEffect'
import { useLiveReload, useRealtimeStatus } from '../../realtime'
import { useToasts } from '../../context/ToastsContext'
import { CHECK_STATUS, ChecklistSummary, ProgressRing } from '../../components/DayChecklist'
import { Avatar, Badge, Card, EmptyState, Loading, TONES as UI_TONES } from '../../components/ui'
import FamilyPhotoGrid from '../../components/photos/FamilyPhotoGrid'
import FamilyChildGallery from '../../components/photos/FamilyChildGallery'

const REFRESH_MS = 60_000

const TABS = [
  ['dia', 'Su día', Sun],
  ['fotos', 'Fotos', Images],
  ['historial', 'Historial', CalendarDays],
  ['reportes', 'Reportes', FileText],
]


/** Secciones del día (el estado de asistencia va arriba, en la cabecera del día). */
const AREAS = [
  { group: 'meals', title: 'Alimentación', icon: Utensils, tone: 'amber' },
  { group: 'rest', title: 'Descanso', icon: Moon, tone: 'accent' },
  { group: 'activities', title: 'Actividades', icon: Palette, tone: 'sky' },
  { group: 'care', title: 'Cuidado e higiene', icon: Baby, tone: 'green' },
  { group: 'health', title: 'Salud y avisos', icon: HeartPulse, tone: 'red' },
]

/** "Hoy", "Ayer" o el día de la semana con mayúscula. */
function dayTitle(date) {
  const today = todayKey()
  if (date === today) return 'Hoy'
  if (date === addDays(today, -1)) return 'Ayer'
  const s = longDate(date).split(',')[0]
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function dayLongNoWeekday(date) {
  const parts = longDate(date).split(', ')
  return parts.slice(1).join(', ') || longDate(date)
}

// =================================================================== página

/** Seguimiento de un niño para su familia, organizado por días. */
export default function FamilyChildPage() {
  const { childId } = useParams()
  const { pushToast } = useToasts()
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(([t]) => t === params.get('vista')) ? params.get('vista') : 'dia'
  const today = todayKey()
  const rawDate = params.get('fecha')
  const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && rawDate <= today ? rawDate : today

  const [profile, setProfile] = useState(null)
  const [loadingProfile, setLoadingProfile] = useState(true)

  const loadProfile = useCallback(async () => {
    setLoadingProfile(true)
    try {
      const p = await api.get(`/family/children/${childId}`)
      setProfile(p.data)
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo cargar la ficha') })
    } finally {
      setLoadingProfile(false)
    }
  }, [childId, pushToast])
  useLoadEffect(loadProfile)
  // Ficha (foto, sala, alergias) en vivo; el spinner sólo sale si aún no hay ficha.
  useLiveReload(loadProfile, { entities: ['child'], childId })

  const go = (next) => {
    const p = new URLSearchParams(params)
    Object.entries(next).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)))
    setParams(p, { replace: true })
  }
  const openDay = (d) => go({ vista: 'dia', fecha: d === today ? null : d })

  if (loadingProfile && !profile) return <Loading />
  if (!profile) return <EmptyState icon={Baby} title="No encontrado" />

  return (
    <>
      <Link
        to="/familia"
        className="inline-flex items-center gap-1 min-h-9 text-sm font-medium text-slate-500 dark:text-white/50 hover:text-slate-900 dark:hover:text-white mb-2"
      >
        <ArrowLeft className="w-4 h-4" /> Mis niños
      </Link>

      {/* Cabecera del niño */}
      <Card className="flex items-center gap-4 mb-4">
        <Avatar src={profile.photoUrl} name={profile.fullName} size="lg" />
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900 dark:text-white truncate">
            {profile.fullName}
          </h1>
          <p className="text-sm text-slate-500 dark:text-white/50">
            {[profile.classroomName, profile.age].filter(Boolean).join(' · ')}
          </p>
          {profile.allergies && (
            <Badge tone="red" className="mt-1.5 whitespace-normal">
              <HeartPulse className="w-3.5 h-3.5" /> Alergias: {profile.allergies}
            </Badge>
          )}
        </div>
      </Card>

      {/* Pestañas */}
      <div className="grid grid-cols-4 gap-0.5 p-0.5 mb-4 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200/70 dark:border-white/8" role="tablist">
        {TABS.map(([value, label, Icon]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => go({ vista: value === 'dia' ? null : value })}
            className={`inline-flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 px-1 sm:px-2 min-h-11 sm:min-h-10 rounded-md text-xs sm:text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${
              tab === value
                ? 'bg-white dark:bg-white/12 text-slate-900 dark:text-white shadow-xs ring-1 ring-slate-900/5 dark:ring-white/5'
                : 'text-slate-600 dark:text-white/55 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'dia' && <DayView childId={childId} date={date} onDate={openDay} childName={profile.firstName || profile.fullName} />}
      {tab === 'fotos' && <FamilyChildGallery childId={childId} childName={profile.firstName || profile.fullName} />}
      {tab === 'historial' && <HistoryView childId={childId} onPickDay={openDay} />}
      {tab === 'reportes' && <ReportsView childId={childId} onPickDay={openDay} />}
    </>
  )
}

// =================================================================== día

function DayView({ childId, date, onDate, childName }) {
  const [day, setDay] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const today = todayKey()
  const isToday = date === today

  const fetchDay = useCallback(
    () => api.get(`/family/children/${childId}/day`, { params: { date } }),
    [childId, date],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchDay()
      setDay(res.data)
      setUpdatedAt(new Date())
    } catch (err) {
      setDay(null)
      setError(apiError(err, 'No se pudo cargar el día'))
    } finally {
      setLoading(false)
    }
  }, [fetchDay])
  useLoadEffect(load)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetchDay()
      setDay(res.data)
      setUpdatedAt(new Date())
    } catch {
      // Un fallo puntual se reintenta en el siguiente ciclo.
    } finally {
      setRefreshing(false)
    }
  }, [fetchDay])

  const checklist = day?.checklist
  const live = isToday && !!day && !checklist?.dayClosed && !day?.report

  // En vivo: cualquier registro de este niño en este día refresca la vista, sin parpadeo.
  const realtimeOn = useRealtimeStatus() === 'live'
  useLiveReload(refresh, { childId, date })

  // Respaldo sin tiempo real: mientras la jornada sigue abierta se sondea cada minuto.
  useEffect(() => {
    if (!live || realtimeOn) return
    const timer = setInterval(() => !document.hidden && refresh(), REFRESH_MS)
    const onVisible = () => !document.hidden && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [live, realtimeOn, refresh])

  return (
    <div className="space-y-4">
      <DayNavigator date={date} onDate={onDate} />

      {loading ? (
        <Card><Loading /></Card>
      ) : error ? (
        <Card><EmptyState icon={CalendarDays} title={error} /></Card>
      ) : (
        <>
          <DayHero day={day} isToday={isToday} live={live} refreshing={refreshing} updatedAt={updatedAt} onRefresh={refresh} />

          <DayPhotos photos={day?.photos} childName={childName} date={date} isToday={isToday} />

          {checklist?.childPresent ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 items-start">
                {AREAS.map((area) => (
                  <AreaCard key={area.group} area={area} day={day} />
                ))}
              </div>
              <TeacherNotes day={day} />
            </>
          ) : null}

          <ReportCard day={day} isToday={isToday} />
        </>
      )}
    </div>
  )
}

/** Navegación entre días: anterior / siguiente, ir a hoy y calendario. */
function DayNavigator({ date, onDate }) {
  const today = todayKey()
  const isToday = date === today
  const btn =
    'w-11 h-11 shrink-0 grid place-items-center rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 shadow-xs text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition'
  return (
    <div className="flex items-center gap-2">
      <button className={btn} onClick={() => onDate(addDays(date, -1))} aria-label="Día anterior">
        <ChevronLeft className="w-5 h-5" />
      </button>
      <label className="relative flex-1 min-w-0 cursor-pointer rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 shadow-xs px-4 py-1.5 text-center hover:bg-slate-50 dark:hover:bg-white/10 transition">
        <span className="block text-base font-semibold text-slate-900 dark:text-white leading-tight">
          {dayTitle(date)}
        </span>
        <span className="block text-xs text-slate-500 dark:text-white/50 truncate">{dayLongNoWeekday(date)}</span>
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => e.target.value && onDate(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer"
          aria-label="Elegir día"
        />
      </label>
      <button className={btn} onClick={() => onDate(addDays(date, 1))} disabled={isToday} aria-label="Día siguiente">
        <ChevronRight className="w-5 h-5" />
      </button>
      {!isToday && (
        <button
          onClick={() => onDate(today)}
          className="h-11 px-3.5 shrink-0 rounded-lg text-sm font-medium bg-accent text-accent-fg hover:bg-accent-hover shadow-xs"
        >
          Hoy
        </button>
      )}
    </div>
  )
}

/** Resumen del día: dónde está, progreso y horas de llegada/salida. */
function DayHero({ day, isToday, live, refreshing, updatedAt, onRefresh }) {
  const c = day?.checklist
  const attendance = c?.items?.find((i) => i.key === 'attendance')
  const present = !!c?.childPresent

  let title
  let subtitle = ''
  let tone = 'slate'
  if (present && !day?.departure && isToday) {
    title = 'Está en la guardería'
    tone = 'emerald'
  } else if (present && day?.departure) {
    title = 'Jornada completada'
    tone = 'sky'
  } else if (present) {
    title = 'Asistió'
    tone = 'sky'
  } else if (attendance?.status === 'info') {
    title = attendance.detail?.startsWith('Centro cerrado') ? 'Centro cerrado' : 'Ausencia justificada'
    subtitle = attendance.detail || ''
  } else if (attendance?.status === 'not_done') {
    title = 'No asistió'
    tone = 'red'
  } else {
    title = 'Aún no llega'
    subtitle = 'Aquí verás su día en cuanto registren su llegada.'
  }

  const TONES = {
    emerald: 'text-emerald-700 dark:text-emerald-400',
    sky: 'text-sky-700 dark:text-sky-400',
    red: 'text-red-600 dark:text-red-400',
    slate: 'text-slate-700 dark:text-white/80',
  }

  return (
    <Card>
      <div className="flex items-center gap-5">
        {present ? (
          <ProgressRing summary={c?.summary} />
        ) : (
          <div className="w-[88px] h-[88px] shrink-0 rounded-full grid place-items-center border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
            <Clock className="w-8 h-8 text-slate-400 dark:text-white/30" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {live && present && (
              <span className="relative flex w-2.5 h-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-emerald-500" />
              </span>
            )}
            <h2 className={`text-lg font-semibold tracking-tight ${TONES[tone]}`}>{title}</h2>
          </div>
          {subtitle && <p className="text-sm text-slate-500 dark:text-white/50 mt-0.5">{subtitle}</p>}

          {present && (
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              {day?.arrival && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2 py-1 text-[13px] font-medium tabular-nums">
                  <LogIn className="w-4 h-4" /> Llegó {timeOf(day.arrival.createdAt)}
                </span>
              )}
              {day?.departure && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 px-2 py-1 text-[13px] font-medium tabular-nums">
                  <LogOut className="w-4 h-4" /> Salió {timeOf(day.departure.createdAt)}
                  {day.departure.personName ? ` · ${day.departure.personName}` : ''}
                </span>
              )}
            </div>
          )}
          {present && c?.summary && <ChecklistSummary summary={c.summary} className="mt-2 text-xs" />}
        </div>
      </div>

      {live && (
        <button
          onClick={onRefresh}
          className="mt-4 w-full inline-flex items-center justify-center gap-1.5 text-xs text-slate-400 dark:text-white/30 hover:text-slate-600 dark:hover:text-white/60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Se actualiza solo{updatedAt ? ` · última vez ${timeOf(updatedAt.toISOString())}` : ''}
        </button>
      )}
    </Card>
  )
}

/** Una sección del día (comidas, siesta…) con su estado y los detalles registrados. */
function AreaCard({ area, day }) {
  const items = (day?.checklist?.items || []).filter((i) => i.group === area.group)
  if (!items.length) return null
  const Icon = area.icon

  const extraFor = (item) => {
    if (item.key?.startsWith('meal:')) {
      const m = (day.meals || []).find((x) => `meal:${x.type}` === item.key)
      return [m?.menu, m?.notes].filter(Boolean).join(' · ')
    }
    if (item.key === 'nap') return (day.naps || []).map((n) => n.notes).filter(Boolean).join(' · ')
    if (item.key?.startsWith('activity:')) {
      const a = (day.activities || []).find((x) => x.title === item.label)
      // El detalle del checklist ya dice cómo participó; aquí sólo la nota de la maestra.
      return a?.note || ''
    }
    return ''
  }

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-2">
        <span className={`w-8 h-8 rounded-md grid place-items-center ${(UI_TONES[area.tone] || UI_TONES.slate).icon}`}>
          <Icon className="w-4 h-4" />
        </span>
        <h3 className="font-semibold text-slate-900 dark:text-white">{area.title}</h3>
      </div>
      <ul className="px-4 pb-3 divide-y divide-slate-100 dark:divide-white/5">
        {items.map((item) => {
          const cfg = CHECK_STATUS[item.status] || CHECK_STATUS.not_recorded
          const StatusIcon = cfg.icon
          const extra = extraFor(item)
          return (
            <li key={item.key} className="flex items-start gap-3 py-2.5">
              <StatusIcon className={`w-5 h-5 shrink-0 mt-0.5 ${cfg.iconColor}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-medium text-slate-800 dark:text-white">{item.label}</p>
                  <span className={`shrink-0 text-[11px] font-medium px-1.5 py-0.5 rounded-md ${cfg.chip}`}>{cfg.label}</span>
                </div>
                {item.detail && <p className="text-sm text-slate-600 dark:text-white/60">{item.detail}</p>}
                {extra && <p className="text-xs text-slate-400 dark:text-white/40 mt-0.5">{extra}</p>}
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/** Observaciones de la educadora que no están ya en el resumen (notas, ánimo…). */
function TeacherNotes({ day }) {
  const notes = (day?.logs || []).filter(
    (l) => l.notes && !l.notifyGuardian && !['hygiene', 'diaper', 'bathroom'].includes(l.kind),
  )
  if (!notes.length) return null
  return (
    <Card>
      <div className="flex items-center gap-2 mb-2">
        <NotebookPen className="w-5 h-5 text-slate-400 dark:text-white/40" />
        <h3 className="font-semibold text-slate-900 dark:text-white">Notas de la maestra</h3>
      </div>
      <ul className="space-y-2">
        {notes.map((l, i) => (
          <li key={i} className="text-sm text-slate-700 dark:text-white/70">
            <span className="text-xs font-medium tabular-nums text-slate-400 dark:text-white/40 mr-2">{l.time}</span>
            {l.notes}
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** Galería del día: las fotos en las que sale el niño, por hora. */
function DayPhotos({ photos, childName, date, isToday }) {
  if (!photos?.length) return null
  const name = (childName || '').split(' ')[0]
  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
            <Images className="w-5 h-5 text-slate-400 dark:text-white/40" />
            Fotos del día
          </h3>
          <p className="text-xs text-slate-500 dark:text-white/45 mt-0.5 tabular-nums">
            {photos.length} {photos.length === 1 ? 'foto' : 'fotos'}
            {name ? ` de ${name}` : ''} {isToday ? 'hoy' : `del ${dayLongNoWeekday(date)}`} · toca una para verla en grande
          </p>
        </div>
      </div>
      <FamilyPhotoGrid photos={photos} downloadName={name ? name.toLowerCase() : 'foto'} />
    </Card>
  )
}

/** Reporte de cierre del día. */
function ReportCard({ day, isToday }) {
  if (day?.report) {
    return (
      <Card className="border-l-4 border-l-emerald-500 dark:border-l-emerald-500">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-8 h-8 rounded-md grid place-items-center bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
            <MessageCircleHeart className="w-4 h-4" />
          </span>
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-white">Reporte del día</h3>
            {day.report.sentAt && (
              <p className="text-xs text-slate-500 dark:text-white/50">
                Enviado a las {timeOf(day.report.sentAt)}
              </p>
            )}
          </div>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-white/80">
          {day.report.messageText}
        </p>
      </Card>
    )
  }
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-300 dark:border-white/10 px-4 py-4 text-sm text-slate-500 dark:text-white/50">
      <FileText className="w-5 h-5 shrink-0" />
      {isToday
        ? 'El reporte del día llegará al cierre de la jornada.'
        : 'No hay reporte enviado para este día.'}
    </div>
  )
}

// =================================================================== historial

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const WEEKDAYS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do']
const pad = (n) => String(n).padStart(2, '0')

/** Calendario del mes: qué días asistió y en cuáles hay reporte. */
function HistoryView({ childId, onPickDay }) {
  const { pushToast } = useToasts()
  const today = todayKey()
  const [ym, setYm] = useState(() => today.slice(0, 7))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const [y, m] = ym.split('-').map(Number)
  const from = `${ym}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const monthEnd = `${ym}-${pad(lastDay)}`
  const to = monthEnd > today ? today : monthEnd

  // `silent`: recarga en vivo sin spinner ni toasts.
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    try {
      const [att, hist, reps] = await Promise.all([
        api.get(`/family/children/${childId}/attendance`, { params: { from, to } }),
        api.get(`/family/children/${childId}/history`, { params: { from, to } }),
        api.get(`/family/children/${childId}/reports`),
      ])
      setData({ attendance: att.data || [], history: hist.data, reports: reps.data || [] })
    } catch (err) {
      if (silent) return // se conserva lo que ya se ve
      setData(null)
      pushToast({ type: 'error', message: apiError(err, 'No se pudo cargar el historial') })
    } finally {
      if (!silent) setLoading(false)
    }
  }, [childId, from, to, pushToast])
  useLoadEffect(load)
  const quietReload = useCallback(() => load({ silent: true }), [load])
  useLiveReload(quietReload, { entities: ['attendance', 'report', 'meal', 'daily_log', 'justification'], childId }, { debounceMs: 1500 })

  const stats = useMemo(() => {
    const attended = new Set((data?.attendance || []).filter((r) => r?.type === 'in').map((r) => String(r.date).slice(0, 10)))
    const reported = new Set((data?.reports || []).map((r) => String(r.date).slice(0, 10)))
    const naps = (data?.history?.logs || []).filter((l) => l.kind === 'nap' && Number(l.durationMinutes) > 0)
    const napAvg = naps.length ? Math.round(naps.reduce((s, l) => s + Number(l.durationMinutes), 0) / naps.length) : 0
    return { attended, reported, napAvg, mealPct: data?.history?.mealSummary?.total ? data.history.mealSummary.ateWellPct : null }
  }, [data])

  const startOffset = (new Date(y, m - 1, 1).getDay() + 6) % 7
  const cells = [...Array(startOffset).fill(null), ...Array.from({ length: lastDay }, (_, i) => `${ym}-${pad(i + 1)}`)]
  const shiftMonth = (delta) => {
    const d = new Date(y, m - 1 + delta, 1)
    setYm(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`)
  }
  const isCurrentMonth = ym === today.slice(0, 7)

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between max-w-lg mx-auto mb-4">
          <button onClick={() => shiftMonth(-1)} className="p-2.5 rounded-lg text-slate-600 dark:text-white/70 hover:bg-slate-100 dark:hover:bg-white/10" aria-label="Mes anterior">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-base font-semibold capitalize text-slate-900 dark:text-white">
            {MONTHS[m - 1]} {y}
          </h2>
          <button onClick={() => shiftMonth(1)} disabled={isCurrentMonth}
            className="p-2.5 rounded-lg text-slate-600 dark:text-white/70 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-30" aria-label="Mes siguiente">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <Loading />
        ) : (
          <div className="max-w-lg mx-auto">
            <div className="grid grid-cols-7 gap-1 text-center mb-1">
              {WEEKDAYS.map((w) => (
                <span key={w} className="text-[11px] font-medium text-slate-400 dark:text-white/35 py-1">{w}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((d, i) => {
                if (!d) return <span key={`e${i}`} />
                const future = d > today
                const went = stats.attended.has(d)
                const rep = stats.reported.has(d)
                return (
                  <button
                    key={d}
                    disabled={future}
                    onClick={() => onPickDay(d)}
                    className={`relative aspect-square rounded-lg text-sm font-medium tabular-nums transition disabled:opacity-25 disabled:cursor-default ${
                      went
                        ? 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-600/20 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-400/25'
                        : 'bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10'
                    } ${d === today ? 'outline-2 outline-offset-2 outline-accent' : ''}`}
                    aria-label={`${longDate(d)}${went ? ', asistió' : ''}${rep ? ', con reporte' : ''}`}
                  >
                    {Number(d.slice(8))}
                    {rep && <span className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${went ? 'bg-emerald-600 dark:bg-emerald-300' : 'bg-emerald-500'}`} />}
                  </button>
                )
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-white/50">
              <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-50 ring-1 ring-inset ring-emerald-600/30 dark:bg-emerald-500/15" /> Asistió</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Con reporte</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded outline-2 outline-accent" /> Hoy</span>
              <span>Toca un día para verlo completo.</span>
            </div>
          </div>
        )}
      </Card>

      {!loading && data && (
        <div className="grid grid-cols-3 gap-3">
          <StatBox icon={CalendarDays} value={stats.attended.size} label="días asistió" tone="green" />
          <StatBox icon={Utensils} value={stats.mealPct === null ? '—' : `${stats.mealPct}%`} label="comidas bien" tone="amber" />
          <StatBox icon={Moon} value={stats.napAvg ? `${stats.napAvg}′` : '—'} label="siesta media" tone="accent" />
        </div>
      )}
    </div>
  )
}

function StatBox({ icon: Icon, value, label, tone }) {
  return (
    <Card padded={false} className="p-3 sm:p-4">
      <span className={`w-7 h-7 rounded-md flex items-center justify-center ${(UI_TONES[tone] || UI_TONES.slate).icon}`}>
        <Icon className="w-4 h-4" />
      </span>
      <p className="mt-2 text-xl sm:text-2xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-white">{value}</p>
      <p className="text-xs text-slate-500 dark:text-white/50">{label}</p>
    </Card>
  )
}

// =================================================================== reportes

function ReportsView({ childId, onPickDay }) {
  const { pushToast } = useToasts()
  const [reports, setReports] = useState(null)
  const [open, setOpen] = useState(null)

  const load = useCallback(async ({ silent = false } = {}) => {
    try {
      const res = await api.get(`/family/children/${childId}/reports`)
      const list = res.data || []
      setReports(list)
      // En vivo se respeta el reporte que la familia tiene abierto.
      setOpen((prev) => (silent && (prev === null || list.some((r) => r.id === prev)) ? prev : list[0]?.id || null))
    } catch (err) {
      if (silent) return
      setReports([])
      pushToast({ type: 'error', message: apiError(err, 'No se pudieron cargar los reportes') })
    }
  }, [childId, pushToast])
  useLoadEffect(load)
  const quietReload = useCallback(() => load({ silent: true }), [load])
  useLiveReload(quietReload, { entities: ['report'], childId })

  if (!reports) return <Card><Loading /></Card>
  if (!reports.length) {
    return (
      <Card>
        <EmptyState icon={History} title="Aún no hay reportes"
          message="Cada día, al cierre de la jornada, aquí quedará guardado el reporte de su día." />
      </Card>
    )
  }

  return (
    <ul className="space-y-3">
      {reports.map((r) => {
        const isOpen = open === r.id
        return (
          <li key={r.id}>
            <Card padded={false} className="overflow-hidden">
              <button
                onClick={() => setOpen(isOpen ? null : r.id)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-white/5"
                aria-expanded={isOpen}
              >
                <span className="w-11 h-11 shrink-0 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-slate-700 dark:text-white/80 grid place-items-center leading-none">
                  <span className="text-center">
                    <span className="block text-base font-semibold tabular-nums">{Number(String(r.date).slice(8, 10))}</span>
                    <span className="block text-[9px] font-medium uppercase text-slate-500 dark:text-white/45">{MONTHS[Number(String(r.date).slice(5, 7)) - 1]?.slice(0, 3)}</span>
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900 dark:text-white truncate">{dayTitle(String(r.date).slice(0, 10))}, {dayLongNoWeekday(String(r.date).slice(0, 10))}</p>
                  {r.summary ? (
                    <ChecklistSummary summary={r.summary} className="text-xs" />
                  ) : (
                    <p className="text-xs text-slate-500 dark:text-white/50">Enviado {r.sentAt ? `a las ${timeOf(r.sentAt)}` : ''}</p>
                  )}
                </div>
                <ChevronRight className={`w-5 h-5 text-slate-400 transition ${isOpen ? 'rotate-90' : ''}`} />
              </button>
              {isOpen && (
                <div className="px-4 pb-4 border-t border-slate-100 dark:border-white/5">
                  <p className="pt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-white/80">
                    {r.messageText}
                  </p>
                  <button
                    onClick={() => onPickDay(String(r.date).slice(0, 10))}
                    className="mt-3 inline-flex items-center gap-1.5 min-h-9 text-sm font-medium text-accent-text hover:underline"
                  >
                    Ver el día completo <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </Card>
          </li>
        )
      })}
    </ul>
  )
}
