import { useState } from 'react'
import {
  CheckCircle2,
  Link2,
  Loader2,
  LogOut,
  QrCode,
  RefreshCw,
  Send,
  Smartphone,
  Unplug,
  WifiOff,
  X,
} from '../icons'
import { api, apiError } from '../../api/client'
import { useToasts } from '../../context/ToastsContext'
import { Badge, Button, Card, Field, inputClass } from '../ui'
import Modal from '../Modal'
import ConfirmDialog from '../ConfirmDialog'

/** Estado → etiqueta, tono y texto de ayuda. */
const LINKED_STATES = {
  connected: { label: 'Conectado', tone: 'green', icon: CheckCircle2 },
  qr: { label: 'Esperando escaneo', tone: 'amber', icon: QrCode },
  connecting: { label: 'Conectando…', tone: 'sky', icon: Loader2 },
  disconnected: { label: 'Sin conexión', tone: 'slate', icon: WifiOff },
  logged_out: { label: 'Desvinculado', tone: 'red', icon: Unplug },
}

const fmtPhone = (p) => (p ? `+${p}` : '')

const fmtSince = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' })
}

const STEPS = [
  'Abre WhatsApp en el teléfono del centro.',
  'Toca ⋮ (Android) o Configuración (iPhone) → Dispositivos vinculados.',
  'Toca "Vincular un dispositivo" y confirma con tu huella o PIN.',
  'Apunta la cámara a este código. El código cambia cada ~20 s; se actualiza solo.',
]

/**
 * Tarjeta principal: estado del WhatsApp vinculado, QR para vincular y acciones.
 * `status` viene de GET /whatsapp/linked/status (lo refresca la página).
 */
