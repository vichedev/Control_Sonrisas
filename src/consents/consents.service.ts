import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ConsentPolicy } from './consent-policy.entity';
import { ChildConsent } from './child-consent.entity';
import { Child } from '../children/child.entity';
import { ChildGuardian } from '../children/child-guardian.entity';
import { AppBranding } from '../branding/branding.entity';
import { AuditContext, AuditService } from '../audit/audit.service';
import { DEFAULT_POLICIES } from './consent-defaults';
import {
  CONSENT_LABEL,
  CONSENT_TYPES,
  ChildConsentSummary,
  ConsentMethod,
  ConsentStatus,
  ConsentType,
} from './consent.types';

export interface RecordConsentInput {
  childId: string;
  type: ConsentType;
  granted: boolean;
  method: ConsentMethod;
  guardianId?: string | null;
  guardianName?: string;
  recordedById?: string | null;
  recordedByName?: string;
  note?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Consentimientos de los representantes (LOPDP).
 *
 * Reglas del estado vigente (por niño + tipo; decide el último registro):
 * - Sin registros → `pending`.
 * - Último registro = denegado → `denied` (una negativa vale para cualquier versión del texto).
 * - Último registro = autorizado sobre una versión anterior a `baseVersion` del texto
 *   vigente → `pending` con `outdated: true` (hay que renovarlo).
 * - En otro caso → `granted`.
 *
 * Uso de imagen: sólo con `granted`. WhatsApp: todo menos `denied` (transición).
 */
@Injectable()
export class ConsentsService implements OnApplicationBootstrap {
  private readonly log = new Logger('Consents');
  /** Textos vigentes en memoria (30 s): se consultan en cada foto y cada aviso. */
  private policyCache: Map<ConsentType, ConsentPolicy> | null = null;
  private policyCacheAt = 0;

  constructor(
    @InjectRepository(ConsentPolicy) private readonly policies: Repository<ConsentPolicy>,
    @InjectRepository(ChildConsent) private readonly records: Repository<ChildConsent>,
    @InjectRepository(Child) private readonly children: Repository<Child>,
    @InjectRepository(ChildGuardian) private readonly links: Repository<ChildGuardian>,
    @InjectRepository(AppBranding) private readonly branding: Repository<AppBranding>,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  /** Siembra los textos v1 que falten. */
  async onApplicationBootstrap() {
    try {
      for (const def of DEFAULT_POLICIES) {
        const exists = await this.policies.count({ where: { type: def.type } });
        if (exists) continue;
        await this.policies.insert({
          type: def.type,
          version: 1,
          baseVersion: 1,
          title: def.title,
          body: def.body,
          required: def.required,
          active: true,
          publishedAt: new Date(),
          createdById: null,
          createdByName: 'Sistema',
        });
        this.log.log(`Política inicial creada: ${def.type} v1`);
      }
      this.policyCache = null;
    } catch (e: any) {
      this.log.warn(`No se pudieron sembrar las políticas: ${e?.message || e}`);
    }
  }

  // ------------------------------------------------------------------ políticas

  private async activePolicies(): Promise<Map<ConsentType, ConsentPolicy>> {
    if (this.policyCache && Date.now() - this.policyCacheAt < 30_000) return this.policyCache;
    const rows = await this.policies.find({ where: { active: true } });
    const map = new Map<ConsentType, ConsentPolicy>();
    for (const r of rows) map.set(r.type, r);
    this.policyCache = map;
    this.policyCacheAt = Date.now();
    return map;
  }

  private async centerName(): Promise<string> {
    const b = await this.branding.find({ take: 1 }).catch(() => []);
    return b[0]?.companyName?.trim() || 'el centro';
  }

  private render(p: ConsentPolicy, center: string) {
    return {
      id: p.id,
      type: p.type,
      label: CONSENT_LABEL[p.type],
      version: p.version,
      baseVersion: p.baseVersion,
      title: p.title,
      body: p.body.split('{centro}').join(center),
      rawBody: p.body,
      required: p.required,
      active: p.active,
      publishedAt: p.publishedAt,
      createdByName: p.createdByName,
    };
  }

  /** Textos vigentes, ya con el nombre del centro. */
  async currentPolicies() {
    const [map, center] = await Promise.all([this.activePolicies(), this.centerName()]);
    const out: Record<string, ReturnType<ConsentsService['render']>> = {};
    for (const t of CONSENT_TYPES) {
      const p = map.get(t);
      if (p) out[t] = this.render(p, center);
    }
    return out;
  }

  /** Todas las versiones (vista de dirección). */
  async policyHistory() {
    const [rows, center] = await Promise.all([
      this.policies.find({ order: { type: 'ASC', version: 'DESC' } }),
      this.centerName(),
    ]);
    return rows.map((p) => this.render(p, center));
  }

  /**
   * Publica una versión nueva de un texto. Con `requireReconsent` las autorizaciones
   * anteriores pasan a pendientes; sin él (corrección menor) siguen valiendo.
   */
  async publishPolicy(
    type: ConsentType,
    input: { title: string; body: string; requireReconsent: boolean },
    actor: { id?: string | null; name?: string },
    ctx: AuditContext,
  ) {
    if (!CONSENT_TYPES.includes(type)) throw new BadRequestException('Tipo de consentimiento inválido');
    const title = (input.title || '').trim();
    const body = (input.body || '').trim();
    if (title.length < 3 || body.length < 20) {
      throw new BadRequestException('El título y el texto son obligatorios');
    }
    const saved = await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(ConsentPolicy);
      const prev = await repo.findOne({ where: { type }, order: { version: 'DESC' } });
      const version = (prev?.version || 0) + 1;
      await repo.update({ type, active: true }, { active: false });
      return repo.save(
        repo.create({
          type,
          version,
          baseVersion: input.requireReconsent || !prev ? version : prev.baseVersion,
          title,
          body,
          required: type === 'data_processing',
          active: true,
          publishedAt: new Date(),
          createdById: actor.id || null,
          createdByName: actor.name || '',
        }),
      );
    });
    this.policyCache = null;
    await this.audit.record(ctx, {
      entity: 'consent_policy',
      entityId: saved.id,
      action: 'update',
      summary: `Publicó la versión ${saved.version} de "${CONSENT_LABEL[type]}"${
        input.requireReconsent ? ' (exige renovar el consentimiento)' : ' (corrección menor)'
      }`,
      after: { type, version: saved.version, baseVersion: saved.baseVersion },
    });
    return this.render(saved, await this.centerName());
  }

