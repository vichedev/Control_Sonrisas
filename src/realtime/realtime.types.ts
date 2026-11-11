/** Qué cambió. */
export type RealtimeEntity =
  | 'attendance'
  | 'staff_attendance'
  | 'meal'
  | 'daily_log'
  | 'activity'
  | 'report'
  | 'justification'
  | 'child'
  | 'photo'
  | 'task';

export type RealtimeAction = 'created' | 'updated' | 'deleted';

/**
 * Evento interno del sistema. Se emite cada vez que cambia un dato del día.
 * - A los navegadores sólo se envían los campos públicos (sin `record`).
 * - `record` es la entidad completa cuando está disponible (sólo uso en servidor,
 *   p. ej. para notificar por WhatsApp).
 */
export interface RealtimeEvent {
  entity: RealtimeEntity;
  action: RealtimeAction;
  id?: string | null;
  childId?: string | null;
  classroomId?: string | null;
  /** Día afectado 'YYYY-MM-DD' si se conoce. */
  date?: string | null;
  record?: any;

  // ── Sólo servidor (nunca viajan al navegador) ──────────────────────────────
  /** Estado anterior en BD (updates hechos con `save`), si TypeORM lo cargó. */
  previous?: any;
  /** Persona del personal a la que se refiere (staff_attendance.userId, task.assigneeId). */
  userId?: string | null;
  /** Sala anterior (p. ej. niño cambiado de sala) para avisar también a la sala de origen. */
  previousClassroomId?: string | null;
  /** false = no visible para las familias (foto/actividad no compartida, reporte no enviado). */
  familyVisible?: boolean;
}

/** Lo único que se envía al navegador. */
export interface RealtimePublicEvent {
  entity: RealtimeEntity;
  action: RealtimeAction;
  id: string | null;
  childId: string | null;
  classroomId: string | null;
  date: string | null;
}
