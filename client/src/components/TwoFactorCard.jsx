import { useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, Loader2, ShieldCheck, Smartphone, X } from './icons'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'

/**
 * Card de gestión de 2FA (TOTP) — visible para cualquier usuario autenticado
 * (dirección, coordinación, educadora o representante). Activar 2FA pide secret + verificación.
 * Desactivar pide contraseña + código TOTP actual + invalida otras sesiones.
 *
 * Props:
 *   - onActivated/onDisabled: callbacks (recibidos de la página, normalmente toasts)
 *   - onError(message)
 */
export default function TwoFactorCard({ onActivated, onDisabled, onError }) {
  const { user, refreshUser, applyNewToken } = useAuth()
  const [setupOpen, setSetupOpen] = useState(false)
  const [disableOpen, setDisableOpen] = useState(false)

  return (
    <div className="rounded-xl bg-white dark:bg-surface border border-slate-200 dark:border-white/8 shadow-xs p-5 sm:p-6 space-y-4">
      <div className="flex items-start gap-4">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${user?.totpEnabled ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300' : 'border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-slate-500 dark:text-white/60'}`}>
          {user?.totpEnabled ? <ShieldCheck className="w-[18px] h-[18px]" /> : <KeyRound className="w-[18px] h-[18px]" />}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white flex flex-wrap items-center gap-2">Autenticación en 2 pasos (TOTP){user?.totpEnabled && <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20">Activada</span>}</h2>
          <p className="text-sm text-slate-500 dark:text-white/50 mt-1">
            {user?.totpEnabled
              ? 'Está activada. Cada vez que inicies sesión te pediremos el código de 6 dígitos de tu app autenticadora.'
              : 'Añade una capa extra: incluso si alguien obtiene tu contraseña, necesitará tu app autenticadora para entrar.'}
          </p>
          <p className="text-xs text-slate-500 dark:text-white/40 mt-2">Compatible con Google Authenticator, Microsoft Authenticator, Authy, 1Password.</p>
        </div>
      </div>
      <div className="flex justify-end">
        {user?.totpEnabled ? (
          <button onClick={() => setDisableOpen(true)} className="inline-flex items-center justify-center gap-1.5 min-h-9 px-3.5 py-1.5 rounded-lg text-sm font-medium bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-red-600 dark:text-red-400 hover:bg-red-50 hover:border-red-200 dark:hover:bg-red-500/10 dark:hover:border-red-500/30 shadow-xs transition-colors">Desactivar</button>
        ) : (
          <button onClick={() => setSetupOpen(true)} className="inline-flex items-center justify-center gap-2 min-h-9 px-3.5 py-1.5 rounded-lg text-sm font-medium bg-accent text-accent-fg hover:bg-accent-hover shadow-xs disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-1">
            <ShieldCheck className="w-4 h-4" /> Activar
          </button>
        )}
      </div>

      {setupOpen && (
        <Setup2FAModal
          onClose={() => setSetupOpen(false)}
          onActivated={async () => {
            setSetupOpen(false)
            await refreshUser()
            onActivated?.()
          }}
          onError={onError}
        />
      )}
      {disableOpen && (
        <Disable2FAModal
          onClose={() => setDisableOpen(false)}
          onDone={async (data) => {
            setDisableOpen(false)
            if (data) applyNewToken(data)
            await refreshUser()
            onDisabled?.()
          }}
          onError={onError}
        />
      )}
    </div>
  )
}

