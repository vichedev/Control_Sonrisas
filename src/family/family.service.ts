import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Child } from '../children/child.entity';
import { ChildAttendance } from '../attendance/child-attendance.entity';
import { DailyReport } from '../reports/daily-report.entity';
import { ChildrenService } from '../children/children.service';
import { AttendanceService } from '../attendance/attendance.service';
import { MealsService } from '../meals/meals.service';
import { DailyLogsService } from '../daily-logs/daily-logs.service';
import { ActivitiesService } from '../activities/activities.service';
import { PhotosService } from '../photos/photos.service';
import { ReportsService } from '../reports/reports.service';
import { JustificationsService } from '../justifications/justifications.service';
import { CreateJustificationDto } from '../justifications/dto/create-justification.dto';
import { addDays, dayKey, normalizeDay } from '../common/day.util';
import { ageFromBirthDate } from '../common/day.util';

/** Registro de entrada/salida tal como lo ve la familia (sin datos internos). */
export interface FamilyAttendanceView {
  id: string;
  type: string;
  date: string;
  createdAt: Date;
  mood: string;
  temperature: number | null;
  personName: string;
  personRelationship: string;
}

/** Quita alertas, documento, notas, foto y quién registró: sólo para uso interno. */
function toFamilyAttendance(r: any): FamilyAttendanceView | null {
  if (!r) return null;
  return {
    id: r.id,
    type: r.type,
    date: r.date,
    createdAt: r.createdAt,
    mood: r.mood,
    temperature: r.temperature ?? null,
    personName: r.personName || '',
    personRelationship: r.personRelationship || '',
  };
}

/** Quita el objeto `child` embebido (trae notas internas) y el id de quien registró. */
function stripRow<T extends Record<string, any>>(row: T) {
  const { child, recordedById, createdById, ...rest } = row as any;
  return rest;
}

/**
 * Portal familiar.
 *
 * Todo endpoint de este módulo resuelve primero qué niños tiene a cargo el representante
 * autenticado y filtra por esa lista. Ningún parámetro de la petición decide el alcance:
 * si un representante pide el historial de un niño ajeno, recibe 404, no datos.
 */
@Injectable()
export class FamilyService {
  constructor(
    @InjectRepository(Child) private readonly childrenRepo: Repository<Child>,
    @InjectRepository(ChildAttendance) private readonly attendanceRepo: Repository<ChildAttendance>,
    @InjectRepository(DailyReport) private readonly reportsRepo: Repository<DailyReport>,
    private readonly children: ChildrenService,
    private readonly attendance: AttendanceService,
    private readonly meals: MealsService,
    private readonly logs: DailyLogsService,
    private readonly activities: ActivitiesService,
    private readonly photos: PhotosService,
    private readonly reports: ReportsService,
    private readonly justifications: JustificationsService,
  ) {}

  /** Niños a cargo del representante, con su sala. */
  async myChildren(guardianId: string) {
    const ids = await this.children.childIdsForGuardian(guardianId);
    if (!ids.length) return [];
    const rows = await this.childrenRepo.find({
      where: { id: In(ids) },
      relations: ['classroom'],
      order: { firstName: 'ASC' },
    });
    return rows.map((c) => ({
      id: c.id,
      name: `${c.firstName} ${c.lastName}`.trim(),
      photoUrl: c.photoUrl,
      birthDate: c.birthDate,
      age: ageFromBirthDate(c.birthDate).label,
      classroomName: c.classroom?.name || '',
      classroomColor: c.classroom?.color || '',
      allergies: c.allergies,
      active: c.active,
    }));
  }

  private async assertMine(guardianId: string, childId: string) {
    await this.children.assertGuardianOf(guardianId, childId);
  }

  /** Resumen de hoy de todos sus niños: dónde está cada uno ahora mismo. */
  async today(guardianId: string) {
    const children = await this.myChildren(guardianId);
    const date = dayKey();
    if (!children.length) return { date, children: [] };
    const ids = children.map((c) => c.id);
    // Dos consultas para todos los niños en vez de dos por niño.
    const [records, reports] = await Promise.all([
      this.attendanceRepo.find({ where: { childId: In(ids), date }, order: { createdAt: 'ASC' } }),
      this.reportsRepo.find({ where: { childId: In(ids), date } }),
    ]);
    const out = children.map((child) => {
      const mine = records.filter((r) => r.childId === child.id);
      const arrival = mine.find((r) => r.type === 'in') || null;
      const departure = [...mine].reverse().find((r) => r.type === 'out') || null;
      const report = reports.find((r) => r.childId === child.id);
      return {
        child,
        status: departure ? 'checked_out' : arrival ? 'present' : 'absent',
        arrival: toFamilyAttendance(arrival),
        departure: toFamilyAttendance(departure),
        reportSent: report?.status === 'sent',
        reportId: report?.status === 'sent' ? report.id : null,
      };
    });
    return { date, children: out };
  }

