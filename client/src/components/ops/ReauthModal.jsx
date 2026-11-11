import { useState } from 'react'
import Modal from '../Modal'
import PasswordInput from '../PasswordInput'
import { Button, Field, inputClass } from '../ui'
import { AlertTriangle, Lock } from '../icons'
import { useAuth } from '../../context/AuthContext'
import { errMsg } from './opsFormat'

/**
 * Confirmación fuerte para operaciones críticas: contraseña + código 2FA (si la cuenta lo
 * tiene) y, opcionalmente, escribir una palabra (p. ej. RESTAURAR).
 * `onSubmit({ password, code, confirm })` debe devolver una promesa; si falla, el error
 * se muestra en el propio modal.
 */
export default function ReauthModal({
  open,
  onClose,
  title,
  subtitle,
  description,
  confirmWord,
  confirmLabel = 'Confirmar',
  variant = 'primary',
  onSubmit,
  children,
}) {
  const { user } = useAuth()
  const needsCode = !!user?.totpEnabled
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [word, setWord] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reset = () => {
    setPassword('')
    setCode('')
    setWord('')
    setError('')
    setBusy(false)
  }
  const close = () => {
    if (busy) return
    reset()
    onClose?.()
  }

  const ready =
    password.length > 0 &&
    (!needsCode || /^\d{6}$/.test(code)) &&
    (!confirmWord || word.trim() === confirmWord)

  const submit = async (e) => {
    e?.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError('')
    try {
      await onSubmit({ password, ...(needsCode ? { code } : {}), ...(confirmWord ? { confirm: word.trim() } : {}) })
      reset()
    } catch (err) {
      setError(errMsg(err, 'No se pudo completar la operación'))
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      subtitle={subtitle}
      width="md"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancelar
          </Button>
          <Button variant={variant} icon={Lock} onClick={submit} loading={busy} disabled={!ready}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {description && (
          <div className="flex gap-3 rounded-lg border border-amber-200 dark:border-amber-400/20 bg-amber-50 dark:bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100">
            <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-300" />
            <div className="space-y-1">{description}</div>
          </div>
        )}
        {children}
        <Field label="Tu contraseña" required>
          <PasswordInput
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={busy}
          />
        </Field>
        {needsCode && (
          <Field label="Código de verificación (2FA)" required hint="Los 6 dígitos de tu app de autenticación.">
            <input
              className={`${inputClass} tabular-nums tracking-widest`}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={busy}
            />
          </Field>
        )}
        {confirmWord && (
          <Field label={`Escribe ${confirmWord} para confirmar`} required>
            <input
              className={`${inputClass} font-mono`}
              value={word}
              onChange={(e) => setWord(e.target.value.toUpperCase())}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </Field>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  )
}
