import { normText } from './dataView'

/**
 * Utilidades de búsqueda de niños (nombre, apellido, cédula, matrícula), sin tildes.
 * Úsalas en cualquier buscador de niños (DayBoard, CommandPalette, trackers…) para que todos
 * respondan igual: "sofia mend", "1710034065", "1710 034".
 */

/** Nombre a mostrar de un niño venga como venga (`name`, `fullName` o nombre + apellido). */
export function childName(c) {
  if (!c) return ''
  return c.name || c.fullName || `${c.firstName || ''} ${c.lastName || ''}`.trim()
}

/** Normaliza un niño de cualquier endpoint a la forma que usa ChildPicker. */
export function toPickerChild(c) {
  return {
    ...c,
    id: c.id ?? c.childId,
    name: childName(c),
    photoUrl: c.photoUrl || c.child?.photoUrl || '',
    documentId: c.documentId || '',
    classroomName: c.classroomName || c.classroom?.name || '',
    code: c.code || '',
  }
}

/** Sólo dígitos y letras en mayúsculas (para comparar cédulas con o sin guiones/espacios). */
export function compactDoc(s) {
  return String(s || '').replace(/[\s.-]+/g, '').toUpperCase()
}

/** Formato de lectura de la cédula: 1710034065 → 171003406-5. Pasaportes, tal cual. */
export function formatDocumentId(doc) {
  const d = compactDoc(doc)
  return /^\d{10}$/.test(d) ? `${d.slice(0, 9)}-${d.slice(9)}` : d
}

/**
 * ¿El niño coincide con la búsqueda? Cada palabra debe aparecer en el nombre completo,
 * la cédula o la matrícula. Una búsqueda sólo de dígitos compara la cédula sin separadores.
 */
export function matchChild(c, query) {
  const q = normText(query).trim()
  if (!q) return true
  const name = normText(childName(c))
  const doc = compactDoc(c.documentId)
  const code = normText(c.code)
  const qDoc = compactDoc(query)
  if (qDoc && /^[0-9A-Z]{3,}$/.test(qDoc) && /\d/.test(qDoc) && (doc.includes(qDoc) || compactDoc(c.code).includes(qDoc))) {
    return true
  }
  const hay = `${name} ${doc.toLowerCase()} ${code}`
  return q.split(/\s+/).every((w) => hay.includes(w))
}

/**
 * Trozos de `text` para resaltar las palabras de `query` (sin tildes):
 * [{ text, hit: boolean }]. La longitud se conserva carácter a carácter.
 */
export function highlightParts(text, query) {
  const src = String(text || '')
  const words = normText(query).trim().split(/\s+/).filter((w) => w.length > 0)
  if (!words.length || !src) return [{ text: src, hit: false }]
  const folded = [...src].map((ch) => normText(ch)[0] ?? ch).join('')
  if (folded.length !== src.length) return [{ text: src, hit: false }]
  const marks = new Array(src.length).fill(false)
  for (const w of words) {
    let from = 0
    let i
    while ((i = folded.indexOf(w, from)) !== -1) {
      for (let k = i; k < i + w.length; k++) marks[k] = true
      from = i + w.length
    }
  }
  const parts = []
  for (let i = 0; i < src.length; i++) {
    const last = parts[parts.length - 1]
    if (last && last.hit === marks[i]) last.text += src[i]
    else parts.push({ text: src[i], hit: marks[i] })
  }
  return parts
}

/** Cédula ecuatoriana válida (10 dígitos, provincia 01–24 o 30, verificador módulo 10). */
export function isValidCedula(v) {
  if (!/^\d{10}$/.test(v)) return false
  const prov = Number(v.slice(0, 2))
  if (!((prov >= 1 && prov <= 24) || prov === 30) || Number(v[2]) >= 6) return false
  let sum = 0
  for (let i = 0; i < 9; i++) {
    let p = Number(v[i]) * (i % 2 === 0 ? 2 : 1)
    if (p >= 10) p -= 9
    sum += p
  }
  return (10 - (sum % 10)) % 10 === Number(v[9])
}

/**
 * Mismo criterio que el backend (src/children/document-id.util.ts): '' es válido (opcional);
 * cédula de 10 dígitos con verificador, o pasaporte de 5–20 letras/números con alguna letra.
 * Devuelve el mensaje de error o ''.
 */
export function documentIdError(raw) {
  const v = compactDoc(raw)
  if (!v) return ''
  if (v.length > 20) return 'Máximo 20 caracteres.'
  if (/^\d+$/.test(v)) {
    if (v.length !== 10) return 'La cédula ecuatoriana tiene 10 dígitos.'
    if (!isValidCedula(v)) return 'La cédula no es válida: revisa los dígitos.'
    return ''
  }
  if (/^[A-Z0-9]{5,20}$/.test(v) && /[A-Z]/.test(v)) return ''
  return 'Escribe una cédula de 10 dígitos o un pasaporte (5 a 20 letras y números).'
}
