import { ChevronLeft, ChevronRight } from './icons'

const WEEKDAYS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do']
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function pad(n) {
  return String(n).padStart(2, '0')
}
export function dateStr(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}

/**
 * Calendario mensual sencillo.
 * - marks: array de marcajes (objetos con createdAt y type) del mes mostrado
 * - selectedDate / onSelect: día seleccionado ('YYYY-MM-DD')
 */
export default function MonthCalendar({ year, month, marks = [], selectedDate, onSelect, onPrev, onNext }) {
  const todayStr = dateStr(new Date())

  // Mapa día -> { in: bool, out: bool }
  const byDay = new Map()
  for (const m of marks) {
    const k = dateStr(m.createdAt)
    const e = byDay.get(k) || { in: false, out: false }
    if (m.type === 'in') e.in = true
    if (m.type === 'out') e.out = true
    byDay.set(k, e)
  }

  const first = new Date(year, month - 1, 1)
  // Lunes = 0 ... Domingo = 6
  const startOffset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month, 0).getDate()

  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <button onClick={onPrev} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-white/60 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition" aria-label="Mes anterior">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold text-slate-900 dark:text-white capitalize">{MONTHS[month - 1]} {year}</span>
        <button onClick={onNext} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-white/60 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition" aria-label="Mes siguiente">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-center text-[11px] font-medium text-slate-400 dark:text-white/40 py-1">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />
          const ds = `${year}-${pad(month)}-${pad(d)}`
          const info = byDay.get(ds)
          const isToday = ds === todayStr
          const isSelected = ds === selectedDate
          return (
            <button
              key={i}
              onClick={() => onSelect?.(ds)}
              className={`relative aspect-square rounded-lg text-sm font-medium flex flex-col items-center justify-center transition ${
                isSelected
                  ? 'bg-accent text-accent-fg'
                  : isToday
                    ? 'bg-accent-soft text-accent-text ring-1 ring-inset ring-accent/30'
                    : 'text-slate-700 dark:text-white/70 hover:bg-slate-100 dark:hover:bg-white/5'
              }`}
            >
              <span>{d}</span>
              {info && (
                <span className="absolute bottom-1 flex gap-0.5">
                  {info.in && <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-emerald-500'}`} />}
                  {info.out && <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white/70' : 'bg-sky-500'}`} />}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-500 dark:text-white/40">
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Entrada</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-sky-500" /> Salida</span>
      </div>
    </div>
  )
}
