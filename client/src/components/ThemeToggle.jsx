import { Moon, Sun } from './icons'
import { useTheme } from '../context/ThemeContext'

export default function ThemeToggle({ className = '', size = 'md' }) {
  const { isDark, toggleTheme } = useTheme()

  const sizes = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
  }
  const iconSizes = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      title={isDark ? 'Modo claro' : 'Modo oscuro'}
      className={`${sizes[size]} relative rounded-lg flex items-center justify-center
        text-slate-500 hover:text-slate-900 hover:bg-slate-100
        dark:text-white/60 dark:hover:text-white dark:hover:bg-white/10
        transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring
        ${className}`}
    >
      <Sun
        className={`${iconSizes[size]} absolute transition-all duration-300 ${
          isDark ? 'opacity-0 rotate-90 scale-50' : 'opacity-100 rotate-0 scale-100'
        }`}
      />
      <Moon
        className={`${iconSizes[size]} absolute transition-all duration-300 ${
          isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-50'
        }`}
      />
    </button>
  )
}
