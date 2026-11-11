import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, BedDouble, Droplets, FileText, LogIn, Moon, Sun, XCircle } from '../icons'
import { api, apiError, longDate } from '../../api/client'
import { useToasts } from '../../context/ToastsContext'
import Modal from '../Modal'
import { StatusChip } from '../DayChecklist'
import { Button, inputClass } from '../ui'
import { HYGIENE, INTAKES, MEAL_LABEL, MOODS, REPORT_STATUS } from './trackerModel'

const NAP_KEY = 'sonrisas.tracker.nap'

function readNapDefaults() {
  try {
    const v = JSON.parse(localStorage.getItem(NAP_KEY) || 'null')
    if (v?.from && v?.to) return v
  } catch {
    /* sin almacenamiento */
  }
  return { from: '13:00', to: '14:30' }
}

/** ISO de una hora 'HH:mm' en el día 'YYYY-MM-DD' (hora local). */
function isoAt(day, hhmm) {
  const [y, m, d] = day.split('-').map(Number)
  const [h, min] = hhmm.split(':').map(Number)
  return new Date(y, m - 1, d, h, min).toISOString()
}

const INTAKE_TONE = {
  emerald: 'border-slate-200 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5',
  amber: 'border-slate-200 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5',
  red: 'border-slate-200 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5',
}
const METER_FILL = { emerald: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500' }

/** Medidor de 4 segmentos: cuánto del plato comió (no depende sólo del color). */
function Meter({ level, tone }) {
  return (
    <span className="flex gap-0.5" aria-hidden="true">
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`w-2 h-4 rounded-sm ${i <= level ? METER_FILL[tone] : 'bg-slate-200 dark:bg-white/10'}`}
        />
      ))}
    </span>
  )
}

