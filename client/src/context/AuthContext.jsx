import { createContext, useContext, useEffect, useState } from 'react'
import { api, MEDIA_TOKEN_KEY, setMediaToken, TOKEN_KEY, USER_KEY } from '../api/client'

const AuthContext = createContext(null)

function readStoredUser() {
  const raw = localStorage.getItem(USER_KEY)
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser)
  // loading = hay token pero todavía no validamos al usuario
  const [loading, setLoading] = useState(
    () => !!localStorage.getItem(TOKEN_KEY) && !readStoredUser(),
  )

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) return
    api
      .get('/auth/me')
      .then((res) => {
        setUser(res.data)
        setMediaToken(res.data?.mediaToken)
        localStorage.setItem(USER_KEY, JSON.stringify(res.data))
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(USER_KEY)
        localStorage.removeItem(MEDIA_TOKEN_KEY)
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  /**
   * Devuelve:
   *  - { needs2FA: true, tempToken } cuando la cuenta requiere segundo factor.
   *  - { user } cuando el login es completo.
   */
  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password })
    if (res.data?.requires2FA) {
      return { needs2FA: true, tempToken: res.data.tempToken }
    }
    localStorage.setItem(TOKEN_KEY, res.data.accessToken)
    setMediaToken(res.data.mediaToken)
    localStorage.setItem(USER_KEY, JSON.stringify(res.data.user))
    setUser(res.data.user)
    return { user: res.data.user }
  }

  const loginWith2FA = async (tempToken, code) => {
    const res = await api.post('/auth/2fa/login', { tempToken, code })
    localStorage.setItem(TOKEN_KEY, res.data.accessToken)
    setMediaToken(res.data.mediaToken)
    localStorage.setItem(USER_KEY, JSON.stringify(res.data.user))
    setUser(res.data.user)
    return res.data.user
  }

  const refreshUser = async () => {
    const res = await api.get('/auth/me')
    setUser(res.data)
    setMediaToken(res.data?.mediaToken)
    localStorage.setItem(USER_KEY, JSON.stringify(res.data))
    return res.data
  }

  /** Cambio de contraseña — actualiza el accessToken devuelto (la tokenVersion cambió). */
  const applyNewToken = (data) => {
    if (data?.accessToken) localStorage.setItem(TOKEN_KEY, data.accessToken)
    // El cambio de contraseña sube la tokenVersion → el token de medios anterior deja
    // de valer y hay que guardar el nuevo, o las fotos dejarían de cargar.
    if (data?.mediaToken) setMediaToken(data.mediaToken)
    if (data?.user) {
      setUser(data.user)
      localStorage.setItem(USER_KEY, JSON.stringify(data.user))
    }
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(MEDIA_TOKEN_KEY)
    setUser(null)
  }

  const role = user?.role
  const value = {
    user,
    login,
    loginWith2FA,
    refreshUser,
    applyNewToken,
    logout,
    loading,
    role,
    isAdmin: role === 'admin',
    isCoordinator: role === 'coordinator',
    isTeacher: role === 'teacher',
    isGuardian: role === 'guardian',
    /** Personal de la guardería (todo el que no es representante). */
    isStaff: role === 'admin' || role === 'coordinator' || role === 'teacher',
    /** Puede aprobar, corregir y enviar en bloque. */
    canManage: role === 'admin' || role === 'coordinator',
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}

/** Etiqueta en español del rol, para mostrarlo en la interfaz. */
export const ROLE_LABEL = {
  admin: 'Dirección',
  coordinator: 'Coordinación',
  teacher: 'Educadora',
  guardian: 'Representante',
}
