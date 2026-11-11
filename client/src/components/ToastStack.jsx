import { AlertTriangle, CheckCircle2, Info, X, XCircle } from './icons'
import { useToasts } from '../context/ToastsContext'

/*
 * Avisos flotantes. Fondo sólido (se leen sobre cualquier página), icono + texto,
 * franja de color a la izquierda. Arriba a la derecha bajo la barra superior: así no
 * tapan la barra de navegación inferior del móvil ni las barras de guardar.
 * El cierre automático lo hace ToastsContext.
 */
const STYLES = {
  success: {
    icon: CheckCircle2,
    label: 'Listo',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  warning: {
    icon: AlertTriangle,
    label: 'Atención',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  error: {
    icon: XCircle,
    label: 'Error',
    iconColor: 'text-red-600 dark:text-red-400',
  },
  info: {
    icon: Info,
    label: 'Aviso',
    iconColor: 'text-sky-600 dark:text-sky-400',
  },
}

const MAX_VISIBLE = 4

export default function ToastStack() {
  const { toasts, dismissToast } = useToasts()

  return (
    <div
      aria-live="polite"
      className="fixed z-[80] left-3 right-3 top-[calc(0.5rem+env(safe-area-inset-top,0px))] sm:left-auto sm:right-4 sm:top-16 sm:w-96 flex flex-col gap-2 pointer-events-none"
    >
      {toasts.slice(-MAX_VISIBLE).map((t) => {
        const style = STYLES[t.type] || STYLES.info
        const Icon = style.icon
        return (
          <div
            key={t.id}
            role={t.type === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto relative overflow-hidden rounded-xl bg-white dark:bg-elevated border border-slate-200 dark:border-white/10 shadow-lg shadow-slate-900/8 dark:shadow-black/40 pl-3.5 pr-2 py-3 flex items-start gap-3 animate-pop-in"
          >
            <Icon className={`w-5 h-5 ${style.iconColor} shrink-0 mt-0.5`} aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <span className="sr-only">{style.label}: </span>
              <p className="font-medium text-sm leading-snug text-slate-900 dark:text-white break-words">
                {t.title || t.message}
              </p>
              {t.title && t.message && (
                <p className="text-xs mt-0.5 text-slate-600 dark:text-white/70 break-words">{t.message}</p>
              )}
              {t.subtitle && (
                <p className="text-xs mt-0.5 text-slate-500 dark:text-white/60">{t.subtitle}</p>
              )}
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              className="shrink-0 p-1.5 -my-0.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/10"
              aria-label="Cerrar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
