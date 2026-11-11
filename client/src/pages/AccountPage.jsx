import { useRef, useState } from 'react'
import {
  Briefcase,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  Phone,
  Upload,
  User as UserIcon,
} from '../components/icons'
import { api, mediaUrl } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToasts } from '../context/ToastsContext'
import TwoFactorCard from '../components/TwoFactorCard'
import { PageHeader, inputClass } from '../components/ui'

export default function AccountPage() {
  const { user, refreshUser } = useAuth()
  const { pushToast } = useToasts()

  return (
    <div className="space-y-5">
      <PageHeader icon={UserIcon} title="Mi cuenta" subtitle="Actualiza tu información de perfil y tu contraseña." />

      {/* key: re-monta el formulario cuando cambian los datos guardados (sin efecto de sincronización) */}
      <ProfileCard key={`${user?.id}|${user?.name || ''}|${user?.phone || ''}`} user={user} onSaved={async () => { await refreshUser(); pushToast({ type: 'success', title: 'Perfil actualizado' }) }} onError={(m) => pushToast({ type: 'error', title: 'No se pudo guardar', subtitle: m })} />

      {/* Password + 2FA lado a lado en pantallas anchas */}
      <div className="grid xl:grid-cols-2 gap-5 items-start">
        <ChangePasswordCard onDone={() => pushToast({ type: 'success', title: 'Contraseña actualizada' })} onError={(m) => pushToast({ type: 'error', title: 'No se pudo cambiar', subtitle: m })} />
        <TwoFactorCard
          onActivated={() => pushToast({ type: 'success', title: '2FA activado', subtitle: 'En tu próximo login te pediremos el código.' })}
          onDisabled={() => pushToast({ type: 'success', title: '2FA desactivado' })}
          onError={(m) => pushToast({ type: 'error', title: 'Error con 2FA', subtitle: m })}
        />
      </div>

      <SessionsCard onDone={() => pushToast({ type: 'success', title: 'Otras sesiones cerradas', subtitle: 'Cualquier dispositivo donde estuvieras logueado deberá iniciar sesión de nuevo.' })} onError={(m) => pushToast({ type: 'error', title: 'No se pudo cerrar', subtitle: m })} />
    </div>
  )
}

