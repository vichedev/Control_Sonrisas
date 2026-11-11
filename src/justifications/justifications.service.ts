import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Justification,
  JustificationStatus,
  JustificationType,
} from './justification.entity';
import { Child } from '../children/child.entity';
import { UploadsService } from '../uploads/uploads.service';
import { CreateJustificationDto } from './dto/create-justification.dto';
import { DecideJustificationDto } from './dto/decide-justification.dto';

export interface Actor {
  id?: string;
  name?: string;
  role?: string;
}

/** Columnas del niño que acompañan a una justificación. */
const CHILD_SUMMARY_COLUMNS = [
  'child.id',
  'child.firstName',
  'child.lastName',
  'child.photoUrl',
  'child.classroomId',
];

@Injectable()
export class JustificationsService {
  constructor(
    @InjectRepository(Justification) private readonly repo: Repository<Justification>,
    @InjectRepository(Child) private readonly childrenRepo: Repository<Child>,
    private readonly uploads: UploadsService,
  ) {}

  async list(opts: {
    status?: string;
    childId?: string;
    childIds?: string[];
    /** Alcance de educadora: sólo niños de estas salas. */
    classroomIds?: string[];
    from?: string;
    to?: string;
  } = {}) {
    // Del niño sólo lo necesario para pintar la lista: nunca la ficha completa
    // (notas internas, salud), porque esta consulta también la usa el portal familiar.
    const qb = this.repo
      .createQueryBuilder('j')
      .leftJoin('j.child', 'child')
      .addSelect(CHILD_SUMMARY_COLUMNS)
      .orderBy('j.createdAt', 'DESC')
      .limit(500);
    if (opts.status) qb.andWhere('j.status = :s', { s: opts.status });
    if (opts.childId) qb.andWhere('j.childId = :cid', { cid: opts.childId });
    if (opts.childIds) {
      if (!opts.childIds.length) return [];
      qb.andWhere('j.childId IN (:...ids)', { ids: opts.childIds });
    }
    if (opts.classroomIds) {
      if (!opts.classroomIds.length) return [];
      qb.andWhere('child.classroomId IN (:...rids)', { rids: opts.classroomIds });
    }
    if (opts.from) qb.andWhere('j.dateTo >= :from', { from: opts.from });
    if (opts.to) qb.andWhere('j.dateFrom <= :to', { to: opts.to });
    return qb.getMany();
  }

  async findOne(id: string): Promise<Justification> {
    const j = await this.repo
      .createQueryBuilder('j')
      .leftJoin('j.child', 'child')
      .addSelect(CHILD_SUMMARY_COLUMNS)
      .where('j.id = :id', { id })
      .getOne();
    if (!j) throw new NotFoundException('Justificación no encontrada');
    return j;
  }

  async create(dto: CreateJustificationDto, actor: Actor) {
    const child = await this.childrenRepo.findOne({ where: { id: dto.childId } });
    if (!child) throw new NotFoundException('Niño no encontrado');

    const from = dto.dateFrom.slice(0, 10);
    const to = dto.dateTo.slice(0, 10);
    if (to < from) throw new BadRequestException('El rango de fechas está invertido');

    const attachmentUrl = dto.attachment
      ? this.uploads.saveDataUrl(dto.attachment, 'justificacion')
      : '';

    const j = this.repo.create({
      childId: dto.childId,
      dateFrom: from,
      dateTo: to,
      type: (dto.type as JustificationType) || 'otro',
      reason: dto.reason,
      attachmentUrl,
      status: 'pending',
      createdById: actor.id || null,
      createdByName: actor.name || '',
    });
    return this.repo.save(j);
  }

  async decide(id: string, dto: DecideJustificationDto, actor: Actor) {
    const j = await this.findOne(id);
    if (j.status !== 'pending') {
      throw new BadRequestException('Esa justificación ya fue resuelta');
    }
    j.status = dto.decision as JustificationStatus;
    j.adminNote = dto.adminNote || '';
    j.decidedById = actor.id || null;
    j.decidedAt = new Date();
    return this.repo.save(j);
  }

  async remove(id: string) {
    const j = await this.findOne(id);
    await this.repo.remove(j);
    return { ok: true as const };
  }

  pendingCount() {
    return this.repo.count({ where: { status: 'pending' } });
  }

  /** Justificaciones aprobadas que cubren un día concreto para un grupo de niños. */
  approvedFor(childIds: string[], date: string) {
    if (!childIds.length) return Promise.resolve([]);
    return this.repo
      .createQueryBuilder('j')
      .where('j.childId IN (:...ids)', { ids: childIds })
      .andWhere('j.status = :s', { s: 'approved' })
      .andWhere('j.dateFrom <= :d AND j.dateTo >= :d', { d: date })
      .getMany();
  }

  /** Comprueba que todos los ids pertenezcan al conjunto permitido (portal familiar). */
  async assertOwnership(id: string, allowedChildIds: string[]) {
    const j = await this.repo.findOne({ where: { id, childId: In(allowedChildIds) } });
    if (!j) throw new NotFoundException('Justificación no encontrada');
    return j;
  }
}
