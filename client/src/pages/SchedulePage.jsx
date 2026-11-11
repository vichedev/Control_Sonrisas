import { useEffect, useState } from 'react'
import { CalendarClock, Plus, Save, Trash2 } from '../components/icons'
import { api, apiError, shortDate } from '../api/client'
import { useToasts } from '../context/ToastsContext'
import {
  Button,
  Card,
  Field,
  inputClass,
  Loading,
  PageHeader,
  SectionTitle,
} from '../components/ui'

const DAYS = [
  ['1', 'Lunes'],
  ['2', 'Martes'],
  ['3', 'Miércoles'],
  ['4', 'Jueves'],
  ['5', 'Viernes'],
  ['6', 'Sábado'],
  ['0', 'Domingo'],
]

/** Horario del centro: apertura, retiro y evaluación de la jornada del personal. */
export default function SchedulePage() {
  const { pushToast } = useToasts()
  const [schedule, setSchedule] = useState(null)
  const [saving, setSaving] = useState(false)
  const [newHoliday, setNewHoliday] = useState({ date: '', name: '' })

  useEffect(() => {
    api
      .get('/schedule')
      .then((r) => setSchedule(r.data))
      .catch((err) => pushToast({ type: 'error', message: apiError(err) }))
  }, [pushToast])

  if (!schedule) return <Loading />

  const set = (key, value) => setSchedule((s) => ({ ...s, [key]: value }))

  const setDay = (key, field, value) =>
    setSchedule((s) => ({
      ...s,
      days: { ...s.days, [key]: { ...s.days?.[key], [field]: value } },
    }))

  const save = async () => {
    setSaving(true)
    try {
      const res = await api.patch('/schedule', {
        name: schedule.name,
        enabled: schedule.enabled,
        days: schedule.days,
        holidays: schedule.holidays,
        lateArrivalAfterMinutes: Number(schedule.lateArrivalAfterMinutes),
        pickupDeadline: schedule.pickupDeadline,
        latePickupAfterMinutes: Number(schedule.latePickupAfterMinutes),
        reportGenerationTime: schedule.reportGenerationTime,
        staffAttendanceEnabled: schedule.staffAttendanceEnabled,
        lateAfterMinutes: Number(schedule.lateAfterMinutes),
        absentAfterMinutes: Number(schedule.absentAfterMinutes),
        overtimeEnabled: schedule.overtimeEnabled,
        overtimeAfterMinutes: Number(schedule.overtimeAfterMinutes),
        earlyLeaveEnabled: schedule.earlyLeaveEnabled,
        earlyLeaveBeforeMinutes: Number(schedule.earlyLeaveBeforeMinutes),
        centerName: schedule.centerName,
        centerAddress: schedule.centerAddress,
        centerPhone: schedule.centerPhone,
      })
      setSchedule(res.data)
      pushToast({ type: 'success', message: 'Horario guardado' })
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo guardar') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Horario del centro"
        subtitle="Define la apertura, el límite de retiro y la jornada del personal."
        icon={CalendarClock}
        actions={
          <Button icon={Save} onClick={save} loading={saving}>
            Guardar cambios
          </Button>
        }
      />

      <Card className="mb-5">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={schedule.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-semibold text-slate-800 dark:text-white">Evaluar el horario</span>
            <p className="text-sm text-slate-500 dark:text-white/50">
              Con esto activo, las llegadas y los retiros se etiquetan como a tiempo o tardíos. Sin
              ello las horas se registran igual, pero sin etiqueta.
            </p>
          </span>
        </label>
      </Card>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card>
          <SectionTitle>Días y horas</SectionTitle>
          <div className="space-y-2">
            {DAYS.map(([key, label]) => {
              const day = schedule.days?.[key] || {}
              return (
                <div key={key} className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 w-32">
                    <input
                      type="checkbox"
                      checked={!!day.enabled}
                      onChange={(e) => setDay(key, 'enabled', e.target.checked)}
                    />
                    <span className="text-sm font-semibold text-slate-700 dark:text-white/80">{label}</span>
                  </label>
                  <input
                    type="time"
                    value={day.start || ''}
                    onChange={(e) => setDay(key, 'start', e.target.value)}
                    disabled={!day.enabled}
                    className={`${inputClass} w-auto`}
                  />
                  <span className="text-slate-400">a</span>
                  <input
                    type="time"
                    value={day.end || ''}
                    onChange={(e) => setDay(key, 'end', e.target.value)}
                    disabled={!day.enabled}
                    className={`${inputClass} w-auto`}
                  />
                </div>
              )
            })}
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <SectionTitle>Niños</SectionTitle>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Tolerancia de llegada (min)">
                <input
                  className={inputClass}
                  type="number"
                  min="0"
                  value={schedule.lateArrivalAfterMinutes}
                  onChange={(e) => set('lateArrivalAfterMinutes', e.target.value)}
                />
              </Field>
              <Field label="Hora límite de retiro" hint="Vacío = se usa la hora de cierre del día.">
                <input
                  className={inputClass}
                  type="time"
                  value={schedule.pickupDeadline || ''}
                  onChange={(e) => set('pickupDeadline', e.target.value)}
                />
              </Field>
              <Field label="Tolerancia de retiro (min)">
                <input
                  className={inputClass}
                  type="number"
                  min="0"
                  value={schedule.latePickupAfterMinutes}
                  onChange={(e) => set('latePickupAfterMinutes', e.target.value)}
                />
              </Field>
              <Field label="Hora de cierre de reportes" hint="A partir de ella se avisa de lo que falta.">
                <input
                  className={inputClass}
                  type="time"
                  value={schedule.reportGenerationTime || ''}
                  onChange={(e) => set('reportGenerationTime', e.target.value)}
                />
              </Field>
            </div>
          </Card>

          <Card>
            <SectionTitle>Personal</SectionTitle>
            <label className="flex items-center gap-2 mb-3 text-sm text-slate-600 dark:text-white/60">
              <input
                type="checkbox"
                checked={schedule.staffAttendanceEnabled}
                onChange={(e) => set('staffAttendanceEnabled', e.target.checked)}
              />
              Evaluar la jornada del equipo
            </label>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Tardanza tras (min)">
                <input
                  className={inputClass}
                  type="number"
                  min="0"
                  value={schedule.lateAfterMinutes}
                  onChange={(e) => set('lateAfterMinutes', e.target.value)}
                />
              </Field>
              <Field label="Cuenta como falta tras (min)">
                <input
                  className={inputClass}
                  type="number"
                  min="0"
                  value={schedule.absentAfterMinutes}
                  onChange={(e) => set('absentAfterMinutes', e.target.value)}
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-4 mt-3">
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-white/60">
                <input
                  type="checkbox"
                  checked={schedule.overtimeEnabled}
                  onChange={(e) => set('overtimeEnabled', e.target.checked)}
                />
                Contabilizar horas extra
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-white/60">
                <input
                  type="checkbox"
                  checked={schedule.earlyLeaveEnabled}
                  onChange={(e) => set('earlyLeaveEnabled', e.target.checked)}
                />
                Contabilizar salidas anticipadas
              </label>
            </div>
          </Card>
        </div>
      </div>

      <Card className="mt-5">
        <SectionTitle>Datos del centro</SectionTitle>
        <p className="text-xs text-slate-400 dark:text-white/30 -mt-2 mb-3">
          Aparecen en el mensaje de WhatsApp que reciben las familias.
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Nombre">
            <input
              className={inputClass}
              value={schedule.centerName || ''}
              onChange={(e) => set('centerName', e.target.value)}
              placeholder="Guardería Sonrisas"
            />
          </Field>
          <Field label="Dirección">
            <input
              className={inputClass}
              value={schedule.centerAddress || ''}
              onChange={(e) => set('centerAddress', e.target.value)}
            />
          </Field>
          <Field label="Teléfono">
            <input
              className={inputClass}
              value={schedule.centerPhone || ''}
              onChange={(e) => set('centerPhone', e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card className="mt-5">
        <SectionTitle>Días cerrados</SectionTitle>
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            type="date"
            value={newHoliday.date}
            onChange={(e) => setNewHoliday((h) => ({ ...h, date: e.target.value }))}
            className={`${inputClass} w-auto`}
          />
          <input
            value={newHoliday.name}
            onChange={(e) => setNewHoliday((h) => ({ ...h, name: e.target.value }))}
            placeholder="Motivo (feriado, capacitación…)"
            className={`${inputClass} flex-1 min-w-[200px]`}
          />
          <Button
            variant="secondary"
            icon={Plus}
            onClick={() => {
              if (!newHoliday.date) return
              set('holidays', [...(schedule.holidays || []), newHoliday])
              setNewHoliday({ date: '', name: '' })
            }}
          >
            Añadir
          </Button>
        </div>
        {(schedule.holidays || []).length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-white/30">Sin días cerrados registrados.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {schedule.holidays.map((h) => (
              <li key={h.date} className="py-2 flex items-center justify-between gap-2">
                <span className="text-sm text-slate-700 dark:text-white/70">
                  <strong>{shortDate(h.date)}</strong>
                  {h.name ? ` · ${h.name}` : ''}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Trash2}
                  onClick={() => set('holidays', schedule.holidays.filter((x) => x.date !== h.date))}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
