import { Suspense, useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Menu, MoreHorizontal, Search, X } from './icons'
import ThemeToggle from './ThemeToggle'
import Logo, { LogoMark } from './Logo'
import UserMenu from './UserMenu'
import CommandPalette from './CommandPalette'
import { InstallChip } from './InstallPrompt'
import { HOME, BOTTOM_NAV, OPEN_SEARCH_EVENT, SECTIONS, pageForPath, sectionsFor } from './navConfig'
import { Kbd, Loading } from './ui'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import { LiveIndicator, useLiveReload } from '../realtime'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')

function CountBadge({ count, className = '' }) {
  if (!count) return null
  return (
    <span
      className={`inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[10px] font-semibold tabular-nums bg-accent text-accent-fg ${className}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

function SideLink({ item, count, onNavigate }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        `group relative flex items-center gap-2.5 px-2.5 min-h-9 rounded-lg text-[13.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${
          isActive
            ? 'bg-accent-soft text-accent-text before:absolute before:-left-3 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r-full before:bg-accent'
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-white/60 dark:hover:text-white dark:hover:bg-white/5'
        }`
      }
    >
      <Icon className="w-[18px] h-[18px] shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>
      <CountBadge count={count} className="ml-auto" />
    </NavLink>
  )
}

export default function PanelLayout() {
  const auth = useAuth()
  const { pathname } = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [badges, setBadges] = useState({})

  const sections = sectionsFor(auth)
  const current = pageForPath(pathname)
  const closePalette = useCallback(() => setPaletteOpen(false), [])

  // Contadores: al montar, cada 60 s, al volver a la pestaña y en vivo.
  const refreshBadges = useCallback(
    () =>
      api
        .get('/summary/badges')
        .then((r) => setBadges(r.data || {}))
        .catch(() => {}),
    [],
  )
  useEffect(() => {
    const first = setTimeout(refreshBadges, 0)
    const t = setInterval(refreshBadges, 60000)
    const onVisible = () => document.visibilityState === 'visible' && refreshBadges()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(first)
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshBadges])
  useLiveReload(refreshBadges, { entities: ['attendance', 'daily_log', 'report', 'justification', 'task'] }, { debounceMs: 1500 })

  // La barra inferior existe mientras se está en el panel: activa `--bottom-nav-h`.
  useEffect(() => {
    document.documentElement.classList.add('has-bottom-nav')
    return () => document.documentElement.classList.remove('has-bottom-nav')
  }, [])

  // Ctrl/⌘+K abre el buscador desde cualquier página del panel.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setMobileOpen(false)
        setPaletteOpen((v) => !v)
      }
    }
    const onOpen = () => {
      setMobileOpen(false)
      setPaletteOpen(true)
    }
    document.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen)
    }
  }, [])

  // El cajón lateral se cierra con Escape.
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e) => e.key === 'Escape' && setMobileOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  const bottomItems = BOTTOM_NAV.map((to) => SECTIONS.flatMap((s) => s.items).find((it) => it.to === to)).filter(Boolean)
  // "Más" muestra la suma de los avisos que no están en la barra inferior.
  const moreCount = sections
    .flatMap((s) => s.items)
    .filter((it) => it.badge && !BOTTOM_NAV.includes(it.to))
    .reduce((acc, it) => acc + (badges[it.badge] || 0), 0)
  // "Más" se marca en las páginas que no tienen botón propio (salvo el Resumen).
  const moreActive =
    mobileOpen ||
    (pathname !== '/panel' && !BOTTOM_NAV.some((to) => pathname === to || pathname.startsWith(to + '/')))

  return (
    <div className="min-h-screen bg-app flex">

      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-slate-900/40 dark:bg-black/60 z-40 animate-fade-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        aria-label="Menú principal"
        className={`fixed lg:sticky top-0 left-0 h-dvh w-64 max-w-[85vw] bg-white dark:bg-surface border-r border-slate-200 dark:border-white/10 z-50 lg:z-30 transition-transform flex flex-col ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex items-center justify-between h-14 shrink-0 px-4 border-b border-slate-200 dark:border-white/10">
          <Logo size="sm" to="/panel" />
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-2 -mr-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-white/60 dark:hover:bg-white/10"
            aria-label="Cerrar menú"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-3 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] space-y-4">
          <SideLink item={HOME} onNavigate={() => setMobileOpen(false)} />
          {sections.map((section) => {
            const items = section.items.filter((it) => !it.hidden)
            if (!items.length) return null
            return (
              <div key={section.title}>
                <p className="px-2.5 pb-1 text-[11px] font-medium text-slate-400 dark:text-white/35">
                  {section.title}
                </p>
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <SideLink
                      key={item.to}
                      item={item}
                      count={item.badge ? badges[item.badge] || 0 : 0}
                      onNavigate={() => setMobileOpen(false)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </nav>
      </aside>

      <div className="flex-1 min-w-0">
        <header className="sticky top-0 z-30 h-14 px-3 sm:px-4 lg:px-8 flex items-center gap-2 bg-white/85 dark:bg-app/85 backdrop-blur-md border-b border-slate-200 dark:border-white/10">
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden p-2.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-white/70 dark:hover:bg-white/10"
            aria-label="Abrir menú"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 min-w-0 lg:hidden">
            <LogoMark size="sm" />
            <span className="font-semibold text-slate-900 dark:text-white truncate">
              {current?.short || current?.label || 'Sonrisas'}
            </span>
          </div>

          {/* Buscador: campo en escritorio, icono en móvil */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden lg:flex items-center gap-2 w-80 max-w-[40vw] h-9 px-3 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-sm text-slate-400 dark:text-white/40 hover:border-slate-300 dark:hover:border-white/25 transition"
          >
            <Search className="w-4 h-4" />
            <span className="flex-1 text-left">Buscar niño o página…</span>
            <span className="flex items-center gap-1">
              <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>

          <div className="flex-1" />
          <div className="flex items-center gap-1.5 sm:gap-2">
            <InstallChip />
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="lg:hidden p-2.5 rounded-lg text-slate-600 hover:bg-slate-100 dark:text-white/70 dark:hover:bg-white/10"
              aria-label="Buscar niño o página"
            >
              <Search className="w-5 h-5" />
            </button>
            <LiveIndicator compact className="px-1" />
            <ThemeToggle size="sm" />
            <UserMenu />
          </div>
        </header>

        <main className="p-4 sm:p-5 lg:p-8 max-w-[1600px] mx-auto pb-[calc(var(--bottom-nav-h)+1.5rem)] lg:pb-8">
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      {/* Barra inferior (móvil y tablet): las tareas del día a un toque */}
      <nav
        aria-label="Accesos del día"
        className="lg:hidden fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 dark:border-white/10 bg-white/95 dark:bg-surface/95 backdrop-blur-md pb-[env(safe-area-inset-bottom,0px)]"
      >
        <div className="grid grid-cols-5 h-16 max-w-xl mx-auto">
          {bottomItems.map((item) => {
            const Icon = item.icon
            const count = item.badge ? badges[item.badge] || 0 : 0
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${
                    isActive ? 'text-accent-text' : 'text-slate-500 dark:text-white/55'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`relative flex items-center justify-center w-12 h-7 rounded-full transition ${
                        isActive ? 'bg-accent-soft' : ''
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      <CountBadge count={count} className="absolute -top-1.5 -right-0.5 ring-2 ring-white dark:ring-surface" />
                    </span>
                    <span className="truncate max-w-full px-1">{item.short || item.label}</span>
                  </>
                )}
              </NavLink>
            )
          })}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Más opciones del menú"
            className={`relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${
              moreActive ? 'text-accent-text' : 'text-slate-500 dark:text-white/55'
            }`}
          >
            <span
              className={`relative flex items-center justify-center w-12 h-7 rounded-full ${
                moreActive ? 'bg-accent-soft' : ''
              }`}
            >
              <MoreHorizontal className="w-5 h-5" />
              <CountBadge count={moreCount} className="absolute -top-1.5 -right-0.5 ring-2 ring-white dark:ring-surface" />
            </span>
            <span>Más</span>
          </button>
        </div>
      </nav>

      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </div>
  )
}
