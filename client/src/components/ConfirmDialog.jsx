import { useEffect, useId, useRef } from 'react'
import { AlertTriangle, CheckCircle2, Info, Trash2, X } from './icons'

const VARIANTS = {
  info: {
    icon: Info,
    iconBg: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300',
    confirmBtn: 'bg-accent text-accent-fg hover:bg-accent-hover',
  },
  success: {
    icon: CheckCircle2,
    iconBg: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
    confirmBtn: 'bg-emerald-600 text-white hover:bg-emerald-700 dark:hover:bg-emerald-500',
  },
  warning: {
    icon: AlertTriangle,
    iconBg: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
    confirmBtn: 'bg-amber-500 text-slate-950 hover:bg-amber-400',
  },
  danger: {
    icon: Trash2,
    iconBg: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300',
    confirmBtn: 'bg-red-600 text-white hover:bg-red-700 dark:hover:bg-red-500',
  },
}

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = '¿Estás seguro?',
  message,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  variant = 'info',
  icon: CustomIcon,
  loading = false,
  details,
}) {
  const titleId = useId()
  const cancelRef = useRef(null)
  const confirmRef = useRef(null)

  useEffect(() => {
    if (!open) return
    // En captura y deteniendo la propagación: si hay un Modal debajo, no se cierra también.
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (!loading) onClose?.()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, loading, onClose])

  // Foco inicial: "Cancelar" en acciones peligrosas, "Confirmar" en las demás.
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement
    const t = setTimeout(() => {
      ;(variant === 'danger' ? cancelRef.current : confirmRef.current)?.focus()
    }, 30)
    return () => {
      clearTimeout(t)
      if (prev && typeof prev.focus === 'function') prev.focus({ preventScroll: true })
    }
  }, [open, variant])

  if (!open) return null

  const cfg = VARIANTS[variant] || VARIANTS.info
  const Icon = CustomIcon || cfg.icon

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 dark:bg-black/60 animate-fade-in"
      onClick={() => !loading && onClose?.()}
    >
      <div
        className="relative w-full max-w-md animate-fade-in-up"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative bg-white dark:bg-elevated border border-slate-200 dark:border-white/10 rounded-xl shadow-xl overflow-hidden">
          <button
            type="button"
            onClick={() => !loading && onClose?.()}
            disabled={loading}
            className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:text-white/50 dark:hover:text-white dark:hover:bg-white/10 transition disabled:opacity-40"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="px-6 pt-6 pb-2 flex items-start gap-4">
            <div
              className={`shrink-0 w-10 h-10 rounded-full ${cfg.iconBg} flex items-center justify-center`}
            >
              <Icon className="w-5 h-5" />
            </div>

            <div className="min-w-0 flex-1 pr-6">
            <h3 id={titleId} className="text-base font-semibold text-slate-900 dark:text-white mb-1">
              {title}
            </h3>

            {message && (
              <p className="text-sm text-slate-600 dark:text-white/65 leading-relaxed">
                {message}
              </p>
            )}

            {details && (
              <div className="mt-3 p-3 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-700 dark:text-white/80">
                {details}
              </div>
            )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-6 py-4 mt-2 bg-slate-50 dark:bg-white/3 border-t border-slate-100 dark:border-white/5">
            <button
              ref={cancelRef}
              type="button"
              onClick={() => !loading && onClose?.()}
              disabled={loading}
              className="flex-1 sm:flex-none min-h-10 px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 dark:text-white/85 dark:hover:text-white dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 rounded-lg shadow-xs transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
            >
              {cancelText}
            </button>
            <button
              ref={confirmRef}
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className={`flex-1 sm:flex-none min-h-10 px-4 py-2 text-sm font-medium rounded-lg shadow-xs transition disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-1 ${cfg.confirmBtn}`}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                  Procesando…
                </span>
              ) : (
                confirmText
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
