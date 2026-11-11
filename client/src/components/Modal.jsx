import { useEffect, useId, useRef } from 'react'
import { X } from './icons'

const WIDTHS = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Modal genérico del panel. En móvil se abre como hoja inferior.
 * Cierra con Escape y con clic en el fondo; enfoca el primer campo al abrir,
 * mantiene el Tab dentro y devuelve el foco al cerrar.
 */
export default function Modal({ open, onClose, title, subtitle, children, footer, width = 'md' }) {
  const panelRef = useRef(null)
  const closeRef = useRef(onClose)
  const titleId = useId()

  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement
    const panel = panelRef.current

    // Primer campo del cuerpo; si no hay, el propio panel (no el botón cerrar).
    const focusTimer = setTimeout(() => {
      if (!panel || panel.contains(document.activeElement)) return
      // En pantallas táctiles no se abre el teclado sin que la usuaria lo pida.
      const touch = window.matchMedia?.('(pointer: coarse)').matches
      const field = touch
        ? null
        : panel.querySelector(
            '[data-modal-body] input:not([disabled]):not([type="hidden"]), [data-modal-body] select:not([disabled]), [data-modal-body] textarea:not([disabled])',
          )
      ;(field || panel).focus({ preventScroll: true })
    }, 30)

    const onKey = (e) => {
      if (e.defaultPrevented) return
      if (e.key === 'Escape') {
        closeRef.current?.()
        return
      }
      if (e.key === 'Tab' && panel) {
        const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null)
        if (!items.length) return
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    // Bloquear el scroll del fondo evita que el listado se mueva bajo el modal en móvil.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus({ preventScroll: true })
      }
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-slate-900/40 dark:bg-black/60 animate-fade-in" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative w-full ${WIDTHS[width] || WIDTHS.md} max-h-[92dvh] overflow-hidden rounded-t-2xl sm:rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-elevated shadow-xl flex flex-col focus:outline-none animate-fade-in-up`}
      >
        {/* Asa visual de hoja inferior en móvil */}
        <span className="sm:hidden mx-auto mt-2 h-1.5 w-10 rounded-full bg-slate-200 dark:bg-white/15" aria-hidden="true" />
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-200/70 dark:border-white/8">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-slate-900 dark:text-white truncate">
              {title}
            </h2>
            {subtitle && (
              <p className="text-sm text-slate-500 dark:text-white/50 truncate">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 -m-2 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/10"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div data-modal-body className="px-5 py-4 overflow-y-auto flex-1">
          {children}
        </div>

        {footer && (
          <div className="px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:pb-3 border-t border-slate-200/70 dark:border-white/8 flex flex-wrap justify-end gap-2 bg-slate-50 dark:bg-white/3">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
