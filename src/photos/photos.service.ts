import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository, SelectQueryBuilder } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { Photo, PhotoSubject } from './photo.entity';
import { PhotoChild } from './photo-child.entity';
import { Child } from '../children/child.entity';
import { Activity } from '../activities/activity.entity';
import { UploadsService } from '../uploads/uploads.service';
import { dayKey, normalizeDay } from '../common/day.util';
import { ConsentsService } from '../consents/consents.service';
import { RealtimeService } from '../realtime/realtime.service';

export interface RegisterPhotoInput {
  /** Data URL base64 (se guarda en /uploads) o URL ya guardada. */
  photo?: string | null;
  url?: string | null;
  subject: PhotoSubject;
  subjectId?: string | null;
  childId?: string | null;
  classroomId?: string | null;
  activityId?: string | null;
  date?: string;
  caption?: string;
  shareWithFamily?: boolean;
  actorId?: string | null;
  actorName?: string;
  /**
   * `pickup_evidence`: foto del adulto que retira (seguridad). No exige consentimiento de
   * imagen del niño, pero sin él queda sólo como evidencia interna (no se comparte).
   */
  purpose?: 'pickup_evidence';
}

/** Foto subida desde la galería / actividad / "momento del día", con varios niños. */
export interface CreateTaggedInput {
  photos: string[];
  childIds: string[];
  subject: PhotoSubject;
  classroomId?: string | null;
  activityId?: string | null;
  date?: string;
  caption?: string;
  takenAt?: Date | null;
  shareWithFamily?: boolean;
  actorId?: string | null;
  actorName?: string;
}

/** Foto tal como la ve una familia: sin quién la subió ni nombres de otros niños. */
export interface FamilyPhotoView {
  id: string;
  url: string;
  caption: string;
  date: string;
  takenAt: Date;
  createdAt: Date;
  subject: PhotoSubject;
  activityId: string | null;
  activityTitle: string;
  /** Niños de ESTA familia que salen en la foto. */
  childIds: string[];
  /** Cuántos compañeros más salen (sin nombres). */
  othersCount: number;
  /** Foto de la sala sin niños etiquetados. */
  group: boolean;
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class PhotosService implements OnApplicationBootstrap {
  private readonly log = new Logger('PhotosService');

  constructor(
    @InjectRepository(Photo) private readonly repo: Repository<Photo>,
    @InjectRepository(PhotoChild) private readonly tagsRepo: Repository<PhotoChild>,
    @InjectRepository(Child) private readonly childrenRepo: Repository<Child>,
    @InjectRepository(Activity) private readonly activitiesRepo: Repository<Activity>,
    private readonly uploads: UploadsService,
    private readonly consents: ConsentsService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * El evento automático de la fila `photos` sólo lleva el primer niño: se avisa también
   * a las familias de los demás etiquetados para que su galería se actualice en vivo.
   */
  private notifyTags(photo: Photo, childIds: string[]) {
    for (const childId of new Set(childIds)) {
      this.realtime.emit({
        entity: 'photo',
        action: 'updated',
        id: photo.id,
        childId,
        classroomId: photo.classroomId,
        date: photo.date,
        familyVisible: photo.shareWithFamily,
      });
    }
  }

  /**
   * Al añadirse la columna `takenAt`, las filas antiguas reciben la hora de la migración:
   * se corrige con su `createdAt` (idempotente: tras la primera vez no toca nada).
   */
  async onApplicationBootstrap() {
    try {
      await this.repo.query(
        `UPDATE photos SET "takenAt" = "createdAt" WHERE "takenAt" > "createdAt" + interval '5 minutes'`,
      );
    } catch (e: any) {
      this.log.warn(`No se pudo ajustar takenAt: ${e?.message || e}`);
    }
  }

  /**
   * 403 si el niño no tiene autorización de imagen vigente (LOPDP).
   * Los servicios que guardan su registro ANTES de la foto deben llamarlo antes de guardar.
   */
  assertCanPhotograph(childId: string | null | undefined): Promise<void> {
    if (!childId) return Promise.resolve();
    return this.consents.assertImageConsent(childId);
  }

  /**
   * 403 con la lista de niños sin autorización de imagen, para que la educadora
   * los quite de la foto. `blocked` va en el cuerpo de la respuesta.
   */
  async assertCanPhotographAll(childIds: string[]): Promise<void> {
    const ids = [...new Set(childIds.filter(Boolean))];
    if (!ids.length) return;
    const statuses = await this.consents.statusForChildren(ids);
    const blockedIds = ids.filter((id) => statuses.get(id)?.images.status !== 'granted');
    if (!blockedIds.length) return;
    const kids = await this.childrenRepo.find({
      where: { id: In(blockedIds) },
      select: ['id', 'firstName', 'lastName'],
    });
    const blocked = blockedIds.map((id) => {
      const k = kids.find((c) => c.id === id);
      return { id, name: k ? `${k.firstName} ${k.lastName}`.trim() : 'Niño' };
    });
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      message: `Sin consentimiento de imagen de ${blocked.map((b) => b.name).join(', ')}`,
      blocked,
    });
  }

