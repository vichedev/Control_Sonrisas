import { useCallback, useEffect, useState } from 'react'
import {
  CalendarClock,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  Coffee,
  LogIn,
  LogOut,
  Undo2,
} from '../components/icons'
import { addDays, api, apiError, longDate, shortDate, timeOf, todayKey } from '../api/client'
import { useLoadEffect } from '../api/useLoadEffect'
import { useLiveReload } from '../realtime'
import { useToasts } from '../context/ToastsContext'
import PhotoCapture from '../components/PhotoCapture'
import { Badge, Card, EmptyState, Loading, PageHeader, SectionTitle } from '../components/ui'

const ORDER = ['in', 'lunch_out', 'lunch_in', 'out']

const TYPES = {
  in: { label: 'Entrada', action: 'Marcar entrada', icon: LogIn, tone: 'green' },
  lunch_out: { label: 'Salida a almuerzo', action: 'Salir a almorzar', icon: Coffee, tone: 'amber' },
  lunch_in: { label: 'Vuelta del almuerzo', action: 'Marcar vuelta del almuerzo', icon: Undo2, tone: 'amber' },
  out: { label: 'Salida', action: 'Marcar salida', icon: LogOut, tone: 'sky' },
}

/** Estado actual en palabras, según el siguiente marcaje esperado. */
const STATE_TEXT = {
  in: 'Aún no marcas tu entrada',
  lunch_out: 'En jornada',
  lunch_in: 'En almuerzo',
  out: 'En jornada',
}

const SCHEDULE_LABEL = {
  on_time: ['A tiempo', 'green'],
  late: ['Tardanza', 'amber'],
  absent_threshold: ['Fuera de límite', 'rose'],
  overtime: ['Hora extra', 'violet'],
  early_leave: ['Salida anticipada', 'amber'],
  rest_day: ['Día de descanso', 'slate'],
  holiday: ['Feriado', 'slate'],
}

