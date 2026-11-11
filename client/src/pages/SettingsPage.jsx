import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { settingsFor } from '../components/navConfig'
import { ArrowUpRight, Gear } from '../components/icons'

/**
 * Ajustes: un solo lugar para la configuración del centro y de la cuenta.
 * Escritorio: menú propio a la izquierda. Móvil: pestañas desplazables arriba.
 * Cada sección es la página de siempre, renderizada en el <Outlet />.
 */
export default function SettingsPage() {
  const auth = useAuth()
  const { pathname } = useLocation()
  const groups = settingsFor(auth)
  const items = groups.flatMap((g) => g.items)

  // /panel/ajustes → primera sección disponible para el rol.
  if (pathname.replace(/\/+$/, '') === '/panel/ajustes') {
    const first = items.find((it) => !it.external)
    return first ? <Navigate to={first.to} replace /> : null
  }

  const linkClass = (active) =>
    `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
      active
        ? 'bg-accent-soft text-accent-text font-medium'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-white/65 dark:hover:bg-white/5 dark:hover:text-white'
    }`

  return (
    <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
      {/* Menú de ajustes */}
      <aside className="mb-5 lg:mb-0">
        <div className="hidden lg:flex items-center gap-2 mb-4 text-slate-900 dark:text-white">
          <Gear className="w-5 h-5 text-slate-500 dark:text-white/50" />
          <h1 className="text-lg font-semibold">Ajustes</h1>
        </div>

        {/* Móvil: pestañas */}
        <nav className="lg:hidden -mx-4 px-4 flex gap-1.5 overflow-x-auto pb-1" aria-label="Secciones de ajustes">
          {items.map((it) => {
            const Icon = it.icon
            const cls = (active) =>
              `shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm whitespace-nowrap ${
                active
                  ? 'border-transparent bg-accent-soft text-accent-text font-medium'
                  : 'border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-white/70'
              }`
            return it.external ? (
              <Link key={it.to} to={it.to} className={cls(false)}>
                <Icon className="w-4 h-4" /> {it.label}
              </Link>
            ) : (
              <NavLink key={it.to} to={it.to} className={({ isActive }) => cls(isActive)}>
                <Icon className="w-4 h-4" /> {it.label}
              </NavLink>
            )
          })}
        </nav>

        {/* Escritorio: menú agrupado */}
        <nav className="hidden lg:block space-y-5" aria-label="Secciones de ajustes">
          {groups.map((g) => (
            <div key={g.title}>
              <p className="px-3 mb-1.5 text-xs font-medium text-slate-400 dark:text-white/40">{g.title}</p>
              <ul className="space-y-0.5">
                {g.items.map((it) => {
                  const Icon = it.icon
                  return (
                    <li key={it.to}>
                      {it.external ? (
                        <Link to={it.to} className={linkClass(false)}>
                          <Icon className="w-4 h-4 shrink-0" />
                          <span className="flex-1">{it.label}</span>
                          <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" aria-label="Abre otra sección" />
                        </Link>
                      ) : (
                        <NavLink to={it.to} className={({ isActive }) => linkClass(isActive)}>
                          <Icon className="w-4 h-4 shrink-0" />
                          <span className="flex-1">{it.label}</span>
                        </NavLink>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <section className="min-w-0">
        <Outlet />
      </section>
    </div>
  )
}
