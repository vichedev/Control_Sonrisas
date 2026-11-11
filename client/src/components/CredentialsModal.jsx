import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { AlertCircle, Check, CheckCircle2, Copy, Eye, EyeOff, KeyRound, Link as LinkIcon, ShieldAlert, User, WhatsappLogo } from './icons'
import Modal from './Modal'
import { Button } from './ui'
import { useBranding } from '../context/BrandingContext'
import { useAuth } from '../context/AuthContext'
import { api, apiError } from '../api/client'

/** ¿El WhatsApp del centro puede enviar ahora? (null = consultando) */
function useCenterWhatsapp() {
  const [state, setState] = useState(null)
  useEffect(() => {
    let cancelled = false
    api
      .get('/whatsapp/provider')
      .then(({ data }) => !cancelled && setState({ ready: data?.connected === true || data?.provider === 'cloud', phone: data?.linked?.phone || '' }))
      .catch(() => !cancelled && setState({ ready: false, phone: '' }))
    return () => {
      cancelled = true
    }
  }, [])
  return state
}

/**
 * Envío de las credenciales por el WhatsApp vinculado del centro (sin abrir otras pestañas).
 * El backend sólo acepta la contraseña temporal vigente y nunca la guarda en la bitácora.
 */
function SendAccessButton({ credential, wa, canConfigure }) {
  const [state, setState] = useState({ status: 'idle', toPhone: '', error: '' })
  const userId = credential.userId || credential.guardianId || credential.id
  const send = async () => {
    setState({ status: 'sending', toPhone: '', error: '' })
    try {
      const body = { tempPassword: credential.tempPassword }
      if (userId) body.userId = userId
      else body.email = credential.email
      const { data } = await api.post('/whatsapp/send-access', body)
      if (data.status === 'sent' || data.status === 'queued') setState({ status: 'sent', toPhone: data.toPhone, error: '' })
      else setState({ status: 'failed', toPhone: data.toPhone, error: data.error || 'No se pudo enviar' })
    } catch (err) {
      setState({ status: 'failed', toPhone: '', error: apiError(err, 'No se pudo enviar') })
    }
  }

  if (wa === null) {
    return (
      <Button size="sm" variant="secondary" icon={WhatsappLogo} disabled>
        Enviar por WhatsApp del centro
      </Button>
    )
  }
  if (!wa.ready) {
    return (
      <div className="w-full space-y-1.5">
        <Button size="sm" variant="secondary" icon={WhatsappLogo} disabled>
          Enviar por WhatsApp del centro
        </Button>
        <p className="flex items-start gap-1.5 text-xs text-slate-500 dark:text-white/45">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>
            El WhatsApp del centro no está conectado.{' '}
            {canConfigure ? (
              <RouterLink to="/panel/ajustes/whatsapp" className="font-medium text-accent-text underline underline-offset-2">
                Conectarlo
              </RouterLink>
            ) : (
              'Pide a dirección que lo conecte.'
            )}{' '}
            Mientras tanto, copia los datos.
          </span>
        </p>
      </div>
    )
  }
  if (state.status === 'sent') {
    return (
      <span className="inline-flex items-center gap-1.5 min-h-8 px-2.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300">
        <CheckCircle2 className="w-4 h-4" /> Enviado por WhatsApp{state.toPhone ? ` a ${state.toPhone}` : ''}
      </span>
    )
  }
  return (
    <div className="w-full space-y-1.5">
      <Button size="sm" variant={state.status === 'failed' ? 'secondary' : 'success'} icon={WhatsappLogo} loading={state.status === 'sending'} onClick={send}>
        {state.status === 'sending' ? 'Enviando…' : state.status === 'failed' ? 'Reintentar envío' : 'Enviar por WhatsApp del centro'}
      </Button>
      {state.status === 'failed' && (
        <p className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" /> {state.error}
        </p>
      )}
    </div>
  )
}

