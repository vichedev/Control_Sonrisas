import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Task, TaskPriority, TaskStatus } from './task.entity';
import { User } from '../users/user.entity';
import { PushService } from '../push/push.service';
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';

export interface Actor {
  id?: string;
  name?: string;
  role?: string;
}

/** Datos mínimos del responsable que viajan al cliente (nunca la entidad User completa). */
function publicTask(t: Task) {
  const a = t.assignee;
  return {
    ...t,
    assignee: a ? { id: a.id, name: a.name, role: a.role, photoUrl: a.photoUrl } : null,
  };
}

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private readonly repo: Repository<Task>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly push: PushService,
  ) {}

  async list(opts: { assigneeId?: string; status?: string; limit?: number } = {}) {
    const qb = this.repo
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.assignee', 'a')
      .orderBy('t.status', 'ASC')
      .addOrderBy('t.dueAt', 'ASC')
      .addOrderBy('t.createdAt', 'DESC')
      .limit(Math.min(opts.limit || 300, 1000));
    if (opts.assigneeId) qb.andWhere('t.assigneeId = :aid', { aid: opts.assigneeId });
    if (opts.status) qb.andWhere('t.status = :s', { s: opts.status });
    return (await qb.getMany()).map(publicTask);
  }

  /** Pendientes abiertos del usuario (los que ve al entrar). */
  findMine(assigneeId: string) {
    return this.repo.find({
      where: { assigneeId, status: Not('completed' as TaskStatus) },
      order: { dueAt: 'ASC', createdAt: 'DESC' },
    });
  }

  /** Entidad sin relaciones, para uso interno (save/remove). */
  private async load(id: string): Promise<Task> {
    const t = await this.repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Pendiente no encontrado');
    return t;
  }

  async findOne(id: string) {
    const t = await this.repo.findOne({ where: { id }, relations: ['assignee'] });
    if (!t) throw new NotFoundException('Pendiente no encontrado');
    return publicTask(t);
  }

  /** El responsable debe existir, estar activo y ser personal (nunca un representante). */
  private async assertAssignee(assigneeId: string) {
    const assignee = await this.usersRepo.findOne({ where: { id: assigneeId } });
    if (!assignee || !assignee.active || assignee.role === 'guardian') {
      throw new BadRequestException('El responsable debe ser personal activo de la guardería');
    }
  }

  async create(dto: CreateTaskDto, actor: Actor) {
    await this.assertAssignee(dto.assigneeId);
    const task = this.repo.create({
      assigneeId: dto.assigneeId,
      assignedById: actor.id || null,
      assignedByName: actor.name || '',
      title: dto.title,
      description: dto.description || '',
      priority: (dto.priority as TaskPriority) || 'normal',
      classroomId: dto.classroomId || null,
      childId: dto.childId || null,
      dueAt: this.parseDate(dto.dueAt),
      status: 'pending',
    });
    const saved = await this.repo.save(task);

    // La notificación es "mejor esfuerzo": si el push falla, el pendiente ya está creado.
    this.push
      .notifyUser(saved.assigneeId, {
        title: 'Nuevo pendiente',
        body: saved.title,
        tag: `task-${saved.id}`,
      })
      .catch(() => {});

    return this.findOne(saved.id);
  }

  async update(id: string, dto: UpdateTaskDto, actor: Actor) {
    const task = await this.load(id);
    // Una educadora puede avanzar y cerrar SUS pendientes; reasignarlos o reescribirlos
    // es cosa de quien los creó.
    const isOwner = task.assigneeId === actor.id;
    const isManager = actor.role === 'admin' || actor.role === 'coordinator';
    if (!isOwner && !isManager) {
      throw new ForbiddenException('Ese pendiente no es tuyo');
    }
    // La fecha límite también la fija quien asigna, no la responsable.
    const managerOnly =
      dto.assigneeId !== undefined ||
      dto.title !== undefined ||
      dto.description !== undefined ||
      dto.priority !== undefined ||
      dto.dueAt !== undefined;
    if (!isManager && managerOnly) {
      throw new ForbiddenException('Sólo dirección o coordinación pueden editar el pendiente');
    }
    if (dto.assigneeId !== undefined && dto.assigneeId !== task.assigneeId) {
      await this.assertAssignee(dto.assigneeId);
    }

    if (dto.title !== undefined) task.title = dto.title;
    if (dto.description !== undefined) task.description = dto.description;
    if (dto.priority !== undefined) task.priority = dto.priority as TaskPriority;
    if (dto.assigneeId !== undefined) task.assigneeId = dto.assigneeId;
    if (dto.dueAt !== undefined) task.dueAt = this.parseDate(dto.dueAt);
    if (dto.completionNote !== undefined) task.completionNote = dto.completionNote;
    if (dto.status !== undefined) {
      task.status = dto.status as TaskStatus;
      task.completedAt = dto.status === 'completed' ? new Date() : null;
    }
    await this.repo.save(task);
    return this.findOne(id);
  }

  async remove(id: string) {
    const task = await this.load(id);
    await this.repo.remove(task);
    return { ok: true as const };
  }

  /** Contadores para el badge del menú. */
  async countOpen() {
    const [pending, inProgress] = await Promise.all([
      this.repo.count({ where: { status: 'pending' } }),
      this.repo.count({ where: { status: 'in_progress' } }),
    ]);
    return { pending, inProgress };
  }

  private parseDate(value?: string | null): Date | null {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
}