  /**
   * Guarda la imagen (si viene en base64) y la indexa en la galería.
   * Devuelve la URL para que el llamador la guarde también en su propia entidad.
   *
   * Lanza 403 si la foto es de un niño sin consentimiento de imagen (ver `assertCanPhotograph`).
   * Nunca lanza por un fallo de indexado: si la foto se guardó en disco, perder la fila
   * de galería no debe tumbar el registro de una entrada o una comida.
   */
  async register(input: RegisterPhotoInput): Promise<string> {
    // Foto de un niño concreto: exige su consentimiento de imagen, salvo la evidencia de retiro.
    let shareWithFamily = input.shareWithFamily ?? true;
    if (input.childId && (input.photo || input.url)) {
      if (input.purpose === 'pickup_evidence') {
        if (!(await this.consents.canUseImage(input.childId))) shareWithFamily = false;
      } else {
        await this.consents.assertImageConsent(input.childId);
      }
    }
    const url = input.photo
      ? this.uploads.saveDataUrl(input.photo, input.subject)
      : input.url || '';
    if (!url) return '';
    try {
      const res = await this.repo.insert({
        url,
        subject: input.subject,
        subjectId: input.subjectId || null,
        childId: input.childId || null,
        classroomId: input.classroomId || null,
        activityId: input.activityId || null,
        date: normalizeDay(input.date),
        caption: input.caption || '',
        shareWithFamily,
        uploadedById: input.actorId || null,
        uploadedByName: input.actorName || '',
      });
      const id = res.identifiers?.[0]?.id;
      if (id && input.childId) {
        await this.tagsRepo.insert({ photoId: id, childId: input.childId }).catch(() => undefined);
      }
    } catch {
      // La imagen ya está en disco y referenciada por su entidad: seguimos.
    }
    return url;
  }

  /**
   * Fotos con varios niños etiquetados (galería, actividad, momento del día).
   * Exige consentimiento de imagen de TODOS los etiquetados antes de guardar nada.
   */
  async createTagged(input: CreateTaggedInput) {
    const childIds = [...new Set(input.childIds.filter(Boolean))];
    await this.assertCanPhotographAll(childIds);

    let classroomId = input.classroomId || null;
    let shareWithFamily = input.shareWithFamily;
    let date = input.date ? normalizeDay(input.date) : '';
    if (input.activityId) {
      const activity = await this.activitiesRepo.findOne({ where: { id: input.activityId } });
      if (!activity) throw new NotFoundException('Actividad no encontrada');
      classroomId = classroomId || activity.classroomId;
      shareWithFamily = shareWithFamily ?? activity.shareWithFamilies;
      date = date || activity.date;
    }
    if (!classroomId && childIds.length) {
      const first = await this.childrenRepo.findOne({ where: { id: childIds[0] }, select: ['id', 'classroomId'] });
      classroomId = first?.classroomId || null;
    }
    const takenAt = input.takenAt && input.takenAt.getTime() < Date.now() ? input.takenAt : new Date();
    date = date || dayKey(takenAt);

    // Primero se validan y guardan todas en disco: si una imagen es inválida no queda nada a medias.
    const urls: string[] = [];
    try {
      for (const p of input.photos) urls.push(this.uploads.saveDataUrl(p, input.subject));
    } catch (e) {
      urls.forEach((u) => this.deleteFile(u));
      throw e;
    }

    const saved: Photo[] = [];
    for (const url of urls) {
      const photo = await this.repo.save(
        this.repo.create({
          url,
          subject: input.subject,
          subjectId: input.activityId || null,
          childId: childIds[0] || null,
          classroomId,
          activityId: input.activityId || null,
          date,
          caption: (input.caption || '').slice(0, 500),
          takenAt,
          shareWithFamily: shareWithFamily ?? true,
          uploadedById: input.actorId || null,
          uploadedByName: input.actorName || '',
        }),
      );
      if (childIds.length) {
        await this.tagsRepo.insert(childIds.map((childId) => ({ photoId: photo.id, childId })));
        this.notifyTags(photo, childIds.slice(1));
      }
      saved.push(photo);
    }
    return this.decorate(saved);
  }

