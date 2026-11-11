import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, LogOut, Shield, User as UserIcon } from './icons'
import { ROLE_LABEL, useAuth } from '../context/AuthContext'
import { Avatar } from './ui'

export default function UserMenu() {
  const { user, logout, isGuardian } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  if (!user) return null
  const base = isGuardian ? '/familia' : '/panel'

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Menú de ${user.name}`}
        className="flex items-center gap-2 px-1.5 sm:px-2 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition"
      >
        <Avatar src={user.photoUrl} name={user.name} size="sm" />
        <span className="hidden sm:flex flex-col items-start leading-tight">
          <span className="text-[13px] font-medium text-slate-800 dark:text-white">{user.name}</span>
          <span className="text-[11px] font-normal text-slate-500 dark:text-white/45">
            {ROLE_LABEL[user.role] || user.role}
          </span>
        </span>
        <ChevronDown className={`hidden sm:block w-4 h-4 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-60 animate-pop-in rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-elevated shadow-xl overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-white/8">
            <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{user.name}</p>
            <p className="text-xs text-slate-400 dark:text-white/40 truncate">{user.email}</p>
          </div>
          <Link
            to={`${base}/cuenta`}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 min-h-11 text-sm text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-white/5"
          >
            <UserIcon className="w-4 h-4" /> Mi cuenta
          </Link>
          <Link
            to={`${base}/seguridad`}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 min-h-11 text-sm text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-white/5"
          >
            <Shield className="w-4 h-4" /> Seguridad y 2FA
          </Link>
          <button
            onClick={() => {
              logout()
              navigate('/login', { replace: true })
            }}
            className="w-full flex items-center gap-2 px-4 min-h-11 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 border-t border-slate-100 dark:border-white/5"
          >
            <LogOut className="w-4 h-4" /> Cerrar sesión
          </button>
        </div>
      )}
    </div>
  )
}
