import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { DailyReport } from './daily-report.entity';
import { Child } from '../children/child.entity';
import { ChildrenService } from '../children/children.service';
import { AttendanceService } from '../attendance/attendance.service';
import {
  MEAL_INTAKE_LABEL,
  MEAL_TYPE_LABEL,
  MealsService,
} from '../meals/meals.service';
import { Meal, MealIntake, MealType } from '../meals/meal.entity';
import { DailyLogsService, LOG_KIND_LABEL } from '../daily-logs/daily-logs.service';
import { DailyLog } from '../daily-logs/daily-log.entity';
import { ActivitiesService, PARTICIPATION_LABEL } from '../activities/activities.service';
import { Activity } from '../activities/activity.entity';
import { ActivityParticipant } from '../activities/activity-participant.entity';
import { PhotosService } from '../photos/photos.service';
import { Photo } from '../photos/photo.entity';
import { WorkScheduleService } from '../schedule/work-schedule.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { Justification } from '../justifications/justification.entity';
import { ChildAttendance, ChildMood } from '../attendance/child-attendance.entity';
import {
  dayKey,
  daysBetween,
  minutesOfDay,
  normalizeDay,
  timeKey,
} from '../common/day.util';

export interface Actor {
  id?: string;
  name?: string;
}

// ---------------------------------------------------------------- checklist

export type ChecklistGroup = 'attendance' | 'meals' | 'rest' | 'activities' | 'care' | 'health';
export type ChecklistStatus = 'done' | 'partial' | 'not_done' | 'pending' | 'not_recorded' | 'info';

export interface ChecklistItem {
  key: string;
  group: ChecklistGroup;
  label: string;
  status: ChecklistStatus;
  detail: string | null;
  count?: number;
}

/** "Qué se hizo y qué no" del día de un niño. */
export interface DayChecklist {
  date: string;
  childPresent: boolean;
  dayClosed: boolean;
  summary: { done: number; notDone: number; pending: number };
  items: ChecklistItem[];
}

const MOOD_LABEL: Record<ChildMood, string> = {
  '': '',
  happy: 'de buen ánimo',
  calm: 'con calma',
  sleepy: 'con sueño',
  sad: 'con el ánimo bajo',
  crying: 'llorando',
  irritable: 'irritable',
  sick: 'con malestar',
};

/** Orden de las comidas en el día (el biberón va aparte). */
const MEAL_ORDER: MealType[] = ['breakfast', 'snack_am', 'lunch', 'snack_pm'];

/** Cuánto comió → estado y texto del checklist. */
const INTAKE_CHECK: Record<MealIntake, { status: ChecklistStatus; detail: string }> = {
  all: { status: 'done', detail: 'Comió todo' },
  most: { status: 'done', detail: 'Comió casi todo' },
  half: { status: 'done', detail: 'Comió la mitad' },
  little: { status: 'partial', detail: 'Comió poco' },
  none: { status: 'not_done', detail: 'No comió' },
};

