import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Meal, MealIntake, MealType } from './meal.entity';
import { Child } from '../children/child.entity';
import { PhotosService } from '../photos/photos.service';
import { normalizeDay } from '../common/day.util';
import { BulkMealDto, CreateMealDto, UpdateMealDto } from './dto/meal.dto';

export interface Actor {
  id?: string;
  name?: string;
}

/** Etiquetas en español para el reporte que lee la familia. */
export const MEAL_TYPE_LABEL: Record<MealType, string> = {
  breakfast: 'Desayuno',
  snack_am: 'Refrigerio de la mañana',
  lunch: 'Almuerzo',
  snack_pm: 'Refrigerio de la tarde',
  bottle: 'Biberón',
};

/** Tipos que pueden repetirse en el día (no se fusionan con el registro previo). */
const UPSERT_EXCLUDED: MealType[] = ['bottle'];

export const MEAL_INTAKE_LABEL: Record<MealIntake, string> = {
  all: 'Comió todo',
  most: 'Comió casi todo',
  half: 'Comió la mitad',
  little: 'Comió poco',
  none: 'No quiso comer',
};

/** Campos del niño que viajan en los listados (nunca la ficha completa). */
const CHILD_PUBLIC_FIELDS = [
  'child.id',
  'child.firstName',
  'child.lastName',
  'child.classroomId',
  'child.photoUrl',
];

@Injectable()
export class MealsService {
  constructor(
    @InjectRepository(Meal) private readonly repo: Repository<Meal>,
    @InjectRepository(Child) private readonly childrenRepo: Repository<Child>,
    private readonly photos: PhotosService,
  ) {}

  async list(
    opts: {
      date?: string;
      from?: string;
      to?: string;
      childId?: string;
      classroomId?: string;
      /** Alcance de la educadora ([] = nada). */
      classroomIds?: string[];
      type?: string;
    } = {},
  ) {
    if (opts.classroomIds && !opts.classroomIds.length) return [];
    const qb = this.repo
      .createQueryBuilder('m')
      .leftJoin('m.child', 'child')
      .addSelect(CHILD_PUBLIC_FIELDS)
      .orderBy('m.date', 'DESC')
      .addOrderBy('m.createdAt', 'ASC')
      .limit(1000);
    if (opts.date) qb.andWhere('m.date = :d', { d: opts.date });
    if (opts.from) qb.andWhere('m.date >= :from', { from: opts.from });
    if (opts.to) qb.andWhere('m.date <= :to', { to: opts.to });
    if (opts.childId) qb.andWhere('m.childId = :cid', { cid: opts.childId });
    if (opts.type) qb.andWhere('m.type = :t', { t: opts.type });
    if (opts.classroomId) qb.andWhere('child.classroomId = :rid', { rid: opts.classroomId });
    if (opts.classroomIds) qb.andWhere('child.classroomId IN (:...rids)', { rids: opts.classroomIds });
    return qb.getMany();
  }

  /** Comidas del día de un niño (usado por el reporte diario). */
  dayMeals(childId: string, date: string) {
    return this.repo.find({ where: { childId, date }, order: { createdAt: 'ASC' } });
  }

  async create(dto: CreateMealDto, actor: Actor) {
    const child = await this.mustFindChild(dto.childId);
    // Consentimiento de imagen (LOPDP): antes de guardar la comida.
    if (dto.photo) await this.photos.assertCanPhotograph(dto.childId);
    const date = normalizeDay(dto.date);
    const type = dto.type as MealType;
    // Foto indexada con el id de la comida, para borrarla con ella.
    const attachPhoto = async (meal: Meal) => {
      if (!dto.photo) return meal;
      const url = await this.photos.register({
        photo: dto.photo,
        subject: 'meal',
        subjectId: meal.id,
        childId: dto.childId,
        classroomId: child.classroomId,
        date,
        caption: MEAL_TYPE_LABEL[type] || 'Comida',
        actorId: actor.id,
        actorName: actor.name,
      });
      if (url) {
        meal.photoUrl = url;
        await this.repo.update(meal.id, { photoUrl: url });
      }
      return meal;
    };

    // Un mismo niño no tiene dos almuerzos el mismo día: si ya existe, se actualiza.
    // Los biberones sí se repiten en el día: siempre se insertan.
    const existing = UPSERT_EXCLUDED.includes(type)
      ? null
      : await this.repo.findOne({ where: { childId: dto.childId, date, type } });
    if (existing) {
      existing.menu = dto.menu ?? existing.menu;
      existing.intake = (dto.intake as MealIntake) ?? existing.intake;
      existing.notes = dto.notes ?? existing.notes;
      return attachPhoto(await this.repo.save(existing));
    }

    const meal = this.repo.create({
      childId: dto.childId,
      date,
      type: dto.type as MealType,
      menu: dto.menu || '',
      intake: (dto.intake as MealIntake) || 'all',
      notes: dto.notes || '',
      photoUrl: '',
      servedAt: new Date(),
      recordedById: actor.id || null,
      recordedByName: actor.name || '',
    });
    return attachPhoto(await this.repo.save(meal));
  }

