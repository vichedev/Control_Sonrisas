import { createContext, useCallback, useContext, useState } from 'react'
import { api } from '../api/client'
import { useLoadEffect } from '../api/useLoadEffect'

/**
 * Marca/branding del sitio cargada desde el servidor. Se aplica en toda la app:
 * logo, nombre de empresa, color principal, favicon y theme-color.
 *
 * Mientras carga, devuelve los defaults para que la UI no salte.
 */
const DEFAULTS = {
  companyName: 'Sonrisitas',
  tagline: 'Centro de Desarrollo Infantil',
  logoUrl: '',
  primaryColor: '#4f46e5',
}

const BrandingContext = createContext({ branding: DEFAULTS, reload: () => {} })

/**
 * Pisa los `<link rel="icon">` apuntándolos al endpoint dinámico del backend
 * (`/api/branding/favicon`) con un query `?v=<updatedAt>` para que cuando el
 * branding cambie, el navegador descargue la nueva versión.
 *
 * Nota: el index.html ya apunta a /api/branding/favicon, así que en la PRIMERA
 * carga el navegador ya recibe el icono correcto. Esto sólo refresca cuando el
 * admin guarda un nuevo logo sin recargar.
 */
function applyFavicon(updatedAt) {
  const old = document.head.querySelectorAll(
    'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]',
  )
  old.forEach((el) => el.parentNode?.removeChild(el))

  const v = updatedAt ? encodeURIComponent(updatedAt) : Date.now()
  const url = `/api/branding/favicon?v=${v}`
  addIcon('icon', url)
  addIcon('shortcut icon', url)
  addIcon('apple-touch-icon', url)
}

function addIcon(rel, href) {
  const link = document.createElement('link')
  link.rel = rel
  link.href = href
  document.head.appendChild(link)
}

/** Reemplaza la meta theme-color (sólo la de modo claro, la oscura la dejamos). */
function applyThemeColor(color) {
  if (!color) return
  const metas = document.head.querySelectorAll('meta[name="theme-color"]')
  let lightMeta = null
  metas.forEach((m) => {
    const media = m.getAttribute('media') || ''
    if (!media || media.includes('light')) lightMeta = m
  })
  if (!lightMeta) {
    lightMeta = document.createElement('meta')
    lightMeta.name = 'theme-color'
    lightMeta.setAttribute('media', '(prefers-color-scheme: light)')
    document.head.appendChild(lightMeta)
  }
  lightMeta.setAttribute('content', color)
}

/** Color que trae el servidor si dirección nunca lo cambió (default de la entidad Branding). */
const SERVER_DEFAULT_COLOR = '#4f46e5'

/** Luminancia relativa WCAG de un color #rrggbb. */
function luminance(hex) {
  const n = hex.replace('#', '').slice(0, 6)
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Usa el color de la marca como acento (`--accent`) sólo si dirección lo eligió
 * y el texto blanco encima se lee bien (contraste ≥ 4.5:1). Si no, queda el azul por defecto.
 */
function applyAccent(color) {
  const root = document.documentElement
  const c = String(color || '').trim().toLowerCase()
  const valid = /^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(c)
  if (valid && c.slice(0, 7) !== SERVER_DEFAULT_COLOR && 1.05 / (luminance(c) + 0.05) >= 4.5) {
    root.style.setProperty('--accent', c.slice(0, 7))
  } else {
    root.style.removeProperty('--accent')
  }
}

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState(DEFAULTS)

  const reload = useCallback(async () => {
    try {
      const { data } = await api.get('/branding')
      const merged = { ...DEFAULTS, ...data }
      setBranding(merged)
      // Aplica el color principal como variable CSS para que cualquier estilo dinámico lo pueda usar.
      if (merged.primaryColor) {
        document.documentElement.style.setProperty('--brand-primary', merged.primaryColor)
        applyThemeColor(merged.primaryColor)
      }
      applyAccent(merged.primaryColor)
      // Actualiza el <title>
      if (merged.companyName) {
        document.title = `${merged.companyName}${merged.tagline ? ' · ' + merged.tagline : ''}`
      }
      // Favicon: re-versiona el endpoint dinámico con updatedAt para forzar refresco
      // tras un cambio de logo sin recargar la página.
      applyFavicon(data?.updatedAt)
    } catch {
      // sin conexión / 404 → mantener defaults
    }
  }, [])

  // Diferido un tick (ver useLoadEffect): evita el setState síncrono dentro del efecto.
  useLoadEffect(reload)

  return (
    <BrandingContext.Provider value={{ branding, reload }}>{children}</BrandingContext.Provider>
  )
}

export function useBranding() {
  return useContext(BrandingContext)
}
