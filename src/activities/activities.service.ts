import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Activity,
  ActivityCategory,
  ActivityStatus,
} from './activity.entity';
import { ActivityParticipant, Participation } from './activity-participant.entity';
import { Child } from '../children/child.entity';
import { PhotosService } from '../photos/photos.service';
import { dayKey, normalizeDay } from '../common/day.util';
import {
  CreateActivityDto,
  ParticipantInputDto,
  SetParticipantsDto,
  UpdateActivityDto,
} from './dto/activity.dto';

export interface Actor {
  id?: string;
  name?: string;
}

export const CATEGORY_LABEL: Record<ActivityCategory, string> = {
  motor: 'Motricidad',
  arte: 'Arte y manualidades',
  musica: 'Música',
  lectura: 'Cuentos y lectura',
  juego: 'Juego libre',
  aprendizaje: 'Aprendizaje',
  exterior: 'Aire libre',
  sensorial: 'Estimulación sensorial',
  higiene: 'Hábitos e higiene',
  otro: 'Otra actividad',
};

export const PARTICIPATION_LABEL: Record<Participation, string> = {
  excellent: 'Participó con entusiasmo',
  good: 'Participó bien',
  regular: 'Participó a ratos',
  low: 'Le costó participar',
  absent: 'No participó',
};

@Injectable()
export class ActivitiesService {
  constructor(
    @InjectRepository(Activity) private readonly repo: Repository<Activity>,
    @InjectRepository(ActivityParticipant)
    private readonly participantsRepo: Repository<ActivityParticipant>,
    @InjectRepository(Child) private readonly childrenRepo: Repository<Child>,
    private readonly photos: PhotosService,
  ) {}