  /**
   * Registra la misma comida para varios niños de una sala. Reemplaza el registro previo
   * de ese tipo y día para cada niño, de modo que repetir el guardado corrige en lugar
   * de duplicar.
   */
  async createBulk(dto: BulkMealDto, actor: Actor) {
    const date = normalizeDay(dto.date);
    const type = dto.type as MealType;
    const childIds = dto.entries.map((e) => e.childId);
    const children = await this.childrenRepo.find({ where: { id: In(childIds) } });
    const byId = new Map(children.map((c) => [c.id, c]));

    const photoUrl = dto.photo
      ? await this.photos.register({
          photo: dto.photo,
          subject: 'meal',
          classroomId: dto.classroomId || null,
          date,
          caption: `${MEAL_TYPE_LABEL[type] || 'Comida'}${dto.menu ? `: ${dto.menu}` : ''}`,
          actorId: actor.id,
          actorName: actor.name,
        })
      : '';

    // Biberón: cada toma es un registro nuevo, no se corrige el anterior.
    const existing = UPSERT_EXCLUDED.includes(type)
      ? []
      : await this.repo.find({ where: { childId: In(childIds), date, type } });
    const existingByChild = new Map(existing.map((m) => [m.childId, m]));

    const toSave: Meal[] = [];
    for (const entry of dto.entries) {
      if (!byId.has(entry.childId)) continue;
      const prev = existingByChild.get(entry.childId);
      if (prev) {
        prev.menu = dto.menu ?? prev.menu;
        prev.intake = (entry.intake as MealIntake) || prev.intake;
        prev.notes = entry.notes ?? prev.notes;
        if (photoUrl) prev.photoUrl = photoUrl;
        toSave.push(prev);
      } else {
        toSave.push(
          this.repo.create({
            childId: entry.childId,
            date,
            type,
            menu: dto.menu || '',
            intake: (entry.intake as MealIntake) || 'all',
            notes: entry.notes || '',
            photoUrl,
            servedAt: new Date(),
            recordedById: actor.id || null,
            recordedByName: actor.name || '',
          }),
        );
      }
    }
    await this.repo.save(toSave);
    return { saved: toSave.length, date, type };
  }

  async update(id: string, dto: UpdateMealDto, actor: Actor) {
    const meal = await this.findOne(id);
    if (dto.menu !== undefined) meal.menu = dto.menu;
    if (dto.intake !== undefined) meal.intake = dto.intake as MealIntake;
    if (dto.notes !== undefined) meal.notes = dto.notes;
    if (dto.photo) {
      meal.photoUrl = await this.photos.register({
        photo: dto.photo,
        subject: 'meal',
        subjectId: meal.id,
        childId: meal.childId,
        classroomId: (await this.childrenRepo.findOne({ where: { id: meal.childId }, select: ['id', 'classroomId'] }))?.classroomId ?? null,
        date: meal.date,
        caption: MEAL_TYPE_LABEL[meal.type] || 'Comida',
        actorId: actor.id,
        actorName: actor.name,
      });
    }
    return this.repo.save(meal);
  }

  async findOne(id: string): Promise<Meal> {
    const meal = await this.repo.findOne({ where: { id } });
    if (!meal) throw new NotFoundException('Registro de comida no encontrado');
    return meal;
  }

  async remove(id: string) {
    const meal = await this.findOne(id);
    await this.photos.removeBySubject('meal', id);
    await this.repo.remove(meal);
    return { ok: true as const };
  }

  /**
   * Resumen de alimentación de un rango: cuántas veces comió bien y cuántas rechazó.
   * Es la pregunta que la familia hace en la reunión de seguimiento.
   */
  async intakeSummary(opts: {
    from: string;
    to: string;
    childId?: string;
    classroomId?: string;
    classroomIds?: string[];
  }) {
    if (opts.classroomIds && !opts.classroomIds.length) {
      return { counts: { all: 0, most: 0, half: 0, little: 0, none: 0 }, total: 0, ateWellPct: 0 };
    }
    const qb = this.repo
      .createQueryBuilder('m')
      .leftJoin('m.child', 'child')
      .select('m.intake', 'intake')
      .addSelect('COUNT(*)', 'total')
      .where('m.date BETWEEN :from AND :to', { from: opts.from, to: opts.to })
      .groupBy('m.intake');
    if (opts.childId) qb.andWhere('m.childId = :cid', { cid: opts.childId });
    if (opts.classroomId) qb.andWhere('child.classroomId = :rid', { rid: opts.classroomId });
    if (opts.classroomIds) qb.andWhere('child.classroomId IN (:...rids)', { rids: opts.classroomIds });
    const rows = await qb.getRawMany<{ intake: MealIntake; total: string }>();
    const counts: Record<string, number> = { all: 0, most: 0, half: 0, little: 0, none: 0 };
    for (const r of rows) counts[r.intake] = Number(r.total);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return {
      counts,
      total,
      // "Comió bien" = todo o casi todo. Es el indicador que se mira de un vistazo.
      ateWellPct: total ? Math.round(((counts.all + counts.most) / total) * 100) : 0,
    };
  }

  private async mustFindChild(childId: string): Promise<Child> {
    const child = await this.childrenRepo.findOne({ where: { id: childId } });
    if (!child) throw new NotFoundException('Niño no encontrado');
    return child;
  }
}
