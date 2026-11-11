import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DailyLog, DailyLogKind } from './daily-log.entity';
import { Child } from '../children/child.entity';
import { PhotosService } from '../photos/photos.service';
import { dayKey, normalizeDay } from '../common/day.util';
import {
  BulkDailyLogDto,
  CreateDailyLogDto,
  UpdateDailyLogDto,
} from './dto/daily-log.dto';

export interface Actor {
  id?: string;
  name?: string;
}

/** Campos del niño que viajan en los listados (nunca la ficha completa). */
const CHILD_PUBLIC_FIELDS = ['child.id', 'child.firstName', 'child.lastName', 'child.classroomId', 'child.photoUrl'];

export const LOG_KIND_LABEL: Record<DailyLogKind, string> = {
  nap: 'Siesta',
  hygiene: 'Higiene',
  health: 'Salud',
  incident: 'Incidente',
  mood: 'Estado de ánimo',
  note: 'Observación',
};

@Injectable()
export class DailyLogsService {
  constructor(
    @InjectRepository(DailyLog) private readonly repo: Repository<DailyLog>,
    @InjectRepository(Child) private readonly childrenRepo: Repository<Child>,
    private readonly photos: PhotosService,
  ) {}

  async list(opts: {
    date?: string;
    from?: string;
    to?: string;
    childId?: string;
    classroomId?: string;
    /** Alcance de la educadora ([] = nada). */
    classroomIds?: string[];
    kind?: string;
    pendingNotice?: boolean;
  } = {}) {
    if (opts.classroomIds && !opts.classroomIds.length) return [];
    const qb = this.repo
      .createQueryBuilder('l')
      .leftJoin('l.child', 'child')
      .addSelect(CHILD_PUBLIC_FIELDS)
      .orderBy('l.occurredAt', 'DESC')
      .limit(1000);
    if (opts.date) qb.andWhere('l.date = :d', { d: opts.date });
    if (opts.from) qb.andWhere('l.date >= :from', { from: opts.from });
    if (opts.to) qb.andWhere('l.date <= :to', { to: opts.to });
    if (opts.childId) qb.andWhere('l.childId = :cid', { cid: opts.childId });
    if (opts.kind) qb.andWhere('l.kind = :k', { k: opts.kind });
    if (opts.classroomId) qb.andWhere('child.classroomId = :rid', { rid: opts.classroomId });
    if (opts.classroomIds) qb.andWhere('child.classroomId IN (:...rids)', { rids: opts.classroomIds });
    // Avisos urgentes que aún no se han comunicado a la familia.
    if (opts.pendingNotice) {
      qb.andWhere('l.notifyGuardian = true').andWhere('l.guardianNotified = false');
    }
    return qb.getMany();
  }

  /** Bitácora del día de un niño, en orden cronológico (línea de tiempo). */
  dayLogs(childId: string, date: string) {
    return this.repo.find({ where: { childId, date }, order: { occurredAt: 'ASC' } });
  }

  async create(dto: CreateDailyLogDto, actor: Actor) {
    const child = await this.mustFindChild(dto.childId);
    // Consentimiento de imagen (LOPDP): antes de guardar la anotación.
    if (dto.photo) await this.photos.assertCanPhotograph(dto.childId);
    const occurredAt = this.parseDate(dto.occurredAt) || new Date();
    const endedAt = this.parseDate(dto.endedAt);
    const date = dto.date ? normalizeDay(dto.date) : dayKey(occurredAt);

    const log = this.repo.create({
      childId: dto.childId,
      kind: dto.kind as DailyLogKind,
      date,
      detail: dto.detail || '',
      occurredAt,
      endedAt,
      durationMinutes: this.durationOf(occurredAt, endedAt),
      notes: dto.notes || '',
      temperature: dto.temperature ?? null,
      photoUrl: '',
      notifyGuardian: dto.notifyGuardian ?? dto.kind === 'incident',
      recordedById: actor.id || null,
      recordedByName: actor.name || '',
    });
    const saved = await this.repo.save(log);
    // La foto se indexa con el id de la anotación, para borrarla con ella.
    if (dto.photo) {
      const url = await this.photos.register({
        photo: dto.photo,
        subject: 'child',
        subjectId: saved.id,
        childId: dto.childId,
        classroomId: child.classroomId,
        date,
        caption: LOG_KIND_LABEL[dto.kind as DailyLogKind] || '',
        // Un incidente se documenta para la guardería; la familia se entera por el
        // aviso, no viendo la foto del golpe en la galería.
        shareWithFamily: dto.kind !== 'incident',
        actorId: actor.id,
        actorName: actor.name,
      });
      if (url) {
        saved.photoUrl = url;
        await this.repo.update(saved.id, { photoUrl: url });
      }
    }
    return saved;
  }

