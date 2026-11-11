import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Not, Repository } from 'typeorm';
import { ChildAttendance, ChildMood } from './child-attendance.entity';
import { StaffAttendance, StaffAttendanceType } from './staff-attendance.entity';
import { Child } from '../children/child.entity';
import { ChildGuardian } from '../children/child-guardian.entity';
import { JustificationsService } from '../justifications/justifications.service';
import { WorkScheduleService } from '../schedule/work-schedule.service';
import { PhotosService } from '../photos/photos.service';
import { dayKey, endOfDay, normalizeDay, startOfDay } from '../common/day.util';
import {
  CheckInDto,
  CheckOutDto,
  ManualStaffMarkDto,
  StaffMarkDto,
  UpdateAttendanceDto,
} from './dto/attendance.dto';

export interface Actor {
  id?: string;
  name?: string;
  role?: string;
}

/** Vista de un registro para el portal familiar: sin datos internos. */
export interface FamilyAttendanceRecord {
  id: string;
  type: ChildAttendance['type'];
  date: string;
  createdAt: Date;
  mood: ChildMood;
  temperature: number | null;
  personName: string;
  personRelationship: string;
  /** Vacío si el retiro quedó señalado (la foto es evidencia interna). */
  photoUrl: string;
}

/** Violación de índice único en Postgres. */
const isUniqueViolation = (e: any) => e?.code === '23505' || e?.driverError?.code === '23505';