  /** Día completo de un niño: lo mismo que ve el personal, sin las notas internas. */
  async childDay(guardianId: string, childId: string, date?: string) {
    await this.assertMine(guardianId, childId);
    const day = normalizeDay(date);
    const [snapshot, report, checklist, myIds] = await Promise.all([
      this.reports.buildSnapshot(childId, day),
      this.reports.findByChildAndDate(childId, day),
      this.reports.buildChecklist(childId, day),
      this.children.childIdsForGuardian(guardianId),
    ]);
    // Galería del día: fotos en las que sale el niño (de otros niños sólo se da el número).
    const photos = await this.photos.forChildDay(childId, day, myIds);
    return {
      ...snapshot,
      photos: photos.map((p) => ({
        id: p.id,
        url: p.url,
        caption: p.caption,
        activityId: p.activityId,
        activityTitle: p.activityTitle,
        subject: p.subject,
        takenAt: p.takenAt,
        othersCount: p.othersCount,
        childIds: p.childIds,
      })),
      photoUrls: photos.map((p) => p.url),
      arrival: toFamilyAttendance(snapshot.arrival),
      departure: toFamilyAttendance(snapshot.departure),
      checklist,
      // El texto sólo se muestra si el reporte ya se envió: mientras es borrador puede
      // cambiar, y la familia no debe leer una versión que la educadora aún está editando.
      report: report?.status === 'sent'
        ? { id: report.id, messageText: report.messageText, sentAt: report.sentAt }
        : null,
    };
  }

  /** Ficha del niño (sin `internalNotes`, que es información interna del personal). */
  async childProfile(guardianId: string, childId: string) {
    await this.assertMine(guardianId, childId);
    const child = await this.children.findOne(childId);
    const { internalNotes, ...rest } = child as any;
    return rest;
  }

  /** Historial de asistencia. */
  async childAttendance(guardianId: string, childId: string, from?: string, to?: string) {
    await this.assertMine(guardianId, childId);
    const rows = await this.attendance.history(childId, {
      from: from || addDays(dayKey(), -60),
      to: to || dayKey(),
    });
    return rows.map((r) => toFamilyAttendance(r));
  }

  /** Reportes diarios ya enviados. */
  async childReports(guardianId: string, childId: string) {
    await this.assertMine(guardianId, childId);
    const rows = await this.reports.familyHistory([childId]);
    // Sólo lo que la familia necesita: sin teléfonos de envío ni datos internos del reporte.
    return rows.map((r: any) => ({
      id: r.id,
      date: r.date,
      sentAt: r.sentAt,
      messageText: r.messageText,
      summary: r.snapshot?.checklist?.summary || null,
    }));
  }

  /** Galería: fotos de sus niños y las grupales de sus salas. */
  async gallery(guardianId: string, opts: { from?: string; to?: string } = {}) {
    const ids = await this.children.childIdsForGuardian(guardianId);
    if (!ids.length) return [];
    const children = await this.childrenRepo.find({ where: { id: In(ids) } });
    const classroomIds = [...new Set(children.map((c) => c.classroomId).filter(Boolean))] as string[];
    return this.photos.listForFamily({
      childIds: ids,
      classroomIds,
      from: opts.from || addDays(dayKey(), -60),
      to: opts.to || dayKey(),
    });
  }

  /**
   * Fotos de un niño en un rango, paginadas. `scope=room` → fotos grupales de su sala
   * (sin niños etiquetados).
   */
  async childPhotos(
    guardianId: string,
    childId: string,
    opts: { from?: string; to?: string; scope?: string; page?: number; limit?: number },
  ) {
    await this.assertMine(guardianId, childId);
    const [child, myIds] = await Promise.all([
      this.childrenRepo.findOne({ where: { id: childId }, select: ['id', 'classroomId'] }),
      this.children.childIdsForGuardian(guardianId),
    ]);
    return this.photos.forChildRange({
      childId,
      classroomId: child?.classroomId || null,
      myChildIds: myIds,
      from: opts.from ? normalizeDay(opts.from) : addDays(dayKey(), -365),
      to: opts.to ? normalizeDay(opts.to) : dayKey(),
      scope: opts.scope === 'room' ? 'room' : 'child',
      page: opts.page,
      limit: opts.limit,
    });
  }

  /** Comidas y bitácora de un rango (evolución de la alimentación y el sueño). */
  async childHistory(guardianId: string, childId: string, from?: string, to?: string) {
    await this.assertMine(guardianId, childId);
    const start = from || addDays(dayKey(), -30);
    const end = to || dayKey();
    const [meals, logs, activities, mealSummary] = await Promise.all([
      this.meals.list({ childId, from: start, to: end }),
      this.logs.list({ childId, from: start, to: end }),
      this.activities.list({ childId, from: start, to: end }),
      this.meals.intakeSummary({ childId, from: start, to: end }),
    ]);
    return {
      from: start,
      to: end,
      meals: meals.map((m) => stripRow(m)),
      logs: logs.map((l) => stripRow(l)),
      // Sólo las actividades que la sala decidió compartir con las familias.
      activities: activities
        .filter((a: any) => a.shareWithFamilies === true)
        .map((a: any) => {
          const { classroom, ...rest } = stripRow(a);
          return { ...rest, classroomName: classroom?.name || '' };
        }),
      mealSummary,
    };
  }

  // --- Avisos de ausencia ---

  async listJustifications(guardianId: string) {
    const ids = await this.children.childIdsForGuardian(guardianId);
    return this.justifications.list({ childIds: ids });
  }

  async createJustification(guardianId: string, dto: CreateJustificationDto, actor: { id?: string; name?: string }) {
    const ids = await this.children.childIdsForGuardian(guardianId);
    if (!ids.includes(dto.childId)) {
      throw new ForbiddenException('Ese niño no está a su cargo');
    }
    return this.justifications.create(dto, actor);
  }
}