  async list(opts: {
    date?: string;
    from?: string;
    to?: string;
    classroomId?: string;
    /** Alcance de la educadora ([] = nada salvo, si se pide, las del centro). */
    classroomIds?: string[];
    /** Con `classroomIds`: incluir también las actividades de todo el centro (sala nula). */
    includeCenterWide?: boolean;
    category?: string;
    childId?: string;
    /** Sólo las compartidas con las familias (portal familiar). */
    sharedOnly?: boolean;
  } = {}) {
    if (opts.classroomIds && !opts.classroomIds.length && !opts.includeCenterWide) return [];
    const qb = this.repo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.classroom', 'room')
      .orderBy('a.date', 'DESC')
      .addOrderBy('a.createdAt', 'DESC')
      .limit(500);
    if (opts.date) qb.andWhere('a.date = :d', { d: opts.date });
    if (opts.from) qb.andWhere('a.date >= :from', { from: opts.from });
    if (opts.to) qb.andWhere('a.date <= :to', { to: opts.to });
    if (opts.classroomId) qb.andWhere('a.classroomId = :rid', { rid: opts.classroomId });
    if (opts.classroomIds) {
      if (!opts.classroomIds.length) qb.andWhere('a.classroomId IS NULL');
      else if (opts.includeCenterWide) {
        qb.andWhere('(a.classroomId IN (:...rids) OR a.classroomId IS NULL)', { rids: opts.classroomIds });
      } else qb.andWhere('a.classroomId IN (:...rids)', { rids: opts.classroomIds });
    }
    if (opts.sharedOnly) qb.andWhere('a.shareWithFamilies = true');
    if (opts.category) qb.andWhere('a.category = :c', { c: opts.category });
    if (opts.childId) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM activity_participants p WHERE p."activityId" = a.id AND p."childId" = :cid)',
        { cid: opts.childId },
      );
    }

    const rows = await qb.getMany();
    if (!rows.length) return [];

    // El recuento de participantes va en una sola consulta agrupada: la lista de
    // actividades del mes puede tener cientos de filas y un N+1 aquí se nota.
    const counts = await this.participantsRepo
      .createQueryBuilder('p')
      .select('p.activityId', 'activityId')
      .addSelect('COUNT(*)', 'total')
      .where('p.activityId IN (:...ids)', { ids: rows.map((r) => r.id) })
      .groupBy('p.activityId')
      .getRawMany<{ activityId: string; total: string }>();
    const byActivity = new Map(counts.map((c) => [c.activityId, Number(c.total)]));

    return rows.map((a) => ({
      ...a,
      categoryLabel: CATEGORY_LABEL[a.category] || '',
      participantCount: byActivity.get(a.id) || 0,
    }));
  }

  async findOne(id: string) {
    const activity = await this.repo.findOne({ where: { id }, relations: ['classroom'] });
    if (!activity) throw new NotFoundException('Actividad no encontrada');
    const participants = await this.participantsRepo.find({
      where: { activityId: id },
      relations: ['child'],
    });
    const photos = await this.photos.list({ activityId: id });
    return {
      ...activity,
      categoryLabel: CATEGORY_LABEL[activity.category] || '',
      photos,
      participants: participants.map((p) => ({
        id: p.id,
        childId: p.childId,
        name: p.child ? `${p.child.firstName} ${p.child.lastName}`.trim() : '',
        photoUrl: p.child?.photoUrl || '',
        participation: p.participation,
        participationLabel: PARTICIPATION_LABEL[p.participation] || '',
        note: p.note,
      })),
    };
  }

  /** Actividades del día en las que participó un niño (para su reporte). */
  async dayActivitiesForChild(childId: string, date: string) {
    // Filtrado por fecha en SQL: no cargar todo el historial del niño.
    const rows = await this.participantsRepo
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.activity', 'a')
      .where('p.childId = :cid', { cid: childId })
      .andWhere('a.date = :d', { d: date })
      .getMany();
    return rows
      .map((p) => ({
        activity: p.activity,
        participation: p.participation,
        note: p.note,
      }))
      .sort(
        (a, b) =>
          new Date(a.activity.startedAt || a.activity.createdAt).getTime() -
          new Date(b.activity.startedAt || b.activity.createdAt).getTime(),
      );
  }

  async create(dto: CreateActivityDto, actor: Actor) {
    const startedAt = this.parseDate(dto.startedAt) || new Date();
    const endedAt = this.parseDate(dto.endedAt);
    const date = dto.date ? normalizeDay(dto.date) : dayKey(startedAt);

    const activity = this.repo.create({
      title: dto.title,
      description: dto.description || '',
      category: (dto.category as ActivityCategory) || 'otro',
      classroomId: dto.classroomId || null,
      date,
      startedAt,
      endedAt,
      durationMinutes: this.durationOf(startedAt, endedAt),
      status: endedAt ? 'completed' : 'in_progress',
      summary: dto.summary || '',
      shareWithFamilies: dto.shareWithFamilies ?? true,
      createdById: actor.id || null,
      createdByName: actor.name || '',
    });
    const saved = await this.repo.save(activity);

    if (dto.coverPhoto) {
      saved.coverPhotoUrl = await this.photos.register({
        photo: dto.coverPhoto,
        subject: 'activity',
        subjectId: saved.id,
        activityId: saved.id,
        classroomId: saved.classroomId,
        date,
        caption: saved.title,
        shareWithFamily: saved.shareWithFamilies,
        actorId: actor.id,
        actorName: actor.name,
      });
      await this.repo.save(saved);
    }
    for (const photo of dto.photos || []) {
      await this.photos.register({
        photo,
        subject: 'activity',
        subjectId: saved.id,
        activityId: saved.id,
        classroomId: saved.classroomId,
        date,
        caption: saved.title,
        shareWithFamily: saved.shareWithFamilies,
        actorId: actor.id,
        actorName: actor.name,
      });
    }

    // Sin lista explícita, participa toda la sala: es el caso normal y evita que la
    // educadora tenga que marcar 20 casillas para registrar la actividad de la mañana.
    const participants =
      dto.participants ?? (await this.defaultParticipants(saved.classroomId));
    await this.replaceParticipants(saved.id, participants);

    return this.findOne(saved.id);
  }

  /** Actividad sin relaciones (para comprobar alcance antes de tocarla). */
  async findBasic(id: string): Promise<Activity> {
    const activity = await this.repo.findOne({ where: { id } });
    if (!activity) throw new NotFoundException('Actividad no encontrada');
    return activity;
  }

  async update(id: string, dto: UpdateActivityDto, actor: Actor) {
    const activity = await this.findBasic(id);
    const prev = {
      share: activity.shareWithFamilies,
      date: activity.date,
      classroomId: activity.classroomId,
    };

    if (dto.title !== undefined) activity.title = dto.title;
    if (dto.description !== undefined) activity.description = dto.description;
    if (dto.category !== undefined) activity.category = dto.category as ActivityCategory;
    if (dto.classroomId !== undefined) activity.classroomId = dto.classroomId || null;
    if (dto.summary !== undefined) activity.summary = dto.summary;
    if (dto.shareWithFamilies !== undefined) activity.shareWithFamilies = dto.shareWithFamilies;
    if (dto.status !== undefined) activity.status = dto.status as ActivityStatus;
    if (dto.date !== undefined) activity.date = normalizeDay(dto.date);
    if (dto.startedAt !== undefined) {
      const d = this.parseDate(dto.startedAt);
      if (!d) throw new BadRequestException('Fecha de inicio inválida');
      activity.startedAt = d;
    }
    if (dto.endedAt !== undefined) {
      activity.endedAt = this.parseDate(dto.endedAt);
      if (activity.endedAt) activity.status = 'completed';
    }
    activity.durationMinutes = this.durationOf(activity.startedAt, activity.endedAt);

    if (dto.coverPhoto) {
      activity.coverPhotoUrl = await this.photos.register({
        photo: dto.coverPhoto,
        subject: 'activity',
        subjectId: activity.id,
        activityId: activity.id,
        classroomId: activity.classroomId,
        date: activity.date,
        caption: activity.title,
        shareWithFamily: activity.shareWithFamilies,
        actorId: actor.id,
        actorName: actor.name,
      });
    }
    for (const photo of dto.photos || []) {
      await this.photos.register({
        photo,
        subject: 'activity',
        subjectId: activity.id,
        activityId: activity.id,
        classroomId: activity.classroomId,
        date: activity.date,
        caption: activity.title,
        shareWithFamily: activity.shareWithFamilies,
        actorId: actor.id,
        actorName: actor.name,
      });
    }

    await this.repo.save(activity);
    // Las fotos ya subidas siguen a la actividad: visibilidad, día y sala.
    await this.photos.syncActivity(id, {
      shareWithFamily: activity.shareWithFamilies !== prev.share ? activity.shareWithFamilies : undefined,
      date: activity.date !== prev.date ? activity.date : undefined,
      classroomId: activity.classroomId !== prev.classroomId ? activity.classroomId : undefined,
    });
    if (dto.participants) await this.replaceParticipants(id, dto.participants);
    return this.findOne(id);
  }

  /** Cierra la actividad: fija la hora de fin y su duración. */
  async complete(id: string, summary?: string) {
    const activity = await this.findBasic(id);
    activity.endedAt = new Date();
    activity.durationMinutes = this.durationOf(activity.startedAt, activity.endedAt);
    activity.status = 'completed';
    if (summary !== undefined) activity.summary = summary;
    await this.repo.save(activity);
    return this.findOne(id);
  }

  async setParticipants(id: string, dto: SetParticipantsDto) {
    await this.replaceParticipants(id, dto.participants);
    return this.findOne(id);
  }

  async remove(id: string) {
    const activity = await this.repo.findOne({ where: { id } });
    if (!activity) throw new NotFoundException('Actividad no encontrada');
    await this.photos.removeBySubject('activity', id);
    await this.repo.remove(activity);
    return { ok: true as const };
  }

  // ------------------------------------------------------------- internos

  /**
   * Sustituye la lista de participantes. Se borra y se reinserta en lugar de hacer un
   * diff: la lista es pequeña (una sala) y así no quedan filas huérfanas de niños que
   * salieron de la actividad.
   */
  private async replaceParticipants(activityId: string, input: ParticipantInputDto[]) {
    // Un niño repetido en la lista rompería el índice único: gana la última entrada.
    const unique = [...new Map(input.map((p) => [p.childId, p])).values()];
    const ids = unique.map((p) => p.childId);
    const valid = new Set(
      ids.length
        ? (await this.childrenRepo.find({ where: { id: In(ids) }, select: ['id'] })).map((c) => c.id)
        : [],
    );
    const rows = unique
      .filter((p) => valid.has(p.childId))
      .map((p) => ({
        activityId,
        childId: p.childId,
        participation: (p.participation as Participation) || 'good',
        note: p.note || '',
      }));
    // Borrar e insertar en una transacción: si falla, no se pierde la lista anterior.
    await this.participantsRepo.manager.transaction(async (em) => {
      await em.delete(ActivityParticipant, { activityId });
      if (rows.length) await em.insert(ActivityParticipant, rows);
    });
  }

  /**
   * Participantes por defecto: los niños activos de la sala. Una actividad de todo el
   * centro (sin sala) no inscribe a nadie automáticamente: hay que elegirlos, para no
   * meterla en el reporte de cada familia del centro.
   */
  private async defaultParticipants(classroomId: string | null): Promise<ParticipantInputDto[]> {
    if (!classroomId) return [];
    const children = await this.childrenRepo.find({
      where: { classroomId, active: true },
      select: ['id'],
    });
    return children.map((c) => ({ childId: c.id, participation: 'good' }));
  }

  private durationOf(from: Date | null, to: Date | null): number {
    if (!from || !to) return 0;
    return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
  }

  private parseDate(value?: string | null): Date | null {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
}