function ProfileCard({ user, onSaved, onError }) {
  const fileRef = useRef(null)
  const [name, setName] = useState(user?.name || '')
  const [phone, setPhone] = useState(user?.phone || '')
  const [photoBase64, setPhotoBase64] = useState(null)
  const [preview, setPreview] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const onFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 8 * 1024 * 1024) { onError('La foto supera 8 MB.'); return }
    const reader = new FileReader()
    reader.onload = () => { setPhotoBase64(String(reader.result || '')); setPreview(String(reader.result || '')) }
    reader.onerror = () => onError('No se pudo leer la imagen.')
    reader.readAsDataURL(f)
    e.target.value = ''
  }

  const submit = async (e) => {
    e.preventDefault()
    if (name.trim().length < 2) { onError('Escribe tu nombre.'); return }
    setSubmitting(true)
    try {
      await api.patch('/auth/profile', {
        name: name.trim(),
        phone: phone.trim(),
        photoBase64: photoBase64 || undefined,
      })
      setPhotoBase64(null) // ya está guardada
      onSaved()
    } catch (err) {
      const m = err?.response?.data?.message
      onError(Array.isArray(m) ? m.join(' · ') : m || 'Error desconocido')
    } finally { setSubmitting(false) }
  }

  const shownPhoto = preview || (user?.photoUrl ? mediaUrl(user.photoUrl) : null)
  const initials = (user?.name || '').split(' ').slice(0, 2).map((s) => s[0]).join('').toUpperCase() || 'U'

  return (
    <form onSubmit={submit} className="rounded-xl bg-white dark:bg-surface border border-slate-200 dark:border-white/8 shadow-xs p-5 sm:p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Perfil</h2>
        <p className="text-sm text-slate-500 dark:text-white/50">Tu nombre, teléfono y foto como los ve el equipo.</p>
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative">
          <div className="w-16 h-16 rounded-full overflow-hidden bg-slate-100 dark:bg-white/10 ring-1 ring-inset ring-slate-900/5 dark:ring-white/10 text-slate-600 dark:text-white/75 text-lg font-semibold flex items-center justify-center">
            {shownPhoto ? <img src={shownPhoto} alt="" className="w-full h-full object-cover" /> : initials}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-700 dark:text-white/80">Foto de perfil</p>
          <p className="text-xs text-slate-500 dark:text-white/50">JPG/PNG hasta 8 MB.</p>
          <button type="button" onClick={() => fileRef.current?.click()} className="mt-2 inline-flex items-center justify-center gap-1.5 min-h-9 px-3.5 py-1.5 rounded-lg text-sm font-medium bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/85 hover:bg-slate-50 dark:hover:bg-white/10 shadow-xs transition-colors">
            <Upload className="w-4 h-4" /> Cambiar foto
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Nombre completo" icon={UserIcon}>
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} className={inputCls} />
        </Field>
        <Field label="Teléfono" icon={Phone}>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} className={inputCls} placeholder="+593…" />
        </Field>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Correo (no editable)" icon={Mail}>
          <input value={user?.email || ''} disabled className={inputCls + ' cursor-not-allowed'} />
        </Field>
        {!!user?.position && (
          <Field label="Cargo" icon={Briefcase}>
            <input value={user.position} disabled className={inputCls + ' cursor-not-allowed'} />
          </Field>
        )}
      </div>
      <p className="text-xs text-slate-500 dark:text-white/45">Para cambiar correo, cargo o departamento, contacta al administrador.</p>

      <div className="flex justify-end">
        <button type="submit" disabled={submitting} className="inline-flex items-center justify-center gap-2 min-h-9 px-3.5 py-1.5 rounded-lg text-sm font-medium bg-accent text-accent-fg hover:bg-accent-hover shadow-xs disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-1">
          <CheckCircle2 className="w-4 h-4" /> {submitting ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  )
}

function ChangePasswordCard({ onDone, onError }) {
  const { user, applyNewToken } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNext, setShowNext] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const requires2FA = !!user?.totpEnabled

  const submit = async (e) => {
    e.preventDefault()
    if (next.length < 8) { onError('La nueva contraseña debe tener al menos 8 caracteres.'); return }
    if (next !== confirm) { onError('La confirmación no coincide.'); return }
    if (next === current) { onError('La nueva contraseña debe ser distinta de la actual.'); return }
    if (requires2FA && totpCode.replace(/\s/g, '').length !== 6) {
      onError('Tu cuenta tiene 2FA activo: ingresa el código de 6 dígitos.'); return
    }
    setSubmitting(true)
    try {
      const payload = { currentPassword: current, newPassword: next }
      if (requires2FA) payload.totpCode = totpCode.replace(/\s/g, '')
      const { data } = await api.post('/auth/change-password', payload)
      // El backend devolvió un accessToken nuevo (la versión anterior queda invalidada).
      applyNewToken(data)
      setCurrent(''); setNext(''); setConfirm(''); setTotpCode('')
      onDone()
    } catch (err) {
      const m = err?.response?.data?.message
      onError(Array.isArray(m) ? m.join(' · ') : m || 'Error desconocido')
    } finally { setSubmitting(false) }
  }

  return (
    <form onSubmit={submit} className="rounded-xl bg-white dark:bg-surface border border-slate-200 dark:border-white/8 shadow-xs p-5 sm:p-6 space-y-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Cambiar contraseña</h2>
        <p className="text-sm text-slate-500 dark:text-white/50">Mínimo 8 caracteres. Al cambiarla se cierran tus otras sesiones.</p>
      </div>
      <Field label="Contraseña actual" icon={Lock}>
        <div className="relative">
          <input type={showCurrent ? 'text' : 'password'} value={current} onChange={(e) => setCurrent(e.target.value)} required className={inputCls + ' pr-10'} />
          <button type="button" onClick={() => setShowCurrent((s) => !s)} className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white">
            {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </Field>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Nueva contraseña" icon={Lock}>
          <div className="relative">
            <input type={showNext ? 'text' : 'password'} value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} className={inputCls + ' pr-10'} />
            <button type="button" onClick={() => setShowNext((s) => !s)} className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white">
              {showNext ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </Field>
        <Field label="Confirmar nueva contraseña" icon={Lock}>
          <input type={showNext ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} className={inputCls} />
        </Field>
      </div>
      {requires2FA && (
        <Field label="Código TOTP de tu app autenticadora" icon={KeyRound}>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value.replace(/[^0-9 ]/g, '').slice(0, 7))}
            required
            maxLength={7}
            placeholder="••••••"
            className={inputCls + ' tracking-[0.4em] text-center font-mono'}
          />
          <p className="text-xs text-slate-500 dark:text-white/45 mt-1">Tu cuenta tiene 2FA: para cambiar la contraseña debes confirmar con tu autenticadora.</p>
        </Field>
      )}
      <p className="text-xs text-slate-500 dark:text-white/45">Mínimo 8 caracteres. Recomendamos usar letras, números y símbolos.</p>
      <div className="flex justify-end">
        <button type="submit" disabled={submitting || !current || next.length < 8 || next !== confirm || (requires2FA && totpCode.replace(/\s/g, '').length !== 6)} className="inline-flex items-center justify-center gap-2 min-h-9 px-3.5 py-1.5 rounded-lg text-sm font-medium bg-accent text-accent-fg hover:bg-accent-hover shadow-xs disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-1">
          <KeyRound className="w-4 h-4" /> {submitting ? 'Actualizando…' : 'Cambiar contraseña'}
        </button>
      </div>
    </form>
  )
}

