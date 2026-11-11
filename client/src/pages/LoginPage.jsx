import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  KeyRound,
  Lock,
  Mail,
  MessageCircleHeart,
  ShieldCheck,
  UtensilsCrossed,
} from '../components/icons'
import { useAuth } from '../context/AuthContext'
import { useBranding } from '../context/BrandingContext'
import { landingFor } from '../components/ProtectedRoute'
import { apiError, brandingLogoUrl } from '../api/client'
import ThemeToggle from '../components/ThemeToggle'
import { Button, inputClass } from '../components/ui'
import PasswordInput from '../components/PasswordInput'

/** Logo por defecto del centro (si dirección no ha subido otro en Ajustes → Marca y logo). */
const DEFAULT_LOGO = '/brand/sonrisitas-logo.png'

/** Mensajes claros para los fallos típicos (sin conexión, demasiados intentos). */
function friendlyError(err, fallback) {
  if (!err?.response) return 'No hay conexión con el servidor. Revisa tu internet e inténtalo otra vez.'
  if (err.response.status === 429) return 'Demasiados intentos seguidos. Espera un minuto y vuelve a intentarlo.'
  return apiError(err, fallback)
}

/** Logo del centro: el subido en Marca y logo o, si no hay, el de Sonrisitas. */
function CenterLogo({ className = '' }) {
  const { branding } = useBranding() || {}
  const [failed, setFailed] = useState(false)
  const uploaded = branding?.logoUrl ? brandingLogoUrl(branding.logoUrl) : ''
  const src = !failed && uploaded ? uploaded : DEFAULT_LOGO
  return (
    <img
      src={src}
      alt={branding?.companyName || 'Sonrisitas'}
      className={`object-contain select-none ${className}`}
      onError={() => setFailed(true)}
      draggable="false"
    />
  )
}

/** Tarjetita que imita la app: muestra de un vistazo lo que verán las familias. */
function FloatingCard({ icon: Icon, tone, title, detail, className = '' }) {
  const tones = {
    green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
    sky: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
    rose: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
  }
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-white/70 bg-white/90 px-3.5 py-2.5 shadow-lg shadow-orange-900/5 backdrop-blur dark:border-white/10 dark:bg-slate-900/80 ${className}`}
      aria-hidden="true"
    >
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${tones[tone]}`}>
        <Icon className="h-5 w-5" weight="duotone" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-slate-800 dark:text-white">{title}</span>
        <span className="block text-xs text-slate-500 dark:text-white/55">{detail}</span>
      </span>
    </div>
  )
}

/** Fondo cálido con los colores del logo (formas difuminadas + punteado sutil). */
function WarmBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-amber-300/40 blur-3xl dark:bg-amber-500/15" />
      <div className="absolute -right-20 top-1/3 h-72 w-72 rounded-full bg-orange-300/35 blur-3xl dark:bg-orange-500/10" />
      <div className="absolute -bottom-28 left-1/4 h-80 w-80 rounded-full bg-rose-300/30 blur-3xl dark:bg-rose-500/10" />
      <div
        className="absolute inset-0 opacity-[0.35] dark:opacity-[0.12]"
        style={{
          backgroundImage: 'radial-gradient(rgba(180, 83, 9, 0.18) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
      />
    </div>
  )
}

