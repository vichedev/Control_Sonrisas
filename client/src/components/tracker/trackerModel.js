// Modelo del "Seguimiento del día": columnas y celdas a partir del checklist de cada niño.
/** 'HH:mm' (24 h) de una fecha ISO: más corto que 'a. m./p. m.' para la matriz. */
function timeOf(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const MEAL_ORDER = ['breakfast', 'snack_am', 'lunch', 'snack_pm', 'bottle']

export const MEAL_LABEL = {
  breakfast: 'Desayuno',
  snack_am: 'Refrigerio mañana',
  lunch: 'Almuerzo',
  snack_pm: 'Refrigerio tarde',
  bottle: 'Biberón',
}

/** Comidas que siempre se muestran: el resto aparece si alguien las registró. */
const CORE_MEALS = ['breakfast', 'lunch']

export const INTAKES = [
  { value: 'all', label: 'Comió todo', short: 'Todo', level: 4, tone: 'emerald' },
  { value: 'most', label: 'Comió casi todo', short: 'Casi todo', level: 3, tone: 'emerald' },
  { value: 'half', label: 'Comió la mitad', short: 'Mitad', level: 2, tone: 'amber' },
  { value: 'little', label: 'Comió poco', short: 'Poco', level: 1, tone: 'amber' },
  { value: 'none', label: 'No quiso comer', short: 'Nada', level: 0, tone: 'red' },
]

/** Texto del checklist ("Comió casi todo") → etiqueta corta de la celda. */
const MEAL_SHORT = {
  'Comió todo': 'Todo',
  'Comió casi todo': 'Casi todo',
  'Comió la mitad': 'Mitad',
  'Comió poco': 'Poco',
  'No comió': 'Nada',
}

export const HYGIENE = [
  { value: 'panal_mojado', label: 'Pañal mojado' },
  { value: 'panal_deposicion', label: 'Pañal con deposición' },
  { value: 'bano', label: 'Fue al baño' },
  { value: 'accidente', label: 'Accidente' },
]

export const MOODS = [
  { value: 'happy', label: 'De buen ánimo' },
  { value: 'calm', label: 'Con calma' },
  { value: 'sleepy', label: 'Con sueño' },
  { value: 'sad', label: 'Ánimo bajo' },
  { value: 'crying', label: 'Llorando' },
  { value: 'irritable', label: 'Irritable' },
  { value: 'sick', label: 'Con malestar' },
]

export const REPORT_STATUS = {
  draft: { label: 'Borrador', status: 'partial' },
  ready: { label: 'Listo', status: 'info' },
  sent: { label: 'Enviado', status: 'done' },
}

/** Columnas de la matriz para los niños cargados (+ comidas añadidas a mano). */
export function buildColumns(rows, extraMeals = []) {
  const meals = new Set([...CORE_MEALS, ...extraMeals])
  let hasActivities = false
  for (const r of rows) {
    for (const it of r.checklist?.items || []) {
      if (it.key.startsWith('meal:')) meals.add(it.key.slice(5))
      if (it.group === 'activities') hasActivities = true
    }
  }
  const cols = [{ key: 'arrival', label: 'Llegada' }]
  for (const t of MEAL_ORDER) {
    if (meals.has(t)) cols.push({ key: `meal:${t}`, label: MEAL_LABEL[t], mealType: t })
  }
  cols.push({ key: 'nap', label: 'Siesta' })
  cols.push({ key: 'care', label: 'Pañal / Higiene' })
  if (hasActivities) cols.push({ key: 'activities', label: 'Actividades' })
  cols.push({ key: 'departure', label: 'Salida' })
  cols.push({ key: 'report', label: 'Reporte' })
  return cols
}

const isIn = (row) => row.attendance.status !== 'absent'

/**
 * Celda de un niño en una columna.
 * `status`: done | partial | not_done | pending | not_recorded | info | none (no aplica).
 * `action`: tipo de acción rápida al tocarla, o null si no se puede hacer nada aquí.
 */
export function cellFor(row, col, { isToday }) {
  const items = row.checklist?.items || []
  const closed = !!row.checklist?.dayClosed
  const missing = closed ? 'not_recorded' : 'pending'
  const missingText = closed ? 'Sin registro' : 'Pendiente'

  if (col.key === 'arrival') {
    if (isIn(row)) {
      return { status: 'done', text: timeOf(row.attendance.arrivalAt) || 'Llegó', action: 'arrival' }
    }
    const att = items.find((i) => i.key === 'attendance')
    const st = att?.status || 'pending'
    if (st === 'pending') {
      return { status: 'pending', text: 'Sin llegar', action: isToday ? 'arrival' : null, link: isToday ? null : '/panel/dia' }
    }
    const text = st === 'info'
      ? (att.detail || '').startsWith('Ausencia') ? 'Justificada' : 'Cerrado'
      : 'No asistió'
    return { status: st, text, title: att?.detail || '', action: null }
  }

  if (col.key === 'departure') {
    if (row.attendance.status === 'checked_out') {
      return { status: 'done', text: timeOf(row.attendance.departureAt) || 'Salió', link: '/panel/dia' }
    }
    if (row.attendance.status === 'present') {
      return { status: 'none', text: 'En sala', link: '/panel/dia', title: 'Registrar la salida en Entradas y salidas' }
    }
    return { status: 'none', text: '—' }
  }

  if (col.key === 'report') {
    const rep = row.report
    if (rep) {
      const cfg = REPORT_STATUS[rep.status] || REPORT_STATUS.draft
      return { status: cfg.status, text: cfg.label, action: 'report' }
    }
    if (!isIn(row)) return { status: 'none', text: '—' }
    return { status: 'none', text: 'Generar', action: 'report', emphasis: true }
  }

  // Lo que sigue sólo aplica si el niño está (o estuvo) en la sala.
  if (!isIn(row)) return { status: 'none', text: '—' }

  if (col.mealType) {
    const item = items.find((i) => i.key === col.key)
    if (!item) return { status: missing, text: missingText, action: 'meal' }
    if (col.mealType === 'bottle') return { status: 'done', text: item.detail || 'Sí', action: 'meal' }
    if (item.status === 'pending' || item.status === 'not_recorded') {
      return { status: item.status, text: missingText, action: 'meal' }
    }
    return { status: item.status, text: MEAL_SHORT[item.detail] || item.detail || 'Hecho', title: item.detail, action: 'meal' }
  }

  if (col.key === 'nap') {
    const item = items.find((i) => i.key === 'nap')
    if (!item) return { status: 'none', text: 'Anotar', action: 'nap' }
    if (item.status === 'pending' || item.status === 'not_recorded') {
      return { status: item.status, text: missingText, action: 'nap' }
    }
    const d = item.detail || ''
    let text = d
    let sleeping = false
    if (d.startsWith('Durmiendo')) {
      text = 'Durmiendo'
      sleeping = true
    } else if (d.startsWith('Durmió')) {
      text = d.replace(/^Durmió\s*/, '').replace(/\s*\(.*\)$/, '')
    }
    return { status: sleeping ? 'info' : item.status, text, title: d, action: 'nap', sleeping }
  }

  if (col.key === 'care') {
    const care = items.filter((i) => i.group === 'care')
    if (!care.length) return { status: 'none', text: 'Anotar', action: 'care' }
    const n = care.reduce((acc, i) => acc + (i.count || 1), 0)
    return {
      status: 'info',
      text: `${n} ${n === 1 ? 'vez' : 'veces'}`,
      title: care.map((i) => `${i.label}: ${i.detail}`).join(' · '),
      action: 'care',
    }
  }

  if (col.key === 'activities') {
    const acts = items.filter((i) => i.group === 'activities')
    if (!acts.length) return { status: 'none', text: '—' }
    const done = acts.filter((i) => i.status === 'done').length
    const pend = acts.filter((i) => i.status === 'pending' || i.status === 'not_recorded').length
    const status = done === acts.length ? 'done' : pend ? (closed ? 'not_recorded' : 'pending') : done ? 'partial' : 'not_done'
    return {
      status,
      text: acts.length === 1 ? (status === 'done' ? 'Participó' : status === 'not_done' ? 'No participó' : missingText) : `${done}/${acts.length}`,
      title: acts.map((i) => `${i.label}: ${i.detail || 'pendiente'}`).join(' · '),
      link: '/panel/actividades',
    }
  }

  return { status: 'none', text: '—' }
}

/** Celdas pendientes de un niño (lo que falta), sin contar salida ni reporte. */
export function pendingCells(row, cols, opts) {
  return cols
    .filter((c) => c.key !== 'departure' && c.key !== 'report')
    .map((c) => ({ col: c, cell: cellFor(row, c, opts) }))
    .filter(({ cell }) => cell.status === 'pending')
}

/** Niños presentes que aún no tienen esa comida anotada (para "todos comieron todo"). */
export function bulkMealTargets(rows, mealType) {
  return rows.filter((r) => {
    if (r.attendance.status === 'absent') return false
    const item = (r.checklist?.items || []).find((i) => i.key === `meal:${mealType}`)
    return !item || item.status === 'pending' || item.status === 'not_recorded'
  })
}