const HEALTH_DETAIL_LABEL: Record<string, string> = {
  fiebre: 'Fiebre',
  medicacion: 'Medicación',
  malestar: 'Malestar',
  vomito: 'Vómito',
  golpe: 'Golpe',
  caida: 'Caída',
  mordida: 'Mordida',
  rasguno: 'Rasguño',
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(DailyReport) private readonly repo: Repository<DailyReport>,
    @InjectRepository(Child) private readonly childrenRepo: Repository<Child>,
    @InjectRepository(Justification)
    private readonly justificationsRepo: Repository<Justification>,
    @InjectRepository(ChildAttendance)
    private readonly attendanceRepo: Repository<ChildAttendance>,
    @InjectRepository(Meal) private readonly mealsRepo: Repository<Meal>,
    @InjectRepository(DailyLog) private readonly logsRepo: Repository<DailyLog>,
    @InjectRepository(Activity) private readonly activitiesRepo: Repository<Activity>,
    @InjectRepository(ActivityParticipant)
    private readonly participantsRepo: Repository<ActivityParticipant>,
    @InjectRepository(Photo) private readonly photosRepo: Repository<Photo>,
    private readonly children: ChildrenService,
    private readonly attendance: AttendanceService,
    private readonly meals: MealsService,
    private readonly logs: DailyLogsService,
    private readonly activities: ActivitiesService,
    private readonly photos: PhotosService,
    private readonly schedule: WorkScheduleService,
    private readonly whatsapp: WhatsappService,
  ) {}

  // =====================================================================
  // Reporte diario por niño
  // =====================================================================

  /**
   * Reúne todo lo registrado del niño ese día. Es la fuente única del reporte:
   * el texto del mensaje y el detalle que ve la familia salen de aquí.
   */
  async buildSnapshot(childId: string, date: string) {
    const child = await this.children.findOne(childId);
    const [records, meals, logs, activities, photos] = await Promise.all([
      this.attendance.dayRecords(childId, date),
      this.meals.dayMeals(childId, date),
      this.logs.dayLogs(childId, date),
      this.activities.dayActivitiesForChild(childId, date),
      // Galería del día del niño: sólo fotos compartidas en las que sale (etiquetado).
      this.photos.forChildDay(childId, date),
    ]);

    const arrival = records.find((r) => r.type === 'in') || null;
    const departure = [...records].reverse().find((r) => r.type === 'out') || null;

    return {
      child: {
        id: child.id,
        name: child.fullName,
        photoUrl: child.photoUrl,
        classroomName: child.classroomName,
      },
      date,
      arrival,
      departure,
      meals: meals.map((m) => ({
        type: m.type,
        typeLabel: MEAL_TYPE_LABEL[m.type],
        menu: m.menu,
        intake: m.intake,
        intakeLabel: MEAL_INTAKE_LABEL[m.intake],
        notes: m.notes,
      })),
      naps: logs
        .filter((l) => l.kind === 'nap')
        .map((l) => ({
          from: timeKey(new Date(l.occurredAt)),
          to: l.endedAt ? timeKey(new Date(l.endedAt)) : '',
          minutes: l.durationMinutes,
          notes: l.notes,
        })),
      logs: logs
        .filter((l) => l.kind !== 'nap')
        .map((l) => ({
          kind: l.kind,
          kindLabel: LOG_KIND_LABEL[l.kind],
          detail: l.detail,
          time: timeKey(new Date(l.occurredAt)),
          notes: l.notes,
          temperature: l.temperature,
          notifyGuardian: l.notifyGuardian,
        })),
      // Una actividad en la que no participó no se cuenta como hecha
      // (aparece como "No participó" en el checklist).
      activities: activities
        .filter((a) => a.activity.shareWithFamilies && a.participation !== 'absent')
        .map((a) => ({
          title: a.activity.title,
          category: a.activity.category,
          description: a.activity.description,
          participation: a.participation,
          note: a.note,
        })),
      photos: photos.map((p) => ({
        id: p.id,
        url: p.url,
        caption: p.caption,
        activityTitle: p.activityTitle,
        takenAt: p.takenAt,
        othersCount: p.othersCount,
      })),
      photoUrls: photos.map((p) => p.url),
    } as Record<string, any>;
  }

  /**
   * "Qué se hizo y qué no": lo esperado del día (según lo que se registró para la sala)
   * contra lo registrado del niño. Sólo lee datos existentes.
   */
  async buildChecklist(childId: string, date: string): Promise<DayChecklist> {
    const day = normalizeDay(date);
    const child = await this.childrenRepo.findOne({ where: { id: childId } });
    if (!child) throw new NotFoundException('Niño no encontrado');

    const today = dayKey();
    const items: ChecklistItem[] = [];
    const records = await this.attendanceRepo.find({
      where: { childId, date: day },
      order: { createdAt: 'ASC' },
    });
    const arrival = records.find((r) => r.type === 'in') || null;
    const departure = [...records].reverse().find((r) => r.type === 'out') || null;
    const childPresent = !!(arrival || departure);
    const dayClosed = day < today || !!departure;
    const missing: ChecklistStatus = dayClosed ? 'not_recorded' : 'pending';
    const missingDetail = dayClosed ? 'Sin registro' : null;

    // --- Asistencia
    if (childPresent) {
      const parts: string[] = [];
      if (arrival) parts.push(`Llegó ${timeKey(new Date(arrival.createdAt))}`);
      if (departure) parts.push(`Salió ${timeKey(new Date(departure.createdAt))}`);
      items.push({ key: 'attendance', group: 'attendance', label: 'Asistencia', status: 'done', detail: parts.join(' · ') });
    } else {
      const schedule = await this.schedule.get();
      const closed = this.schedule.isClosed(schedule, day);
      const excuse = await this.justificationsRepo.findOne({
        where: { childId, status: 'approved', dateFrom: LessThanOrEqual(day), dateTo: MoreThanOrEqual(day) },
      });
      const cfg = this.schedule.dayConfig(schedule, day);
      const afterClose =
        day === today && !!cfg?.end && minutesOfDay(timeKey()) >= minutesOfDay(cfg.end);
      let status: ChecklistStatus;
      let detail: string | null;
      if (excuse) {
        status = 'info';
        detail = `Ausencia justificada: ${excuse.reason}`;
      } else if (closed.closed) {
        status = 'info';
        detail = `Centro cerrado (${closed.reason})`;
      } else if (day < today || afterClose) {
        status = 'not_done';
        detail = 'No asistió';
      } else {
        status = 'pending';
        detail = day > today ? null : 'Aún no llega';
      }
      items.push({ key: 'attendance', group: 'attendance', label: 'Asistencia', status, detail });
      // Ausente: no se listan comidas, siestas ni actividades.
      return this.finishChecklist(day, false, dayClosed, items);
    }

    const [meals, logs] = await Promise.all([
      this.mealsRepo.find({ where: { childId, date: day }, order: { createdAt: 'ASC' } }),
      this.logsRepo.find({ where: { childId, date: day }, order: { occurredAt: 'ASC' } }),
    ]);

    // --- Comidas: lo servido a la sala ese día ∪ lo registrado del niño
    const expected = new Set<MealType>(meals.map((m) => m.type));
    if (child.classroomId) {
      const roomTypes = await this.mealsRepo
        .createQueryBuilder('m')
        .innerJoin('m.child', 'c')
        .select('m.type', 'type')
        .distinct(true)
        .where('m.date = :d', { d: day })
        .andWhere('c.classroomId = :rid', { rid: child.classroomId })
        .getRawMany<{ type: MealType }>();
      for (const r of roomTypes) expected.add(r.type);
    }
    for (const type of MEAL_ORDER) {
      if (!expected.has(type)) continue;
      const mine = meals.filter((m) => m.type === type);
      const last = mine[mine.length - 1];
      const check = last ? INTAKE_CHECK[last.intake] || INTAKE_CHECK.all : null;
      items.push({
        key: `meal:${type}`,
        group: 'meals',
        label: MEAL_TYPE_LABEL[type],
        status: check ? check.status : missing,
        detail: check ? check.detail : missingDetail,
      });
    }
    const bottles = meals.filter((m) => m.type === 'bottle').length;
    if (bottles) {
      items.push({
        key: 'meal:bottle',
        group: 'meals',
        label: MEAL_TYPE_LABEL.bottle,
        status: 'done',
        detail: plural(bottles, 'biberón', 'biberones'),
        count: bottles,
      });
    }

    // --- Siesta: se espera si la sala durmió siesta ese día o la ficha tiene pautas de siesta
    const naps = logs.filter((l) => l.kind === 'nap');
    let napExpected = naps.length > 0 || !!child.napNotes?.trim();
    if (!napExpected && child.classroomId) {
      const roomNaps = await this.logsRepo
        .createQueryBuilder('l')
        .innerJoin('l.child', 'c')
        .where('l.date = :d', { d: day })
        .andWhere("l.kind = 'nap'")
        .andWhere('c.classroomId = :rid', { rid: child.classroomId })
        .getCount();
      napExpected = roomNaps > 0;
    }
    if (napExpected) {
      const slept = naps.filter((l) => l.detail !== 'no_durmio');
      if (slept.length) {
        const minutes = slept.reduce(
          (acc, l) =>
            acc +
            (l.durationMinutes ||
              (l.endedAt
                ? Math.max(0, Math.round((new Date(l.endedAt).getTime() - new Date(l.occurredAt).getTime()) / 60000))
                : 0)),
          0,
        );
        const from = timeKey(new Date(slept[0].occurredAt));
        const lastNap = slept[slept.length - 1];
        const detail = lastNap.endedAt
          ? `Durmió ${this.formatMinutes(minutes)} (${from}–${timeKey(new Date(lastNap.endedAt))})`
          : `Durmiendo desde ${timeKey(new Date(lastNap.occurredAt))}`;
        items.push({ key: 'nap', group: 'rest', label: 'Siesta', status: 'done', detail });
      } else if (naps.length) {
        items.push({ key: 'nap', group: 'rest', label: 'Siesta', status: 'not_done', detail: 'No durmió' });
      } else {
        items.push({ key: 'nap', group: 'rest', label: 'Siesta', status: missing, detail: missingDetail });
      }
    }

    // --- Actividades compartidas con las familias (de su sala o en las que figura)
    const parts = await this.participantsRepo
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.activity', 'a')
      .where('p.childId = :cid', { cid: childId })
      .andWhere('a.date = :d', { d: day })
      .getMany();
    const acts = new Map<string, Activity>();
    for (const p of parts) acts.set(p.activityId, p.activity);
    if (child.classroomId) {
      const roomActs = await this.activitiesRepo.find({
        where: { date: day, classroomId: child.classroomId },
      });
      for (const a of roomActs) acts.set(a.id, a);
    }
    const sorted = [...acts.values()]
      .filter((a) => a.shareWithFamilies && a.status !== 'cancelled')
      .sort(
        (a, b) =>
          new Date(a.startedAt || a.createdAt).getTime() - new Date(b.startedAt || b.createdAt).getTime(),
      );
    for (const a of sorted) {
      const p = parts.find((x) => x.activityId === a.id);
      let status: ChecklistStatus;
      let detail: string | null;
      if (p && p.participation !== 'absent') {
        status = 'done';
        detail = PARTICIPATION_LABEL[p.participation] || null;
      } else if (p) {
        status = 'not_done';
        detail = 'No participó';
      } else if (a.status === 'planned' || a.status === 'in_progress') {
        status = missing;
        detail = dayClosed ? 'Sin registro' : null;
      } else {
        status = 'not_done';
        detail = 'No participó';
      }
      items.push({ key: `activity:${a.id}`, group: 'activities', label: a.title, status, detail });
    }

    // --- Cuidado: higiene agrupada por tipo
    const hygiene = logs.filter((l) => l.kind === 'hygiene');
    const wet = hygiene.filter((l) => l.detail === 'panal_mojado').length;
    const dirty = hygiene.filter((l) => l.detail === 'panal_deposicion').length;
    const dry = hygiene.filter((l) => l.detail === 'panal_seco').length;
    if (wet + dirty + dry) {
      const bits: string[] = [];
      if (wet) bits.push(plural(wet, 'mojado', 'mojados'));
      if (dirty) bits.push(plural(dirty, 'con deposición', 'con deposición'));
      if (dry) bits.push(plural(dry, 'seco', 'secos'));
      items.push({
        key: 'care:diaper',
        group: 'care',
        label: 'Cambios de pañal',
        status: 'info',
        detail: bits.join(', '),
        count: wet + dirty + dry,
      });
    }
    const careGroups: Array<{ key: string; label: string; match: (d: string) => boolean }> = [
      { key: 'care:bathroom', label: 'Idas al baño', match: (d) => d === 'bano' },
      { key: 'care:accident', label: 'Accidentes', match: (d) => d === 'accidente' },
      {
        key: 'care:other',
        label: 'Higiene',
        match: (d) => !['panal_mojado', 'panal_deposicion', 'panal_seco', 'bano', 'accidente'].includes(d),
      },
    ];
    for (const g of careGroups) {
      const n = hygiene.filter((l) => g.match(l.detail || '')).length;
      if (!n) continue;
      items.push({
        key: g.key,
        group: 'care',
        label: g.label,
        status: 'info',
        detail: plural(n, 'vez', 'veces'),
        count: n,
      });
    }

    // --- Salud / incidentes: sólo lo marcado para avisar a la familia
    for (const l of logs) {
      if ((l.kind !== 'health' && l.kind !== 'incident') || !l.notifyGuardian) continue;
      const sub = HEALTH_DETAIL_LABEL[l.detail] || '';
      const label = sub ? `${LOG_KIND_LABEL[l.kind]}: ${sub}` : LOG_KIND_LABEL[l.kind];
      const temp = l.temperature ? ` (${l.temperature} °C)` : '';
      const text = l.notes?.trim();
      items.push({
        key: `health:${l.id}`,
        group: 'health',
        label,
        status: 'info',
        detail: `${timeKey(new Date(l.occurredAt))}${temp}${text ? ` · ${text}` : ''}`,
      });
    }

    return this.finishChecklist(day, true, dayClosed, items);
  }

  private finishChecklist(
    date: string,
    childPresent: boolean,
    dayClosed: boolean,
    items: ChecklistItem[],
  ): DayChecklist {
    const count = (...s: ChecklistStatus[]) => items.filter((i) => s.includes(i.status)).length;
    return {
      date,
      childPresent,
      dayClosed,
      summary: {
        done: count('done', 'partial'),
        notDone: count('not_done'),
        pending: count('pending', 'not_recorded'),
      },
      items,
    };
  }

  /** Redacta el mensaje que se enviará por WhatsApp. */
  async composeMessage(snapshot: any): Promise<string> {
    const schedule = await this.schedule.get();
    const centerName = schedule.centerName || 'la guardería';
    const lines: string[] = [];

    const prettyDate = this.formatDate(snapshot.date);
    lines.push(`*Reporte del día · ${snapshot.child.name}*`);
    lines.push(`${prettyDate}${snapshot.child.classroomName ? ` · ${snapshot.child.classroomName}` : ''}`);
    lines.push('');

    // Horario
    if (snapshot.arrival) {
      const mood = MOOD_LABEL[snapshot.arrival.mood as ChildMood];
      lines.push(
        `🕗 Llegó a las ${timeKey(new Date(snapshot.arrival.createdAt))}${mood ? ` (${mood})` : ''}`,
      );
    }
    if (snapshot.departure) {
      lines.push(`🏠 Se retiró a las ${timeKey(new Date(snapshot.departure.createdAt))}`);
    }

    // Alimentación
    if (snapshot.meals?.length) {
      lines.push('');
      lines.push('*Alimentación*');
      for (const m of snapshot.meals) {
        const menu = m.menu ? `: ${m.menu}` : '';
        const notes = m.notes ? ` — ${m.notes}` : '';
        lines.push(`🍽️ ${m.typeLabel}${menu} · ${m.intakeLabel}${notes}`);
      }
    }

    // Siestas
    if (snapshot.naps?.length) {
      lines.push('');
      lines.push('*Descanso*');
      for (const n of snapshot.naps) {
        const range = n.to ? `${n.from} a ${n.to}` : `desde ${n.from}`;
        const dur = n.minutes ? ` (${this.formatMinutes(n.minutes)})` : '';
        lines.push(`😴 Durmió de ${range}${dur}${n.notes ? ` — ${n.notes}` : ''}`);
      }
    }

    // Actividades (sin las que tienen participación 'absent')
    const activities = (snapshot.activities || []).filter((a: any) => a.participation !== 'absent');
    if (activities.length) {
      lines.push('');
      lines.push('*Actividades*');
      for (const a of activities) {
        lines.push(`🎨 ${a.title}${a.note ? ` — ${a.note}` : ''}`);
      }
    }

    // Bitácora: primero lo que hay que avisar sí o sí.
    const logs = snapshot.logs || [];
    const urgent = logs.filter((l: any) => l.notifyGuardian);
    const rest = logs.filter((l: any) => !l.notifyGuardian && l.kind !== 'hygiene');
    if (urgent.length) {
      lines.push('');
      lines.push('*Importante*');
      for (const l of urgent) {
        const temp = l.temperature ? ` (${l.temperature} °C)` : '';
        lines.push(`⚠️ ${l.time} · ${l.kindLabel}${temp}${l.notes ? ` — ${l.notes}` : ''}`);
      }
    }
    if (rest.length) {
      lines.push('');
      lines.push('*Observaciones*');
      for (const l of rest) {
        lines.push(`📝 ${l.time} · ${l.notes || l.kindLabel}`);
      }
    }

    const hygieneCount = logs.filter((l: any) => l.kind === 'hygiene').length;
    if (hygieneCount) {
      lines.push('');
      lines.push(`🧼 Cambios / higiene: ${hygieneCount}`);
    }

    // Lo que no se hizo (sólo `not_done`, en una línea para no alargar el mensaje)
    const checklist: DayChecklist | undefined = snapshot.checklist;
    if (checklist?.childPresent) {
      const notDone = checklist.items
        .filter((i) => i.status === 'not_done')
        .map((i) => (i.group === 'rest' || !i.detail ? i.detail || i.label : `${i.detail}: ${i.label}`));
      if (notDone.length) {
        lines.push('');
        lines.push(`⏳ *Pendiente / no se hizo:* ${notDone.slice(0, 6).join(' · ')}${notDone.length > 6 ? '…' : ''}`);
      }
    }

    if (snapshot.photoUrls?.length) {
      lines.push('');
      const n = snapshot.photoUrls.length;
      lines.push(`📸 ${n} ${n === 1 ? 'foto' : 'fotos'} del día — míralas en el portal familiar.`);
    }

    lines.push('');
    lines.push(`Con cariño, el equipo de ${centerName}.`);
    return lines.join('\n');
  }

  /** Texto final: mensaje generado + nota de la educadora al final. */
  private withNote(messageText: string, note: string) {
    return note ? `${messageText}\n\n_${note}_` : messageText;
  }

  /**
   * Genera (o regenera) el reporte de un niño para un día.
   * Un reporte ya enviado no se regenera: lo que la familia recibió queda como está.
   * Si la educadora editó el texto a mano, se actualiza el snapshot pero no el texto
   * (salvo `force`).
   */
  async generate(childId: string, date: string, actor: Actor, opts: { force?: boolean } = {}) {
    const day = normalizeDay(date);
    const existing = await this.repo.findOne({ where: { childId, date: day } });
    if (existing?.status === 'sent') return this.decorate(existing);

    const snapshot = await this.buildSnapshot(childId, day);
    snapshot.checklist = await this.buildChecklist(childId, day);
    const messageText = await this.composeMessage(snapshot);

    const report =
      existing ||
      this.repo.create({ childId, date: day, generatedById: actor?.id || null });
    report.snapshot = snapshot;
    report.photoUrls = snapshot.photoUrls;
    if (!report.edited || opts.force) {
      // La nota de la educadora se conserva y se vuelve a añadir al final del texto.
      report.messageText = this.withNote(messageText, report.teacherNote);
      report.edited = false;
    }
    report.status = 'ready';
    const saved = await this.repo.save(report);
    return this.decorate(saved);
  }

  /**
   * Genera los reportes de todos los niños que estuvieron presentes ese día.
   * Los ausentes no reciben reporte: no habría nada que contar. Los editados a mano
   * se saltan salvo `force`.
   */
  async generateForDay(
    date: string,
    classroomIds: string[] | undefined,
    actor: Actor,
    opts: { force?: boolean } = {},
  ) {
    const day = normalizeDay(date);
    const present = await this.presentChildIds(day, classroomIds);
    const existing = present.length
      ? await this.repo.find({ where: { childId: In(present), date: day } })
      : [];
    const byChild = new Map(existing.map((r) => [r.childId, r]));
    const results = [];
    let skipped = 0;
    for (const childId of present) {
      const prev = byChild.get(childId);
      if (prev && !opts.force && (prev.edited || prev.status === 'sent')) {
        skipped++;
        continue;
      }
      results.push(await this.generate(childId, day, actor, opts));
    }
    return { date: day, generated: results.length, skipped, reports: results };
  }

  async list(
    opts: {
      date?: string;
      classroomId?: string;
      classroomIds?: string[];
      status?: string;
      childId?: string;
    } = {},
  ) {
    if (opts.classroomIds && !opts.classroomIds.length) return [];
    const qb = this.repo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.child', 'child')
      .orderBy('r.date', 'DESC')
      .addOrderBy('child.firstName', 'ASC')
      .limit(500);
    if (opts.date) qb.andWhere('r.date = :d', { d: opts.date });
    if (opts.status) qb.andWhere('r.status = :s', { s: opts.status });
    if (opts.childId) qb.andWhere('r.childId = :cid', { cid: opts.childId });
    if (opts.classroomId) qb.andWhere('child.classroomId = :rid', { rid: opts.classroomId });
    if (opts.classroomIds) qb.andWhere('child.classroomId IN (:...rids)', { rids: opts.classroomIds });
    const rows = await qb.getMany();
    return rows.map((r) => this.decorate(r));
  }

  /** Id del niño de un reporte (para comprobar el alcance antes de tocarlo). 404 si no existe. */
  async childIdOf(id: string): Promise<string> {
    const report = await this.repo.findOne({ where: { id }, select: ['id', 'childId'] });
    if (!report) throw new NotFoundException('Reporte no encontrado');
    return report.childId;
  }

  async findOne(id: string) {
    const report = await this.repo.findOne({ where: { id }, relations: ['child'] });
    if (!report) throw new NotFoundException('Reporte no encontrado');
    const messages = await this.whatsapp.byReport(id);
    const recipients = await this.children.reportRecipients(report.childId);
    return { ...this.decorate(report), messages, recipients };
  }

  /** Edita el texto o la nota de la educadora antes de enviar. */
  async update(id: string, data: { messageText?: string; teacherNote?: string; photoUrls?: string[] }) {
    const report = await this.repo.findOne({ where: { id } });
    if (!report) throw new NotFoundException('Reporte no encontrado');
    if (report.status === 'sent') {
      throw new BadRequestException('Ese reporte ya se envió y no puede editarse');
    }
    const noteChanged =
      data.teacherNote !== undefined && data.teacherNote.slice(0, 2000) !== report.teacherNote;
    if (data.teacherNote !== undefined) report.teacherNote = data.teacherNote.slice(0, 2000);
    if (data.messageText !== undefined) {
      const text = data.messageText.slice(0, 4000);
      if (text !== report.messageText) {
        report.messageText = text;
        report.edited = true;
      }
    } else if (noteChanged && !report.edited && report.snapshot) {
      // La nota nueva tiene que llegar a la familia: se rehace el texto desde el snapshot.
      report.messageText = this.withNote(await this.composeMessage(report.snapshot), report.teacherNote);
    }
    if (data.photoUrls !== undefined) report.photoUrls = data.photoUrls.slice(0, 20);
    report.status = 'ready';
    return this.decorate(await this.repo.save(report));
  }

  /**
   * Envía el reporte a los representantes marcados para recibirlo.
   *
   * Cada destinatario se intenta por separado. El reporte queda como enviado sólo si al
   * menos un mensaje salió (`sent`) o quedó preparado (`manual_pending`); si fallan todos,
   * sigue en `ready` y se responde 400 con el detalle por destinatario.
   */
  async send(id: string, actor: Actor, opts: { onlyMissing?: boolean } = {}) {
    const report = await this.repo.findOne({ where: { id }, relations: ['child'] });
    if (!report) throw new NotFoundException('Reporte no encontrado');
    if (report.status === 'sent' && !opts.onlyMissing) {
      throw new BadRequestException('Ese reporte ya se envió');
    }
    if (!report.messageText) {
      throw new BadRequestException('El reporte está vacío, genérelo primero');
    }

    let recipients = await this.children.reportRecipients(report.childId);
    if (!recipients.length) {
      throw new BadRequestException(
        'Ningún representante de este niño tiene teléfono y recepción de reportes activada',
      );
    }
    const previousOk: string[] = [];
    if (opts.onlyMissing) {
      // Sólo a quien no lo recibió todavía (ni lo tiene en cola).
      const done = new Set(
        (await this.whatsapp.byReport(report.id))
          .filter((m) => m.status === 'sent' || m.status === 'queued')
          .map((m) => m.guardianId),
      );
      for (const r of recipients) if (done.has(r.guardianId)) previousOk.push(r.phone);
      recipients = recipients.filter((r) => !done.has(r.guardianId));
      if (!recipients.length) throw new BadRequestException('Todas las familias ya recibieron este reporte');
    }

    const messages = [];
    const results: Array<{
      guardianId: string;
      name: string;
      phone: string;
      status: 'sent' | 'manual_pending' | 'failed' | 'queued';
      error: string;
      messageId: string | null;
      link: string;
    }> = [];
    for (const r of recipients) {
      try {
        const msg = await this.whatsapp.send({
          phone: r.phone,
          body: report.messageText,
          toName: r.name,
          childId: report.childId,
          guardianId: r.guardianId,
          reportId: report.id,
          actorId: actor?.id,
        });
        messages.push(msg);
        results.push({
          guardianId: r.guardianId,
          name: r.name,
          phone: r.phone,
          status: msg.status,
          error: msg.errorMessage || '',
          messageId: msg.id,
          link: msg.link || '',
        });
      } catch (e: any) {
        // Teléfono inválido u otro error de un destinatario: no frena a los demás.
        results.push({
          guardianId: r.guardianId,
          name: r.name,
          phone: r.phone,
          status: 'failed',
          error: e?.message || 'Error al enviar',
          messageId: null,
          link: '',
        });
      }
    }

    const ok = results.filter((r) => r.status === 'sent' || r.status === 'manual_pending');
    if (!ok.length) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: `No se pudo enviar el reporte a ningún representante: ${results
          .map((r) => `${r.name || r.phone} (${r.error || 'falló'})`)
          .join('; ')}`,
        results,
      });
    }

    report.status = 'sent';
    report.sentAt = report.sentAt && opts.onlyMissing ? report.sentAt : new Date();
    report.sentVia = this.whatsapp.providerName;
    report.sentTo = [...new Set([...previousOk, ...ok.map((r) => r.phone)])].join(', ');
    report.sentById = actor?.id || null;
    report.sentByName = actor?.name || '';
    await this.repo.save(report);

    return { report: this.decorate(report), messages, results };
  }

  /** Envía en bloque todos los reportes listos de un día. */
  async sendForDay(date: string, classroomIds: string[] | undefined, actor: Actor) {
    const pending = await this.list({ date: normalizeDay(date), classroomIds, status: 'ready' });
    const results = [];
    let sent = 0;
    for (const r of pending) {
      try {
        results.push(await this.send(r.id, actor));
        sent++;
      } catch (e: any) {
        // Un niño sin teléfono registrado no debe frenar el envío de los otros 30.
        const body = typeof e?.getResponse === 'function' ? e.getResponse() : null;
        results.push({
          reportId: r.id,
          childName: r.childName,
          error: e?.message || 'Error al enviar',
          results: body?.results || [],
        });
      }
    }
    return { total: pending.length, sent, failed: pending.length - sent, results };
  }

  async remove(id: string) {
    const report = await this.repo.findOne({ where: { id } });
    if (!report) throw new NotFoundException('Reporte no encontrado');
    await this.repo.remove(report);
    return { ok: true as const };
  }

  // =====================================================================
  // Informes generales
  // =====================================================================

  /**
   * Asistencia por niño en un rango: días presente, ausente y justificado.
   * Es el informe que se entrega a la familia y a la entidad reguladora.
   *
   * Cada niño cuenta desde su `enrolledAt`. Los niños ya dados de baja aparecen si
   * tienen registros en el rango (contados hasta su último registro).
   */
  async attendanceReport(opts: { from: string; to: string; classroomId?: string; classroomIds?: string[] }) {
    const from = normalizeDay(opts.from);
    const to = normalizeDay(opts.to);
    const days = daysBetween(from, to);
    const schedule = await this.schedule.get();
    const openDays = days.filter((d) => !this.schedule.isClosed(schedule, d).closed);
    const rooms = opts.classroomIds ?? (opts.classroomId ? [opts.classroomId] : undefined);
    if (rooms && !rooms.length) return { from, to, openDays: openDays.length, rows: [] };

    const recQb = this.attendanceRepo
      .createQueryBuilder('a')
      .innerJoin('a.child', 'c')
      .select(['a.id', 'a.childId', 'a.date', 'a.scheduleStatus'])
      .where('a.date BETWEEN :from AND :to', { from, to })
      .andWhere("a.type = 'in'");
    if (rooms) recQb.andWhere('c.classroomId IN (:...rooms)', { rooms });
    const records = await recQb.getMany();

    const withRecords = [...new Set(records.map((r) => r.childId))];
    const roomWhere = rooms ? { classroomId: In(rooms) } : {};
    const where: any[] = [{ active: true, ...roomWhere }];
    if (withRecords.length) where.push({ id: In(withRecords) });
    const children = await this.childrenRepo.find({
      where,
      relations: ['classroom'],
      order: { firstName: 'ASC' },
    });
    if (!children.length) return { from, to, openDays: openDays.length, rows: [] };

    const ids = children.map((c) => c.id);
    const justifications = await this.justificationsRepo.find({
      where: {
        childId: In(ids),
        status: 'approved',
        dateFrom: LessThanOrEqual(to),
        dateTo: MoreThanOrEqual(from),
      },
    });

    const rows = children.map((child) => {
      const mine = records.filter((r) => r.childId === child.id);
      const lastDay = mine.reduce((max, r) => (r.date > max ? r.date : max), '');
      const childOpen = openDays.filter(
        (d) =>
          (!child.enrolledAt || d >= child.enrolledAt) && (child.active || d <= lastDay),
      );
      const openSet = new Set(childOpen);
      const presentDays = new Set(mine.map((r) => r.date).filter((d) => openSet.has(d)));
      const late = new Set(
        mine.filter((r) => r.scheduleStatus === 'late_arrival').map((r) => r.date),
      ).size;
      const justifiedDays = childOpen.filter(
        (d) =>
          !presentDays.has(d) &&
          justifications.some((j) => j.childId === child.id && j.dateFrom <= d && j.dateTo >= d),
      ).length;
      const absent = childOpen.length - presentDays.size - justifiedDays;
      return {
        childId: child.id,
        name: `${child.firstName} ${child.lastName}`.trim(),
        classroomName: child.classroom?.name || '',
        active: child.active,
        openDays: childOpen.length,
        present: presentDays.size,
        absent: Math.max(0, absent),
        justified: justifiedDays,
        late,
        attendancePct: childOpen.length
          ? Math.min(100, Math.round((presentDays.size / childOpen.length) * 100))
          : 0,
      };
    });

    return { from, to, openDays: openDays.length, rows };
  }

  /** Panorama del día para el resumen del panel. Con `classroomIds`, sólo esas salas. */
  async overview(date?: string, classroomIds?: string[]) {
    const day = normalizeDay(date);
    if (classroomIds) return this.scopedOverview(day, classroomIds);
    const [attendance, photoCount, pendingNotices, reports] = await Promise.all([
      this.attendance.dailyTotals(day),
      this.photos.countForDay(day),
      this.logs.pendingNoticesCount(),
      this.repo.find({ where: { date: day } }),
    ]);
    const activities = await this.activities.list({ date: day });
    const mealSummary = await this.meals.intakeSummary({ from: day, to: day });

    return {
      date: day,
      attendance,
      activities: activities.length,
      photos: photoCount,
      pendingNotices,
      meals: mealSummary,
      reports: {
        total: reports.length,
        sent: reports.filter((r) => r.status === 'sent').length,
        ready: reports.filter((r) => r.status === 'ready').length,
      },
    };
  }

  /** Igual que `overview` pero limitado a unas salas (educadoras). */
  private async scopedOverview(day: string, rooms: string[]) {
    const attendance = {
      enrolled: 0,
      present: 0,
      checkedOut: 0,
      absent: 0,
      justified: 0,
      lateArrivals: 0,
      flagged: 0,
    };
    const counts: Record<string, number> = { all: 0, most: 0, half: 0, little: 0, none: 0 };
    if (!rooms.length) {
      return {
        date: day,
        attendance,
        activities: 0,
        photos: 0,
        pendingNotices: 0,
        meals: { counts, total: 0, ateWellPct: 0 },
        reports: { total: 0, sent: 0, ready: 0 },
      };
    }
    for (const rid of rooms) {
      const { totals } = await this.attendance.board({ date: day, classroomId: rid });
      for (const k of Object.keys(attendance) as Array<keyof typeof attendance>) {
        attendance[k] += (totals as any)[k] || 0;
      }
    }
    const [activities, photos, pendingNotices, mealRows, reports] = await Promise.all([
      this.activitiesRepo.count({ where: { date: day, classroomId: In(rooms) } }),
      this.photosRepo
        .createQueryBuilder('p')
        .leftJoin(Child, 'c', 'c.id = p.childId')
        .where('p.date = :d', { d: day })
        .andWhere('(p.classroomId IN (:...rooms) OR c.classroomId IN (:...rooms))', { rooms })
        .getCount(),
      this.logsRepo
        .createQueryBuilder('l')
        .innerJoin('l.child', 'c')
        .where('l.notifyGuardian = true AND l.guardianNotified = false')
        .andWhere('c.classroomId IN (:...rooms)', { rooms })
        .getCount(),
      this.mealsRepo
        .createQueryBuilder('m')
        .innerJoin('m.child', 'c')
        .select('m.intake', 'intake')
        .addSelect('COUNT(*)', 'total')
        .where('m.date = :d', { d: day })
        .andWhere('c.classroomId IN (:...rooms)', { rooms })
        .groupBy('m.intake')
        .getRawMany<{ intake: string; total: string }>(),
      this.list({ date: day, classroomIds: rooms }),
    ]);
    for (const r of mealRows) counts[r.intake] = Number(r.total);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return {
      date: day,
      attendance,
      activities,
      photos,
      pendingNotices,
      meals: {
        counts,
        total,
        ateWellPct: total ? Math.round(((counts.all + counts.most) / total) * 100) : 0,
      },
      reports: {
        total: reports.length,
        sent: reports.filter((r) => r.status === 'sent').length,
        ready: reports.filter((r) => r.status === 'ready').length,
      },
    };
  }

  /**
   * Evolución de la asistencia diaria en un rango (gráfico del panel).
   * Una sola consulta agrupada en vez de un tablero por día.
   */
  async attendanceTrend(from: string, to: string, classroomIds?: string[]) {
    const days = daysBetween(normalizeDay(from), normalizeDay(to));
    if (!days.length) return [];
    const schedule = await this.schedule.get();
    const closed = new Set(days.filter((d) => this.schedule.isClosed(schedule, d).closed));
    if (classroomIds && !classroomIds.length) {
      return days.map((d) => ({ date: d, present: 0, absent: 0, closed: closed.has(d) }));
    }
    const first = days[0];
    const last = days[days.length - 1];

    const children = await this.childrenRepo.find({
      where: { active: true, ...(classroomIds ? { classroomId: In(classroomIds) } : {}) },
      select: ['id', 'enrolledAt'],
    });

    const qb = this.attendanceRepo
      .createQueryBuilder('a')
      .innerJoin('a.child', 'c')
      .select('a.childId', 'childId')
      .addSelect("to_char(a.date, 'YYYY-MM-DD')", 'day')
      .distinct(true)
      .where('a.date BETWEEN :first AND :last', { first, last })
      .andWhere("a.type = 'in'")
      .andWhere('c.active = true');
    if (classroomIds) qb.andWhere('c.classroomId IN (:...rooms)', { rooms: classroomIds });
    const pairs = await qb.getRawMany<{ childId: string; day: string }>();

    const presentByDay = new Map<string, Set<string>>();
    for (const p of pairs) {
      if (!presentByDay.has(p.day)) presentByDay.set(p.day, new Set());
      presentByDay.get(p.day)!.add(p.childId);
    }

    const justifications = children.length
      ? await this.justificationsRepo.find({
          where: {
            childId: In(children.map((c) => c.id)),
            status: 'approved',
            dateFrom: LessThanOrEqual(last),
            dateTo: MoreThanOrEqual(first),
          },
          select: ['id', 'childId', 'dateFrom', 'dateTo'],
        })
      : [];

    return days.map((d) => {
      const present = presentByDay.get(d) || new Set<string>();
      if (closed.has(d)) return { date: d, present: present.size, absent: 0, closed: true };
      const expected = children.filter((c) => !c.enrolledAt || c.enrolledAt <= d);
      const absent = expected.filter(
        (c) =>
          !present.has(c.id) &&
          !justifications.some((j) => j.childId === c.id && j.dateFrom <= d && j.dateTo >= d),
      ).length;
      return { date: d, present: present.size, absent, closed: false };
    });
  }

  // ------------------------------------------------------------- internos

  /**
   * Niños activos con algún registro (llegada o retiro) ese día. Consulta ligera:
   * evita armar el tablero completo de asistencia.
   */
  private async presentChildIds(day: string, classroomIds?: string[]): Promise<string[]> {
    if (classroomIds && !classroomIds.length) return [];
    const qb = this.attendanceRepo
      .createQueryBuilder('a')
      .innerJoin('a.child', 'c')
      .select('a.childId', 'childId')
      .distinct(true)
      .where('a.date = :d', { d: day })
      .andWhere('c.active = true');
    if (classroomIds) qb.andWhere('c.classroomId IN (:...rooms)', { rooms: classroomIds });
    const rows = await qb.getRawMany<{ childId: string }>();
    return rows.map((r) => r.childId);
  }

  private decorate(report: DailyReport) {
    return {
      ...report,
      childName: (report as any).child
        ? `${(report as any).child.firstName} ${(report as any).child.lastName}`.trim()
        : '',
    };
  }

  private formatDate(day: string): string {
    const [y, m, d] = day.split('-').map(Number);
    const date = new Date(y, (m || 1) - 1, d || 1);
    return date.toLocaleDateString('es-EC', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  private formatMinutes(min: number): string {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const r = min % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
  }

  /** Reportes ya enviados de un niño — los que ve la familia en su portal. */
  familyHistory(childIds: string[], limit = 60) {
    if (!childIds.length) return Promise.resolve([]);
    return this.repo.find({
      where: { childId: In(childIds), status: 'sent' },
      order: { date: 'DESC' },
      take: Math.min(limit, 200),
    });
  }

  /** Reporte de un niño en un día concreto, para el portal familiar. */
  findByChildAndDate(childId: string, date: string) {
    return this.repo.findOne({ where: { childId, date: normalizeDay(date) } });
  }

  /**
   * Seguimiento del día: checklist de cada niño activo de las salas indicadas,
   * con su estado de asistencia y el reporte del día (si existe).
   */
  async dayChecklists(date: string | undefined, classroomIds?: string[]) {
    const day = normalizeDay(date);
    if (classroomIds && !classroomIds.length) return { date: day, children: [] };
    const kids = await this.childrenRepo.find({
      where: { active: true, ...(classroomIds ? { classroomId: In(classroomIds) } : {}) },
      relations: { classroom: true },
      order: { firstName: 'ASC', lastName: 'ASC' },
    });
    if (!kids.length) return { date: day, children: [] };
    const ids = kids.map((k) => k.id);
    const [records, reports] = await Promise.all([
      this.attendanceRepo.find({ where: { childId: In(ids), date: day }, order: { createdAt: 'ASC' } }),
      this.repo.find({ where: { childId: In(ids), date: day }, select: ['id', 'childId', 'status'] }),
    ]);
    const reportBy = new Map(reports.map((r) => [r.childId, r]));

    // Checklists en lotes pequeños para no saturar el pool de conexiones.
    const checklists = new Map<string, DayChecklist>();
    const BATCH = 6;
    for (let i = 0; i < ids.length; i += BATCH) {
      const slice = ids.slice(i, i + BATCH);
      const res = await Promise.all(slice.map((id) => this.buildChecklist(id, day)));
      slice.forEach((id, j) => checklists.set(id, res[j]));
    }

    return {
      date: day,
      children: kids.map((k) => {
        const mine = records.filter((r) => r.childId === k.id);
        const arrival = mine.find((r) => r.type === 'in') || null;
        const departure = [...mine].reverse().find((r) => r.type === 'out') || null;
        const last = mine[mine.length - 1];
        const status: 'present' | 'checked_out' | 'absent' = !last
          ? 'absent'
          : last.type === 'out'
            ? 'checked_out'
            : 'present';
        const report = reportBy.get(k.id);
        return {
          child: {
            id: k.id,
            name: `${k.firstName} ${k.lastName}`.trim(),
            photoUrl: k.photoUrl,
            classroomId: k.classroomId,
            classroomName: k.classroom?.name || '',
            allergies: k.allergies,
          },
          attendance: {
            status,
            arrivalAt: arrival ? arrival.createdAt : null,
            departureAt: departure ? departure.createdAt : null,
          },
          checklist: checklists.get(k.id)!,
          report: report ? { id: report.id, status: report.status } : null,
        };
      }),
    };
  }

  /** Ids de niños sin reporte generado para ese día (los que faltan por cerrar). */
  async pendingForDay(date = dayKey(), classroomIds?: string[]) {
    const present = await this.presentChildIds(date, classroomIds);
    if (!present.length) return [];
    const existing = await this.repo.find({
      where: { childId: In(present), date },
      select: ['id', 'childId'],
    });
    const done = new Set(existing.map((r) => r.childId));
    return present.filter((id) => !done.has(id));
  }
}