/** Copia al portapapeles con respaldo para navegadores sin la API moderna. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

function useCopy() {
  const [copied, setCopied] = useState(null)
  const copy = async (key, text) => {
    if (await copyText(text)) {
      setCopied(key)
      setTimeout(() => setCopied((k) => (k === key ? null : k)), 1800)
    }
  }
  return [copied, copy]
}

function CopyRow({ icon: Icon, label, value, mono, secret, copied, onCopy }) {
  const [visible, setVisible] = useState(true)
  return (
    <div className="flex items-center gap-3 rounded-lg bg-slate-50 dark:bg-white/4 border border-slate-200 dark:border-white/10 px-3 py-2.5">
      <Icon className="w-4 h-4 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-slate-500 dark:text-white/45">{label}</p>
        <p
          className={`truncate text-slate-900 dark:text-white ${mono ? 'font-mono text-base font-semibold tracking-wider' : 'text-sm font-medium'}`}
          title={visible ? value : undefined}
        >
          {secret && !visible ? '••••••••••••' : value}
        </p>
      </div>
      {secret && (
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 dark:hover:text-white dark:hover:bg-white/10"
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          title={visible ? 'Ocultar' : 'Mostrar'}
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      )}
      <button
        type="button"
        onClick={onCopy}
        className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
          copied
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-400/20'
            : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100 dark:bg-white/5 dark:text-white/80 dark:border-white/10 dark:hover:bg-white/10'
        }`}
        aria-label={`Copiar ${label.toLowerCase()}`}
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  )
}

/**
 * Muestra las credenciales recién generadas (se ven UNA sola vez).
 *
 * props:
 *  - credentials: [{ name, email, tempPassword, userId? | guardianId? | id? }]
 *    (sin id, el envío por WhatsApp identifica la cuenta por su correo)
 *  - audience: 'family' (portal familiar) | 'staff' (personal)
 */
export default function CredentialsModal({ credentials, audience = 'family', onClose }) {
  const { branding } = useBranding() || {}
  const [copied, copy] = useCopy()
  const { isAdmin } = useAuth()
  const wa = useCenterWhatsapp()
  const list = (credentials || []).filter((c) => c?.tempPassword)
  if (!list.length) return null

  const center = branding?.companyName || 'Sonrisas'
  const url = window.location.origin
  const isFamily = audience === 'family'

  const messageFor = (c) =>
    [
      `Hola ${c.name}, estos son tus datos de acceso ${isFamily ? `al portal familiar de ${center}` : `al sistema de ${center}`}:`,
      '',
      `Ingresa en: ${url}`,
      `Usuario: ${c.email}`,
      `Contraseña temporal: ${c.tempPassword}`,
      '',
      'Al entrar por primera vez el sistema te pedirá crear tu propia contraseña.',
    ].join('\n')

  return (
    <Modal
      open
      onClose={onClose}
      width="md"
      title={isFamily ? 'Acceso al portal familiar' : 'Acceso al sistema'}
      subtitle={list.length > 1 ? `${list.length} cuentas listas para entregar` : 'Cuenta lista para entregar'}
      footer={<Button onClick={onClose}>Listo, ya lo entregué</Button>}
    >
      <div className="space-y-4">
        <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
          <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
          <p>
            Por seguridad, la contraseña temporal <strong>solo se muestra ahora</strong>. Envíala por
            WhatsApp o cópiala antes de cerrar. Si se pierde, usa <strong>«Restablecer acceso»</strong> para generar otra.
          </p>
        </div>

        {list.map((c, i) => {
          const k = `${i}-${c.email}`
          return (
            <section
              key={k}
              className="rounded-xl border border-slate-200 dark:border-white/8 p-4 space-y-2.5"
            >
              <div className="flex items-center gap-3 pb-1">
                <div className="w-10 h-10 shrink-0 rounded-full bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/75 ring-1 ring-inset ring-slate-900/5 dark:ring-white/10 grid place-items-center font-semibold">
                  {(c.name || '?').trim().charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 dark:text-white truncate">{c.name}</p>
                  <p className="text-xs text-slate-500 dark:text-white/50">
                    {isFamily ? 'Representante · portal familiar' : 'Personal del centro'}
                  </p>
                </div>
              </div>

              <CopyRow icon={LinkIcon} label="Dirección de ingreso" value={url}
                copied={copied === `${k}:url`} onCopy={() => copy(`${k}:url`, url)} />
              <CopyRow icon={User} label="Usuario (correo)" value={c.email}
                copied={copied === `${k}:user`} onCopy={() => copy(`${k}:user`, c.email)} />
              <CopyRow icon={KeyRound} label="Contraseña temporal" value={c.tempPassword} mono secret
                copied={copied === `${k}:pass`} onCopy={() => copy(`${k}:pass`, c.tempPassword)} />

              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  variant={copied === `${k}:all` ? 'success' : 'secondary'}
                  icon={copied === `${k}:all` ? Check : Copy}
                  onClick={() => copy(`${k}:all`, messageFor(c))}
                >
                  {copied === `${k}:all` ? 'Mensaje copiado' : 'Copiar mensaje completo'}
                </Button>
<SendAccessButton credential={c} wa={wa} canConfigure={isAdmin} />
              </div>
            </section>
          )
        })}

        <p className="text-xs text-center text-slate-500 dark:text-white/40">
          Al ingresar por primera vez, {isFamily ? 'el representante' : 'la persona'} deberá crear su propia contraseña.
        </p>
      </div>
    </Modal>
  )
}
