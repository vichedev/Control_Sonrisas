import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DaySchedule, Holiday, WorkSchedule } from './work-schedule.entity';
import { UpdateScheduleDto } from './dto/update-schedule.dto';

export type StaffMarkType = 'in' | 'lunch_out' | 'lunch_in' | 'out';

export type StaffScheduleStatus =
  | 'normal'
  | 'on_time'
  | 'late'
  | 'absent_threshold'
  | 'overtime'
  | 'early_leave'
  | 'rest_day'
  | 'holiday';

/** Estado de la llegada / retiro de un niño respecto al horario del centro. */
export type ChildScheduleStatus =
  | ''
  | 'on_time'
  | 'late_arrival'
  | 'early_pickup'
  | 'late_pickup'
  | 'closed_day';

export interface ScheduleEval<T extends string> {
  status: T;
  minutes: number;
  note: string;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const pad = (n: number) => String(n).padStart(2, '0');
const dateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseTimeOnDate(base: Date, hhmm: string): Date {
  const [h, m] = (HHMM.test(hhmm) ? hhmm : '00:00').split(':').map((x) => parseInt(x, 10));
  const d = new Date(base);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

function fmtDur(min: number): string {
  const m = Math.abs(Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** Guardería abierta de lunes a viernes, 07:30 a 17:00, con almuerzo del personal 13:00-14:00. */
function defaultDays(): Record<string, DaySchedule> {
  const day = (
    enabled: boolean,
    start = '07:30',
    end = '17:00',
    lunchStart = '13:00',
    lunchEnd = '14:00',
  ): DaySchedule => ({ enabled, start, end, lunchStart, lunchEnd });
  return {
    '0': day(false),
    '1': day(true),
    '2': day(true),
    '3': day(true),
    '4': day(true),
    '5': day(true),
    '6': day(false, '08:00', '13:00', '', ''),
  };
}

function sanitizeDays(
  input: any,
  current: Record<string, DaySchedule>,
): Record<string, DaySchedule> {
  const out: Record<string, DaySchedule> = { ...current };
  if (input && typeof input === 'object') {
    for (let i = 0; i <= 6; i++) {
      const k = String(i);
      const v = input[k];
      if (!v || typeof v !== 'object') continue;
      const cleanLunch = (raw: any, fallback: string | undefined): string => {
        if (raw === '' || raw === null) return '';
        if (typeof raw === 'string' && HHMM.test(raw)) return raw;
        return fallback ?? '';
      };
      out[k] = {
        enabled: v.enabled === true || v.enabled === 'true',
        start: HHMM.test(v.start) ? v.start : out[k]?.start || '07:30',
        end: HHMM.test(v.end) ? v.end : out[k]?.end || '17:00',
        lunchStart: cleanLunch(v.lunchStart, out[k]?.lunchStart),
        lunchEnd: cleanLunch(v.lunchEnd, out[k]?.lunchEnd),
      };
      // Un receso con sólo un extremo definido no significa nada: se descarta entero.
      if (!out[k].lunchStart || !out[k].lunchEnd) {
        out[k].lunchStart = '';
        out[k].lunchEnd = '';
      }
    }
  }
  return out;
}

function sanitizeHolidays(input: any): Holiday[] {
  if (!Array.isArray(input)) return [];
  const map = new Map<string, string>();
  for (const h of input) {
    if (h && typeof h === 'object' && YMD.test(h.date)) {
      map.set(h.date, String(h.name || '').slice(0, 80).trim());
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, name]) => ({ date, name }));
}

function clampMin(v: any, def: number): number {
  const n = Math.round(Number(v));
  if (!isFinite(n) || n < 0) return def;
  return Math.min(n, 1440);
}

function cleanTime(v: any, fallback: string): string {
  if (v === '' || v === null) return '';
  return typeof v === 'string' && HHMM.test(v) ? v : fallback;
}

@Injectable()
export class WorkScheduleService {
  constructor(
    @InjectRepository(WorkSchedule) private readonly repo: Repository<WorkSchedule>,
  ) {}

  /** Devuelve la (única) configuración, creándola con valores por defecto si no existe. */
  async get(): Promise<WorkSchedule> {
    const list = await this.repo.find({ order: { createdAt: 'ASC' }, take: 1 });
    if (list.length) {
      const s = list[0];
      if (!s.days) s.days = defaultDays();
      if (!s.holidays) s.holidays = [];
      return s;
    }
    const created = this.repo.create({
      name: 'Horario de la guardería',
      enabled: false,
      days: defaultDays(),
      lateArrivalAfterMinutes: 15,
      pickupDeadline: '',
      latePickupAfterMinutes: 10,
      reportGenerationTime: '17:00',
      staffAttendanceEnabled: true,
      lateAfterMinutes: 5,
      absentAfterMinutes: 120,
      holidays: [],
    });
    return this.repo.save(created);
  }

  async update(dto: UpdateScheduleDto): Promise<WorkSchedule> {
    const s = await this.get();
    if (dto.name !== undefined) {
      s.name = String(dto.name).slice(0, 80).trim() || 'Horario de la guardería';
    }
    if (dto.enabled !== undefined) s.enabled = !!dto.enabled;
    if (dto.days !== undefined) s.days = sanitizeDays(dto.days, s.days || defaultDays());
    if (dto.holidays !== undefined) s.holidays = sanitizeHolidays(dto.holidays);

    // Niños
    if (dto.lateArrivalAfterMinutes !== undefined) {
      s.lateArrivalAfterMinutes = clampMin(dto.lateArrivalAfterMinutes, s.lateArrivalAfterMinutes);
    }
    if (dto.pickupDeadline !== undefined) {
      s.pickupDeadline = cleanTime(dto.pickupDeadline, s.pickupDeadline);
    }
    if (dto.latePickupAfterMinutes !== undefined) {
      s.latePickupAfterMinutes = clampMin(dto.latePickupAfterMinutes, s.latePickupAfterMinutes);
    }
    if (dto.reportGenerationTime !== undefined) {
      s.reportGenerationTime = cleanTime(dto.reportGenerationTime, s.reportGenerationTime);
    }

    // Personal
    if (dto.staffAttendanceEnabled !== undefined) s.staffAttendanceEnabled = !!dto.staffAttendanceEnabled;
    if (dto.lateAfterMinutes !== undefined) s.lateAfterMinutes = clampMin(dto.lateAfterMinutes, s.lateAfterMinutes);
    if (dto.absentAfterMinutes !== undefined) s.absentAfterMinutes = clampMin(dto.absentAfterMinutes, s.absentAfterMinutes);
    if (dto.overtimeEnabled !== undefined) s.overtimeEnabled = !!dto.overtimeEnabled;
    if (dto.overtimeAfterMinutes !== undefined) s.overtimeAfterMinutes = clampMin(dto.overtimeAfterMinutes, s.overtimeAfterMinutes);
    if (dto.earlyLeaveEnabled !== undefined) s.earlyLeaveEnabled = !!dto.earlyLeaveEnabled;
    if (dto.earlyLeaveBeforeMinutes !== undefined) s.earlyLeaveBeforeMinutes = clampMin(dto.earlyLeaveBeforeMinutes, s.earlyLeaveBeforeMinutes);

    // Centro
    if (dto.centerName !== undefined) s.centerName = String(dto.centerName).slice(0, 120).trim();
    if (dto.centerAddress !== undefined) s.centerAddress = String(dto.centerAddress).slice(0, 200).trim();
    if (dto.centerPhone !== undefined) s.centerPhone = String(dto.centerPhone).slice(0, 40).trim();

    // El límite de inasistencia nunca puede ser menor que el de tardanza.
    if (s.absentAfterMinutes < s.lateAfterMinutes) s.absentAfterMinutes = s.lateAfterMinutes;
    return this.repo.save(s);
  }

  /** True si ese día la guardería está cerrada (fin de semana configurado o feriado). */
  isClosed(schedule: WorkSchedule, day: string): { closed: boolean; reason: string } {
    // Aunque la evaluación de horario esté desactivada, los días de apertura siguen
    // valiendo (por defecto lunes a viernes): si no, los fines de semana contarían como faltas.
    const holiday = (schedule?.holidays || []).find((h) => h.date === day);
    if (holiday) return { closed: true, reason: holiday.name || 'Feriado' };
    const cfg = this.dayConfig(schedule, day);
    return cfg?.enabled ? { closed: false, reason: '' } : { closed: true, reason: 'Día cerrado' };
  }

  /** Configuración (apertura/cierre) del día de la semana de 'YYYY-MM-DD'. */
  dayConfig(schedule: WorkSchedule | null | undefined, day: string): DaySchedule | null {
    const [y, m, d] = day.split('-').map(Number);
    const weekday = new Date(y, (m || 1) - 1, d || 1).getDay();
    return (schedule?.days || defaultDays())[String(weekday)] || null;
  }

  /**
   * Evalúa la llegada o el retiro de un NIÑO.
   *
   * La llegada tardía usa la hora de apertura + tolerancia. El retiro se compara contra
   * `pickupDeadline` si está configurado (es la hora que se factura aparte); si no lo está,
   * contra la hora de cierre del día.
   */
  evaluateChild(opts: {
    type: 'in' | 'out';
    at: Date;
    schedule: WorkSchedule;
  }): ScheduleEval<ChildScheduleStatus> {
    const { type, at, schedule } = opts;
    if (!schedule?.enabled) return { status: '', minutes: 0, note: '' };

    const ds = dateStr(at);
    const holiday = (schedule.holidays || []).find((h) => h.date === ds);
    if (holiday) {
      return {
        status: 'closed_day',
        minutes: 0,
        note: `Registro en día cerrado${holiday.name ? ': ' + holiday.name : ''}`,
      };
    }

    const day = (schedule.days || defaultDays())[String(at.getDay())];
    if (!day || !day.enabled) {
      return { status: 'closed_day', minutes: 0, note: 'Registro en día cerrado' };
    }

    if (type === 'in') {
      const open = parseTimeOnDate(at, day.start);
      const lateMin = Math.round((at.getTime() - open.getTime()) / 60000);
      if (lateMin > (schedule.lateArrivalAfterMinutes || 0)) {
        return {
          status: 'late_arrival',
          minutes: lateMin,
          note: `Llegó ${fmtDur(lateMin)} después de la apertura (${day.start})`,
        };
      }
      return { status: 'on_time', minutes: 0, note: 'Llegada dentro del horario' };
    }

    const deadline = schedule.pickupDeadline && HHMM.test(schedule.pickupDeadline)
      ? schedule.pickupDeadline
      : day.end;
    const limit = parseTimeOnDate(at, deadline);
    const delta = Math.round((at.getTime() - limit.getTime()) / 60000);
    if (delta > (schedule.latePickupAfterMinutes || 0)) {
      return {
        status: 'late_pickup',
        minutes: delta,
        note: `Retiro ${fmtDur(delta)} después del límite (${deadline})`,
      };
    }
    // Un retiro muy anticipado (más de 2 h antes del cierre) se anota como tal: suele
    // significar cita médica o que el niño se sintió mal, y a la familia le interesa verlo.
    if (delta < -120) {
      return { status: 'early_pickup', minutes: -delta, note: `Retiro anticipado (${fmtDur(-delta)} antes)` };
    }
    return { status: 'on_time', minutes: 0, note: 'Retiro dentro del horario' };
  }

  /**
   * Evalúa un marcaje del PERSONAL contra la jornada configurada.
   * @param isFirstInOfDay sólo el primer "in" del día cuenta para tardanza.
   */
  evaluateStaff(opts: {
    type: StaffMarkType;
    at: Date;
    schedule: WorkSchedule;
    isFirstInOfDay: boolean;
  }): ScheduleEval<StaffScheduleStatus> {
    const { type, at, schedule, isFirstInOfDay } = opts;
    if (!schedule || !schedule.enabled || !schedule.staffAttendanceEnabled) {
      return { status: 'normal', minutes: 0, note: '' };
    }

    const ds = dateStr(at);
    const holiday = (schedule.holidays || []).find((h) => h.date === ds);
    if (holiday) {
      return {
        status: 'holiday',
        minutes: 0,
        note: `Día festivo${holiday.name ? ': ' + holiday.name : ''}`,
      };
    }

    const day = (schedule.days || defaultDays())[String(at.getDay())];
    if (!day || !day.enabled) {
      return { status: 'rest_day', minutes: 0, note: 'Marcaje en día de descanso' };
    }

    // Ir y volver del almuerzo no se penaliza.
    if (type === 'lunch_out' || type === 'lunch_in') {
      return { status: 'normal', minutes: 0, note: '' };
    }

    if (type === 'in') {
      if (!isFirstInOfDay) return { status: 'normal', minutes: 0, note: 'Reingreso' };
      const start = parseTimeOnDate(at, day.start);
      const lateMin = Math.round((at.getTime() - start.getTime()) / 60000);
      if (lateMin > schedule.absentAfterMinutes) {
        return {
          status: 'absent_threshold',
          minutes: lateMin,
          note: `Entrada con ${fmtDur(lateMin)} de retraso — supera el límite, cuenta como inasistencia`,
        };
      }
      if (lateMin > schedule.lateAfterMinutes) {
        return { status: 'late', minutes: lateMin, note: `Llegó ${fmtDur(lateMin)} tarde (esperado ${day.start})` };
      }
      if (lateMin < -1) {
        return { status: 'on_time', minutes: 0, note: `A tiempo (llegó ${fmtDur(-lateMin)} antes)` };
      }
      return { status: 'on_time', minutes: 0, note: 'A tiempo' };
    }

    // type === 'out'
    const end = parseTimeOnDate(at, day.end);
    const delta = Math.round((at.getTime() - end.getTime()) / 60000);
    if (delta >= 0) {
      if (schedule.overtimeEnabled && delta > 0 && delta >= schedule.overtimeAfterMinutes) {
        return { status: 'overtime', minutes: delta, note: `${fmtDur(delta)} de horas extra (salida ${day.end})` };
      }
      return {
        status: 'on_time',
        minutes: 0,
        note: delta > 0 ? `Salida ${fmtDur(delta)} después de la hora` : 'Salida puntual',
      };
    }
    const early = -delta;
    if (schedule.earlyLeaveEnabled && early > schedule.earlyLeaveBeforeMinutes) {
      return { status: 'early_leave', minutes: early, note: `Salió ${fmtDur(early)} antes (esperado ${day.end})` };
    }
    return { status: 'on_time', minutes: 0, note: 'Salida' };
  }
}