function SessionsCard({ onDone, onError }) {
  const { applyNewToken } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const submit = async () => {
    setSubmitting(true)
    try {
      const { data } = await api.post('/auth/logout-all')
      applyNewToken(data)
      setConfirmOpen(false)
      onDone()
    } catch (err) {
      const m = err?.response?.data?.message
      onError(Array.isArray(m) ? m.join(' · ') : m || 'Error desconocido')
    } finally { setSubmitting(false) }
  }
  return (
    <div className="rounded-xl bg-white dark:bg-surface border border-slate-200 dark:border-white/8 shadow-xs p-5 sm:p-6 space-y-4">
      <div className="flex items-start gap-4">
        <div className="w-9 h-9 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-slate-500 dark:text-white/60 flex items-center justify-center shrink-0">
          <Lock className="w-[18px] h-[18px]" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Cerrar sesión en otros dispositivos</h2>
          <p className="text-sm text-slate-500 dark:text-white/50 mt-0.5">Invalida cualquier sesión activa tuya en otros navegadores o móviles. Tu sesión actual sigue abierta.</p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        {!confirmOpen ? (
          <button onClick={() => setConfirmOpen(true)} className="inline-flex items-center justify-center gap-1.5 min-h-9 px-3.5 py-1.5 rounded-lg text-sm font-medium bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/85 hover:bg-slate-50 dark:hover:bg-white/10 shadow-xs transition-colors">Cerrar otras</button>
        ) : (
          <>
            <button onClick={() => setConfirmOpen(false)} className="inline-flex items-center justify-center gap-1.5 min-h-9 px-3.5 py-1.5 rounded-lg text-sm font-medium bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/85 hover:bg-slate-50 dark:hover:bg-white/10 shadow-xs transition-colors">Cancelar</button>
            <button onClick={submit} disabled={submitting} className="inline-flex items-center justify-center min-h-9 px-3.5 py-1.5 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 dark:hover:bg-red-500 shadow-xs disabled:opacity-50 transition-colors">
              {submitting ? 'Cerrando…' : 'Sí, cerrar todas'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

const inputCls = inputClass
function Field({ label, icon: Icon, children }) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-[13px] font-medium text-slate-700 dark:text-white/75 mb-1.5">
        {Icon && <Icon className="w-3.5 h-3.5 text-slate-400 dark:text-white/40" />} {label}
      </label>
      {children}
    </div>
  )
}
