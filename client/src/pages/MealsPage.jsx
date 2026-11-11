import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCheck,
  ChevronDown,
  MessageSquarePlus,
  RotateCcw,
  Save,
  UserX,
  UtensilsCrossed,
} from '../components/icons'
import { api, apiError, longDate, timeOf, todayKey } from '../api/client'
import { useLoadEffect } from '../api/useLoadEffect'
import { useLiveReload } from '../realtime'
import { useToasts } from '../context/ToastsContext'
import DayFilters, { lastClassroomId } from '../components/DayFilters'
import PhotoCapture from '../components/PhotoCapture'
import ConsentWarning from '../components/consent/ConsentWarning'
import ConfirmDialog from '../components/ConfirmDialog'
import { SearchInput } from '../components/DataToolbar'
import { matchChild } from '../components/childSearch'
import { Avatar, Badge, Button, Card, EmptyState, inputClass, Loading, PageHeader } from '../components/ui'

// Valores de src/meals/dto/meal.dto.ts (MEAL_TYPES / MEAL_INTAKES).
const MEAL_TYPES = [
  { value: 'breakfast', label: 'Desayuno' },
  { value: 'snack_am', label: 'Refrigerio mañana' },
  { value: 'lunch', label: 'Almuerzo' },
  { value: 'snack_pm', label: 'Refrigerio tarde' },
  { value: 'bottle', label: 'Biberón' },
]

// Etiqueta corta en el botón; `long` = la que lee la familia (MEAL_INTAKE_LABEL).
const INTAKES = [
  {
    value: 'all',
    label: 'Todo',
    long: 'Comió todo',
    on: 'bg-emerald-50 border-emerald-500 text-emerald-800 dark:bg-emerald-500/15 dark:border-emerald-400/60 dark:text-emerald-200',
    dot: 'bg-emerald-500',
  },
  {
    value: 'most',
    label: 'Casi todo',
    long: 'Comió casi todo',
    on: 'bg-emerald-50 border-emerald-500 text-emerald-800 dark:bg-emerald-500/15 dark:border-emerald-400/60 dark:text-emerald-200',
    dot: 'bg-emerald-400',
  },
  {
    value: 'half',
    label: 'Mitad',
    long: 'Comió la mitad',
    on: 'bg-amber-50 border-amber-500 text-amber-900 dark:bg-amber-500/15 dark:border-amber-400/60 dark:text-amber-100',
    dot: 'bg-amber-400',
  },
  {
    value: 'little',
    label: 'Poco',
    long: 'Comió poco',
    on: 'bg-amber-50 border-amber-500 text-amber-900 dark:bg-amber-500/15 dark:border-amber-400/60 dark:text-amber-100',
    dot: 'bg-amber-500',
  },
  {
    value: 'none',
    label: 'Nada',
    long: 'No quiso comer',
    on: 'bg-red-50 border-red-500 text-red-800 dark:bg-red-500/15 dark:border-red-400/60 dark:text-red-200',
    dot: 'bg-red-500',
  },
]

// Biberón: cada toma es un registro nuevo en el backend (no se corrige el anterior).
const APPEND_ONLY = ['bottle']

/** Comida más probable según la hora: ahorra un toque al abrir la pantalla. */
function defaultType() {
  const h = new Date().getHours()
  if (h < 9) return 'breakfast'
  if (h < 11) return 'snack_am'
  if (h < 14) return 'lunch'
  return 'snack_pm'
}

/**
 * Registro de alimentación por sala. Se trabaja como en la vida real: un menú común
 * y, niño a niño, cuánto comió. Guardar de nuevo corrige en lugar de duplicar.
 */
/** A partir de cuántos niños presentes aparece el buscador. */
const SEARCH_MIN = 12