  // ------------------------------------------------------------------ estado

  private emptyStatus(currentVersion: number): ConsentStatus {
    return { status: 'pending', at: null, by: '', method: null, version: null, currentVersion, outdated: false };
  }

  private statusOf(rec: ChildConsent | undefined, policy: ConsentPolicy | undefined): ConsentStatus {
    const current = policy?.version || 0;
    if (!rec) return this.emptyStatus(current);
    const base = {
      at: rec.createdAt,
      by: rec.guardianName || rec.recordedByName || '',
      method: rec.method,
      version: rec.policyVersion,
      currentVersion: current,
    };
    if (!rec.granted) return { ...base, status: 'denied', outdated: false };
    if (policy && rec.policyVersion < policy.baseVersion) {
      return { ...base, status: 'pending', outdated: true };
    }
    return { ...base, status: 'granted', outdated: false };
  }

  /** Estado vigente de varios niños en dos consultas. */
  async statusForChildren(childIds: string[]): Promise<Map<string, ChildConsentSummary>> {
    const out = new Map<string, ChildConsentSummary>();
    const ids = [...new Set((childIds || []).filter(Boolean))];
    if (!ids.length) return out;
    const [policies, latest] = await Promise.all([
      this.activePolicies(),
      this.records
        .createQueryBuilder('c')
        .distinctOn(['c.childId', 'c.type'])
        .where('c.childId IN (:...ids)', { ids })
        .orderBy('c.childId')
        .addOrderBy('c.type')
        .addOrderBy('c.createdAt', 'DESC')
        .getMany(),
    ]);
    const byKey = new Map(latest.map((r) => [`${r.childId}:${r.type}`, r]));
    for (const id of ids) {
      const summary = {} as ChildConsentSummary;
      for (const t of CONSENT_TYPES) summary[t] = this.statusOf(byKey.get(`${id}:${t}`), policies.get(t));
      out.set(id, summary);
    }
    return out;
  }

  async statusForChild(childId: string): Promise<ChildConsentSummary> {
    return (await this.statusForChildren([childId])).get(childId)!;
  }

  /** Versión compacta para badges en listados: { images: 'granted', … }. */
  static compact(s: ChildConsentSummary | undefined) {
    if (!s) return null;
    return {
      data_processing: s.data_processing.status,
      images: s.images.status,
      whatsapp: s.whatsapp.status,
    };
  }

