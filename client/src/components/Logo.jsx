import { Link } from 'react-router-dom'
import { Smile } from './icons'
import { brandingLogoUrl } from '../api/client'
import { useBranding } from '../context/BrandingContext'

const SIZES = {
  sm: { box: 'w-8 h-8 rounded-lg', icon: 'w-[18px] h-[18px]', text: 'text-[15px]' },
  md: { box: 'w-9 h-9 rounded-lg', icon: 'w-5 h-5', text: 'text-base' },
  lg: { box: 'w-12 h-12 rounded-xl', icon: 'w-6 h-6', text: 'text-xl' },
  xl: { box: 'w-16 h-16 rounded-xl', icon: 'w-8 h-8', text: 'text-3xl' },
}

export function LogoMark({ size = 'md', className = '' }) {
  const { branding } = useBranding()
  const s = SIZES[size] || SIZES.md

  // Con logo propio del centro se muestra ese en lugar del isotipo por defecto.
  if (branding?.logoUrl) {
    return (
      <div
        className={`${s.box} ${className} shrink-0 overflow-hidden bg-white dark:bg-white/10 ring-1 ring-slate-900/10 dark:ring-white/10 flex items-center justify-center`}
      >
        {/* El logo va por el endpoint público de branding: /uploads exige token
            y el login se muestra sin sesión iniciada. */}
        <img src={brandingLogoUrl(branding.logoUrl)} alt="logo" className="w-full h-full object-contain" />
      </div>
    )
  }

  return (
    <div className={`${s.box} ${className} shrink-0 bg-accent text-accent-fg flex items-center justify-center`}>
      <Smile className={s.icon} />
    </div>
  )
}

export default function Logo({ size = 'md', to = '/', showText = true }) {
  const { branding } = useBranding()
  const s = SIZES[size] || SIZES.md
  const name = branding?.appName || 'Sonrisas'

  const content = (
    <span className="flex items-center gap-2.5">
      <LogoMark size={size} />
      {showText && (
        <span className="flex flex-col leading-none">
          <span className={`${s.text} font-semibold tracking-tight text-slate-900 dark:text-white`}>{name}</span>
          <span className="mt-0.5 text-[11px] font-medium text-slate-500 dark:text-white/45">
            Cuidado infantil
          </span>
        </span>
      )}
    </span>
  )

  return to ? (
    <Link to={to} className="inline-flex items-center">
      {content}
    </Link>
  ) : (
    content
  )
}