export default function MealsPage() {
  const { pushToast } = useToasts()
  const [date, setDate] = useState(todayKey())
  const [classroomId, setClassroomId] = useState(lastClassroomId)
  const [type, setType] = useState(defaultType)
  const [children, setChildren] = useState([])
  const [meals, setMeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Cambios locales (sólo lo que difiere de lo guardado) para la comida actual.
  const [drafts, setDrafts] = useState({})
  const [menuDraft, setMenuDraft] = useState(null) // null = sin tocar
  const [photo, setPhoto] = useState('')
  const [photoOpen, setPhotoOpen] = useState(false)
  const [pending, setPending] = useState(null) // acción esperando confirmación
  // Buscador (salas de más de SEARCH_MIN niños). Sólo filtra lo que se ve: los borradores no se tocan.
  const [search, setSearch] = useState('')
  const [docs, setDocs] = useState({})

  const loadSeq = useRef(0)
  // `silent`: recarga en vivo, sin spinner ni toasts. Los borradores viven aparte (drafts),
  // así que refrescar lo guardado nunca pisa lo que la educadora está marcando.
  const load = useCallback(async ({ silent = false } = {}) => {
    const seq = ++loadSeq.current
    if (!silent) setLoading(true)
    try {
      // Todas las comidas del día de una vez: permite contar por tipo y cambiar de pestaña sin esperar.
      const [boardRes, mealsRes] = await Promise.all([
        api.get('/attendance/board', { params: { date, classroomId: classroomId || undefined } }),
        api.get('/meals', { params: { date, classroomId: classroomId || undefined } }),
      ])
      if (seq !== loadSeq.current) return // llegó una respuesta más nueva
      setChildren(boardRes.data?.children || [])
      setMeals(mealsRes.data || [])
    } catch (err) {
      if (!silent) pushToast({ type: 'error', message: apiError(err, 'No se pudo cargar la alimentación') })
    } finally {
      if (!silent) setLoading(false)
    }
  }, [date, classroomId, pushToast])

  useLoadEffect(load)
  const quietReload = useCallback(() => load({ silent: true }), [load])
  useLiveReload(quietReload, { entities: ['meal', 'attendance'], date, classroomId: classroomId || undefined })

  // Cédulas por niño para el buscador (el tablero no las trae).
  const bigRoom = children.length > SEARCH_MIN
  useEffect(() => {
    if (!bigRoom) return undefined
    let cancelled = false
    api
      .get('/children', { params: { classroomId: classroomId || undefined } })
      .then((r) => {
        if (cancelled) return
        const map = {}
        for (const c of r.data || []) if (c.documentId) map[c.id] = c.documentId
        setDocs(map)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [bigRoom, classroomId])

  // Sólo tiene sentido registrar comidas de quien estuvo en la guardería.
  const present = useMemo(
    () => children.filter((c) => c.status === 'present' || c.status === 'checked_out'),
    [children],
  )
  const notHere = useMemo(
    () => children.filter((c) => c.status !== 'present' && c.status !== 'checked_out'),
    [children],
  )

  // Registros por tipo → por niño (el último gana: en biberón es la última toma).
  const byType = useMemo(() => {
    const out = {}
    for (const m of meals) {
      out[m.type] ||= { byChild: {}, takes: {}, menu: '' }
      out[m.type].byChild[m.childId] = m
      out[m.type].takes[m.childId] = (out[m.type].takes[m.childId] || 0) + 1
      if (m.menu && !out[m.type].menu) out[m.type].menu = m.menu
    }
    return out
  }, [meals])

  const current = byType[type] || { byChild: {}, takes: {}, menu: '' }
  const appendOnly = APPEND_ONLY.includes(type)
  const menu = menuDraft ?? current.menu

  const rowState = (childId) => {
    const saved = current.byChild[childId]
    const d = drafts[childId] || {}
    const intake = d.intake ?? (appendOnly ? null : saved?.intake) ?? null
    const notes = d.notes ?? (appendOnly ? '' : saved?.notes || '')
    let dirty
    if (appendOnly) dirty = !!d.intake
    else
      dirty =
        (d.intake !== undefined && d.intake !== saved?.intake) ||
        (d.notes !== undefined && d.notes !== (saved?.notes || ''))
    // Sin cantidad no se puede guardar (el backend asumiría "Comió todo").
    const missingIntake = !intake && d.notes !== undefined && d.notes !== ''
    return { saved, intake, notes, dirty: dirty && !!intake, missingIntake }
  }

  const rows = present.map((c) => ({ child: c, ...rowState(c.childId) }))
  const changedRows = rows.filter((r) => r.dirty)
  const showSearch = present.length > SEARCH_MIN
  const query = showSearch ? search.trim() : ''
  const visibleRows = query
    ? rows.filter((r) => matchChild({ ...r.child, documentId: docs[r.child.childId] }, query))
    : rows
  const hiddenDirty = query ? changedRows.length - visibleRows.filter((r) => r.dirty).length : 0
  const menuDirty = menuDraft !== null && menuDraft.trim() !== (current.menu || '')
  const extrasDirty = menuDirty || !!photo
  const changeCount = changedRows.length + (extrasDirty ? 1 : 0)
  const missingCount = rows.filter((r) => r.missingIntake).length
  const pendingCount = changeCount + missingCount
  const hasChanges = pendingCount > 0
  const recordedCount = rows.filter((r) => r.saved).length
  const emptyCount = rows.filter((r) => !r.intake).length

  // Avisar al cerrar/recargar la pestaña con cambios sin guardar.
  useEffect(() => {
    if (!hasChanges) return
    const onBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasChanges])

  const resetDrafts = () => {
    setDrafts({})
    setMenuDraft(null)
    setPhoto('')
    setPhotoOpen(false)
  }

  /** Ejecuta `action` y descarta borradores; si hay cambios sin guardar, pregunta antes. */
  const guarded = (action) => {
    if (hasChanges) setPending(() => action)
    else {
      resetDrafts()
      action()
    }
  }

  const setDraft = (childId, key, value) =>
    setDrafts((prev) => ({ ...prev, [childId]: { ...prev[childId], [key]: value } }))

  const fillAll = () => {
    setDrafts((prev) => {
      const next = { ...prev }
      for (const r of rows) if (!r.intake) next[r.child.childId] = { ...next[r.child.childId], intake: 'all' }
      return next
    })
  }

  const save = async () => {
    if (missingCount) {
      pushToast({ type: 'error', message: 'Elige cuánto comió en las filas con observación.' })
      return
    }
    let entries = changedRows.map((r) => {
      const d = drafts[r.child.childId] || {}
      const e = { childId: r.child.childId, intake: r.intake }
      if (appendOnly) {
        if (r.notes) e.notes = r.notes
      } else if (d.notes !== undefined) e.notes = d.notes
      return e
    })
    // Si sólo cambió el menú o la foto, se aplica a lo ya registrado (sin tocar cantidades).
    if (extrasDirty && !appendOnly) {
      const touched = new Set(entries.map((e) => e.childId))
      for (const r of rows) if (r.saved && !touched.has(r.child.childId)) entries.push({ childId: r.child.childId })
    }
    if (!entries.length) {
      pushToast({
        type: 'info',
        message: 'Marca cuánto comió al menos un niño para guardar el menú o la foto.',
      })
      return
    }
    setSaving(true)
    try {
      await api.post('/meals/bulk', {
        type,
        date,
        classroomId: classroomId || undefined,
        menu: menu?.trim() || undefined,
        photo: photo || undefined,
        entries,
      })
      const label = MEAL_TYPES.find((t) => t.value === type)?.label.toLowerCase()
      pushToast({ type: 'success', message: `Guardado: ${label} de ${changedRows.length || entries.length} niño(s)` })
      resetDrafts()
      await load({ silent: true })
    } catch (err) {
      pushToast({ type: 'error', message: apiError(err, 'No se pudo guardar') })
    } finally {
      setSaving(false)
    }
  }

  // En móvil las pestañas se desplazan: mantener visible la comida activa.
  const tabsRef = useRef(null)
  useEffect(() => {
    const el = tabsRef.current?.querySelector('[aria-selected="true"]')
    el?.scrollIntoView?.({ block: 'nearest', inline: 'center' })
  }, [type])

  const typeCount = (t) => present.filter((c) => byType[t]?.byChild[c.childId]).length

  return (
    <>
      <PageHeader
        title="Alimentación"
        subtitle={longDate(date)}
        icon={UtensilsCrossed}
        actions={
          <DayFilters
            date={date}
            onDateChange={(d) => guarded(() => setDate(d))}
            classroomId={classroomId}
            onClassroomChange={(id) => guarded(() => setClassroomId(id))}
          />
        }
      />

      {/* Pestañas de comida con avance por tipo */}
      <div
        ref={tabsRef}
        role="tablist"
        aria-label="Comida"
        className="-mx-4 px-4 sm:-mx-5 sm:px-5 lg:mx-0 lg:px-0 mb-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]"
      >
        {MEAL_TYPES.map((t) => {
          const n = typeCount(t.value)
          const active = type === t.value
          const done = present.length > 0 && n === present.length
          return (
            <button
              key={t.value}
              role="tab"
              aria-selected={active}
              onClick={() => !active && guarded(() => setType(t.value))}
              className={`shrink-0 h-11 px-4 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-2 border ${
                active
                  ? 'bg-accent-soft border-accent/40 text-accent-text'
                  : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/10'
              }`}
            >
              {t.label}
              {present.length > 0 && (
                <span
                  className={`text-[11px] px-1.5 py-0.5 rounded-md tabular-nums inline-flex items-center gap-0.5 ${
                    active
                      ? 'bg-accent/10'
                      : done
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                        : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/50'
                  }`}
                >
                  {done && <Check className="w-3 h-3" />}
                  {n}/{present.length}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Menú + foto: una sola fila compacta */}
      <Card padded={false} className="mb-4 p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <label className="flex-1 min-w-0">
            <span className="sr-only">Menú del día</span>
            <input
              className={`${inputClass} h-11`}
              value={menu}
              onChange={(e) => setMenuDraft(e.target.value)}
              placeholder="Menú: puré de zanahoria con pollo…"
              maxLength={500}
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            icon={photo ? Check : Camera}
            onClick={() => setPhotoOpen((v) => !v)}
            aria-expanded={photoOpen}
            className="h-11 shrink-0"
          >
            <span className="hidden sm:inline">{photo ? 'Foto lista' : 'Foto del plato'}</span>
            <span className="sm:hidden">Foto</span>
            <ChevronDown className={`w-4 h-4 transition ${photoOpen ? 'rotate-180' : ''}`} />
          </Button>
        </div>
        <p className="text-xs text-slate-400 dark:text-white/35 mt-1.5">
          El menú se aplica a todos los niños de esta comida.
        </p>
        {photoOpen && (
          <div className="mt-3 space-y-3">
            {/* Foto de grupo: avisa qué niños no deben salir en ella. */}
            {classroomId && <ConsentWarning classroomId={classroomId} className="max-w-xl" />}
            <div className="max-w-sm">
              <PhotoCapture value={photo} onChange={setPhoto} label="" compact />
            </div>
          </div>
        )}
      </Card>

      <Card padded={false} className="mb-4">
        {loading ? (
          <Loading />
        ) : present.length === 0 ? (
          <EmptyState
            icon={UtensilsCrossed}
            title="Nadie ha llegado todavía"
            message="Registra primero las llegadas del día en Entradas y salidas."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-white/5">
              <p className="text-sm text-slate-600 dark:text-white/60 mr-auto">
                <strong className="text-slate-900 dark:text-white tabular-nums">
                  {recordedCount}/{present.length}
                </strong>{' '}
                {appendOnly ? 'con toma registrada' : 'registrados'}
                {emptyCount > 0 && (
                  <span className="text-slate-400 dark:text-white/40"> · {emptyCount} sin marcar</span>
                )}
              </p>
              <Button
                size="sm"
                variant="secondary"
                icon={CheckCheck}
                onClick={fillAll}
                disabled={emptyCount === 0}
                className="h-10"
                title="Marca «Comió todo» en los niños que aún no tienen nada"
              >
                Todos: Comió todo
              </Button>
            </div>

            {showSearch && (
              <div className="px-4 py-2.5 border-b border-slate-100 dark:border-white/5">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Buscar niño por nombre o cédula…"
                  aria-label="Buscar niño por nombre o cédula"
                />
                {query && (
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-white/45 tabular-nums" aria-live="polite">
                    {visibleRows.length} de {rows.length} niños
                    {hiddenDirty > 0 &&
                      ` · ${hiddenDirty} cambio${hiddenDirty === 1 ? '' : 's'} sin guardar en niños ocultos (se guardan igual)`}
                  </p>
                )}
              </div>
            )}

            {query && visibleRows.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-white/50">
                Ningún niño coincide con «{search.trim()}».{' '}
                <button type="button" onClick={() => setSearch('')} className="font-medium text-accent-text hover:underline">
                  Limpiar búsqueda
                </button>
              </div>
            )}

            <ul className="divide-y divide-slate-100 dark:divide-white/5">
              {visibleRows.map((r) => (
                <MealRow
                  key={r.child.childId}
                  row={r}
                  appendOnly={appendOnly}
                  takes={current.takes[r.child.childId] || 0}
                  onIntake={(v) => setDraft(r.child.childId, 'intake', v)}
                  onNotes={(v) => setDraft(r.child.childId, 'notes', v)}
                />
              ))}
            </ul>
          </>
        )}

        {!loading && notHere.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-100 dark:border-white/5 bg-slate-50/60 dark:bg-white/2 rounded-b-xl">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-white/40 mb-2">
              <UserX className="w-3.5 h-3.5" />
              No asistieron ({notHere.length}) — no se registra su comida
            </p>
            <ul className="flex flex-wrap gap-2">
              {notHere.map((c) => (
                <li
                  key={c.childId}
                  className="inline-flex items-center gap-2 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 pl-1 pr-2.5 py-1 opacity-70"
                >
                  <Avatar src={c.photoUrl} name={c.name} size="xs" />
                  <span className="text-xs font-semibold text-slate-600 dark:text-white/60">{c.name}</span>
                  <span className="text-[11px] text-slate-400 dark:text-white/35">
                    {c.status === 'justified' ? 'Falta justificada' : 'Sin llegar'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* Barra de guardado fija: siempre a mano del pulgar */}
      {present.length > 0 && !loading && (
        <div className="sticky z-20" style={{ bottom: 'calc(var(--bottom-nav-h, 0px) + 0.75rem)' }}>
          <div
            className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 sm:px-4 shadow-[0_4px_16px_-8px_rgba(15,23,42,0.18)] backdrop-blur-md transition-colors ${
              hasChanges
                ? 'bg-amber-50/95 border-amber-300 dark:bg-elevated/95 dark:border-amber-500/40'
                : 'bg-white/95 border-slate-200 dark:bg-elevated/95 dark:border-white/10'
            }`}
            role="status"
            aria-live="polite"
          >
            <p className="text-sm leading-tight mr-auto min-w-0">
              {hasChanges ? (
                <span className="font-semibold text-amber-800 dark:text-amber-200">
                  {pendingCount} {pendingCount === 1 ? 'cambio' : 'cambios'} sin guardar
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-white/50">
                  <Check className="w-4 h-4 text-emerald-500" /> Todo guardado
                </span>
              )}
            </p>
            {hasChanges && (
              <Button variant="ghost" icon={RotateCcw} onClick={resetDrafts} className="h-11 shrink-0">
                <span className="hidden sm:inline">Limpiar cambios</span>
                <span className="sm:hidden">Limpiar</span>
              </Button>
            )}
            <Button
              icon={Save}
              onClick={save}
              loading={saving}
              disabled={!hasChanges}
              className="h-11 shrink-0"
            >
              Guardar
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={() => {
          const action = pending
          setPending(null)
          resetDrafts()
          action?.()
        }}
        variant="warning"
        title="Tienes cambios sin guardar"
        message="Si continúas se descartarán. ¿Quieres seguir sin guardar?"
        confirmText="Descartar y seguir"
        cancelText="Volver"
      />
    </>
  )
}

function MealRow({ row, appendOnly, takes, onIntake, onNotes }) {
  const { child, saved, intake, notes, dirty, missingIntake } = row
  const [notesOpen, setNotesOpen] = useState(false)
  const showNotes = notesOpen || !!notes
  const savedIntake = saved?.intake
  const groupRef = useRef(null)

  // Teclado: flechas mueven la selección como en un grupo de radios.
  const onKey = (e) => {
    const idx = INTAKES.findIndex((i) => i.value === intake)
    let next = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % INTAKES.length
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + INTAKES.length) % INTAKES.length
    if (next === null) return
    e.preventDefault()
    onIntake(INTAKES[next].value)
    groupRef.current?.querySelectorAll('[role="radio"]')[next]?.focus()
  }

  let chip
  if (missingIntake) chip = <Badge tone="amber">Elige cantidad</Badge>
  else if (dirty)
    chip = (
      <Badge tone="amber">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Sin guardar
      </Badge>
    )
  else if (saved)
    chip = (
      <Badge tone="green">
        <Check className="w-3 h-3" /> {appendOnly ? `${takes} toma${takes === 1 ? '' : 's'}` : 'Guardado'}
      </Badge>
    )
  else chip = <Badge tone="slate">Sin registrar</Badge>

  return (
    <li
      className={`px-4 py-3 grid gap-x-4 gap-y-2.5 xl:grid-cols-[minmax(170px,220px)_minmax(440px,1fr)_minmax(150px,240px)] xl:items-center ${
        dirty ? 'bg-amber-50/50 dark:bg-amber-500/5' : !intake ? 'bg-slate-50/40 dark:bg-white/1' : ''
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <Avatar src={child.photoUrl} name={child.name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-800 dark:text-white text-sm truncate">{child.name}</p>
          {child.allergies ? (
            <p className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300 truncate">
              <AlertTriangle className="w-3 h-3 shrink-0" /> Alergia: {child.allergies}
            </p>
          ) : appendOnly && saved ? (
            <p className="text-[11px] text-slate-400 dark:text-white/40 truncate">
              Última toma {timeOf(saved.servedAt || saved.createdAt)} ·{' '}
              {INTAKES.find((i) => i.value === savedIntake)?.long}
            </p>
          ) : null}
        </div>
        {!showNotes && (
          <button
            type="button"
            onClick={() => setNotesOpen(true)}
            className="xl:hidden shrink-0 h-9 inline-flex items-center gap-1 px-2 rounded-lg text-xs font-semibold text-slate-500 dark:text-white/50 hover:bg-slate-100 dark:hover:bg-white/10"
          >
            <MessageSquarePlus className="w-4 h-4" /> Nota
          </button>
        )}
        <span className="shrink-0 xl:hidden">{chip}</span>
      </div>

      <div
        ref={groupRef}
        role="radiogroup"
        aria-label={`Cuánto comió ${child.name}`}
        onKeyDown={onKey}
        className="grid grid-cols-5 gap-1.5"
      >
        {INTAKES.map((i, idx) => {
          const on = intake === i.value
          const wasSaved = !appendOnly && savedIntake === i.value && !on
          const focusable = intake ? on : idx === 0
          return (
            <button
              key={i.value}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={focusable ? 0 : -1}
              title={i.long}
              onClick={() => onIntake(i.value)}
              className={`relative h-11 px-1 rounded-lg border text-xs sm:text-sm sm:whitespace-nowrap font-medium leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-accent-ring dark:focus-visible:ring-offset-transparent ${
                on
                  ? `${i.on}`
                  : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/10'
              }`}
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                {!on && <span className={`hidden sm:inline-block w-2 h-2 rounded-full ${i.dot}`} />}
                {on && <Check className="hidden sm:inline w-3.5 h-3.5" />}
                {i.label}
              </span>
              {wasSaved && (
                <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 px-1 rounded bg-slate-200 dark:bg-white/20 text-[9px] font-semibold text-slate-600 dark:text-white/70">
                  antes
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className={`items-center gap-2 min-w-0 ${showNotes ? 'flex' : 'hidden xl:flex'}`}>
        {showNotes ? (
          <input
            className={`${inputClass} h-10 flex-1 min-w-0`}
            value={notes}
            onChange={(e) => onNotes(e.target.value)}
            placeholder="Observación…"
            aria-label={`Observación de ${child.name}`}
            autoFocus={notesOpen && !notes}
            maxLength={1000}
          />
        ) : (
          <button
            type="button"
            onClick={() => setNotesOpen(true)}
            className="h-10 inline-flex items-center gap-1.5 px-2 rounded-lg text-xs font-semibold text-slate-500 dark:text-white/50 hover:bg-slate-100 dark:hover:bg-white/10"
          >
            <MessageSquarePlus className="w-4 h-4" /> Observación
          </button>
        )}
        <span className="hidden xl:inline-flex ml-auto shrink-0">{chip}</span>
      </div>
    </li>
  )
}