  /** Condición "el niño sale en la foto" (etiqueta o `childId` heredado). */
  private whereTagged(qb: SelectQueryBuilder<Photo>, param: string, ids: string[] | string) {
    const many = Array.isArray(ids);
    const op = many ? `IN (:...${param})` : `= :${param}`;
    qb.andWhere(
      new Brackets((w) => {
        w.where(`p.childId ${op}`, { [param]: ids }).orWhere(
          `EXISTS (SELECT 1 FROM photo_children pc WHERE pc."photoId" = p.id AND pc."childId" ${op})`,
          { [param]: ids },
        );
      }),
    );
  }

  /** Foto grupal: sin niño heredado ni etiquetas. */
  private whereGroup(qb: SelectQueryBuilder<Photo>) {
    qb.andWhere('p.childId IS NULL').andWhere(
      'NOT EXISTS (SELECT 1 FROM photo_children pc WHERE pc."photoId" = p.id)',
    );
  }

  /** Etiquetas de varias fotos: photoId → childIds. */
  private async tagsFor(photos: Photo[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (!photos.length) return map;
    const rows = await this.tagsRepo.find({
      where: { photoId: In(photos.map((p) => p.id)) },
      order: { createdAt: 'ASC' },
    });
    for (const r of rows) map.set(r.photoId, [...(map.get(r.photoId) || []), r.childId]);
    // Filas antiguas con childId y sin etiqueta.
    for (const p of photos) if (!map.has(p.id) && p.childId) map.set(p.id, [p.childId]);
    return map;
  }

  private async activityTitles(photos: Photo[]): Promise<Map<string, string>> {
    const ids = [...new Set(photos.map((p) => p.activityId).filter(Boolean))] as string[];
    if (!ids.length) return new Map();
    const rows = await this.activitiesRepo.find({ where: { id: In(ids) }, select: ['id', 'title'] });
    return new Map(rows.map((a) => [a.id, a.title]));
  }

  /** Vista del personal: añade etiquetas con nombre y título de la actividad. */
  async decorate(photos: Photo[]) {
    const [tags, titles] = await Promise.all([this.tagsFor(photos), this.activityTitles(photos)]);
    const allIds = [...new Set([...tags.values()].flat())];
    const kids = allIds.length
      ? await this.childrenRepo.find({ where: { id: In(allIds) }, select: ['id', 'firstName', 'lastName', 'photoUrl'] })
      : [];
    const byId = new Map(kids.map((k) => [k.id, k]));
    return photos.map((p) => {
      const childIds = tags.get(p.id) || [];
      return {
        ...p,
        tags: undefined,
        childIds,
        children: childIds.map((id) => {
          const k = byId.get(id);
          return { id, name: k ? `${k.firstName} ${k.lastName}`.trim() : '', photoUrl: k?.photoUrl || '' };
        }),
        activityTitle: p.activityId ? titles.get(p.activityId) || '' : '',
      };
    });
  }

  /** Vista de familia: sólo sus niños; de los demás, cuántos son. */
  private async familyView(photos: Photo[], myChildIds: string[]): Promise<FamilyPhotoView[]> {
    const [tags, titles] = await Promise.all([this.tagsFor(photos), this.activityTitles(photos)]);
    const mine = new Set(myChildIds);
    return photos.map((p) => {
      const ids = tags.get(p.id) || [];
      const own = ids.filter((id) => mine.has(id));
      return {
        id: p.id,
        url: p.url,
        caption: p.caption,
        date: p.date,
        takenAt: p.takenAt || p.createdAt,
        createdAt: p.createdAt,
        subject: p.subject,
        activityId: p.activityId,
        activityTitle: p.activityId ? titles.get(p.activityId) || '' : '',
        childIds: own,
        othersCount: ids.length - own.length,
        group: ids.length === 0,
      };
    });
  }

  /** Galería filtrable (personal). `onlyShared` la restringe a lo que puede ver una familia. */
  async list(opts: {
    date?: string;
    from?: string;
    to?: string;
    childId?: string;
    childIds?: string[];
    classroomId?: string;
    /** Alcance de la educadora: sólo fotos de estas salas ([] = nada). */
    classroomIds?: string[];
    activityId?: string;
    subject?: PhotoSubject;
    onlyShared?: boolean;
    limit?: number;
  }) {
    if (opts.classroomIds && !opts.classroomIds.length) return [];
    const qb = this.repo
      .createQueryBuilder('p')
      .orderBy('p.date', 'DESC')
      .addOrderBy('p.takenAt', 'DESC');
    if (opts.classroomIds) qb.andWhere('p.classroomId IN (:...rids)', { rids: opts.classroomIds });
    if (opts.date) qb.andWhere('p.date = :d', { d: opts.date });
    if (opts.from) qb.andWhere('p.date >= :from', { from: opts.from });
    if (opts.to) qb.andWhere('p.date <= :to', { to: opts.to });
    if (opts.childId) this.whereTagged(qb, 'cid', opts.childId);
    if (opts.classroomId) qb.andWhere('p.classroomId = :rid', { rid: opts.classroomId });
    if (opts.activityId) qb.andWhere('p.activityId = :aid', { aid: opts.activityId });
    if (opts.subject) qb.andWhere('p.subject = :s', { s: opts.subject });
    if (opts.onlyShared) qb.andWhere('p.shareWithFamily = true');
    if (opts.childIds) {
      if (!opts.childIds.length) return [];
      this.whereTagged(qb, 'ids', opts.childIds);
    }
    qb.limit(Math.min(opts.limit || 300, 1000));
    return this.decorate(await qb.getMany());
  }

  /**
   * Fotos visibles para una familia: las que muestran a sus niños y las grupales
   * de las salas de esos niños.
   */
  async listForFamily(opts: {
    childIds: string[];
    classroomIds: string[];
    from?: string;
    to?: string;
    limit?: number;
  }) {
    if (!opts.childIds.length) return [];
    const rooms = opts.classroomIds.length ? opts.classroomIds : [NIL_UUID];
    const qb = this.repo
      .createQueryBuilder('p')
      .where('p.shareWithFamily = true')
      .andWhere(
        new Brackets((w) => {
          w.where('p.childId IN (:...ids)', { ids: opts.childIds })
            .orWhere(
              'EXISTS (SELECT 1 FROM photo_children pc WHERE pc."photoId" = p.id AND pc."childId" IN (:...ids))',
              { ids: opts.childIds },
            )
            .orWhere(
              new Brackets((g) => {
                g.where('p.childId IS NULL')
                  .andWhere('p.classroomId IN (:...rooms)', { rooms })
                  .andWhere('NOT EXISTS (SELECT 1 FROM photo_children pc WHERE pc."photoId" = p.id)');
              }),
            );
        }),
      )
      .orderBy('p.date', 'DESC')
      .addOrderBy('p.takenAt', 'DESC')
      .limit(Math.min(opts.limit || 200, 500));
    if (opts.from) qb.andWhere('p.date >= :from', { from: opts.from });
    if (opts.to) qb.andWhere('p.date <= :to', { to: opts.to });
    return this.familyView(await qb.getMany(), opts.childIds);
  }

  /**
   * Galería del día de un niño: fotos compartidas en las que sale, por hora.
   * Las fotos grupales sin etiquetar NO entran (se ven en "Fotos de la sala").
   */
  async forChildDay(childId: string, date: string, myChildIds: string[] = [childId]) {
    const qb = this.repo
      .createQueryBuilder('p')
      .where('p.date = :d', { d: normalizeDay(date) })
      .andWhere('p.shareWithFamily = true')
      .orderBy('p.takenAt', 'ASC');
    this.whereTagged(qb, 'cid', childId);
    return this.familyView(await qb.getMany(), myChildIds);
  }

  /**
   * Fotos de un niño en un rango, paginadas (galería familiar por niño).
   * `scope: 'room'` devuelve en cambio las fotos grupales de su sala.
   */
  async forChildRange(opts: {
    childId: string;
    classroomId: string | null;
    myChildIds: string[];
    from?: string;
    to?: string;
    scope?: 'child' | 'room';
    page?: number;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(opts.limit || 30, 1), 100);
    const page = Math.max(opts.page || 1, 1);
    const qb = this.repo
      .createQueryBuilder('p')
      .where('p.shareWithFamily = true')
      .orderBy('p.date', 'DESC')
      .addOrderBy('p.takenAt', 'DESC');
    if (opts.scope === 'room') {
      qb.andWhere('p.classroomId = :rid', { rid: opts.classroomId || NIL_UUID });
      this.whereGroup(qb);
    } else {
      this.whereTagged(qb, 'cid', opts.childId);
    }
    if (opts.from) qb.andWhere('p.date >= :from', { from: opts.from });
    if (opts.to) qb.andWhere('p.date <= :to', { to: opts.to });
    const [rows, total] = await qb.skip((page - 1) * limit).take(limit).getManyAndCount();
    return {
      items: await this.familyView(rows, opts.myChildIds),
      total,
      page,
      limit,
      hasMore: page * limit < total,
    };
  }

  /** Fotos compartibles de un niño en un día — las que se adjuntan al reporte diario. */
  async forDailyReport(childId: string, _classroomId: string | null, date: string) {
    return this.forChildDay(childId, date);
  }

  async findOne(id: string): Promise<Photo> {
    const photo = await this.repo.findOne({ where: { id } });
    if (!photo) throw new NotFoundException('Foto no encontrada');
    return photo;
  }

  /** Niños etiquetados en una foto (incluye el `childId` heredado). */
  async tagIds(photo: Photo): Promise<string[]> {
    return (await this.tagsFor([photo])).get(photo.id) || [];
  }

  async update(
    id: string,
    data: { caption?: string; shareWithFamily?: boolean; childId?: string | null; childIds?: string[] },
  ) {
    const photo = await this.findOne(id);
    const wasShared = photo.shareWithFamily;
    const current = await this.tagIds(photo);
    let next: string[] | null = null;
    if (data.childIds !== undefined) next = [...new Set(data.childIds.filter(Boolean))];
    else if (data.childId !== undefined) next = data.childId ? [data.childId] : [];

    if (next) {
      // Etiquetar a un niño equivale a tomarle una foto: exige su consentimiento.
      await this.assertCanPhotographAll(next.filter((c) => !current.includes(c)));
      await this.tagsRepo.delete({ photoId: id });
      if (next.length) await this.tagsRepo.insert(next.map((childId) => ({ photoId: id, childId })));
      photo.childId = next[0] || null;
    }
    if (data.caption !== undefined) photo.caption = data.caption.slice(0, 500);
    if (data.shareWithFamily !== undefined) photo.shareWithFamily = data.shareWithFamily;
    const saved = await this.repo.save(photo);
    // Avisa a quien entra, a quien sale y (si cambió la visibilidad) a todos.
    const touched = next ? [...current, ...next] : current;
    this.notifyTags({ ...saved, shareWithFamily: saved.shareWithFamily || wasShared } as Photo, touched);
    return (await this.decorate([saved]))[0];
  }

  /**
   * Borra la foto del índice y, si el archivo no lo usa nadie más (otra fila, portada
   * de actividad), también del disco. Las fotos de comidas/bitácora/entrada siguen
   * referenciadas por su registro: de esas sólo se quita la fila.
   */
  async remove(id: string) {
    const photo = await this.repo.findOne({ where: { id } });
    if (!photo) throw new NotFoundException('Foto no encontrada');
    await this.repo.remove(photo);
    if (['moment', 'general', 'activity'].includes(photo.subject)) {
      const [others, covers] = await Promise.all([
        this.repo.count({ where: { url: photo.url } }),
        this.activitiesRepo.count({ where: { coverPhotoUrl: photo.url } }),
      ]);
      if (!others && !covers) this.deleteFile(photo.url);
    }
    return { ok: true as const };
  }

  /** Quita un archivo de /uploads a partir de su URL pública (silencioso). */
  private deleteFile(url: string) {
    try {
      const filename = path.basename((url || '').split('?')[0].split('#')[0]);
      if (!filename || filename.includes('..')) return;
      const full = path.join(path.resolve(process.cwd(), 'uploads'), filename);
      if (fs.existsSync(full)) fs.unlinkSync(full);
    } catch {
      /* el archivo puede no existir */
    }
  }

  /** Borra del índice las fotos de una entidad que se está eliminando. */
  async removeBySubject(subject: PhotoSubject, subjectId: string) {
    await this.repo.delete({ subject, subjectId });
  }

  /** Propaga a las fotos de una actividad los cambios de visibilidad, fecha o sala. */
  async syncActivity(
    activityId: string,
    patch: { shareWithFamily?: boolean; date?: string; classroomId?: string | null },
  ) {
    const set: Partial<Photo> = {};
    if (patch.shareWithFamily !== undefined) set.shareWithFamily = patch.shareWithFamily;
    if (patch.date !== undefined) set.date = patch.date;
    if (patch.classroomId !== undefined) set.classroomId = patch.classroomId;
    if (!Object.keys(set).length) return;
    await this.repo.update({ activityId }, set);
  }

  /** Cuántas fotos se tomaron hoy (para el resumen del panel). */
  async countForDay(date = dayKey()) {
    return this.repo.count({ where: { date } });
  }

  /** Fotos por niño en un día (etiquetas incluidas), para el tablero del día. */
  async countByChildForDay(childIds: string[], date: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    if (!childIds.length) return out;
    const rows: Array<{ childId: string; n: string }> = await this.repo.query(
      `SELECT t."childId" AS "childId", COUNT(DISTINCT t."photoId") AS n FROM (
         SELECT p.id AS "photoId", p."childId" FROM photos p WHERE p.date = $1 AND p."childId" = ANY($2)
         UNION
         SELECT pc."photoId", pc."childId" FROM photo_children pc JOIN photos p ON p.id = pc."photoId"
          WHERE p.date = $1 AND pc."childId" = ANY($2)
       ) t GROUP BY t."childId"`,
      [date, childIds],
    );
    for (const r of rows) out[r.childId] = Number(r.n);
    return out;
  }

  /** Fotos por niño en un día, indexadas. Uso interno del generador de reportes. */
  async byChildForDay(childIds: string[], date: string) {
    if (!childIds.length) return new Map<string, Photo[]>();
    const qb = this.repo.createQueryBuilder('p').where('p.date = :d', { d: date }).orderBy('p.takenAt', 'ASC');
    this.whereTagged(qb, 'ids', childIds);
    const rows = await qb.getMany();
    const tags = await this.tagsFor(rows);
    const wanted = new Set(childIds);
    const map = new Map<string, Photo[]>();
    for (const r of rows) {
      for (const cid of tags.get(r.id) || []) {
        if (!wanted.has(cid)) continue;
        map.set(cid, [...(map.get(cid) || []), r]);
      }
    }
    return map;
  }
}