export default function LinkedStatusCard({ status, canEdit, onChange }) {
  const { pushToast } = useToasts()
  const [busy, setBusy] = useState('')
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [testOpen, setTestOpen] = useState(false)

  const state = status?.state || 'disconnected'
  const meta = LINKED_STATES[state] || LINKED_STATES.disconnected
  const StateIcon = meta.icon

  const call = async (key, fn, okMsg) => {
    setBusy(key)
    try {
      const r = await fn()
      if (r?.data) onChange?.(r.data)
      if (okMsg) pushToast({ type: 'success', message: okMsg })
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo completar la acción') })
    } finally {
      setBusy('')
    }
  }

  const connect = (fresh = false) =>
    call('connect', () => api.post(`/whatsapp/linked/connect${fresh ? '?fresh=1' : ''}`))
  const stop = () => call('stop', () => api.post('/whatsapp/linked/stop'))
  const logout = async () => {
    await call('logout', () => api.post('/whatsapp/linked/logout'), 'WhatsApp desvinculado')
    setConfirmLogout(false)
  }

  return (
    <Card className="overflow-hidden" padded={false}>
      {/* Cabecera con el estado */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-white/10">
        <div className="flex items-center gap-3">
          <span
            className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              state === 'connected'
                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300'
                : state === 'qr'
                  ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300'
                  : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/60'
            }`}
          >
            <Smartphone className="w-5 h-5" />
          </span>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-white/45">
              WhatsApp del centro
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge tone={meta.tone} className="text-xs px-2.5 py-1">
                <StateIcon className={`w-3.5 h-3.5 ${state === 'connecting' ? 'animate-spin' : ''}`} />
                {meta.label}
              </Badge>
              {status?.queueLength > 0 && (
                <Badge tone="sky">{status.queueLength} en cola</Badge>
              )}
            </div>
          </div>
        </div>
        {canEdit && state === 'connected' && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={Send} onClick={() => setTestOpen(true)}>
              Enviar mensaje de prueba
            </Button>
            <Button variant="ghost" size="sm" icon={LogOut} onClick={() => setConfirmLogout(true)}>
              Desvincular
            </Button>
          </div>
        )}
      </div>

      <div className="p-5">
        {state === 'connected' && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Info label="Número vinculado" value={fmtPhone(status.phone) || '—'} />
            <Info label="Nombre en WhatsApp" value={status.name || '—'} />
            <Info label="Conectado desde" value={fmtSince(status.connectedSince) || '—'} />
            <p className="sm:col-span-3 text-sm text-slate-600 dark:text-white/60">
              Los reportes y avisos salen automáticamente desde este número, con pausas de
              unos segundos entre mensajes.
              {status.sentLastMinute > 0 && ` Enviados en el último minuto: ${status.sentLastMinute}.`}
            </p>
          </div>
        )}

        {state === 'qr' && (
          <div className="grid gap-6 md:grid-cols-[auto_1fr] items-center">
            <div className="mx-auto">
              <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-sm">
                {status.qr ? (
                  <img
                    src={status.qr}
                    alt="Código QR para vincular WhatsApp"
                    className="w-64 h-64 sm:w-72 sm:h-72"
                  />
                ) : (
                  <div className="w-64 h-64 flex items-center justify-center text-slate-400">
                    <Loader2 className="w-8 h-8 animate-spin" />
                  </div>
                )}
              </div>
              <p className="text-center text-xs text-slate-400 dark:text-white/40 mt-2">
                Se actualiza automáticamente
              </p>
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Vincula el WhatsApp del centro
              </h3>
              <ol className="mt-3 space-y-2.5">
                {STEPS.map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm text-slate-700 dark:text-white/75">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-white/80 text-xs font-semibold tabular-nums flex items-center justify-center">
                      {i + 1}
                    </span>
                    <span className="pt-0.5">{s}</span>
                  </li>
                ))}
              </ol>
              {canEdit && (
                <div className="flex flex-wrap gap-2 mt-5">
                  <Button variant="secondary" size="sm" icon={RefreshCw} loading={busy === 'connect'} onClick={() => connect(true)}>
                    Nuevo código
                  </Button>
                  <Button variant="ghost" size="sm" icon={X} loading={busy === 'stop'} onClick={stop}>
                    Cancelar
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {state === 'connecting' && (
          <div className="flex items-center gap-3 py-6 text-slate-600 dark:text-white/60">
            <Loader2 className="w-5 h-5 animate-spin text-sky-500" />
            <span className="text-sm">
              Conectando con WhatsApp… {status?.hasSession ? 'Recuperando la sesión guardada.' : 'Preparando el código QR.'}
            </span>
            {canEdit && (
              <Button variant="ghost" size="sm" icon={X} className="ml-auto" loading={busy === 'stop'} onClick={stop}>
                Detener
              </Button>
            )}
          </div>
        )}

        {(state === 'disconnected' || state === 'logged_out') && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1 text-sm text-slate-600 dark:text-white/60">
              {state === 'logged_out' ? (
                <p>
                  El número se desvinculó. Hasta que lo vuelvas a vincular no salen reportes, avisos
                  ni datos de acceso: quedan listos para enviarlos cuando se conecte.
                </p>
              ) : status?.hasSession ? (
                <p>Hay una sesión guardada pero no está conectada. Pulsa conectar para reanudarla.</p>
              ) : (
                <p>
                  Vincula el número del centro escaneando un código QR desde el teléfono. Todo lo
                  que se envía a las familias (reportes, avisos y datos de acceso) sale desde este número.
                </p>
              )}
            </div>
            {canEdit && (
              <Button icon={status?.hasSession ? RefreshCw : Link2} loading={busy === 'connect'} onClick={() => connect(false)}>
                {status?.hasSession ? 'Conectar' : 'Vincular WhatsApp'}
              </Button>
            )}
          </div>
        )}

        {status?.lastError && state !== 'connected' && (
          <p className="mt-4 text-xs rounded-lg px-3 py-2 bg-red-50 text-red-700 border border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/20">
            {status.lastError}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        onConfirm={logout}
        loading={busy === 'logout'}
        variant="danger"
        icon={Unplug}
        title="¿Desvincular el WhatsApp del centro?"
        message="Se cerrará la sesión en el teléfono y dejarán de salir avisos automáticos. No se podrán enviar reportes ni datos de acceso hasta que vincules un número otra vez."
        confirmText="Desvincular"
      />

      <TestMessageModal open={testOpen} onClose={() => setTestOpen(false)} />
    </Card>
  )
}

function Info({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 dark:bg-white/5 px-4 py-3">
      <p className="text-xs font-medium text-slate-500 dark:text-white/45">{label}</p>
      <p className="font-semibold text-slate-900 dark:text-white mt-0.5 truncate">{value}</p>
    </div>
  )
}

function TestMessageModal({ open, onClose }) {
  const { pushToast } = useToasts()
  const [phone, setPhone] = useState('')
  const [sending, setSending] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (phone.replace(/\D/g, '').length < 7) {
      pushToast({ type: 'error', message: 'Escribe un número válido' })
      return
    }
    setSending(true)
    try {
      const r = await api.post('/whatsapp/linked/test', { phone }, { timeout: 120000 })
      if (r.data?.status === 'sent') {
        pushToast({ type: 'success', message: 'Mensaje de prueba enviado' })
        onClose()
      } else {
        pushToast({ type: 'error', message: r.data?.errorMessage || 'No se pudo enviar' })
      }
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo enviar') })
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={sending ? () => {} : onClose}
      title="Mensaje de prueba"
      subtitle="Se envía desde el WhatsApp del centro"
      width="sm"
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Número de destino" hint="Ej.: 0987654321 (se añade el código de Ecuador si falta)">
          <input
            className={inputClass}
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0987654321"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={sending}>
            Cancelar
          </Button>
          <Button type="submit" icon={Send} loading={sending}>
            Enviar prueba
          </Button>
        </div>
      </form>
    </Modal>
  )
}
