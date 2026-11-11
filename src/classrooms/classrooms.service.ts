import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Classroom, ClassroomLevel } from './classroom.entity';
import { Child } from '../children/child.entity';
import { User } from '../users/user.entity';
import { CreateClassroomDto, UpdateClassroomDto } from './dto/classroom.dto';

@Injectable()
export class ClassroomsService {
  constructor(
    @InjectRepository(Classroom) private readonly repo: Repository<Classroom>,
    @InjectRepository(Child) private readonly childrenRepo: Repository<Child>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
  ) {}

  /**
   * Lista las salas con el número de niños activos y el nombre de la educadora.
   * El conteo va en una sola consulta agrupada: con 8-10 salas un N+1 sería inocuo,
   * pero esta lista se pinta en el resumen del día, que se recarga constantemente.
   */
  async findAll(includeInactive = true, onlyIds?: string[]) {
    // `onlyIds` limita a esas salas (alcance de educadora); [] → ninguna.
    if (onlyIds && !onlyIds.length) return [];
    const where: any = includeInactive ? {} : { active: true };
    if (onlyIds) where.id = In(onlyIds);
    const rooms = await this.repo.find({
      where,
      order: { ageMinMonths: 'ASC', name: 'ASC' },
    });
    if (!rooms.length) return [];

    const counts = await this.childrenRepo
      .createQueryBuilder('c')
      .select('c.classroomId', 'classroomId')
      .addSelect('COUNT(*)', 'total')
      .where('c.active = true')
      .groupBy('c.classroomId')
      .getRawMany<{ classroomId: string | null; total: string }>();
    const byRoom = new Map(counts.map((c) => [c.classroomId, Number(c.total)]));

    const teacherIds = rooms.map((r) => r.teacherId).filter(Boolean) as string[];
    const teachers = teacherIds.length
      ? await this.usersRepo.find({ where: teacherIds.map((id) => ({ id })) })
      : [];
    const teacherName = new Map(teachers.map((t) => [t.id, t.name]));

    return rooms.map((r) => ({
      ...r,
      childCount: byRoom.get(r.id) || 0,
      teacherName: r.teacherId ? teacherName.get(r.teacherId) || '' : '',
    }));
  }

  async findOne(id: string): Promise<Classroom> {
    const room = await this.repo.findOne({ where: { id } });
    if (!room) throw new NotFoundException('Sala no encontrada');
    return room;
  }

  /** Espejo de UsersService.syncRoomTeacher: la educadora sin sala recibe ésta. */
  private async syncTeacherRoom(room: Classroom) {
    if (!room.teacherId) return;
    await this.repo.manager.query(
      `UPDATE users SET "classroomId" = $1 WHERE id = $2 AND "classroomId" IS NULL AND role = 'teacher'`,
      [room.id, room.teacherId],
    );
  }

  async create(dto: CreateClassroomDto) {
    const room = this.repo.create({
      name: dto.name,
      level: (dto.level as ClassroomLevel) || 'otro',
      ageMinMonths: dto.ageMinMonths ?? 0,
      ageMaxMonths: dto.ageMaxMonths ?? 0,
      capacity: dto.capacity ?? 0,
      color: dto.color || '#38bdf8',
      teacherId: dto.teacherId || null,
      notes: dto.notes || '',
      active: dto.active ?? true,
    });
    const saved = await this.repo.save(room);
    await this.syncTeacherRoom(saved);
    return saved;
  }

  async update(id: string, dto: UpdateClassroomDto) {
    const room = await this.findOne(id);
    if (dto.name !== undefined) room.name = dto.name;
    if (dto.level !== undefined) room.level = dto.level as ClassroomLevel;
    if (dto.ageMinMonths !== undefined) room.ageMinMonths = dto.ageMinMonths;
    if (dto.ageMaxMonths !== undefined) room.ageMaxMonths = dto.ageMaxMonths;
    if (dto.capacity !== undefined) room.capacity = dto.capacity;
    if (dto.color !== undefined) room.color = dto.color;
    if (dto.teacherId !== undefined) room.teacherId = dto.teacherId || null;
    if (dto.notes !== undefined) room.notes = dto.notes;
    if (dto.active !== undefined) room.active = dto.active;
    const saved = await this.repo.save(room);
    await this.syncTeacherRoom(saved);
    return saved;
  }

  /**
   * Elimina la sala. Los niños que estaban en ella quedan SIN sala (`classroomId = null`)
   * por el `onDelete: 'SET NULL'` de la relación — nunca se borra un niño al borrar su sala.
   */
  async remove(id: string) {
    const room = await this.findOne(id);
    await this.repo.remove(room);
    return { ok: true as const };
  }
}
