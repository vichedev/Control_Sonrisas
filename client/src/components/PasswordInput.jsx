import { useState } from 'react'
import { Eye, EyeOff, Lock } from './icons'
import { inputClass } from './ui'

/**
 * Campo de contraseña con botón "Mostrar/Ocultar" y aviso de Bloq Mayús activado.
 * Acepta las mismas props que un <input> (value, onChange, autoComplete, id…).
 * `withIcon` añade el candado a la izquierda (pantalla de inicio de sesión).
 */
export default function PasswordInput({ withIcon = false, className = '', onKeyUp, onKeyDown, onBlur, ...rest }) {
  const [visible, setVisible] = useState(false)
  const [caps, setCaps] = useState(false)
  const readCaps = (e) => {
    if (typeof e.getModifierState === 'function') setCaps(e.getModifierState('CapsLock'))
  }
  return (
    <div>
      <div className="relative">
        {withIcon && (
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" aria-hidden="true" />
        )}
        <input
          {...rest}
          type={visible ? 'text' : 'password'}
          className={`${inputClass} min-h-11 pr-24 ${withIcon ? 'pl-9' : ''} ${className}`}
          onKeyUp={(e) => {
            readCaps(e)
            onKeyUp?.(e)
          }}
          onKeyDown={(e) => {
            readCaps(e)
            onKeyDown?.(e)
          }}
          onBlur={(e) => {
            setCaps(false)
            onBlur?.(e)
          }}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 px-2 h-8 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-white/50 dark:hover:text-white dark:hover:bg-white/10"
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          {visible ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
      {caps && (
        <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300" role="status">
          Bloq Mayús está activado
        </p>
      )}
    </div>
  )
}
