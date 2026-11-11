import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { Baby, CalendarDays, ChevronRight, Clock, FileText, LogIn, LogOut, MessageCircleHeart } from '../../components/icons'
import { api, apiError, longDate, timeOf, todayKey } from '../../api/client'
import { useLoadEffect } from '../../api/useLoadEffect'
import { useLiveReload } from '../../realtime'
import { useToasts } from '../../context/ToastsContext'
import { useAuth } from '../../context/AuthContext'
import { Avatar, Card, EmptyState, Loading } from '../../components/ui'
import { CHECK_STATUS, ProgressRing } from '../../components/DayChecklist'

const STATUS = {
  present: { label: 'En la guardería', dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-500/10', live: true },
  checked_out: { label: 'Ya se retiró', dot: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-300', bg: 'bg-sky-50 dark:bg-sky-500/10' },
  absent: { label: 'Aún no llega', dot: 'bg-slate-400', text: 'text-slate-600 dark:text-white/60', bg: 'bg-slate-100 dark:bg-white/5' },
}

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

/** Inicio del representante: el día de HOY de cada uno de sus niños. */
export default function FamilyHomePage() {
  const { pushToast } = useToasts()
  const { user } = useAuth() || {}
  const [data, setData] = useState(null)
  const [days, setDays] = useState({})
  const [loading, setLoading] = useState(true)

  // `silent`: recarga en vivo sin toasts (el spinner sólo sale sin datos).
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    try {
      const res = await api.get('/family/today')
      setData(res.data)
      // Son pocos niños por familia: una petición por niño para traer su lista del día.
      const kids = res.data?.children || []
      const results = await Promise.allSettled(
        kids.map((row) => api.get(`/family/children/${row.child.id}/day`, { params: { date: res.data?.date } })),
      )
      const map = {}
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') map[kids[i].child.id] = r.value.data
      })
      setDays(map)
    } catch (err) {
      if (!silent) pushToast({ type: 'error', message: apiError(err, 'No se pudo cargar el día') })
    } finally {
      setLoading(false)
    }
  }, [pushToast])
  useLoadEffect(load)
  // En vivo: el servidor sólo avisa de sus niños; cualquier aviso refresca la portada.
  const quietReload = useCallback(() => load({ silent: true }), [load])
  useLiveReload(quietReload, {}, { debounceMs: 800 })

  if (loading && !data) return <Loading />
  const rows = data?.children || []
  const firstName = (user?.name || '').split(' ')[0]

  return (
    <>
      <div className="mb-6">
        <p className="text-sm font-medium text-slate-500 dark:text-white/50">
          {capitalize(longDate(data?.date || todayKey()))}
        </p>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          {greeting()}{firstName ? `, ${firstName.charAt(0)}${firstName.slice(1).toLowerCase()}` : ''}
        </h1>
        <p className="text-sm text-slate-500 dark:text-white/50 mt-0.5">
          {rows.length > 1 ? 'Así va el día de tus niños.' : 'Así va el día de hoy.'}
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Baby}
            title="No hay niños asociados a tu cuenta"
            message="Pide en la guardería que te vinculen con la ficha de tu hijo o hija."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {rows.map((row) => (
            <ChildTodayCard key={row.child.id} row={row} day={days[row.child.id]} />
          ))}
        </div>
      )}
    </>
  )
}

function ChildTodayCard({ row, day }) {
  const status = STATUS[row.status] || STATUS.absent
  const checklist = day?.checklist
  const present = !!checklist?.childPresent
  const base = `/familia/nino/${row.child.id}`
  // Momentos clave del día (sin el de asistencia, que ya va en la cabecera).
  const moments = (checklist?.items || []).filter((i) => i.group !== 'attendance').slice(0, 6)
  const attendance = checklist?.items?.find((i) => i.key === 'attendance')

  return (
    <Card padded={false} className="overflow-hidden">
      {/* Cabecera */}
      <div className="flex items-center gap-4 p-4 sm:p-5">
        <Avatar src={row.child.photoUrl} name={row.child.name} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white truncate">{row.child.name}</h2>
          <p className="text-sm text-slate-500 dark:text-white/50 truncate">
            {[row.child.classroomName, row.child.age].filter(Boolean).join(' · ')}
          </p>
          <span className={`mt-1.5 inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${status.bg} ${status.text}`}>
            <span className={`w-2 h-2 rounded-full ${status.dot} ${status.live ? 'animate-pulse' : ''}`} />
            {status.label}
          </span>
        </div>
        {present && <ProgressRing summary={checklist.summary} size={72} stroke={8} />}
      </div>

      {/* Cuerpo: el día de hoy */}
      <div className="px-4 sm:px-5 pb-4">
        {present ? (
          <>
            <div className="flex flex-wrap gap-2 mb-3 text-sm">
              {row.arrival && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2 py-1 text-[13px] font-medium tabular-nums">
                  <LogIn className="w-4 h-4" /> Llegó {timeOf(row.arrival.createdAt)}
                </span>
              )}
              {row.departure && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 px-2 py-1 text-[13px] font-medium tabular-nums">
                  <LogOut className="w-4 h-4" /> Salió {timeOf(row.departure.createdAt)}
                </span>
              )}
            </div>
            {moments.length > 0 ? (
              <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {moments.map((item) => {
                  const cfg = CHECK_STATUS[item.status] || CHECK_STATUS.not_recorded
                  const Icon = cfg.icon
                  return (
                    <li key={item.key} className="min-w-0 flex items-center gap-2 rounded-lg border border-slate-100 dark:border-white/5 bg-slate-50/70 dark:bg-white/3 px-3 py-2">
                      <Icon className={`w-4.5 h-4.5 shrink-0 ${cfg.iconColor}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        <strong className="font-medium text-slate-800 dark:text-white">{item.label}</strong>
                        {item.detail && <span className="text-slate-500 dark:text-white/50"> · {item.detail}</span>}
                      </span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-sm text-slate-400 dark:text-white/30">Todavía no hay registros del día.</p>
            )}
          </>
        ) : (
          <div className="flex items-center gap-3 rounded-lg bg-slate-50 dark:bg-white/4 px-4 py-3 text-sm text-slate-500 dark:text-white/50">
            <Clock className="w-5 h-5 shrink-0" />
            {attendance?.status === 'info' || attendance?.status === 'not_done'
              ? attendance.detail
              : 'Cuando registren su llegada, aquí verás su día en vivo.'}
          </div>
        )}

        {row.reportSent && (
          <Link
            to={base}
            className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2.5 text-sm font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/15"
          >
            <MessageCircleHeart className="w-4 h-4" /> Ya llegó el reporte del día
            <ChevronRight className="w-4 h-4 ml-auto" />
          </Link>
        )}
      </div>

      {/* Acciones */}
      <div className="grid grid-cols-3 border-t border-slate-100 dark:border-white/5 text-sm font-medium">
        <Link to={base} className="flex items-center justify-center gap-1.5 min-h-11 py-3 text-accent-text hover:bg-accent-soft">
          <Baby className="w-4 h-4" /> Su día
        </Link>
        <Link to={`${base}?vista=historial`} className="flex items-center justify-center gap-1.5 min-h-11 py-3 border-x border-slate-100 dark:border-white/5 text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/5">
          <CalendarDays className="w-4 h-4" /> Historial
        </Link>
        <Link to={`${base}?vista=reportes`} className="flex items-center justify-center gap-1.5 min-h-11 py-3 text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/5">
          <FileText className="w-4 h-4" /> Reportes
        </Link>
      </div>
    </Card>
  )
}