export default function LoginPage() {
  const { login, loginWith2FA } = useAuth()
  const { branding } = useBranding() || {}
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [tempToken, setTempToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const centerName = branding?.companyName || 'Sonrisitas'
  const tagline = branding?.tagline || 'Centro de Desarrollo Infantil'

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
    <div className="min-h-screen flex bg-[#fffaf2] dark:bg-app">
      {/* Panel de marca (escritorio) */}
      <aside className="relative hidden lg:flex w-[52%] flex-col overflow-hidden border-r border-orange-100 bg-linear-to-br from-[#fff7e6] via-[#fffaf2] to-[#ffefe6] dark:border-white/8 dark:from-surface dark:via-app dark:to-surface">
        <WarmBackdrop />

        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-12 py-10 text-center">
          <CenterLogo className="w-full max-w-md drop-shadow-sm" />
          {/* Vista previa de lo que ve la familia */}
          <p className="mt-12 text-xs font-semibold uppercase tracking-[0.16em] text-orange-700/70 dark:text-orange-200/60">
            Así viven las familias el día
          </p>
          <div className="relative mt-5 h-48 w-full max-w-md">
            <FloatingCard
              icon={CheckCircle2}
              tone="green"
              title="Llegó a las 08:05"
              detail="Entrada registrada"
              className="absolute left-0 top-0 animate-float"
            />
            <FloatingCard
              icon={UtensilsCrossed}
              tone="amber"
              title="Comió todo el almuerzo"
              detail="Arroz con pollo y ensalada"
              className="absolute right-0 top-14 animate-float-slow"
            />
            <FloatingCard
              icon={Camera}
              tone="sky"
              title="3 fotos nuevas del día"
              detail="Pintura con dedos"
              className="absolute left-8 bottom-0 animate-float"
            />
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between gap-4 border-t border-orange-100/80 px-10 py-5 text-xs text-slate-500 dark:border-white/8 dark:text-white/40">
          <span className="inline-flex items-center gap-1.5">
            <MessageCircleHeart className="h-4 w-4 text-orange-500" />
            El día de cada niño, al alcance de su familia
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" /> Datos protegidos
          </span>
        </div>
      </aside>

      {/* Formulario */}
      <main className="relative flex flex-1 flex-col">
        <div className="absolute right-4 top-4 z-20">
          <ThemeToggle size="sm" />
        </div>

        {/* Cabecera de marca (móvil y tablet) */}
        <div className="relative overflow-hidden bg-linear-to-b from-[#fff3dc] to-[#fffaf2] px-6 pb-14 pt-10 text-center lg:hidden dark:from-surface dark:to-app">
          <WarmBackdrop />
          <CenterLogo className="relative z-10 mx-auto w-64 max-w-[80%]" />
        </div>

        <div className="flex flex-1 items-start justify-center px-4 pb-10 lg:items-center lg:py-10">
          <div className="relative z-10 -mt-8 w-full max-w-md lg:mt-0">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xl shadow-orange-900/5 sm:p-8 dark:border-white/10 dark:bg-surface dark:shadow-black/30">
              {!tempToken && (
                <div className="mb-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-600 dark:text-orange-300">
                    {tagline}
                  </p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                    ¡Bienvenido a {centerName}!
                  </h1>
                  <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
                    Ingresa con tu cuenta del centro o de representante.
                  </p>
                </div>
              )}

              <form onSubmit={submit} className="space-y-4">
                {tempToken ? (
                  <>
                    <div className="mb-2 text-center">
                      <span className="mb-2 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-500/20">
                        <ShieldCheck className="h-6 w-6 text-emerald-600 dark:text-emerald-300" />
                      </span>
                      <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Verificación en dos pasos</h1>
                      <p className="text-sm text-slate-500 dark:text-white/50">
                        Escribe el código de 6 dígitos de tu aplicación de autenticación. Cambia cada 30 segundos.
                      </p>
                    </div>
                    <div className="relative">
                      <KeyRound
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                        aria-hidden="true"
                      />
                      <input
                        aria-label="Código de verificación de 6 dígitos"
                        autoComplete="one-time-code"
                        className={`${inputClass} min-h-12 pl-9 text-center text-lg font-semibold tracking-[0.4em]`}
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
                    <div>
                      <label
                        htmlFor="login-email"
                        className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-white/75"
                      >
                        Correo electrónico
                      </label>
                      <div className="relative">
                        <Mail
                          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                          aria-hidden="true"
                        />
                        <input
                          id="login-email"
                          className={`${inputClass} min-h-11 pl-9`}
                          type="email"
                          inputMode="email"
                          value={email}
                          onChange={(e) => {
                            setEmail(e.target.value)
                            if (error) setError('')
                          }}
                          placeholder="correo@ejemplo.com"
                          autoComplete="username"
                          required
                          autoFocus
                        />
                      </div>
                    </div>
                    <div>
                      <label
                        htmlFor="login-password"
                        className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-white/75"
                      >
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
                    className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
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
                    className="min-h-10 w-full text-sm text-slate-500 hover:underline dark:text-white/40"
                  >
                    Volver al inicio de sesión
                  </button>
                )}
              </form>
            </div>

            <p className="mt-6 text-center text-xs text-slate-500 dark:text-white/40">
              ¿Eres representante y no tienes acceso? Pídelo en {centerName}.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