/** Estado de un niño en el tablero del día. */
export type BoardStatus = 'absent' | 'present' | 'checked_out' | 'justified';

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(ChildAttendance)
    private readonly repo: Repository<ChildAttendance>,
    @InjectRepository(StaffAttendance)
    private readonly staffRepo: Repository<StaffAttendance>,
    @InjectRepository(Child) private readonly childrenRepo: Repository<Child>,
    @InjectRepository(ChildGuardian) private readonly linksRepo: Repository<ChildGuardian>,
    private readonly justifications: JustificationsService,
    private readonly schedule: WorkScheduleService,
    private readonly photos: PhotosService,
  ) {}

  // =====================================================================
  // Niños
  // =====================================================================

  /**
   * Tablero del día: TODOS los niños activos con su estado, no sólo los que tienen
   * registro. Es la vista que la educadora necesita por la mañana — lo importante es
   * quién falta, y un listado de marcajes no responde a eso.
   */
  async board(opts: { date?: string; classroomId?: string; classroomIds?: string[] } = {}) {
    const date = normalizeDay(opts.date);
    // Alcance de la educadora: [] = ninguna sala a cargo.
    if (opts.classroomIds && !opts.classroomIds.length) {
      return { date, children: [], totals: this.emptyTotals() };
    }

    const childQb = this.childrenRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.classroom', 'room')
      .where('c.active = true')
      .orderBy('c.firstName', 'ASC');
    if (opts.classroomId) childQb.andWhere('c.classroomId = :rid', { rid: opts.classroomId });
    if (opts.classroomIds) childQb.andWhere('c.classroomId IN (:...rids)', { rids: opts.classroomIds });
    const children = await childQb.getMany();
    if (!children.length) return { date, children: [], totals: this.emptyTotals() };

    const ids = children.map((c) => c.id);
    const records = await this.repo.find({
      where: { childId: In(ids), date },
      order: { createdAt: 'ASC' },
    });
    // Sólo las justificaciones aprobadas que cubren ese día.
    const justified = await this.justifications.approvedFor(ids, date);

    const rows = children.map((child) => {
      const mine = records.filter((r) => r.childId === child.id);
      const arrival = mine.find((r) => r.type === 'in') || null;
      // El último 'out' gana: si se corrigió un retiro, manda el registro más reciente.
      const departure = [...mine].reverse().find((r) => r.type === 'out') || null;
      const excuse = justified.find(
        (j) => j.childId === child.id && j.dateFrom <= date && j.dateTo >= date,
      );

      let status: BoardStatus = 'absent';
      if (departure) status = 'checked_out';
      else if (arrival) status = 'present';
      else if (excuse) status = 'justified';

      return {
        childId: child.id,
        name: `${child.firstName} ${child.lastName}`.trim(),
        photoUrl: child.photoUrl,
        code: child.code,
        allergies: child.allergies,
        classroomId: child.classroomId,
        classroomName: child.classroom?.name || '',
        classroomColor: child.classroom?.color || '',
        status,
        arrival,
        departure,
        justification: excuse
          ? { id: excuse.id, type: excuse.type, reason: excuse.reason }
          : null,
        minutesInCenter:
          arrival && departure
            ? Math.max(
                0,
                Math.round(
                  (new Date(departure.createdAt).getTime() -
                    new Date(arrival.createdAt).getTime()) /
                    60000,
                ),
              )
            : 0,
      };
    });

    const totals = {
      enrolled: rows.length,
      present: rows.filter((r) => r.status === 'present').length,
      checkedOut: rows.filter((r) => r.status === 'checked_out').length,
      absent: rows.filter((r) => r.status === 'absent').length,
      justified: rows.filter((r) => r.status === 'justified').length,
      lateArrivals: rows.filter((r) => r.arrival?.scheduleStatus === 'late_arrival').length,
      flagged: rows.filter((r) => r.arrival?.flagged || r.departure?.flagged).length,
    };

    return { date, children: rows, totals };
  }

  private emptyTotals() {
    return {
      enrolled: 0,
      present: 0,
      checkedOut: 0,
      absent: 0,
      justified: 0,
      lateArrivals: 0,
      flagged: 0,
    };
  }

  /** Registra la llegada del niño. */
  async checkIn(childId: string, dto: CheckInDto, actor: Actor) {
    const child = await this.mustFindChild(childId);
    // Consentimiento de imagen (LOPDP): se comprueba antes de guardar la llegada.
    if (dto.photo) await this.photos.assertCanPhotograph(childId);
    const at = this.resolveTime(dto.at, actor);
    const date = dayKey(at);

    const existing = await this.repo.findOne({ where: { childId, date, type: 'in' } });
    if (existing) {
      throw new BadRequestException(
        `${child.firstName} ya tiene registrada la llegada de hoy`,
      );
    }

    const schedule = await this.schedule.get();
    const evaluation = this.schedule.evaluateChild({ type: 'in', at, schedule });

    const record = this.repo.create({
      childId,
      type: 'in',
      date,
      photoUrl: '',
      mood: (dto.mood as ChildMood) || '',
      temperature: dto.temperature ?? null,
      guardianId: dto.guardianId || null,
      personName: dto.personName || '',
      personRelationship: dto.personRelationship || '',
      personDocument: dto.personDocument || '',
      notes: dto.notes || '',
      scheduleStatus: evaluation.status,
      scheduleMinutes: evaluation.minutes,
      recordedById: actor.id || null,
      recordedByName: actor.name || '',
      createdAt: at,
    });
    const saved = await this.saveUnique(record, `${child.firstName} ya tiene registrada la llegada de hoy`);
    // La foto se indexa con el id del registro para poder borrarla con él.
    if (dto.photo) {
      saved.photoUrl = await this.photos.register({
        photo: dto.photo,
        subject: 'attendance',
        subjectId: saved.id,
        childId,
        classroomId: child.classroomId,
        date,
        caption: 'Llegada',
        actorId: actor.id,
        actorName: actor.name,
      });
      if (saved.photoUrl) await this.repo.update(saved.id, { photoUrl: saved.photoUrl });
    }
    return { ...saved, scheduleNote: evaluation.note };
  }

  /**
   * Registra el retiro del niño.
   *
   * Aquí está el único control de seguridad de verdad del sistema: si quien retira no es
   * un representante autorizado, se rechaza salvo que el personal confirme la excepción
   * (`overrideUnauthorized`), y en ese caso el registro queda señalado para coordinación.
   */
  async checkOut(childId: string, dto: CheckOutDto, actor: Actor) {
    const child = await this.mustFindChild(childId);
    const at = this.resolveTime(dto.at, actor);
    const date = dayKey(at);

    const arrival = await this.repo.findOne({ where: { childId, date, type: 'in' } });
    if (!arrival) {
      throw new BadRequestException(
        `${child.firstName} no tiene registrada la llegada de hoy`,
      );
    }
    if (at.getTime() < new Date(arrival.createdAt).getTime()) {
      throw new BadRequestException('La hora de retiro no puede ser anterior a la llegada');
    }
    const already = await this.repo.findOne({ where: { childId, date, type: 'out' } });
    if (already) {
      throw new BadRequestException(`${child.firstName} ya fue retirado hoy`);
    }

    // Un representante desactivado no cuenta como autorizado.
    const link = dto.guardianId
      ? await this.linksRepo.findOne({
          where: { childId, guardianId: dto.guardianId, canPickup: true },
          relations: ['guardian'],
        })
      : null;
    const authorized = link && link.guardian?.active ? link : null;

    let flagged = false;
    let flagReason = '';
    if (!authorized) {
      if (!dto.overrideUnauthorized) {
        throw new ForbiddenException(
          'Quien retira no está en la lista de autorizados. Confirme la excepción para continuar.',
        );
      }
      flagged = true;
      flagReason = dto.personName
        ? `Retiro por persona no autorizada: ${dto.personName}${dto.personDocument ? ` (${dto.personDocument})` : ''}`
        : 'Retiro por persona no autorizada';
    }

    const schedule = await this.schedule.get();
    const evaluation = this.schedule.evaluateChild({ type: 'out', at, schedule });

    const record = this.repo.create({
      childId,
      type: 'out',
      date,
      photoUrl: '',
      mood: (dto.mood as ChildMood) || '',
      temperature: dto.temperature ?? null,
      guardianId: dto.guardianId || null,
      personName: dto.personName || '',
      personRelationship: dto.personRelationship || (authorized?.relationship ?? ''),
      personDocument: dto.personDocument || '',
      notes: dto.notes || '',
      flagged,
      flagReason,
      scheduleStatus: evaluation.status,
      scheduleMinutes: evaluation.minutes,
      recordedById: actor.id || null,
      recordedByName: actor.name || '',
      createdAt: at,
    });
    const saved = await this.saveUnique(record, `${child.firstName} ya fue retirado hoy`);
    if (dto.photo) {
      saved.photoUrl = await this.photos.register({
        photo: dto.photo,
        subject: 'attendance',
        subjectId: saved.id,
        childId,
        classroomId: child.classroomId,
        date,
        caption: 'Retiro',
        // Un retiro dudoso se fotografía como evidencia interna, no como recuerdo:
        // no se comparte con la familia.
        shareWithFamily: !flagged,
        // Es la foto del adulto que retira: no exige el consentimiento de imagen del niño.
        purpose: 'pickup_evidence',
        actorId: actor.id,
        actorName: actor.name,
      });
      if (saved.photoUrl) await this.repo.update(saved.id, { photoUrl: saved.photoUrl });
    }
    return { ...saved, scheduleNote: evaluation.note };
  }

  /** Historial de entradas y salidas de un niño. */
  async history(childId: string, opts: { from?: string; to?: string; limit?: number } = {}) {
    const qb = this.repo
      .createQueryBuilder('a')
      .where('a.childId = :cid', { cid: childId })
      .orderBy('a.createdAt', 'DESC')
      .limit(Math.min(opts.limit || 300, 1000));
    if (opts.from) qb.andWhere('a.date >= :from', { from: opts.from });
    if (opts.to) qb.andWhere('a.date <= :to', { to: opts.to });
    return qb.getMany();
  }

  /** Registros del día de un niño (usado por el reporte diario). */
  dayRecords(childId: string, date: string) {
    return this.repo.find({ where: { childId, date }, order: { createdAt: 'ASC' } });
  }

  /** Recorta un registro a lo que puede ver la familia. */
  toFamilyRecord(r: ChildAttendance): FamilyAttendanceRecord {
    return {
      id: r.id,
      type: r.type,
      date: r.date,
      createdAt: r.createdAt,
      mood: r.mood,
      temperature: r.temperature,
      personName: r.personName,
      personRelationship: r.personRelationship,
      photoUrl: r.flagged ? '' : r.photoUrl,
    };
  }

  /** Registros del día de un niño, versión portal familiar. */
  async familyRecords(childId: string, date: string): Promise<FamilyAttendanceRecord[]> {
    const rows = await this.dayRecords(childId, date);
    return rows.map((r) => this.toFamilyRecord(r));
  }

  /** Historial de un niño, versión portal familiar. */
  async familyHistory(
    childId: string,
    opts: { from?: string; to?: string; limit?: number } = {},
  ): Promise<FamilyAttendanceRecord[]> {
    const rows = await this.history(childId, opts);
    return rows.map((r) => this.toFamilyRecord(r));
  }

  /** Registros señalados pendientes de revisión. */
  async flagged(opts: { from?: string; to?: string; classroomIds?: string[] } = {}) {
    if (opts.classroomIds && !opts.classroomIds.length) return [];
    const qb = this.repo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.child', 'child')
      .where('a.flagged = true')
      .orderBy('a.createdAt', 'DESC')
      .limit(300);
    if (opts.from) qb.andWhere('a.date >= :from', { from: opts.from });
    if (opts.to) qb.andWhere('a.date <= :to', { to: opts.to });
    if (opts.classroomIds) qb.andWhere('child.classroomId IN (:...rids)', { rids: opts.classroomIds });
    return qb.getMany();
  }

  async findOne(id: string): Promise<ChildAttendance> {
    const rec = await this.repo.findOne({ where: { id }, relations: ['child'] });
    if (!rec) throw new NotFoundException('Registro no encontrado');
    return rec;
  }

  async update(id: string, dto: UpdateAttendanceDto) {
    const rec = await this.findOne(id);
    if (dto.mood !== undefined) rec.mood = dto.mood as ChildMood;
    if (dto.temperature !== undefined) rec.temperature = dto.temperature;
    if (dto.personName !== undefined) rec.personName = dto.personName;
    if (dto.personRelationship !== undefined) rec.personRelationship = dto.personRelationship;
    if (dto.personDocument !== undefined) rec.personDocument = dto.personDocument;
    if (dto.notes !== undefined) rec.notes = dto.notes;
    if (dto.clearFlag) {
      rec.flagged = false;
      rec.flagReason = '';
    }
    if (dto.at) {
      const at = new Date(dto.at);
      if (isNaN(at.getTime())) throw new BadRequestException('Fecha inválida');
      await this.assertConsistentMove(rec, at);
      rec.createdAt = at;
      rec.date = dayKey(at);
      const schedule = await this.schedule.get();
      const evaluation = this.schedule.evaluateChild({ type: rec.type, at, schedule });
      rec.scheduleStatus = evaluation.status;
      rec.scheduleMinutes = evaluation.minutes;
    }
    return this.saveUnique(rec, 'Ese día ya tiene un registro de ese tipo');
  }

  /**
   * Al corregir la hora: no puede caer en un día que ya tenga otro registro del mismo
   * tipo, ni dejar un retiro antes de su llegada.
   */
  private async assertConsistentMove(rec: ChildAttendance, at: Date) {
    const newDate = dayKey(at);
    const others = await this.repo.find({
      where: { childId: rec.childId, date: newDate, id: Not(rec.id) },
    });
    if (others.some((o) => o.type === rec.type)) {
      throw new BadRequestException(
        rec.type === 'in' ? 'Ese día ya tiene registrada una llegada' : 'Ese día ya tiene registrado un retiro',
      );
    }
    if (rec.type === 'out') {
      const arrival = others.find((o) => o.type === 'in');
      if (!arrival) throw new BadRequestException('Ese día no tiene registrada la llegada');
      if (at.getTime() < new Date(arrival.createdAt).getTime()) {
        throw new BadRequestException('La hora de retiro no puede ser anterior a la llegada');
      }
    } else {
      const departure = others.find((o) => o.type === 'out');
      if (departure && at.getTime() > new Date(departure.createdAt).getTime()) {
        throw new BadRequestException('La llegada no puede ser posterior al retiro');
      }
      // Mover la llegada a otro día dejaría huérfano el retiro del día original.
      if (newDate !== rec.date) {
        const oldOut = await this.repo.findOne({
          where: { childId: rec.childId, date: rec.date, type: 'out' },
        });
        if (oldOut) {
          throw new BadRequestException('Ese día tiene un retiro: corrija o elimine primero el retiro');
        }
      }
    }
  }

  /** Guarda y traduce el choque con el índice único a un 400. */
  private async saveUnique(rec: ChildAttendance, message: string): Promise<ChildAttendance> {
    try {
      return await this.repo.save(rec);
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException(message);
      throw e;
    }
  }

  async remove(id: string) {
    const rec = await this.findOne(id);
    await this.photos.removeBySubject('attendance', id);
    await this.repo.remove(rec);
    return { ok: true as const };
  }

  /** Recuento de presentes/ausentes para un día. Alimenta el resumen del panel. */
  async dailyTotals(date = dayKey()) {
    const { totals } = await this.board({ date });
    return totals;
  }

  // =====================================================================
  // Personal
  // =====================================================================

  /**
   * Marca la asistencia del propio usuario. El tipo se deduce del último marcaje del día
   * (entrada → almuerzo → vuelta → salida) salvo que se indique explícitamente.
   */
  async markStaff(userId: string, userName: string, dto: StaffMarkDto) {
    const at = new Date();
    const date = dayKey(at);
    const today = await this.staffRepo.find({
      where: { userId, date },
      order: { createdAt: 'ASC' },
    });

    const next = this.allowedStaffTypes(today);
    if (!next.length) {
      throw new BadRequestException('Ya registró la salida de hoy');
    }
    const type = (dto.type as StaffAttendanceType) || next[0];
    if (!next.includes(type)) {
      throw new BadRequestException(this.staffOrderMessage(today, type));
    }

    const schedule = await this.schedule.get();
    const evaluation = this.schedule.evaluateStaff({
      type,
      at,
      schedule,
      isFirstInOfDay: !today.some((t) => t.type === 'in'),
    });

    const photoUrl = dto.photo
      ? await this.photos.register({
          photo: dto.photo,
          subject: 'general',
          date,
          caption: 'Marcaje del personal',
          shareWithFamily: false,
          actorId: userId,
          actorName: userName,
        })
      : '';

    const record = this.staffRepo.create({
      userId,
      type,
      date,
      photoUrl,
      notes: dto.notes || '',
      scheduleStatus: evaluation.status,
      scheduleMinutes: evaluation.minutes,
      createdAt: at,
    });
    const saved = await this.staffRepo.save(record);
    return { ...saved, scheduleNote: evaluation.note };
  }

  /**
   * Marcajes válidos a continuación (orden: entrada → salida a almuerzo → vuelta →
   * salida; el almuerzo es opcional). El primero es el sugerido. Vacío = jornada cerrada.
   */
  private allowedStaffTypes(today: StaffAttendance[]): StaffAttendanceType[] {
    if (today.some((r) => r.type === 'out')) return [];
    const last = today.length ? today[today.length - 1].type : null;
    switch (last) {
      case null:
        return ['in'];
      case 'in':
        return today.some((r) => r.type === 'lunch_out') ? ['out'] : ['lunch_out', 'out'];
      case 'lunch_out':
        return ['lunch_in'];
      case 'lunch_in':
        return ['out'];
      default:
        return [];
    }
  }

  /** Siguiente marcaje lógico, o null si ya se marcó la salida. */
  private nextStaffType(today: StaffAttendance[]): StaffAttendanceType | null {
    return this.allowedStaffTypes(today)[0] ?? null;
  }

  private staffOrderMessage(today: StaffAttendance[], type: StaffAttendanceType): string {
    const label: Record<StaffAttendanceType, string> = {
      in: 'la entrada',
      lunch_out: 'la salida a almuerzo',
      lunch_in: 'la vuelta del almuerzo',
      out: 'la salida',
    };
    if (today.some((r) => r.type === type)) return `Ya registró ${label[type]} hoy`;
    if (!today.length) return 'Primero debe registrar la entrada';
    if (today[today.length - 1].type === 'lunch_out') {
      return 'Primero debe registrar la vuelta del almuerzo';
    }
    return `No puede registrar ${label[type]} ahora`;
  }

  /** Marcajes de hoy del usuario + cuál sería el siguiente. */
  async staffToday(userId: string) {
    const date = dayKey();
    const marks = await this.staffRepo.find({
      where: { userId, date },
      order: { createdAt: 'ASC' },
    });
    return { date, marks, nextType: this.nextStaffType(marks) };
  }

  async staffList(opts: { date?: string; from?: string; to?: string; userId?: string } = {}) {
    const qb = this.staffRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.user', 'user')
      .orderBy('s.createdAt', 'DESC')
      .limit(1000);
    if (opts.date) qb.andWhere('s.date = :d', { d: opts.date });
    if (opts.from) qb.andWhere('s.date >= :from', { from: opts.from });
    if (opts.to) qb.andWhere('s.date <= :to', { to: opts.to });
    if (opts.userId) qb.andWhere('s.userId = :uid', { uid: opts.userId });
    return qb.getMany();
  }

  /** Alta manual de un marcaje del personal (corrección de la dirección). */
  async createManualStaffMark(dto: ManualStaffMarkDto) {
    const at = new Date(dto.at);
    if (isNaN(at.getTime())) throw new BadRequestException('Fecha inválida');
    const date = dayKey(at);
    const schedule = await this.schedule.get();
    const type = (dto.type as StaffAttendanceType) || 'in';
    const sameDay = await this.staffRepo.find({ where: { userId: dto.userId, date } });
    const evaluation = this.schedule.evaluateStaff({
      type,
      at,
      schedule,
      isFirstInOfDay: !sameDay.some((t) => t.type === 'in'),
    });
    const record = this.staffRepo.create({
      userId: dto.userId,
      type,
      date,
      notes: dto.notes || '',
      manual: true,
      scheduleStatus: evaluation.status,
      scheduleMinutes: evaluation.minutes,
      createdAt: at,
    });
    return this.staffRepo.save(record);
  }

  async removeStaffMark(id: string) {
    const rec = await this.staffRepo.findOne({ where: { id } });
    if (!rec) throw new NotFoundException('Marcaje no encontrado');
    await this.staffRepo.remove(rec);
    return { ok: true as const };
  }

  // =====================================================================
  // Internos
  // =====================================================================

  private async mustFindChild(childId: string): Promise<Child> {
    const child = await this.childrenRepo.findOne({ where: { id: childId } });
    if (!child) throw new NotFoundException('Niño no encontrado');
    if (!child.active) throw new BadRequestException('Ese niño está dado de baja');
    return child;
  }

  /**
   * Hora del registro. Sólo dirección y coordinación pueden fijar una distinta de la
   * actual: si cualquier educadora pudiera retro-fechar, el control de llegadas tardías
   * dejaría de significar nada.
   */
  private resolveTime(at: string | undefined, actor: Actor): Date {
    if (!at) return new Date();
    if (actor.role !== 'admin' && actor.role !== 'coordinator') {
      throw new ForbiddenException('Sólo dirección o coordinación pueden fijar la hora');
    }
    const d = new Date(at);
    if (isNaN(d.getTime())) throw new BadRequestException('Fecha inválida');
    return d;
  }

  /** Registros de un rango, para exportaciones e informes. */
  rangeRecords(from: string, to: string, childIds?: string[]) {
    const where: any = { createdAt: Between(startOfDay(from), endOfDay(to)) };
    if (childIds?.length) where.childId = In(childIds);
    return this.repo.find({ where, order: { createdAt: 'ASC' } });
  }
}
