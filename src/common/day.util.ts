/**
 * Utilidades de fecha "del día local".
 *
 * Todo el sistema guarda instantes en `timestamptz` (UTC) pero razona en días naturales:
 * "las comidas de hoy", "el reporte del 3 de agosto". El día local se calcula con la zona
 * del proceso (TZ del contenedor, p. ej. America/Guayaquil), no con UTC — si no, a partir
 * de las 19:00 el sistema empezaría a contar cosas del día siguiente.
 */

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' del día local de esa fecha (por defecto, hoy). */
export function dayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 'HH:mm' local. */
export function timeKey(d: Date = new Date()): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Primer instante del día local de 'YYYY-MM-DD'. */
export function startOfDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}

/** Último instante del día local de 'YYYY-MM-DD'. */
export function endOfDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
}

/** Valida que la cadena tenga forma 'YYYY-MM-DD'; si no, devuelve el día de hoy. */
export function normalizeDay(day?: string | null): string {
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : dayKey();
}

/** Suma (o resta, con negativos) días a una clave 'YYYY-MM-DD'. */
export function addDays(day: string, delta: number): string {
  const d = startOfDay(day);
  d.setDate(d.getDate() + delta);
  return dayKey(d);
}

/** Lista de días entre `from` y `to`, ambos inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  // Tope de seguridad: dos años. Evita que un rango mal formado genere un bucle infinito.
  for (let i = 0; i < 800 && cur <= to; i++) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** Minutos transcurridos desde medianoche para un 'HH:mm'. */
export function minutesOfDay(hhmm: string): number {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Edad a partir de una fecha de nacimiento 'YYYY-MM-DD'. */
export function ageFromBirthDate(birthDate?: string | null): {
  years: number;
  months: number;
  label: string;
} {
  if (!birthDate) return { years: 0, months: 0, label: '' };
  const b = startOfDay(birthDate);
  const now = new Date();
  let months =
    (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
  if (now.getDate() < b.getDate()) months--;
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const label =
    years === 0
      ? `${months} ${months === 1 ? 'mes' : 'meses'}`
      : rest === 0
        ? `${years} ${years === 1 ? 'año' : 'años'}`
        : `${years} ${years === 1 ? 'año' : 'años'} y ${rest} ${rest === 1 ? 'mes' : 'meses'}`;
  return { years, months, label };
}