function BigOption({ onClick, disabled, children, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full min-h-12 flex items-center gap-3 px-3 py-2 rounded-lg border bg-white dark:bg-white/3 text-left text-sm font-medium text-slate-800 dark:text-white transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${className}`}
    >
      {children}
    </button>
  )
}

/**
 * Hoja de acción rápida del seguimiento: registra lo que falta de un niño sin salir
 * de la pantalla. Usa los mismos endpoints que las páginas de cada módulo.
 */
export default function QuickSheet({ target, date, isToday, onClose, onSaved }) {
  const { pushToast } = useToasts()
  const [busy, setBusy] = useState('')
  const [mood, setMood] = useState('')
  const [nap, setNap] = useState(readNapDefaults)

  if (!target) return null
  const { row, col, cell } = target
  const child = row.child
  const firstName = child.name.split(' ')[0]

  const run = async (key, fn, message, patch) => {
    setBusy(key)
    try {
      await fn()
      pushToast({ type: 'success', message })
      onSaved(child.id, patch)
      onClose()
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo guardar') })
    } finally {
      setBusy('')
    }
  }

  const dateParam = isToday ? {} : { date }
  let title = col.label
  let body = null

  if (cell.action === 'meal') {
    const type = col.mealType
    title = MEAL_LABEL[type]
    const options = type === 'bottle' ? INTAKES.filter((i) => ['all', 'half', 'none'].includes(i.value)) : INTAKES
    body = (
      <div className="space-y-2">
        <p className="text-sm text-slate-500 dark:text-white/50">
          {type === 'bottle' ? '¿Cuánto tomó?' : `¿Cuánto comió ${firstName}?`} Un toque y queda guardado.
        </p>
        {options.map((o) => (
          <BigOption
            key={o.value}
            disabled={!!busy}
            className={INTAKE_TONE[o.tone]}
            onClick={() =>
              run(
                o.value,
                () => api.post('/meals', { childId: child.id, type, intake: o.value, ...dateParam }),
                `${firstName}: ${MEAL_LABEL[type]} · ${o.label}`,
                { key: `meal:${type}`, intake: o.value },
              )
            }
          >
            <Meter level={o.level} tone={o.tone} />
            <span className="flex-1">{o.label}</span>
            {busy === o.value && <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
          </BigOption>
        ))}
      </div>
    )
  } else if (cell.action === 'arrival') {
    title = 'Llegada'
    if (row.attendance.status !== 'absent') {
      body = (
        <p className="text-sm text-slate-600 dark:text-white/60">
          {firstName} ya tiene registrada la llegada ({cell.text}). Para corregirla, usa{' '}
          <Link to="/panel/dia" className="font-medium text-accent-text hover:underline">Entradas y salidas</Link>.
        </p>
      )
    } else {
      body = (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-white/45 mb-2">
              ¿Cómo llega? <span className="normal-case font-normal tracking-normal">(opcional)</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {MOODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMood(mood === m.value ? '' : m.value)}
                  aria-pressed={mood === m.value}
                  className={`min-h-10 px-3 rounded-lg text-xs font-medium transition-colors ${
                    mood === m.value
                      ? 'bg-accent-soft text-accent-text ring-1 ring-inset ring-accent/30'
                      : 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/65 hover:bg-slate-50 dark:hover:bg-white/10'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <Button
            variant="success"
            size="lg"
            icon={LogIn}
            className="w-full min-h-12"
            loading={busy === 'in'}
            onClick={() =>
              run(
                'in',
                () => api.post(`/attendance/children/${child.id}/in`, mood ? { mood } : {}),
                `Llegada de ${firstName} registrada`,
              )
            }
          >
            Registrar llegada ahora
          </Button>
          <p className="text-xs text-slate-400 dark:text-white/40">
            ¿Con foto, temperatura o quién lo trae?{' '}
            <Link to="/panel/dia" className="font-medium text-accent-text hover:underline">Entradas y salidas</Link>
          </p>
        </div>
      )
    }
  } else if (cell.action === 'nap') {
    title = 'Siesta'
    const saveRange = () => {
      try {
        localStorage.setItem(NAP_KEY, JSON.stringify(nap))
      } catch {
        /* sin almacenamiento */
      }
      return api.post('/daily-logs', {
        childId: child.id,
        kind: 'nap',
        occurredAt: isoAt(date, nap.from),
        endedAt: isoAt(date, nap.to),
        ...dateParam,
      })
    }
    // Cierra la siesta abierta (la última sin hora de despertar).
    const wakeUp = async () => {
      const res = await api.get('/daily-logs', { params: { childId: child.id, date, kind: 'nap' } })
      const list = Array.isArray(res.data) ? res.data : res.data?.items || []
      const open = list
        .filter((l) => !l.endedAt && l.detail !== 'no_durmio')
        .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))[0]
      if (!open) throw new Error('No hay una siesta abierta')
      await api.patch(`/daily-logs/${open.id}`, { endedAt: new Date().toISOString() })
    }
    const rangeValid = nap.from && nap.to && nap.to > nap.from
    body = (
      <div className="space-y-3">
        {cell.sleeping && isToday && (
          <BigOption
            disabled={!!busy}
            className="border-slate-200 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5"
            onClick={() => run('wake', wakeUp, `${firstName} despertó`)}
          >
            <Sun className="w-5 h-5 text-amber-500" aria-hidden="true" />
            <span className="flex-1">Despertó ahora</span>
          </BigOption>
        )}
        {isToday && !cell.sleeping && (
          <BigOption
            disabled={!!busy}
            className="border-slate-200 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5"
            onClick={() =>
              run('sleep', () => api.post('/daily-logs', { childId: child.id, kind: 'nap' }), `${firstName} se durmió`)
            }
          >
            <Moon className="w-5 h-5 text-accent-text" aria-hidden="true" />
            <span className="flex-1">Se durmió ahora</span>
          </BigOption>
        )}
        <div className="rounded-lg border border-slate-200 dark:border-white/10 p-3">
          <p className="text-xs font-medium text-slate-500 dark:text-white/45 mb-2">Durmió de… a…</p>
          <div className="flex items-center gap-2">
            <label className="flex-1">
              <span className="sr-only">Desde</span>
              <input type="time" className={inputClass} value={nap.from} onChange={(e) => setNap({ ...nap, from: e.target.value })} />
            </label>
            <span className="text-slate-400">a</span>
            <label className="flex-1">
              <span className="sr-only">Hasta</span>
              <input type="time" className={inputClass} value={nap.to} onChange={(e) => setNap({ ...nap, to: e.target.value })} />
            </label>
          </div>
          <Button
            variant="primary"
            icon={BedDouble}
            className="w-full min-h-11 mt-2"
            disabled={!rangeValid || !!busy}
            loading={busy === 'range'}
            onClick={() => run('range', saveRange, `Siesta de ${firstName}: ${nap.from}–${nap.to}`)}
          >
            Guardar siesta
          </Button>
        </div>
        <BigOption
          disabled={!!busy}
          className="border-slate-200 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5"
          onClick={() =>
            run(
              'skip',
              () => api.post('/daily-logs', { childId: child.id, kind: 'nap', detail: 'no_durmio', ...dateParam }),
              `${firstName}: no durmió`,
            )
          }
        >
          <XCircle className="w-5 h-5 text-red-500" aria-hidden="true" />
          <span className="flex-1">No durmió</span>
        </BigOption>
      </div>
    )
  } else if (cell.action === 'care') {
    title = 'Pañal / Higiene'
    body = (
      <div className="space-y-2">
        {cell.title && <p className="text-sm text-slate-500 dark:text-white/50">Hoy: {cell.title}</p>}
        <div className="grid grid-cols-2 gap-2">
          {HYGIENE.map((h) => (
            <BigOption
              key={h.value}
              disabled={!!busy}
              className="border-slate-200 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5"
              onClick={() =>
                run(
                  h.value,
                  () => api.post('/daily-logs', { childId: child.id, kind: 'hygiene', detail: h.value, ...dateParam }),
                  `${firstName}: ${h.label}`,
                )
              }
            >
              <Droplets className="w-4 h-4 text-sky-500 shrink-0" aria-hidden="true" />
              <span className="flex-1">{h.label}</span>
            </BigOption>
          ))}
        </div>
        <p className="text-xs text-slate-400 dark:text-white/40">Se anota con la hora actual. Para más detalle usa la Bitácora.</p>
      </div>
    )
  } else if (cell.action === 'report') {
    title = 'Reporte del día'
    const rep = row.report
    const sent = rep?.status === 'sent'
    body = (
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-white/60">
          {rep
            ? `Estado: ${REPORT_STATUS[rep.status]?.label || rep.status}.`
            : `Aún no hay reporte de ${firstName}. Se arma con todo lo registrado hoy.`}
          {row.checklist?.summary?.pending > 0 && ` Quedan ${row.checklist.summary.pending} pendiente(s).`}
        </p>
        {!sent && (
          <Button
            variant="primary"
            icon={FileText}
            className="w-full min-h-11"
            loading={busy === 'gen'}
            onClick={() =>
              run(
                'gen',
                () => api.post('/reports/generate', { childId: child.id, date }),
                rep ? `Borrador de ${firstName} actualizado` : `Borrador de ${firstName} generado`,
              )
            }
          >
            {rep ? 'Actualizar borrador' : 'Generar borrador'}
          </Button>
        )}
        <div className="flex flex-wrap gap-2">
          <Link
            to="/panel/reportes"
            className="inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline"
          >
            Revisar y enviar en Reportes <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
          </Link>
          <Link
            to={`/panel/ninos/${child.id}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 dark:text-white/60 hover:underline"
          >
            Ficha de {firstName} <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    )
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      width="sm"
      title={`${title} · ${child.name}`}
      subtitle={isToday ? 'Hoy' : longDate(date)}
    >
      {cell.status !== 'none' && (
        <div className="mb-3 flex items-center gap-2 text-xs text-slate-500 dark:text-white/50">
          Ahora: <StatusChip status={cell.status} /> <span className="font-semibold">{cell.title || cell.text}</span>
        </div>
      )}
      {body}
    </Modal>
  )
}