function Setup2FAModal({ onClose, onActivated, onError }) {
  const [step, setStep] = useState('loading') // 'loading' | 'qr' | 'verify' | 'submitting'
  const [data, setData] = useState(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    api.post('/auth/2fa/setup')
      .then((r) => { setData(r.data); setStep('qr') })
      .catch((e) => {
        const m = e?.response?.data?.message || 'No se pudo generar el código.'
        setError(m); setStep('qr')
        onError?.(m)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const verify = async (e) => {
    e.preventDefault()
    setError(''); setStep('submitting')
    try {
      await api.post('/auth/2fa/verify-setup', { code: code.replace(/\s/g, '') })
      onActivated()
    } catch (err) {
      const m = err?.response?.data?.message || 'Código incorrecto.'
      setError(m); setStep('verify')
    }
  }

  return (
    <Modal onClose={onClose} title="Activar 2FA" Icon={ShieldCheck}>
      {step === 'loading' && (
        <p className="text-center text-slate-500 dark:text-white/60 text-sm py-6 inline-flex items-center gap-2 justify-center w-full"><Loader2 className="w-4 h-4 animate-spin" /> Generando código…</p>
      )}
      {data && (
        <div className="space-y-4">
          <ol className="text-sm text-slate-700 dark:text-white/80 space-y-1.5 list-decimal pl-5">
            <li>Abre Google Authenticator (o Authy, Microsoft Authenticator).</li>
            <li>Pulsa "Añadir cuenta" → "Escanear código QR".</li>
            <li>Escanea este código y luego escribe el código de 6 dígitos que aparece en la app.</li>
          </ol>
          <div className="flex justify-center">
            <div className="p-3 bg-white rounded-xl border border-slate-200 dark:border-white/10">
              <img src={data.qrDataUrl} alt="QR 2FA" className="w-56 h-56" />
            </div>
          </div>
          <details className="text-xs text-slate-500 dark:text-white/50">
            <summary className="cursor-pointer hover:text-slate-700 dark:hover:text-white/70 inline-flex items-center gap-1"><Smartphone className="w-3.5 h-3.5" />¿No puedes escanear? Introducir manualmente</summary>
            <p className="mt-1.5 px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 font-mono break-all">{data.secret}</p>
          </details>
          <form onSubmit={verify} className="space-y-2">
            <label className="block text-[13px] font-medium text-slate-700 dark:text-white/75">Código de la app</label>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9 ]/g, '').slice(0, 7))}
              maxLength={7}
              className="w-full px-3 py-2 rounded-lg border border-slate-300/80 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-slate-900 dark:text-white shadow-xs focus:outline-none focus:border-accent focus:ring-3 focus:ring-accent-ring text-center tracking-[0.5em] text-xl font-semibold tabular-nums py-2.5"
              placeholder="••••••"
              autoComplete="one-time-code"
            />
            {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="inline-flex items-center justify-center gap-1.5 min-h-9 px-3.5 py-1.5 rounded-lg text-sm font-medium bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/85 hover:bg-slate-50 dark:hover:bg-white/10 shadow-xs transition-colors">Cancelar</button>
              <button type="submit" disabled={code.replace(/\s/g, '').length !== 6 || step === 'submitting'} className="inline-flex items-center justify-center gap-2 min-h-9 px-3.5 py-1.5 rounded-lg text-sm font-medium bg-accent text-accent-fg hover:bg-accent-hover shadow-xs disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-1">
                {step === 'submitting' ? <><Loader2 className="w-4 h-4 animate-spin" />Verificando…</> : <><CheckCircle2 className="w-4 h-4" />Activar 2FA</>}
              </button>
            </div>
          </form>
        </div>
      )}
    </Modal>
  )
}

function Disable2FAModal({ onClose, onDone, onError }) {
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault(); setError(''); setSubmitting(true)
    try {
      const { data } = await api.post('/auth/2fa/disable', { code: code.replace(/\s/g, ''), password })
      onDone(data) // el backend devuelve un token fresco
    } catch (err) {
      const m = err?.response?.data?.message || 'No se pudo desactivar.'
      setError(m)
      onError?.(m)
    } finally { setSubmitting(false) }
  }

  return (
    <Modal onClose={onClose} title="Desactivar 2FA" Icon={KeyRound}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-white/70">Confirma tu contraseña y el código actual de tu app para desactivar 2FA.</p>
        <div>
          <label className="block text-[13px] font-medium text-slate-700 dark:text-white/75 mb-1.5">Contraseña</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full px-3 py-2 rounded-lg border border-slate-300/80 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-slate-900 dark:text-white shadow-xs focus:outline-none focus:border-accent focus:ring-3 focus:ring-accent-ring" />
        </div>
        <div>
          <label className="block text-[13px] font-medium text-slate-700 dark:text-white/75 mb-1.5">Código TOTP</label>
          <input type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9 ]/g, '').slice(0, 7))} required maxLength={7} className="w-full px-3 py-2 rounded-lg border border-slate-300/80 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-slate-900 dark:text-white shadow-xs focus:outline-none focus:border-accent focus:ring-3 focus:ring-accent-ring text-center tracking-[0.5em] text-xl font-semibold tabular-nums py-2.5" placeholder="••••••" />
        </div>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="inline-flex items-center justify-center gap-1.5 min-h-9 px-3.5 py-1.5 rounded-lg text-sm font-medium bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/85 hover:bg-slate-50 dark:hover:bg-white/10 shadow-xs transition-colors">Cancelar</button>
          <button type="submit" disabled={submitting || code.replace(/\s/g, '').length !== 6 || !password} className="inline-flex items-center justify-center gap-2 min-h-9 px-3.5 py-1.5 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 dark:hover:bg-red-500 shadow-xs disabled:opacity-50 transition-colors">
            {submitting ? 'Desactivando…' : 'Desactivar 2FA'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Modal({ onClose, title, Icon, children }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/40 dark:bg-black/60 animate-fade-in" onClick={onClose}>
      <div className="relative w-full max-w-md bg-white dark:bg-elevated border border-slate-200 dark:border-white/10 rounded-xl shadow-xl overflow-hidden animate-fade-in-up max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200/70 dark:border-white/8 flex items-center justify-between">
          <h3 className="font-semibold text-base text-slate-900 dark:text-white flex items-center gap-2"><Icon className="w-5 h-5 text-slate-400 dark:text-white/50" />{title}</h3>
          <button onClick={onClose} aria-label="Cerrar" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