  /** Misma anotación para varios niños (la siesta de toda la sala, por ejemplo). */
  async createBulk(dto: BulkDailyLogDto, actor: Actor) {
    const occurredAt = this.parseDate(dto.occurredAt) || new Date();
    const endedAt = this.parseDate(dto.endedAt);
    const date = dto.date ? normalizeDay(dto.date) : dayKey(occurredAt);
    const children = await this.childrenRepo.find({ where: { id: In(dto.childIds) } });

    const logs = children.map((child) =>
      this.repo.create({
        childId: child.id,
        kind: dto.kind as DailyLogKind,
        date,
        detail: dto.detail || '',
        occurredAt,
        endedAt,
        durationMinutes: this.durationOf(occurredAt, endedAt),
        notes: dto.notes || '',
        notifyGuardian: dto.notifyGuardian ?? dto.kind === 'incident',
        recordedById: actor.id || null,
        recordedByName: actor.name || '',
      }),
    );
    await this.repo.save(logs);
    return { saved: logs.length, date, kind: dto.kind };
  }

  async findOne(id: string): Promise<DailyLog> {
    const log = await this.repo.findOne({ where: { id }, relations: ['child'] });
    if (!log) throw new NotFoundException('Anotación no encontrada');
    return log;
  }

  async update(id: string, dto: UpdateDailyLogDto, actor: Actor) {
    const log = await this.findOne(id);
    if (dto.detail !== undefined) log.detail = dto.detail;
    if (dto.notes !== undefined) log.notes = dto.notes;
    if (dto.temperature !== undefined) log.temperature = dto.temperature;
    if (dto.notifyGuardian !== undefined) log.notifyGuardian = dto.notifyGuardian;
    if (dto.guardianNotified !== undefined) log.guardianNotified = dto.guardianNotified;
    if (dto.occurredAt !== undefined) {
      const d = this.parseDate(dto.occurredAt);
      if (!d) throw new BadRequestException('Fecha inválida');
      log.occurredAt = d;
      log.date = dayKey(d);
    }
    if (dto.endedAt !== undefined) log.endedAt = this.parseDate(dto.endedAt);
    log.durationMinutes = this.durationOf(log.occurredAt, log.endedAt);
    if (dto.photo) {
      log.photoUrl = await this.photos.register({
        photo: dto.photo,
        subject: 'child',
        subjectId: log.id,
        childId: log.childId,
        classroomId: log.child?.classroomId ?? null,
        date: log.date,
        caption: LOG_KIND_LABEL[log.kind] || '',
        // Igual que al crear: la foto de un incidente no se comparte.
        shareWithFamily: log.kind !== 'incident',
        actorId: actor.id,
        actorName: actor.name,
      });
    }
    return this.repo.save(log);
  }

  async remove(id: string) {
    const log = await this.findOne(id);
    await this.photos.removeBySubject('child', id);
    await this.repo.remove(log);
    return { ok: true as const };
  }

  /** Marca el aviso como ya comunicado a la familia. */
  async markNotified(id: string) {
    const log = await this.findOne(id);
    log.guardianNotified = true;
    return this.repo.save(log);
  }

  /** Cuántos avisos urgentes quedan sin comunicar (badge del panel). */
  pendingNoticesCount() {
    return this.repo.count({ where: { notifyGuardian: true, guardianNotified: false } });
  }

  private durationOf(from: Date, to: Date | null): number {
    if (!to) return 0;
    return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
  }

  private parseDate(value?: string | null): Date | null {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  private async mustFindChild(childId: string): Promise<Child> {
    const child = await this.childrenRepo.findOne({ where: { id: childId } });
    if (!child) throw new NotFoundException('Niño no encontrado');
    return child;
  }
}
