import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Circle, KeyRound } from '../components/icons'
import { api, apiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { landingFor } from '../components/ProtectedRoute'
import Logo from '../components/Logo'
import { Button, Field, inputClass } from '../components/ui'
import PasswordInput from '../components/PasswordInput'

/** Pantalla obligatoria tras un alta o un reseteo de contraseña. */
export default function ForceChangePasswordPage() {
  const { user, applyNewToken } = useAuth()
  const navigate = useNavigate()
  const [currentPassword, setCurrent] = useState('')
  const [newPassword, setNew] = useState('')
  const [repeat, setRepeat] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Si la cuenta tiene 2FA activo, el backend exige el código para cambiar la clave.
  const requires2FA = !!user?.totpEnabled

  // Mismas reglas que el backend (common/password.validator.ts), mostradas en vivo.
  const rules = [
    { ok: newPassword.length >= 10, label: 'Al menos 10 caracteres', error: 'La nueva contraseña debe tener al menos 10 caracteres' },
    { ok: /[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(newPassword), label: 'Al menos una letra', error: 'La nueva contraseña debe incluir al menos una letra' },
    { ok: /[0-9]/.test(newPassword), label: 'Al menos un número', error: 'La nueva contraseña debe incluir al menos un número' },
    { ok: !!newPassword && newPassword === repeat, label: 'Las dos contraseñas coinciden', error: 'Las contraseñas nuevas no coinciden' },
    { ok: !!newPassword && newPassword !== currentPassword, label: 'Distinta de la temporal', error: 'La nueva contraseña debe ser distinta de la temporal' },
  ]
  const allOk = rules.every((r) => r.ok)

  const submit = async (e) => {
    e.preventDefault()
    if (!allOk) {
      setError(rules.find((r) => !r.ok).error)
      return
    }
    const code = totpCode.replace(/\s/g, '')
    if (requires2FA && code.length !== 6) {
      setError('Tu cuenta tiene 2FA activo: ingresa el código de 6 dígitos.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const payload = { currentPassword, newPassword }
      if (requires2FA) payload.totpCode = code
      const res = await api.post('/auth/change-password', payload)
      applyNewToken(res.data)
      navigate(landingFor(res.data?.user?.role || user?.role), { replace: true })
    } catch (err) {
      setError(apiError(err, 'No se pudo cambiar la contraseña'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-white dark:bg-app">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Logo size="md" to={null} />
        </div>
        <form
          onSubmit={submit}
          className="space-y-4"
        >
          <div className="mb-2">
            <span className="inline-flex w-10 h-10 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 items-center justify-center mb-3">
              <KeyRound className="w-5 h-5 text-accent-text" />
            </span>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">Crea tu contraseña</h1>
            <p className="text-sm text-slate-500 dark:text-white/50 mt-1">
              Por seguridad debes cambiar la contraseña temporal antes de continuar.
            </p>
          </div>

          <Field label="Contraseña temporal" required>
            <PasswordInput
              value={currentPassword}
              onChange={(e) => setCurrent(e.target.value)}
              required
              autoComplete="current-password"
              autoFocus
            />
          </Field>
          <Field label="Nueva contraseña" required>
            <PasswordInput
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
              required
              autoComplete="new-password"
            />
          </Field>
          <Field label="Repite la nueva contraseña" required>
            <PasswordInput
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              required
              autoComplete="new-password"
            />
          </Field>

          <ul className="grid gap-y-1 text-xs rounded-lg border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-white/3 px-3 py-2.5" aria-label="Requisitos de la contraseña">
            {rules.map((r) => (
              <li
                key={r.label}
                className={`flex items-center gap-1.5 ${
                  r.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-white/50'
                }`}
              >
                {r.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
                {r.label}
                <span className="sr-only">{r.ok ? '(cumplido)' : '(pendiente)'}</span>
              </li>
            ))}
          </ul>

          {requires2FA && (
            <Field label="Código de verificación (2FA)" hint="Los 6 dígitos de tu app de autenticación." required>
              <input
                className={`${inputClass} min-h-11`}
                inputMode="numeric"
                maxLength={7}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/[^\d\s]/g, ''))}
                required
                autoComplete="one-time-code"
                placeholder="123456"
              />
            </Field>
          )}

          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 text-sm font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2.5"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}

          <Button type="submit" loading={loading} className="w-full min-h-11" size="lg">
            {loading ? 'Guardando…' : 'Guardar y continuar'}
          </Button>
        </form>
      </div>
    </div>
  )
}
