import axios from 'axios'

// Mismo origen siempre: en producción NestJS sirve la SPA y la API juntas; en
// desarrollo el proxy de Vite reenvía /api y /uploads al backend.
const baseURL = import.meta.env.VITE_API_URL || '/api'

export const TOKEN_KEY = 'sonrisas_token'
export const USER_KEY = 'sonrisas_user'
/**
 * Token de MEDIOS: las fotos de /uploads no son públicas — son fotos de niños.
 * Como una etiqueta <img> no puede enviar la cabecera `Authorization`, el backend
 * emite este token firmado y el frontend lo añade como `?mt=` a cada foto.
 */
export const MEDIA_TOKEN_KEY = 'sonrisas_media_token'

export const api = axios.create({
  baseURL,
  // Las fotos viajan en base64 dentro del JSON; con varias a la vez conviene margen.
  timeout: 60000,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

let isRedirecting = false

/**
 * Endpoints donde 400/401 significa "dato mal tecleado" (contraseña actual o código
 * 2FA incorrecto), NO "sesión caducada": no deben cerrar la sesión.
 */
const USER_INPUT_AUTH = /^\/?auth\/(login|change-password|2fa\/[\w-]+)\/?$/

/** Ruta de la pantalla de cambio obligatorio de contraseña (ver App.jsx). */
export const FORCE_CHANGE_PATH = '/cambiar-clave'
const MUST_CHANGE_MSG = 'Debes cambiar tu contraseña temporal'

function requestPath(config) {
  const url = config?.url || ''
  // Normaliza tanto '/auth/x' como 'http://host/api/auth/x'.
  return url.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/?api(?=\/)/, '').split('?')[0]
}

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status
    const path = window.location.pathname
    const onPublicRoute = path === '/' || path === '/login'
    const reqPath = requestPath(err.config)

    if (status === 401 && !onPublicRoute && !USER_INPUT_AUTH.test(reqPath)) {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
      localStorage.removeItem(MEDIA_TOKEN_KEY)
      if (path !== '/login' && !isRedirecting) {
        isRedirecting = true
        window.location.href = '/login'
      }
    }

    // El backend bloquea todo hasta que se cambie la contraseña temporal.
    const msg = err.response?.data?.message
    if (status === 403 && typeof msg === 'string' && msg.includes(MUST_CHANGE_MSG)) {
      try {
        const stored = JSON.parse(localStorage.getItem(USER_KEY) || 'null')
        if (stored && !stored.mustChangePassword) {
          localStorage.setItem(USER_KEY, JSON.stringify({ ...stored, mustChangePassword: true }))
        }
      } catch {
        // usuario guardado corrupto: ProtectedRoute lo resolverá con /auth/me
      }
      if (path !== FORCE_CHANGE_PATH && !isRedirecting) {
        isRedirecting = true
        window.location.href = FORCE_CHANGE_PATH
      }
    }
    return Promise.reject(err)
  },
)

/** Guarda el token de medios devuelto por el backend (login / 2FA / /auth/me). */
export function setMediaToken(token) {
  if (token) localStorage.setItem(MEDIA_TOKEN_KEY, token)
}

/** Mensaje de error legible a partir de la respuesta de la API. */
export function apiError(err, fallback = 'Ocurrió un error') {
  const data = err?.response?.data
  if (Array.isArray(data?.message)) return data.message.join('. ')
  return data?.message || err?.message || fallback
}

/**
 * URL del logo del centro. Va por el endpoint PÚBLICO `/branding/logo` (y no por
 * /uploads, que exige token) porque la pantalla de login lo muestra sin sesión.
 */
export function brandingLogoUrl(logoUrl) {
  if (!logoUrl) return ''
  if (logoUrl.startsWith('data:') || logoUrl.startsWith('blob:')) return logoUrl
  const v = encodeURIComponent(logoUrl.split('/').pop() || '')
  return `${baseURL.replace(/\/$/, '')}/branding/logo?v=${v}`
}

function isSameOrigin(absolute) {
  if (absolute.startsWith('/') && !absolute.startsWith('//')) return true
  try {
    return new URL(absolute, window.location.href).origin === window.location.origin
  } catch {
    return false
  }
}

/**
 * Resuelve una ruta de imagen del backend a URL absoluta servible.
 * Añade el token de medios a las URLs de /uploads — sin él, el backend responde 403.
 */
export function mediaUrl(url) {
  if (!url) return ''
  if (url.startsWith('data:') || url.startsWith('blob:')) return url

  let absolute
  if (/^https?:\/\//i.test(url)) {
    // Las fotos se guardan con la URL completa del backend (BACKEND_URL). Si apunta a
    // /uploads, se usa sólo la ruta: así se pide al mismo origen que la página (proxy
    // de Vite en desarrollo, NestJS en producción) y la CSP `img-src 'self'` no la bloquea,
    // aunque el dominio o el puerto hayan cambiado desde que se subió.
    try {
      const u = new URL(url)
      absolute = u.pathname.startsWith('/uploads/') ? `${u.pathname}${u.search}` : url
    } catch {
      absolute = url
    }
  } else {
    const apiOrigin = baseURL.replace(/\/api\/?$/, '')
    absolute = `${apiOrigin}${url.startsWith('/') ? '' : '/'}${url}`
  }

  if (!absolute.includes('/uploads/')) return absolute
  // El token de medios sólo viaja a nuestro propio origen: nunca a terceros.
  if (!isSameOrigin(absolute)) return absolute
  const mt = localStorage.getItem(MEDIA_TOKEN_KEY)
  if (!mt) return absolute
  return `${absolute}${absolute.includes('?') ? '&' : '?'}mt=${encodeURIComponent(mt)}`
}

/** 'YYYY-MM-DD' de hoy en hora local (lo que espera la API para el día). */
export function todayKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Suma días a una clave 'YYYY-MM-DD'. */
export function addDays(day, delta) {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, (m || 1) - 1, d || 1)
  date.setDate(date.getDate() + delta)
  return todayKey(date)
}

/** 'HH:mm' local de una fecha ISO. */
export function timeOf(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })
}

/** Fecha larga legible ("lunes, 3 de agosto de 2026"). */
export function longDate(day) {
  if (!day) return ''
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('es-EC', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** Fecha corta ("3 ago 2026"). */
export function shortDate(day) {
  if (!day) return ''
  const [y, m, d] = String(day).slice(0, 10).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('es-EC', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
