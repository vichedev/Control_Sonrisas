import { useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, DoorOpen } from './icons'
import { addDays, api, todayKey, USER_KEY } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { EmptyState } from './ui'

/**
 * Aviso para una educadora sin sala asignada: el backend sólo le devuelve datos de sus
 * salas, así que sin ninguna verá todo vacío — mejor explicárselo.
 */
export function NoClassroomNotice() {
  return (
    <EmptyState
      icon={DoorOpen}
      title="Aún no tienes una sala asignada."
      message="Pide a dirección que te asigne una."
    />
  )
}

// --- Última sala elegida, por usuario (localStorage puede fallar: modo privado, etc.) ---

function roomKey(userId) {
  return `sonrisas_last_room_${userId || 'anon'}`
}

function storedUserId() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null')?.id
  } catch {
    return undefined
  }
}

/** Última sala elegida por el usuario actual ('' = todas / sin preferencia). */
export function lastClassroomId() {
  try {
    return localStorage.getItem(roomKey(storedUserId())) || ''
  } catch {
    return ''
  }
}

function rememberClassroom(userId, id) {
  try {
    localStorage.setItem(roomKey(userId), id || '')
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

/** "Hoy, 10 nov" · "Ayer, 9 nov" · "lun, 3 nov" (+ año si no es el actual). */
function dayLabel(day) {
  if (!day) return ''
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, (m || 1) - 1, d || 1)
  const today = todayKey()
  const opts = { day: 'numeric', month: 'short' }
  if (String(y) !== today.slice(0, 4)) opts.year = 'numeric'
  const short = date.toLocaleDateString('es-EC', opts).replace('.', '')
  if (day === today) return `Hoy, ${short}`
  if (day === addDays(today, -1)) return `Ayer, ${short}`
  if (day === addDays(today, 1)) return `Mañana, ${short}`
  const wd = date.toLocaleDateString('es-EC', { weekday: 'short' }).replace('.', '')
  return `${wd}, ${short}`
}

const arrowClass =
  'shrink-0 w-10 h-11 sm:h-10 flex items-center justify-center text-slate-500 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring transition'

/**
 * Selector de día + sala. Aparece en casi todas las pantallas operativas, así que
 * vive aquí y no repetido en cada una. Compacto: en móvil cabe en una sola fila.
 */
export default function DayFilters({
  date,
  onDateChange,
  classroomId,
  onClassroomChange,
  extra,
  /** Opcional: recibe la lista de salas visibles cuando termina de cargarse. */
  onClassroomsLoaded,
}) {
  const { isTeacher, user } = useAuth()
  const [classrooms, setClassrooms] = useState(null)
  const dateRef = useRef(null)
  const loadedRef = useRef(onClassroomsLoaded)
  const changeRef = useRef(onClassroomChange)
  const currentRef = useRef(classroomId)
  useEffect(() => {
    loadedRef.current = onClassroomsLoaded
    changeRef.current = onClassroomChange
    currentRef.current = classroomId
  })

  const hasRooms = !!onClassroomChange
  const userId = user?.id
  useEffect(() => {
    if (!hasRooms) return
    let alive = true
    // Para una educadora el backend ya devuelve sólo sus salas.
    api
      .get('/classrooms', { params: { includeInactive: 'false' } })
      .then((r) => {
        if (!alive) return
        const list = r.data || []
        setClassrooms(list)
        loadedRef.current?.(list)
        // Restaurar la última sala elegida (si sigue disponible y no hay otra elegida).
        let saved = ''
        try {
          saved = localStorage.getItem(roomKey(userId)) || ''
        } catch {
          saved = ''
        }
        const current = currentRef.current || ''
        if (list.length > 1 && saved && !current && list.some((c) => c.id === saved)) {
          changeRef.current?.(saved)
        } else if (current && current === saved && !list.some((c) => c.id === saved)) {
          // La sala recordada ya no existe o no es visible.
          rememberClassroom(userId, '')
          changeRef.current?.('')
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [hasRooms, userId])

  const pickRoom = (id) => {
    rememberClassroom(userId, id)
    onClassroomChange(id)
  }

  const openPicker = () => {
    const el = dateRef.current
    if (!el) return
    try {
      if (el.showPicker) el.showPicker()
      else el.focus()
    } catch {
      el.focus()
    }
  }

  const isToday = date === todayKey()
  const single = classrooms && classrooms.length === 1 ? classrooms[0] : null

  return (
    // En móvil ocupa todo el ancho útil (100vw − padding del <main>) en una sola fila.
    <div className="flex flex-wrap items-center gap-2 w-[calc(100vw-2rem)] sm:w-auto max-w-full">
      <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto">
        {onDateChange && (
          <div className="flex items-center shrink-0 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 shadow-xs overflow-hidden">
            <button
              type="button"
              onClick={() => onDateChange(addDays(date, -1))}
              className={arrowClass}
              aria-label="Día anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={openPicker}
              className="relative h-11 sm:h-10 px-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-white whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring rounded-lg"
              aria-label={`Cambiar fecha (${dayLabel(date)})`}
            >
              <CalendarDays className="w-4 h-4 text-slate-400 dark:text-white/45" />
              <span className="first-letter:uppercase">{dayLabel(date)}</span>
            </button>
            <input
              ref={dateRef}
              type="date"
              value={date}
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => onDateChange(e.target.value || todayKey())}
              className="sr-only"
            />
            <button
              type="button"
              onClick={() => onDateChange(addDays(date, 1))}
              className={arrowClass}
              aria-label="Día siguiente"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {onDateChange && !isToday && (
          <button
            type="button"
            onClick={() => onDateChange(todayKey())}
            className="shrink-0 h-11 sm:h-10 px-3 rounded-lg text-xs font-medium bg-white border border-slate-200 text-accent-text hover:bg-slate-50 dark:bg-white/5 dark:border-white/10 dark:hover:bg-white/10 transition-colors"
          >
            Hoy
          </button>
        )}

        {onClassroomChange &&
          (single ? (
            <span
              className="min-w-0 flex-1 sm:flex-none sm:max-w-64 inline-flex items-center gap-1.5 h-11 sm:h-10 px-3 rounded-lg bg-slate-100 dark:bg-white/5 text-sm font-medium text-slate-700 dark:text-white/80"
              title={single.name}
            >
              <DoorOpen className="w-4 h-4 shrink-0 text-slate-400 dark:text-white/40" />
              <span className="truncate">{single.name}</span>
            </span>
          ) : (
            <label className="relative min-w-0 flex-1 sm:flex-none">
              <span className="sr-only">Sala</span>
              <DoorOpen className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-white/40" />
              <select
                value={classroomId}
                onChange={(e) => pickRoom(e.target.value)}
                className="w-full sm:w-auto sm:max-w-56 h-11 sm:h-10 pl-8 pr-7 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 shadow-xs text-sm font-medium text-slate-800 dark:text-white truncate focus:outline-none focus:ring-2 focus:ring-accent-ring dark:[&>option]:bg-slate-900"
              >
                <option value="">{isTeacher ? 'Mis salas' : 'Todas las salas'}</option>
                {(classrooms || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
      </div>

      {extra}
    </div>
  )
}