  async canUseImage(childId: string): Promise<boolean> {
    return (await this.statusForChild(childId)).images.status === 'granted';
  }

  /** Pendiente se permite durante la transición; sólo una negativa explícita bloquea. */
  async canWhatsapp(childId: string): Promise<boolean> {
    return (await this.statusForChild(childId)).whatsapp.status !== 'denied';
  }

  /** 403 si no hay autorización de imagen vigente para ese niño. */
  async assertImageConsent(childId: string): Promise<void> {
    if (await this.canUseImage(childId)) return;
    const child = await this.children.findOne({ where: { id: childId }, select: ['id', 'firstName', 'lastName'] });
    const name = child ? `${child.firstName} ${child.lastName}`.trim() : 'este niño';
    throw new ForbiddenException(`Sin consentimiento de imagen de ${name}`);
  }

  /** Niños activos de una sala sin autorización de imagen (aviso para fotos grupales). */
  async classroomPhotoCheck(classroomId: string) {
    const kids = await this.children.find({
      where: { classroomId, active: true },
      select: ['id', 'firstName', 'lastName', 'photoUrl'],
      order: { firstName: 'ASC' },
    });
    const statuses = await this.statusForChildren(kids.map((k) => k.id));
    const withoutConsent = kids
      .map((k) => ({
        id: k.id,
        name: `${k.firstName} ${k.lastName}`.trim(),
        photoUrl: k.photoUrl,
        status: statuses.get(k.id)!.images.status,
      }))
      .filter((k) => k.status !== 'granted');
    return { classroomId, total: kids.length, withoutConsent };
  }

  // ------------------------------------------------------------------ escritura

  async record(input: RecordConsentInput, ctx: AuditContext) {
    if (!CONSENT_TYPES.includes(input.type)) throw new BadRequestException('Tipo de consentimiento inválido');
    const child = await this.children.findOne({ where: { id: input.childId }, select: ['id', 'firstName', 'lastName'] });
    if (!child) throw new NotFoundException('Niño no encontrado');
    const policy = (await this.activePolicies()).get(input.type);
    if (!policy) throw new BadRequestException('No hay un texto vigente para ese consentimiento');

    let guardianName = input.guardianName || '';
    if (input.guardianId) {
      const link = await this.links.findOne({
        where: { childId: input.childId, guardianId: input.guardianId },
        relations: ['guardian'],
      });
      if (!link) throw new BadRequestException('Ese representante no está enlazado con el niño');
      guardianName = link.guardian?.name || guardianName;
    }

    const before = await this.statusForChild(input.childId);
    const saved = await this.records.save(
      this.records.create({
        childId: input.childId,
        guardianId: input.guardianId || null,
        guardianName: guardianName.slice(0, 160),
        type: input.type,
        granted: input.granted,
        policyVersion: policy.version,
        method: input.method,
        recordedById: input.recordedById || null,
        recordedByName: (input.recordedByName || '').slice(0, 160),
        note: (input.note || '').slice(0, 1000),
        ip: (input.ip || '').slice(0, 64),
        userAgent: (input.userAgent || '').slice(0, 300),
      }),
    );
    const childName = `${child.firstName} ${child.lastName}`.trim();
    const verb = input.granted ? 'autorizó' : 'no autorizó';
    await this.audit.record(ctx, {
      entity: 'consent',
      entityId: input.childId,
      action: 'create',
      summary:
        input.method === 'presencial'
          ? `Registró consentimiento presencial: ${guardianName || 'representante'} ${verb} "${CONSENT_LABEL[input.type]}" de ${childName} (v${policy.version})`
          : `${guardianName || 'Representante'} ${verb} "${CONSENT_LABEL[input.type]}" de ${childName} desde el portal (v${policy.version})`,
      before: { status: before[input.type].status, version: before[input.type].version },
      after: { status: input.granted ? 'granted' : 'denied', version: policy.version, method: input.method, recordId: saved.id },
    });
    return { record: saved, consents: await this.statusForChild(input.childId) };
  }

  // ------------------------------------------------------------------ lecturas

  async history(childId: string) {
    return this.records.find({ where: { childId }, order: { createdAt: 'DESC' }, take: 500 });
  }

  async guardiansOf(childId: string) {
    const links = await this.links.find({ where: { childId }, relations: ['guardian'] });
    return links
      .filter((l) => l.guardian)
      .map((l) => ({ guardianId: l.guardianId, name: l.guardian.name, relationship: l.relationship, isPrimary: l.isPrimary }));
  }

