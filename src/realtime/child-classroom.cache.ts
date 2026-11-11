import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { Child } from '../children/child.entity';

const TTL_MS = 60_000;

/**
 * Caché pequeña niño → sala (TTL 60 s). Sirve para completar `classroomId` en eventos
 * que sólo traen `childId` (comidas, bitácora, asistencia…). Se invalida/actualiza con
 * cada evento de `child`.
 */
@Injectable()
export class ChildClassroomCache {
  private readonly map = new Map<string, { v: string | null; at: number }>();

  constructor(private readonly ds: DataSource) {}

  set(childId: string, classroomId: string | null): void {
    this.map.set(childId, { v: classroomId ?? null, at: Date.now() });
  }

  invalidate(childId: string): void {
    this.map.delete(childId);
  }

  async get(childId: string): Promise<string | null> {
    const hit = this.map.get(childId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.v;
    const row = await this.ds
      .getRepository(Child)
      .findOne({ where: { id: childId }, select: ['id', 'classroomId'] });
    const v = row?.classroomId ?? null;
    this.set(childId, v);
    if (this.map.size > 5000) this.prune();
    return v;
  }

  /** Salas de varios niños (sin repetir, sin nulos). */
  async roomsOf(childIds: string[]): Promise<string[]> {
    if (!childIds.length) return [];
    const rows = await this.ds
      .getRepository(Child)
      .find({ where: { id: In(childIds) }, select: ['id', 'classroomId'] });
    rows.forEach((r) => this.set(r.id, r.classroomId));
    return [...new Set(rows.map((r) => r.classroomId).filter((x): x is string => !!x))];
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, e] of this.map) if (now - e.at >= TTL_MS) this.map.delete(k);
  }
}
