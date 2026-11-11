import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Classroom } from '../../classrooms/classroom.entity';
import { Child } from '../../children/child.entity';

/** Lo mínimo de `req.user` que hace falta para decidir el alcance. */
export interface ScopeUser {
  id: string;
  role: string;
  classroomId?: string | null;
}

/**
 * Alcance por sala del personal.
 *
 * - Dirección y coordinación: ven y gestionan todo (`null` = sin restricción).
 * - Educadora: sólo las salas que tiene a cargo. Una sala es suya si es su
 *   `User.classroomId` (asignado en Personal) o si la sala la tiene como
 *   `Classroom.teacherId` (asignado en Salas). Se aceptan las dos para no
 *   depender de que ambas pantallas estén sincronizadas.
 * - Educadora sin sala asignada: no ve ningún niño (lista vacía).
 *
 * Uso típico en un servicio/controlador:
 *   const filter = await scope.classroomFilter(req.user, query.classroomId);
 *   // filter === undefined → sin filtro (admin/coord. sin sala pedida)
 *   // filter === string[]  → filtrar por `classroomId IN (...)` (si [] → nada)
 */
@Injectable()
export class ScopeService {
  constructor(
    @InjectRepository(Classroom) private readonly classrooms: Repository<Classroom>,
    @InjectRepository(Child) private readonly children: Repository<Child>,
  ) {}

  isUnrestricted(user: ScopeUser | undefined | null): boolean {
    return user?.role === 'admin' || user?.role === 'coordinator';
  }

  /** Salas permitidas, o `null` si el usuario no tiene restricción. */
  async allowedClassroomIds(user: ScopeUser): Promise<string[] | null> {
    if (this.isUnrestricted(user)) return null;
    if (user?.role !== 'teacher') return [];
    const owned = await this.classrooms.find({
      where: { teacherId: user.id },
      select: ['id'],
    });
    const ids = new Set(owned.map((c) => c.id));
    if (user.classroomId) ids.add(user.classroomId);
    return [...ids];
  }

  /**
   * Resuelve el filtro de sala de un listado.
   * - Sin restricción: devuelve `[requested]` si se pidió una sala, o `undefined`.
   * - Educadora: si pide una sala ajena → 403; si no pide ninguna → todas las suyas.
   */
  async classroomFilter(user: ScopeUser, requested?: string | null): Promise<string[] | undefined> {
    const allowed = await this.allowedClassroomIds(user);
    if (allowed === null) return requested ? [requested] : undefined;
    if (requested) {
      if (!allowed.includes(requested)) {
        throw new ForbiddenException('Esa sala no está a tu cargo');
      }
      return [requested];
    }
    return allowed;
  }

  async assertClassroom(user: ScopeUser, classroomId: string | null | undefined): Promise<void> {
    const allowed = await this.allowedClassroomIds(user);
    if (allowed === null) return;
    if (!classroomId || !allowed.includes(classroomId)) {
      throw new ForbiddenException('Esa sala no está a tu cargo');
    }
  }

  /** 404 si el niño no existe; 403 si existe pero no es de una sala a cargo del usuario. */
  async assertChild(user: ScopeUser, childId: string): Promise<void> {
    if (this.isUnrestricted(user)) return;
    const child = await this.children.findOne({ where: { id: childId }, select: ['id', 'classroomId'] });
    if (!child) throw new NotFoundException('Niño no encontrado');
    await this.assertClassroom(user, child.classroomId);
  }

  /** Igual que `assertChild` pero para varios niños a la vez (operaciones en bloque). */
  async assertChildren(user: ScopeUser, childIds: string[]): Promise<void> {
    if (this.isUnrestricted(user) || !childIds?.length) return;
    const allowed = (await this.allowedClassroomIds(user)) || [];
    const rows = await this.children.find({
      where: childIds.map((id) => ({ id })),
      select: ['id', 'classroomId'],
    });
    const bad = rows.some((c) => !c.classroomId || !allowed.includes(c.classroomId));
    if (bad || rows.length !== new Set(childIds).size) {
      throw new ForbiddenException('Alguno de esos niños no está en una sala a tu cargo');
    }
  }
}