  /** Niños (con estado) de un conjunto de salas; `undefined` = todas. */
  async childrenWithStatus(opts: { classroomIds?: string[]; includeInactive?: boolean }) {
    if (opts.classroomIds && !opts.classroomIds.length) return [];
    const qb = this.children
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.classroom', 'room')
      .orderBy('c.firstName', 'ASC')
      .addOrderBy('c.lastName', 'ASC');
    if (!opts.includeInactive) qb.andWhere('c.active = true');
    if (opts.classroomIds) qb.andWhere('c.classroomId IN (:...rids)', { rids: opts.classroomIds });
    const kids = await qb.getMany();
    const statuses = await this.statusForChildren(kids.map((k) => k.id));
    return kids.map((k) => ({
      id: k.id,
      name: `${k.firstName} ${k.lastName}`.trim(),
      photoUrl: k.photoUrl,
      classroomId: k.classroomId,
      classroomName: k.classroom?.name || '',
      active: k.active,
      consents: statuses.get(k.id)!,
    }));
  }

  /** Resumen para coordinación: conteos por tipo y lista de pendientes / negados. */
  async summary(classroomIds?: string[]) {
    const rows = await this.childrenWithStatus({ classroomIds });
    const byType = {} as Record<ConsentType, { granted: number; denied: number; pending: number; outdated: number }>;
    for (const t of CONSENT_TYPES) byType[t] = { granted: 0, denied: 0, pending: 0, outdated: 0 };
    const pending: Array<{ childId: string; name: string; classroomName: string; types: ConsentType[] }> = [];
    const denied: Array<{ childId: string; name: string; classroomName: string; types: ConsentType[] }> = [];
    for (const r of rows) {
      const p: ConsentType[] = [];
      const d: ConsentType[] = [];
      for (const t of CONSENT_TYPES) {
        const s = r.consents[t];
        byType[t][s.status]++;
        if (s.outdated) byType[t].outdated++;
        if (s.status === 'pending') p.push(t);
        if (s.status === 'denied') d.push(t);
      }
      if (p.length) pending.push({ childId: r.id, name: r.name, classroomName: r.classroomName, types: p });
      if (d.length) denied.push({ childId: r.id, name: r.name, classroomName: r.classroomName, types: d });
    }
    return { totalChildren: rows.length, byType, pending, denied };
  }

  /** Vista del portal familiar: sus niños, textos vigentes y lo que falta decidir. */
  async forGuardian(guardianId: string) {
    const links = await this.links.find({ where: { guardianId } });
    const ids = links.map((l) => l.childId);
    const kids = ids.length
      ? await this.children.find({ where: { id: In(ids), active: true }, relations: ['classroom'], order: { firstName: 'ASC' } })
      : [];
    const [statuses, policies, center] = await Promise.all([
      this.statusForChildren(kids.map((k) => k.id)),
      this.currentPolicies(),
      this.centerName(),
    ]);
    const children = kids.map((k) => ({
      id: k.id,
      name: `${k.firstName} ${k.lastName}`.trim(),
      firstName: k.firstName,
      photoUrl: k.photoUrl,
      classroomName: k.classroom?.name || '',
      consents: statuses.get(k.id)!,
    }));
    const pending = children.flatMap((c) =>
      CONSENT_TYPES.filter((t) => policies[t] && c.consents[t].status === 'pending').map((type) => ({
        childId: c.id,
        type,
        outdated: c.consents[type].outdated,
      })),
    );
    return { centerName: center, children, policies, pending, hasPending: pending.length > 0 };
  }

  async pendingForGuardian(guardianId: string) {
    return (await this.forGuardian(guardianId)).pending;
  }

  /** Historial de decisiones de los niños del representante. */
  async historyForGuardian(guardianId: string) {
    const links = await this.links.find({ where: { guardianId } });
    const ids = links.map((l) => l.childId);
    if (!ids.length) return [];
    const rows = await this.records.find({ where: { childId: In(ids) }, order: { createdAt: 'DESC' }, take: 300 });
    // La familia no necesita ver IP/navegador ni ids del personal.
    return rows.map((r) => ({
      id: r.id,
      childId: r.childId,
      type: r.type,
      granted: r.granted,
      policyVersion: r.policyVersion,
      method: r.method,
      by: r.guardianName || r.recordedByName || '',
      createdAt: r.createdAt,
    }));
  }
}
