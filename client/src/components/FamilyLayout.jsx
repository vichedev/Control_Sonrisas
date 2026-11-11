import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Baby, Images, MessageCircleHeart, ShieldCheck } from './icons'
import FamilyConsentGate from './consent/FamilyConsentGate'
import Logo from './Logo'
import ThemeToggle from './ThemeToggle'
import UserMenu from './UserMenu'
import { LiveIndicator } from '../realtime'

const LINKS = [
  { to: '/familia', label: 'Mis niños', icon: Baby, end: true },
  { to: '/familia/galeria', label: 'Fotos', icon: Images },
  { to: '/familia/avisos', label: 'Avisar ausencia', icon: MessageCircleHeart },
  { to: '/familia/privacidad', label: 'Privacidad', icon: ShieldCheck },
]

/** Rutas que no pasan por el flujo de consentimientos (ahí se decide o se gestiona la cuenta). */
const UNGATED = ['/familia/privacidad', '/familia/cuenta', '/familia/seguridad']

/**
 * Portal familiar. Deliberadamente más simple que el panel: los representantes entran
 * desde el móvil, a mirar cómo fue el día de su hijo, no a administrar nada.
 */
export default function FamilyLayout() {
  const { pathname } = useLocation()
  return (
    <div className="min-h-screen bg-app">
      <header className="sticky top-0 z-20 bg-white/90 dark:bg-surface/90 backdrop-blur-md border-b border-slate-200 dark:border-white/10">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Logo size="sm" to="/familia" />
          <div className="flex items-center gap-2">
            <LiveIndicator compact className="px-1" />
            <ThemeToggle size="sm" />
            <UserMenu />
          </div>
        </div>
        <nav className="max-w-4xl mx-auto px-2 sm:px-4 flex gap-1 overflow-x-auto -mb-px">
          {LINKS.map((l) => {
            const Icon = l.icon
            return (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 min-h-11 border-b-2 text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${
                    // "Mis niños" sigue marcado dentro de la ficha de cada niño.
                    isActive || (l.end && pathname.startsWith('/familia/nino/'))
                      ? 'border-accent text-slate-900 dark:text-white'
                      : 'border-transparent text-slate-500 dark:text-white/55 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-white/20'
                  }`
                }
              >
                <Icon className="w-4 h-4" />
                {l.label}
              </NavLink>
            )
          })}
        </nav>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* Al salir de Privacidad el filtro se vuelve a montar y revisa de nuevo lo pendiente. */}
        {UNGATED.includes(pathname) ? (
          <Outlet />
        ) : (
          <FamilyConsentGate>
            <Outlet />
          </FamilyConsentGate>
        )}
      </main>
    </div>
  )
}
