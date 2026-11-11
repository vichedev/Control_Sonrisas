import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-app text-slate-600 dark:text-white/70">
      <div className="flex items-center gap-3">
        <span className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        Cargando…
      </div>
    </div>
  )
}

/** Pantalla de inicio que corresponde a cada rol. */
export function landingFor(role) {
  return role === 'guardian' ? '/familia' : '/panel'
}

/**
 * Ruta protegida. `role` acepta un string o un array.
 * 'staff' es un alias de los tres roles del personal.
 */
export default function ProtectedRoute({ children, role }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Loading />
  if (!user) return <Navigate to="/login" replace />

  // Cuenta que aún debe fijar contraseña: no puede ir a ningún otro sitio.
  if (user.mustChangePassword && location.pathname !== '/cambiar-clave') {
    return <Navigate to="/cambiar-clave" replace />
  }

  if (role) {
    const wanted = Array.isArray(role) ? role : [role]
    const allowed = wanted.flatMap((r) =>
      r === 'staff' ? ['admin', 'coordinator', 'teacher'] : [r],
    )
    if (!allowed.includes(user.role)) {
      return <Navigate to={landingFor(user.role)} replace />
    }
  }
  return children
}

/** Redirección de la raíz "/" según el estado de sesión. */
export function RootRedirect({ fallback }) {
  const { user, loading } = useAuth()
  if (loading) return <Loading />
  if (!user) return fallback
  if (user.mustChangePassword) return <Navigate to="/cambiar-clave" replace />
  return <Navigate to={landingFor(user.role)} replace />
}