/** Hora actual que se refresca cada 30 s (para el botón "Marcar … · 08:01"). */
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** Marcaje propio del personal, sin reconocimiento facial: la foto es opcional. */
export default function MyAttendancePage() {
  const { pushToast } = useToasts()
  const now = useNow()
  const [today, setToday] = useState(null)
  const [history, setHistory] = useState([])
  const [photo, setPhoto] = useState('')
  const [showPhoto, setShowPhoto] = useState(false)
  const [showOther, setShowOther] = useState(false)
  const [loading, setLoading] = useState(true)
  const [marking, setMarking] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [t, h] = await Promise.all([
        api.get('/attendance/staff/me'),
        api.get('/attendance/staff/me/history', {
          params: { from: addDays(todayKey(), -30), to: todayKey() },
        }),
      ])
      setToday(t.data)
      setHistory(h.data || [])
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo cargar tu asistencia') })
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  useLoadEffect(load)
  // En vivo (el spinner sólo sale sin datos: recargar no parpadea).
  useLiveReload(load, { entities: ['staff_attendance'] })

  const mark = async (type) => {
    setMarking(type)
    try {
      const res = await api.post('/attendance/staff/mark', {
        type,
        photo: photo || undefined,
      })
      pushToast({
        type: 'success',
        message: `${TYPES[res.data.type]?.label || 'Marcaje'} registrada — ${res.data.scheduleNote || timeOf(res.data.createdAt)}`,
      })
      setPhoto('')
      setShowPhoto(false)
      setShowOther(false)
      load()
    } catch (err) {
      // El backend valida el orden (entrada → almuerzo → vuelta → salida) y explica el error.
      pushToast({ type: 'error', message: apiError(err, 'No se pudo marcar') })
      if (err?.response?.status === 400) load()
    } finally {
      setMarking(null)
    }
  }

  if (loading && !today) return <Loading />

  // `nextType: null` = ya se marcó la salida: la jornada de hoy está cerrada.
  const completed = !!today && today.nextType === null
  const next = today?.nextType || 'in'
  const NextIcon = TYPES[next]?.icon || LogIn
  const done = today?.marks || []
  const lastOf = (type) => [...done].reverse().find((m) => m.type === type)
  const sinceMark = done[done.length - 1]
  const nowText = now.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })

  // Agrupa el historial por día para que se lea como un calendario, no como un log.
  const byDay = history.reduce((acc, m) => {
    ;(acc[m.date] = acc[m.date] || []).push(m)
    return acc
  }, {})

  return (
    <>
      <PageHeader title="Mi asistencia" subtitle={longDate(todayKey())} icon={CalendarClock} />

      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-4">
          {/* Acción principal: un solo botón grande con la siguiente acción */}
          <Card className={completed ? 'border-emerald-200! dark:border-emerald-500/25!' : ''}>
            {completed ? (
              <div className="flex items-center gap-4 py-2">
                <span className="w-16 h-16 shrink-0 rounded-xl bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 inline-flex items-center justify-center">
                  <CheckCircle2 className="w-9 h-9" />
                </span>
                <div>
                  <p className="text-xl font-semibold text-emerald-700 dark:text-emerald-300">Jornada completada</p>
                  <p className="text-sm text-slate-600 dark:text-white/60">
                    Entrada {lastOf('in') ? timeOf(lastOf('in').createdAt) : '—'} · Salida{' '}
                    {lastOf('out') ? timeOf(lastOf('out').createdAt) : '—'}. ¡Buen descanso!
                  </p>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm font-semibold text-slate-500 dark:text-white/50">
                  {STATE_TEXT[next]}
                  {sinceMark && next !== 'in' ? ` desde las ${timeOf(sinceMark.createdAt)}` : ''}
                </p>
                <button
                  type="button"
                  onClick={() => mark(next)}
                  disabled={!!marking}
                  className={`mt-3 w-full min-h-16 rounded-xl px-5 flex items-center justify-center gap-3 text-lg font-semibold shadow-xs transition-colors active:scale-[0.99] disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-2 ${
                    next === 'out'
                      ? 'bg-accent text-accent-fg hover:bg-accent-hover'
                      : next === 'in'
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                        : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                  }`}
                >
                  {marking === next ? (
                    <span className="w-6 h-6 border-[3px] border-current/40 border-t-current rounded-full animate-spin" />
                  ) : (
                    <NextIcon className="w-6 h-6" />
                  )}
                  <span>
                    {TYPES[next]?.action}
                    <span className="font-semibold opacity-80"> · {nowText}</span>
                  </span>
                </button>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPhoto((v) => !v)}
                    aria-expanded={showPhoto}
                    className={`inline-flex items-center gap-1.5 min-h-10 px-3 rounded-lg text-xs font-semibold border transition ${
                      photo
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                        : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/5'
                    }`}
                  >
                    {photo ? <Check className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
                    {photo ? 'Foto lista' : 'Añadir foto (opcional)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowOther((v) => !v)}
                    aria-expanded={showOther}
                    className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-lg text-xs font-semibold text-slate-500 dark:text-white/50 hover:bg-slate-50 dark:hover:bg-white/5"
                  >
                    Otro marcaje
                    <ChevronDown className={`w-4 h-4 transition-transform ${showOther ? 'rotate-180' : ''}`} />
                  </button>
                </div>

                {showPhoto && (
                  <div className="mt-3 max-w-xs">
                    <PhotoCapture value={photo} onChange={setPhoto} label="Foto (opcional)" compact />
                  </div>
                )}

                {showOther && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {ORDER.filter((k) => k !== next).map((key) => {
                      const t = TYPES[key]
                      const Icon = t.icon
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => mark(key)}
                          disabled={!!marking}
                          className="inline-flex items-center gap-2 min-h-12 px-3 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm font-semibold text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-50"
                        >
                          <Icon className="w-4 h-4 shrink-0 text-slate-400" />
                          {t.label}
                        </button>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </Card>

          {/* Línea del día: los cuatro marcajes y cuáles faltan */}
          <Card>
            <SectionTitle>Hoy</SectionTitle>
            <ol className="relative">
              {ORDER.map((key, i) => {
                const t = TYPES[key]
                const m = lastOf(key)
                const isNext = !completed && key === next
                const sched = m && SCHEDULE_LABEL[m.scheduleStatus]
                const Icon = t.icon
                return (
                  <li key={key} className="flex items-start gap-3 pb-4 last:pb-0 relative">
                    {i < ORDER.length - 1 && (
                      <span
                        className={`absolute left-4.5 top-9 bottom-0 w-0.5 ${m ? 'bg-emerald-200 dark:bg-emerald-500/30' : 'bg-slate-200 dark:bg-white/10'}`}
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={`relative z-1 w-9 h-9 shrink-0 rounded-full inline-flex items-center justify-center ${
                        m
                          ? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-300'
                          : isNext
                            ? 'bg-accent-soft text-accent-text ring-2 ring-accent'
                            : 'bg-slate-100 text-slate-400 dark:bg-white/10 dark:text-white/35'
                      }`}
                    >
                      {m ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                    </span>
                    <div className="flex-1 min-w-0 pt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={`text-sm font-semibold ${m ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-white/50'}`}>
                        {t.label}
                      </span>
                      {m ? (
                        <span className="text-sm tabular-nums text-slate-600 dark:text-white/65">{timeOf(m.createdAt)}</span>
                      ) : (
                        <span className="text-xs text-slate-400 dark:text-white/35">{isNext ? 'Siguiente' : 'Pendiente'}</span>
                      )}
                      {sched && <Badge tone={sched[1]}>{sched[0]}</Badge>}
                    </div>
                  </li>
                )
              })}
            </ol>
          </Card>
        </div>

        <Card>
          <SectionTitle hint="Últimos 30 días">Historial</SectionTitle>
          {Object.keys(byDay).length === 0 ? (
            <EmptyState icon={CalendarClock} title="Sin marcajes" />
          ) : (
            <ul className="space-y-2 lg:max-h-[520px] lg:overflow-y-auto">
              {Object.entries(byDay).map(([day, marks]) => {
                const late = marks.some((m) => m.scheduleStatus === 'late')
                return (
                  <li key={day} className="rounded-lg border border-slate-200 dark:border-white/10 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-800 dark:text-white/80">{shortDate(day)}</p>
                      {late && <Badge tone="amber">Tardanza</Badge>}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-white/45 mt-0.5">
                      {marks
                        .slice()
                        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
                        .map((m) => `${TYPES[m.type]?.label || 'Marcaje'} ${timeOf(m.createdAt)}`)
                        .join(' · ')}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
