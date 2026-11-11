import { useState, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import { Download, X } from './icons'

/*
 * Invitación a instalar la PWA, discreta a propósito:
 *  - nunca en las primeras visitas (hace falta volver al menos 3 veces y llevar >10 min
 *    desde la primera), ni si se descartó en los últimos 45 días;
 *  - nunca flota sobre el contenido: en el panel es un chip dentro de la barra superior
 *    (<InstallChip/>), y en el portal de familias una franja fina en el flujo de la página.
 * Si el navegador no dispara `beforeinstallprompt` (Safari iOS, Firefox) no se muestra.
 */

const DISMISS_KEY = 'sonrisas_install_dismissed_at'
const FIRST_SEEN_KEY = 'sonrisas_first_seen_at'
const VISITS_KEY = 'sonrisas_visits'
const SESSION_KEY = 'sonrisas_visit_counted'
const DISMISS_DAYS = 45
const MIN_VISITS = 3
const MIN_AGE_MS = 10 * 60 * 1000

function safeGet(store, key) {
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}
function safeSet(store, key, value) {
  try {
    store.setItem(key, value)
  } catch {
    // almacenamiento bloqueado: se ignora
  }
}

// --- Estado del módulo: el evento llega muy pronto, antes de montar cualquier componente.
let deferredEvent = null
let dismissed = false
const listeners = new Set()
const emit = () => listeners.forEach((l) => l())

if (typeof window !== 'undefined') {
  // Contador de visitas (una por sesión del navegador) y fecha de la primera.
  if (!safeGet(localStorage, FIRST_SEEN_KEY)) safeSet(localStorage, FIRST_SEEN_KEY, String(Date.now()))
  if (!safeGet(sessionStorage, SESSION_KEY)) {
    safeSet(sessionStorage, SESSION_KEY, '1')
    safeSet(localStorage, VISITS_KEY, String(Number(safeGet(localStorage, VISITS_KEY) || 0) + 1))
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredEvent = e
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferredEvent = null
    emit()
  })
}

function eligible() {
  if (!deferredEvent || dismissed) return false
  if (window.matchMedia?.('(display-mode: standalone)').matches) return false
  const dismissedAt = Number(safeGet(localStorage, DISMISS_KEY) || 0)
  if (dismissedAt && Date.now() - dismissedAt < DISMISS_DAYS * 24 * 3600 * 1000) return false
  const visits = Number(safeGet(localStorage, VISITS_KEY) || 0)
  const firstSeen = Number(safeGet(localStorage, FIRST_SEEN_KEY) || Date.now())
  return visits >= MIN_VISITS && Date.now() - firstSeen >= MIN_AGE_MS
}

const subscribe = (cb) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** `{ canInstall, install, dismiss }` para quien quiera ofrecer la instalación. */
export function useInstallPrompt() {
  const canInstall = useSyncExternalStore(subscribe, eligible, () => false)
  const dismiss = () => {
    safeSet(localStorage, DISMISS_KEY, String(Date.now()))
    dismissed = true
    emit()
  }
  const install = async () => {
    const evt = deferredEvent
    if (!evt) return
    try {
      evt.prompt()
      const { outcome } = await evt.userChoice
      if (outcome === 'dismissed') safeSet(localStorage, DISMISS_KEY, String(Date.now()))
    } finally {
      deferredEvent = null
      emit()
    }
  }
  return { canInstall, install, dismiss }
}

/** Chip compacto para la barra superior del panel. */
export function InstallChip() {
  const { canInstall, install, dismiss } = useInstallPrompt()
  if (!canInstall) return null
  return (
    <span className="hidden sm:inline-flex items-center rounded-full border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-white/80">
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 text-xs font-medium rounded-l-full hover:bg-slate-50 dark:hover:bg-white/10"
        title="Instala Sonrisas: ícono en tu pantalla y avisos nativos"
      >
        <Download className="w-3.5 h-3.5" /> Instalar app
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="No mostrar la invitación a instalar"
        className="p-1.5 mr-0.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:text-white/40 dark:hover:text-white dark:hover:bg-white/10"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </span>
  )
}

/**
 * Franja fina fuera del panel (portal de familias). Va en el flujo normal, arriba de
 * todo: empuja el contenido en vez de taparlo. En el panel no se pinta (allí está el chip).
 */
export default function InstallPrompt() {
  const { pathname } = useLocation()
  const { canInstall, install, dismiss } = useInstallPrompt()
  const [busy, setBusy] = useState(false)
  if (!canInstall || !pathname.startsWith('/familia')) return null
  return (
    <div className="relative z-30 flex items-center gap-3 px-4 py-2 text-xs bg-white dark:bg-surface border-b border-slate-200 dark:border-white/8 text-slate-700 dark:text-white/80">
      <Download className="w-4 h-4 shrink-0 text-accent-text" />
      <p className="flex-1 min-w-0 truncate">
        <span className="font-medium text-slate-900 dark:text-white">Instala Sonrisas</span>
        <span className="hidden sm:inline"> · ícono en tu pantalla y avisos al instante</span>
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await install()
          setBusy(false)
        }}
        className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-accent-fg font-medium"
      >
        Instalar
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Ahora no"
        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/10"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
