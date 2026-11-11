import { useState } from 'react'
import { BellRing, DoorOpen, FileCheck2, HeartPulse, LogIn, Moon, Save } from '../icons'
import { api, apiError } from '../../api/client'
import { useToasts } from '../../context/ToastsContext'
import { Badge, Button, Card, Field, SectionTitle, inputClass } from '../ui'

const EVENTS = [
  { key: 'notifyArrival', example: 'arrival', icon: LogIn, title: 'Llegada', desc: 'Cuando se registra la entrada del niño.' },
  { key: 'notifyPickup', example: 'pickup', icon: DoorOpen, title: 'Retiro', desc: 'Cuando sale, con el nombre de quien lo retira.' },
  { key: 'notifyHealth', example: 'health', icon: HeartPulse, title: 'Salud e incidentes', desc: 'Anotaciones de salud o incidentes marcadas "avisar a la familia".' },
  { key: 'notifyJustification', example: 'justification', icon: FileCheck2, title: 'Justificaciones', desc: 'Cuando coordinación aprueba o rechaza un aviso de ausencia.' },
]

/** Interruptor accesible. */
function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative shrink-0 w-11 h-6 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-1 disabled:opacity-50 ${
        checked ? 'bg-accent' : 'bg-slate-300 dark:bg-white/20'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : ''
        }`}
      />
    </button>
  )
}

/** Burbuja estilo WhatsApp para el mensaje de ejemplo. */
function Bubble({ text }) {
  return (
    <div className="rounded-xl rounded-tl-sm bg-[#e7ffdb] dark:bg-emerald-500/10 text-slate-800 dark:text-emerald-50 ring-1 ring-emerald-900/5 dark:ring-emerald-400/15 px-3 py-2 text-[13px] leading-snug whitespace-pre-line shadow-xs max-w-md">
      {text}
    </div>
  )
}

/**
 * Ajustes de avisos automáticos. Se re-monta (key) al recibir ajustes nuevos del servidor,
 * así el formulario parte de las props sin sincronizar con efectos.
 */
export default function NotificationSettings({ settings, linkedConnected, canEdit, onSaved }) {
  const { pushToast } = useToasts()
  const [form, setForm] = useState(() => ({
    enabled: settings.enabled,
    notifyArrival: settings.notifyArrival,
    notifyPickup: settings.notifyPickup,
    notifyHealth: settings.notifyHealth,
    notifyJustification: settings.notifyJustification,
    quietStart: settings.quietStart || '',
    quietEnd: settings.quietEnd || '',
    signature: settings.signature || '',
  }))
  const [saving, setSaving] = useState(false)

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }))
  const signature = form.signature.trim() || settings.defaultSignature || 'Sonrisas'
  // Los ejemplos del servidor llevan la firma guardada; se cambia por la que se está escribiendo.
  const savedSign = settings.signature || settings.defaultSignature || 'Sonrisas'
  const example = (k) => (settings.examples?.[k] || '').replace(`— ${savedSign}`, `— ${signature}`)

  const dirty =
    Object.keys(form).some((k) => String(form[k]) !== String(settings[k] ?? ''))

  const save = async () => {
    if (!!form.quietStart !== !!form.quietEnd) {
      pushToast({ type: 'error', message: 'Indica inicio y fin del horario de silencio, o deja ambos vacíos' })
      return
    }
    setSaving(true)
    try {
      const r = await api.put('/whatsapp/settings', form)
      pushToast({ type: 'success', message: 'Ajustes de avisos guardados' })
      onSaved?.(r.data)
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudieron guardar los ajustes') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <SectionTitle hint="Cualquier novedad, al instante">Avisos automáticos</SectionTitle>

      {/* Interruptor general */}
      <div
        className={`flex items-start gap-4 rounded-xl p-4 border ${
          form.enabled
            ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/25 dark:bg-emerald-500/8'
            : 'border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5'
        }`}
      >
        <BellRing className={`w-5 h-5 shrink-0 ${form.enabled ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-400'}`} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-900 dark:text-white">Enviar avisos a las familias</p>
          <p className="text-sm text-slate-600 dark:text-white/60">
            Se envían solos desde el WhatsApp del centro a los representantes con "recibe reportes"
            activado. Si el número no está conectado, los avisos no salen (quedan como fallidos en la bitácora).
          </p>
          {form.enabled && !linkedConnected && (
            <Badge tone="amber" className="mt-2">El WhatsApp del centro no está conectado</Badge>
          )}
        </div>
        <Switch checked={form.enabled} onChange={set('enabled')} disabled={!canEdit} label="Activar avisos automáticos" />
      </div>

      {/* Eventos */}
      <div className={`mt-4 divide-y divide-slate-100 dark:divide-white/5 ${form.enabled ? '' : 'opacity-60'}`}>
        {EVENTS.map(({ key, example: ex, icon: Icon, title, desc }) => (
          <div key={key} className="py-4 flex flex-col sm:flex-row gap-3 sm:gap-5">
            <div className="flex items-start gap-3 sm:w-64 shrink-0">
              <span className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-white/10 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-slate-600 dark:text-white/70" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-slate-900 dark:text-white">{title}</p>
                <p className="text-xs text-slate-500 dark:text-white/50">{desc}</p>
              </div>
              <Switch checked={form[key]} onChange={set(key)} disabled={!canEdit} label={`Aviso de ${title}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-500 dark:text-white/45 mb-1">Ejemplo</p>
              <Bubble text={example(ex)} />
            </div>
          </div>
        ))}
        <p className="py-3 text-xs text-slate-500 dark:text-white/40">
          El reporte del día se sigue enviando desde <b>Reportes a familias</b> (no se duplica aquí).
        </p>
      </div>

      {/* Silencio y firma */}
      <div className="mt-2 grid gap-4 sm:grid-cols-3">
        <Field label="Silencio desde" hint="No se envían avisos en este horario">
          <input type="time" className={inputClass} value={form.quietStart} onChange={(e) => set('quietStart')(e.target.value)} disabled={!canEdit} />
        </Field>
        <Field label="Silencio hasta">
          <input type="time" className={inputClass} value={form.quietEnd} onChange={(e) => set('quietEnd')(e.target.value)} disabled={!canEdit} />
        </Field>
        <Field label="Firma" hint={`Vacía = "${settings.defaultSignature || 'Sonrisas'}"`}>
          <input className={inputClass} maxLength={120} value={form.signature} onChange={(e) => set('signature')(e.target.value)} placeholder={settings.defaultSignature || 'Sonrisas'} disabled={!canEdit} />
        </Field>
      </div>
      {settings.quietNow && (
        <p className="mt-3 text-xs text-slate-500 dark:text-white/50 flex items-center gap-1.5">
          <Moon className="w-3.5 h-3.5" /> Ahora mismo es horario de silencio.
        </p>
      )}

      {canEdit && (
        <div className="mt-5 flex justify-end">
          <Button icon={Save} loading={saving} disabled={!dirty} onClick={save}>
            Guardar ajustes
          </Button>
        </div>
      )}
    </Card>
  )
}
