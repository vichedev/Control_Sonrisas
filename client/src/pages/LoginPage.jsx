import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, ClipboardList, KeyRound, Mail, MessageCircleHeart, ShieldCheck, UtensilsCrossed } from '../components/icons'
import { useAuth } from '../context/AuthContext'
import { landingFor } from '../components/ProtectedRoute'
import { apiError } from '../api/client'
import Logo from '../components/Logo'
import ThemeToggle from '../components/ThemeToggle'
import { Button, inputClass } from '../components/ui'
import PasswordInput from '../components/PasswordInput'

/** Mensajes claros para los fallos típicos (sin conexión, demasiados intentos). */
function friendlyError(err, fallback) {
  if (!err?.response) return 'No hay conexión con el servidor. Revisa tu internet e inténtalo otra vez.'
  if (err.response.status === 429) return 'Demasiados intentos seguidos. Espera un minuto y vuelve a intentarlo.'
  return apiError(err, fallback)
}

export default function LoginPage() {
  const { login, loginWith2FA } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [tempToken, setTempToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (tempToken) {
        const user = await loginWith2FA(tempToken, code.trim())
        navigate(user.mustChangePassword ? '/cambiar-clave' : landingFor(user.role), { replace: true })
        return
      }
      const res = await login(email.trim(), password)
      if (res.needs2FA) {
        setTempToken(res.tempToken)
        return
      }
      navigate(res.user.mustChangePassword ? '/cambiar-clave' : landingFor(res.user.role), {
        replace: true,
      })
    } catch (err) {
      setError(friendlyError(err, 'No se pudo iniciar sesión'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-white dark:bg-app">
      {/* Panel de marca (sólo escritorio) */}
      <aside className="hidden lg:flex w-[44%] max-w-xl flex-col justify-between p-10 bg-slate-50 dark:bg-surface border-r border-slate-200 dark:border-white/8">
        <Logo size="md" to={null} />
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white max-w-sm">
            El día a día del centro, ordenado y al alcance de las familias.
          </h2>
          <ul className="mt-8 space-y-4 text-sm text-slate-600 dark:text-white/65">
            {[
              [ClipboardList, 'Entradas, salidas y seguimiento de cada niño.'],
              [UtensilsCrossed, 'Alimentación, siestas y bitácora en pocos toques.'],
              [MessageCircleHeart, 'Reporte diario a las familias por WhatsApp.'],
            ].map(([Icon, text]) => (
              <li key={text} className="flex items-start gap-3">
                <span className="shrink-0 w-8 h-8 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-accent-text flex items-center justify-center">
                  <Icon className="w-4 h-4" />
                </span>
                <span className="pt-1.5">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-slate-400 dark:text-white/30">Datos protegidos · acceso sólo para personal y representantes autorizados.</p>
      </aside>

      <div className="relative flex-1 flex items-center justify-center px-4 py-10">
      <div className="absolute top-4 right-4">
        <ThemeToggle size="sm" />
      </div>

      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8 lg:hidden">
          <Logo size="md" to={null} />
        </div>

        <form
          onSubmit={submit}
          className="space-y-4"
        >
          {tempToken ? (
            <>
              <div className="text-center mb-2">
                <span className="inline-flex w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-500/20 items-center justify-center mb-2">
                  <ShieldCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-300" />
                </span>
                <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Verificación en dos pasos</h1>
                <p className="text-sm text-slate-500 dark:text-white/50">
                  Escribe el código de 6 dígitos de tu aplicación de autenticación. Cambia cada 30 segundos.
                </p>
              </div>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" aria-hidden="true" />
                <input
                  aria-label="Código de verificación de 6 dígitos"
                  autoComplete="one-time-code"
                  className={`${inputClass} pl-9 min-h-12 tracking-[0.4em] text-center text-lg font-semibold`}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  inputMode="numeric"
                  autoFocus
                />
              </div>
            </>
          ) : (
            <>
              <div className="mb-4">
                <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">Iniciar sesión</h1>
                <p className="text-sm text-slate-500 dark:text-white/50 mt-1">
                  Entra con tu cuenta del centro o de representante.
                </p>
              </div>
              <div>
              <label htmlFor="login-email" className="block text-[13px] font-medium text-slate-700 dark:text-white/75 mb-1.5">
                Correo electrónico
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" aria-hidden="true" />
                <input
                  id="login-email"
                  className={`${inputClass} pl-9 min-h-11`}
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (error) setError('')
                  }}
                  placeholder="correo@guarderia.com"
                  autoComplete="username"
                  required
                  autoFocus
                />
              </div>
              </div>
              <div>
                <label htmlFor="login-password" className="block text-[13px] font-medium text-slate-700 dark:text-white/75 mb-1.5">
                  Contraseña
                </label>
                <PasswordInput
                  id="login-password"
                  withIcon
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (error) setError('')
                  }}
                  placeholder="Tu contraseña"
                  autoComplete="current-password"
                  required
                />
              </div>
            </>
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

          <Button
            type="submit"
            loading={loading}
            disabled={tempToken ? code.length !== 6 : false}
            className="w-full min-h-11"
            size="lg"
          >
            {loading ? (tempToken ? 'Verificando…' : 'Entrando…') : tempToken ? 'Verificar código' : 'Entrar'}
          </Button>

          {tempToken && (
            <button
              type="button"
              onClick={() => {
                setTempToken('')
                setCode('')
                setError('')
              }}
              className="w-full min-h-10 text-sm text-slate-500 dark:text-white/40 hover:underline"
            >
              Volver al inicio de sesión
            </button>
          )}
        </form>

        <p className="text-center text-xs text-slate-500 dark:text-white/40 mt-6 pt-6 border-t border-slate-200 dark:border-white/8">
          ¿Eres representante y no tienes acceso? Pídelo en la guardería.
        </p>
      </div>
      </div>
    </div>
  )
}
