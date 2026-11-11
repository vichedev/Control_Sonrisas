import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, Not, Repository, SelectQueryBuilder } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';
import { Child, ChildGender } from './child.entity';
import { ChildGuardian } from './child-guardian.entity';
import { Classroom } from '../classrooms/classroom.entity';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { UploadsService } from '../uploads/uploads.service';
import { generateTempPassword } from '../common/password.validator';
import { ageFromBirthDate } from '../common/day.util';
import {
  CreateChildDto,
  GuardianInputDto,
  UpdateChildDto,
  UpdateGuardianDto,
  UpdateGuardianLinkDto,
} from './dto/child.dto';

/** Letras con tilde → sin tilde (búsqueda sin depender de la extensión `unaccent`). */
const ACCENTS_FROM = 'áàäâéèëêíìïîóòöôúùüûñç';
const ACCENTS_TO = 'aaaaeeeeiiiioooouuuunc';

/** Minúsculas y sin tildes, igual que `TRANSLATE(LOWER(...))` en SQL. */
function foldSearch(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[%_\\]/g, '').trim();
}

/** Dominio de los correos internos de representantes sin email (ver `placeholderEmail`). */
const PLACEHOLDER_DOMAIN = '@sincorreo.invalid';

/** true si el correo es uno interno generado (no sirve para iniciar sesión). */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  const e = (email || '').toLowerCase();
  return !e || e.endsWith('.invalid');
}

/** Fila del directorio de representantes (página "Representantes" del panel). */
export interface GuardianDirectoryRow {
  id: string;
  name: string;
  /** null si es un correo interno generado. */
  email: string | null;
  phone: string;
  documentId: string | null;
  active: boolean;
  lastLoginAt: Date | null;
  /** Puede entrar al portal: cuenta activa con correo real (el login es por correo). */
  hasPortalAccess: boolean;
  /** 'active' = ya entró alguna vez · 'pending' = puede entrar pero nunca lo hizo · 'none' = sin acceso. */
  accessStatus: 'active' | 'pending' | 'none';
  children: Array<{
    id: string;
    name: string;
    classroomName: string;
    relationship: string;
    canPickup: boolean;
    receivesReport: boolean;
  }>;
}

/** Vista de un representante tal como se devuelve dentro de la ficha del niño. */
export interface GuardianView {
  linkId: string;
  guardianId: string;
  name: string;
  email: string;
  phone: string;
  documentId: string | null;
  relationship: string;
  isPrimary: boolean;
  canPickup: boolean;
  receivesReport: boolean;
  hasAccount: boolean;
  active: boolean;
}

@Injectable()
export class ChildrenService {
  constructor(
    @InjectRepository(Child) private readonly repo: Repository<Child>,
    @InjectRepository(ChildGuardian) private readonly linksRepo: Repository<ChildGuardian>,
    @InjectRepository(Classroom) private readonly classroomsRepo: Repository<Classroom>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly usersService: UsersService,
    private readonly uploads: UploadsService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------- lecturas

  /** Añade nombre completo, edad y sala al registro plano de la BD. */
  private decorate(child: Child, classroom?: Classroom | null) {
    const age = ageFromBirthDate(child.birthDate);
    return {
      ...child,
      fullName: `${child.firstName} ${child.lastName}`.trim(),
      age: age.label,
      ageMonths: age.months,
      classroomName: classroom?.name || '',
      classroomColor: classroom?.color || '',
    };
  }

  /** `classroomIds`: alcance por sala (educadora). `undefined` = sin filtro; [] = ninguno. */
  async findAll(
    opts: { includeInactive?: boolean; classroomId?: string; classroomIds?: string[]; search?: string } = {},
  ) {
    if (opts.classroomIds && !opts.classroomIds.length) return [];
    const qb = this.repo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.classroom', 'room')
      .orderBy('c.firstName', 'ASC')
      .addOrderBy('c.lastName', 'ASC');

    if (!opts.includeInactive) qb.andWhere('c.active = true');
    if (opts.classroomId) qb.andWhere('c.classroomId = :cid', { cid: opts.classroomId });
    if (opts.classroomIds) qb.andWhere('c.classroomId IN (:...rids)', { rids: opts.classroomIds });
    this.applySearch(qb, opts.search);
    const rows = await qb.getMany();
    return rows.map((c) => this.decorate(c, c.classroom));
  }

  /**
   * Búsqueda por nombre, apellido, nombre completo (en ambos órdenes), matrícula o cédula.
   * Sin tildes ni mayúsculas (`translate` en vez de la extensión `unaccent`).
   * Cada palabra debe aparecer: "sofia mor" encuentra "Sofía Morales".
   */
  private applySearch(qb: SelectQueryBuilder<Child>, search?: string) {
    const words = foldSearch(search || '').split(/\s+/).filter(Boolean).slice(0, 6);
    if (!words.length) return;
    const fold = (expr: string) => `TRANSLATE(LOWER(${expr}), '${ACCENTS_FROM}', '${ACCENTS_TO}')`;
    const hay = fold(`c.firstName || ' ' || c.lastName || ' ' || c.firstName`);
    words.forEach((w, i) => {
      const doc = w.replace(/[\s-]+/g, '').toUpperCase();
      qb.andWhere(
        new Brackets((b) => {
          b.where(`${hay} LIKE :w${i}`, { [`w${i}`]: `%${w}%` })
            .orWhere(`LOWER(COALESCE(c.code, '')) LIKE :w${i}`)
            .orWhere(`COALESCE(c.documentId, '') LIKE :d${i}`, { [`d${i}`]: `%${doc}%` });
        }),
      );
    });
  }

  /**
   * Igual que `findAll` pero paginado en el servidor: `{ items, total, page, pageSize }`.
   * Sólo se usa cuando el cliente manda `page` (compatibilidad: sin `page` → lista completa).
   */
  async findPage(
    opts: { includeInactive?: boolean; classroomIds?: string[]; search?: string },
    page: number,
    pageSize: number,
  ) {
    const p = Math.max(1, Math.floor(page) || 1);
    const size = Math.min(200, Math.max(1, Math.floor(pageSize) || 25));
    if (opts.classroomIds && !opts.classroomIds.length) {
      return { items: [], total: 0, page: p, pageSize: size };
    }
    const qb = this.repo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.classroom', 'room')
      .orderBy('c.firstName', 'ASC')
      .addOrderBy('c.lastName', 'ASC')
      .addOrderBy('c.id', 'ASC');
    if (!opts.includeInactive) qb.andWhere('c.active = true');
    if (opts.classroomIds) qb.andWhere('c.classroomId IN (:...rids)', { rids: opts.classroomIds });
    this.applySearch(qb, opts.search);
    const [rows, total] = await qb.skip((p - 1) * size).take(size).getManyAndCount();
    return { items: rows.map((c) => this.decorate(c, c.classroom)), total, page: p, pageSize: size };
  }

  async findOne(id: string) {
    const child = await this.repo.findOne({ where: { id }, relations: ['classroom'] });
    if (!child) throw new NotFoundException('Niño no encontrado');
    return this.decorate(child, child.classroom);
  }

  /** Entidad cruda, sin decorar. Uso interno de otros servicios. */
  async findEntityOrThrow(id: string): Promise<Child> {
    const child = await this.repo.findOne({ where: { id } });
    if (!child) throw new NotFoundException('Niño no encontrado');
    return child;
  }

  /** Ficha completa: datos + representantes. */
  async findOneWithGuardians(id: string) {
    const child = await this.findOne(id);
    return { ...child, guardians: await this.listGuardians(id) };
  }

  async listGuardians(childId: string): Promise<GuardianView[]> {
    const links = await this.linksRepo.find({
      where: { childId },
      relations: ['guardian'],
      order: { isPrimary: 'DESC', createdAt: 'ASC' },
    });
    return links
      .filter((l) => !!l.guardian)
      .map((l) => ({
        linkId: l.id,
        guardianId: l.guardianId,
        name: l.guardian.name,
        email: l.guardian.email,
        phone: l.guardian.phone,
        documentId: l.guardian.code,
        relationship: l.relationship,
        isPrimary: l.isPrimary,
        canPickup: l.canPickup,
        receivesReport: l.receivesReport,
        // Sin contraseña asignada la cuenta existe pero no sirve para entrar;
        // `mustChangePassword` marca justo ese estado de "creada, no activada".
        hasAccount: !l.guardian.mustChangePassword,
        active: l.guardian.active,
      }));
  }

  /** Ids de los niños a cargo de un representante. Base de todo el portal familiar. */
  async childIdsForGuardian(guardianId: string): Promise<string[]> {
    const links = await this.linksRepo.find({ where: { guardianId } });
    return links.map((l) => l.childId);
  }

  /** Lanza 403 si el representante no está enlazado con ese niño. */
  async assertGuardianOf(guardianId: string, childId: string): Promise<void> {
    const link = await this.linksRepo.findOne({ where: { guardianId, childId } });
    if (!link) throw new NotFoundException('Niño no encontrado');
  }

  /** Representantes que reciben el reporte diario de un niño, con teléfono válido. */
  async reportRecipients(childId: string) {
    const links = await this.linksRepo.find({
      where: { childId, receivesReport: true },
      relations: ['guardian'],
    });
    return links
      .filter((l) => l.guardian?.active && !!l.guardian.phone)
      .map((l) => ({
        guardianId: l.guardianId,
        name: l.guardian.name,
        phone: l.guardian.phone,
        relationship: l.relationship,
      }));
  }

  // ------------------------------------------------------------- escrituras

  private async assertCodeFree(code: string | null | undefined, exceptId?: string) {
    if (!code) return;
    const dup = await this.repo.findOne({
      where: exceptId ? { code, id: Not(exceptId) } : { code },
    });
    if (dup) throw new ConflictException('Ya existe un niño con esa matrícula');
  }

  /** 409 si otro niño ya tiene esa cédula/pasaporte. */
  private async assertDocumentFree(documentId: string | null | undefined, exceptId?: string) {
    if (!documentId) return;
    const dup = await this.repo.findOne({
      where: exceptId ? { documentId, id: Not(exceptId) } : { documentId },
      select: ['id'],
    });
    if (dup) throw new ConflictException('Ya existe un niño con esa cédula');
  }

  private async assertClassroomExists(classroomId?: string | null) {
    if (!classroomId) return;
    const room = await this.classroomsRepo.findOne({ where: { id: classroomId } });
    if (!room) throw new BadRequestException('La sala indicada no existe');
  }

  async create(dto: CreateChildDto) {
    await this.assertCodeFree(dto.code);
    await this.assertDocumentFree(dto.documentId);
    await this.assertClassroomExists(dto.classroomId);

    const photoUrl = dto.photo ? this.uploads.saveDataUrl(dto.photo, 'nino') : '';
    const child = this.repo.create({
      code: dto.code || null,
      documentId: dto.documentId || null,
      firstName: dto.firstName,
      lastName: dto.lastName,
      birthDate: dto.birthDate.slice(0, 10),
      gender: (dto.gender as ChildGender) || 'other',
      photoUrl,
      classroomId: dto.classroomId || null,
      allergies: dto.allergies || '',
      medicalConditions: dto.medicalConditions || '',
      medications: dto.medications || '',
      bloodType: dto.bloodType || '',
      pediatricianName: dto.pediatricianName || '',
      pediatricianPhone: dto.pediatricianPhone || '',
      insurance: dto.insurance || '',
      emergencyContactName: dto.emergencyContactName || '',
      emergencyContactPhone: dto.emergencyContactPhone || '',
      dietaryNotes: dto.dietaryNotes || '',
      napNotes: dto.napNotes || '',
      authorizedPickupNotes: dto.authorizedPickupNotes || '',
      internalNotes: dto.internalNotes || '',
      enrolledAt: dto.enrolledAt ? dto.enrolledAt.slice(0, 10) : null,
      active: dto.active ?? true,
    });
    /** Credenciales generadas para los representantes nuevos, a entregar en mano. */
    const credentials: Array<{ name: string; email: string; tempPassword: string }> = [];
    /** Representantes reutilizados que ya tenían cuenta (no se les genera clave nueva). */
    const existingAccounts: Array<{ guardianId: string; name: string }> = [];

    // Niño + representantes en una sola transacción: si falla un enlace no queda
    // un niño a medias ni cuentas de representante huérfanas.
    const saved = await this.dataSource.transaction(async (m) => {
      const row = await m.getRepository(Child).save(child);
      for (const g of dto.guardians || []) {
        const res = await this.linkGuardian(row.id, g, m);
        if (res.tempPassword) {
          credentials.push({ name: res.guardian.name, email: res.guardian.email, tempPassword: res.tempPassword });
        }
        if (res.existingAccount) existingAccounts.push({ guardianId: res.guardian.id, name: res.guardian.name });
      }
      return row;
    });

    return { ...(await this.findOneWithGuardians(saved.id)), credentials, existingAccounts };
  }

  async update(id: string, dto: UpdateChildDto) {
    const child = await this.findEntityOrThrow(id);
    if (dto.code !== undefined && dto.code !== child.code) {
      await this.assertCodeFree(dto.code, id);
      child.code = dto.code || null;
    }
    if (dto.documentId !== undefined && (dto.documentId || null) !== child.documentId) {
      await this.assertDocumentFree(dto.documentId, id);
      child.documentId = dto.documentId || null;
    }
    if (dto.classroomId !== undefined) {
      await this.assertClassroomExists(dto.classroomId);
      child.classroomId = dto.classroomId || null;
    }
    if (dto.photo) child.photoUrl = this.uploads.saveDataUrl(dto.photo, 'nino');
    if (dto.firstName !== undefined) child.firstName = dto.firstName;
    if (dto.lastName !== undefined) child.lastName = dto.lastName;
    if (dto.birthDate !== undefined) child.birthDate = dto.birthDate.slice(0, 10);
    if (dto.gender !== undefined) child.gender = dto.gender as ChildGender;
    if (dto.allergies !== undefined) child.allergies = dto.allergies;
    if (dto.medicalConditions !== undefined) child.medicalConditions = dto.medicalConditions;
    if (dto.medications !== undefined) child.medications = dto.medications;
    if (dto.bloodType !== undefined) child.bloodType = dto.bloodType;
    if (dto.pediatricianName !== undefined) child.pediatricianName = dto.pediatricianName;
    if (dto.pediatricianPhone !== undefined) child.pediatricianPhone = dto.pediatricianPhone;
    if (dto.insurance !== undefined) child.insurance = dto.insurance;
    if (dto.emergencyContactName !== undefined) child.emergencyContactName = dto.emergencyContactName;
    if (dto.emergencyContactPhone !== undefined) child.emergencyContactPhone = dto.emergencyContactPhone;
    if (dto.dietaryNotes !== undefined) child.dietaryNotes = dto.dietaryNotes;
    if (dto.napNotes !== undefined) child.napNotes = dto.napNotes;
    if (dto.authorizedPickupNotes !== undefined) child.authorizedPickupNotes = dto.authorizedPickupNotes;
    if (dto.internalNotes !== undefined) child.internalNotes = (dto.internalNotes || '').slice(0, 4000);
    if (dto.enrolledAt !== undefined) child.enrolledAt = dto.enrolledAt ? dto.enrolledAt.slice(0, 10) : null;
    if (dto.active !== undefined) child.active = dto.active;

    await this.repo.save(child);
    return this.findOneWithGuardians(id);
  }

  /**
   * Qué se perdería al eliminar la ficha (para el aviso de la UI antes de confirmar).
   * Todo esto se borra en cascada junto con el niño.
   */
  async deletionPreview(id: string) {
    const child = await this.findOne(id);
    const q = (sql: string) =>
      this.dataSource.query(sql, [id]).then((r: Array<{ n: string }>) => Number(r[0]?.n || 0));
    const [attendanceDays, meals, dailyLogs, reports, photos, consents, justifications, guardians] =
      await Promise.all([
        q('SELECT COUNT(*) AS n FROM child_attendances WHERE "childId" = $1'),
        q('SELECT COUNT(*) AS n FROM meals WHERE "childId" = $1'),
        q('SELECT COUNT(*) AS n FROM daily_logs WHERE "childId" = $1'),
        q('SELECT COUNT(*) AS n FROM daily_reports WHERE "childId" = $1'),
        q('SELECT COUNT(*) AS n FROM photos WHERE "childId" = $1'),
        q('SELECT COUNT(*) AS n FROM child_consents WHERE "childId" = $1'),
        q('SELECT COUNT(*) AS n FROM justifications WHERE "childId" = $1'),
        q('SELECT COUNT(*) AS n FROM child_guardians WHERE "childId" = $1'),
      ]);
    return {
      id,
      fullName: child.fullName,
      active: child.active,
      counts: { attendanceDays, meals, dailyLogs, reports, photos, consents, justifications, guardians },
    };
  }

  /**
   * Elimina DEFINITIVAMENTE la ficha del niño y todo su historial (asistencia, comidas,
   * bitácora, reportes, consentimientos, avisos, participación en actividades y enlaces con
   * representantes, por ON DELETE CASCADE) y las fotos etiquetadas con él. Después borra del
   * disco los archivos que ya no usa ningún otro registro (las fotos de grupo se conservan).
   * Las cuentas de los representantes NO se borran (pueden tener hermanos).
   * La opción recomendada en la UI es "Dar de baja" (`active=false`), que no borra nada.
   */
  async remove(id: string) {
    const child = await this.findEntityOrThrow(id);
    const urls = await this.childFileUrls(id, child.photoUrl);
    await this.dataSource.transaction(async (m) => {
      // `photos` no tiene FK hacia el niño: se limpia a mano.
      await m.query('DELETE FROM photos WHERE "childId" = $1', [id]);
      await m.getRepository(Child).delete({ id });
    });
    const removedFiles = await this.deleteOrphanFiles(urls);
    return { ok: true as const, removedFiles };
  }

  /** URLs de archivos subidos ligados a registros de este niño. */
  private async childFileUrls(id: string, photoUrl: string): Promise<string[]> {
    const rows: Array<{ u: string }> = await this.dataSource.query(
      `SELECT "photoUrl" AS u FROM child_attendances WHERE "childId" = $1
       UNION SELECT "photoUrl" FROM meals WHERE "childId" = $1
       UNION SELECT "photoUrl" FROM daily_logs WHERE "childId" = $1
       UNION SELECT "attachmentUrl" FROM justifications WHERE "childId" = $1
       UNION SELECT url FROM photos WHERE "childId" = $1
       UNION SELECT jsonb_array_elements_text("photoUrls") FROM daily_reports WHERE "childId" = $1`,
      [id],
    );
    const all = [photoUrl, ...rows.map((r) => r.u)].filter((u) => !!u && u.includes('/uploads/'));
    return [...new Set(all)];
  }

  /** Borra del disco los archivos que ningún registro restante referencia. Nunca lanza. */
  private async deleteOrphanFiles(urls: string[]): Promise<number> {
    let removed = 0;
    const dir = path.resolve(process.cwd(), 'uploads');
    for (const url of urls) {
      try {
        const used: Array<{ n: string }> = await this.dataSource.query(
          `SELECT (SELECT COUNT(*) FROM children WHERE "photoUrl" = $1)
            + (SELECT COUNT(*) FROM child_attendances WHERE "photoUrl" = $1)
            + (SELECT COUNT(*) FROM meals WHERE "photoUrl" = $1)
            + (SELECT COUNT(*) FROM daily_logs WHERE "photoUrl" = $1)
            + (SELECT COUNT(*) FROM justifications WHERE "attachmentUrl" = $1)
            + (SELECT COUNT(*) FROM photos WHERE url = $1)
            + (SELECT COUNT(*) FROM activities WHERE "coverPhotoUrl" = $1)
            + (SELECT COUNT(*) FROM daily_reports WHERE "photoUrls" @> to_jsonb(ARRAY[$1::text])) AS n`,
          [url],
        );
        if (Number(used[0]?.n || 0) > 0) continue;
        const name = path.basename(url.split('?')[0].split('#')[0]);
        if (!name || name.includes('..')) continue;
        const full = path.join(dir, name);
        if (fs.existsSync(full)) {
          fs.unlinkSync(full);
          removed++;
        }
      } catch {
        // Un archivo que no se pudo borrar no debe impedir la eliminación.
      }
    }
    return removed;
  }

  // ---------------------------------------------------------- representantes

  /**
   * Enlaza un representante al niño. Si no existe la cuenta, la crea con rol `guardian`
   * y una contraseña temporal que se devuelve UNA vez para entregarla a la familia.
   *
   * Antes de crear busca uno existente (hermanos): por `guardianId`, por correo, por
   * documento y, si no trae ninguno de los dos, por nombre + teléfono.
   * `existingAccount`: se reutilizó un representante y se pidió `createAccount` → no se
   * genera clave; la UI sugiere "Restablecer acceso" si hace falta.
   *
   * `manager`: para participar en una transacción (alta del niño).
   */
  async linkGuardian(childId: string, dto: GuardianInputDto, manager?: EntityManager) {
    const m = manager ?? this.dataSource.manager;
    const users = m.getRepository(User);
    const links = m.getRepository(ChildGuardian);

    const child = await m.getRepository(Child).findOne({ where: { id: childId }, select: ['id'] });
    if (!child) throw new NotFoundException('Niño no encontrado');

    let guardian: User | null = null;
    let tempPassword: string | null = null;
    let matched = false;

    if (dto.guardianId) {
      guardian = await users.findOne({ where: { id: dto.guardianId } });
      if (!guardian) throw new NotFoundException('Representante no encontrado');
      if (guardian.role !== 'guardian') {
        throw new BadRequestException('Ese usuario no es un representante');
      }
      matched = true;
    } else {
      if (!dto.name) throw new BadRequestException('Falta el nombre del representante');
      const email = dto.email ? dto.email.toLowerCase().trim() : '';

      if (email) {
        const byEmail = await users.findOne({ where: { email } });
        if (byEmail && byEmail.role !== 'guardian') {
          throw new ConflictException('Ese correo ya pertenece a una cuenta del personal');
        }
        guardian = byEmail;
      }
      if (!guardian && dto.documentId) {
        const byCode = await users.findOne({ where: { code: dto.documentId } });
        if (byCode && byCode.role !== 'guardian') {
          throw new ConflictException('Ese documento ya pertenece a una cuenta del personal');
        }
        guardian = byCode;
      }
      if (!guardian && !email && !dto.documentId && dto.phone) {
        // Sin correo ni documento: mismo nombre + mismo teléfono = misma persona.
        guardian = await users
          .createQueryBuilder('u')
          .where("u.role = 'guardian'")
          .andWhere('LOWER(u.name) = :n', { n: dto.name.toLowerCase() })
          .andWhere('u.phone = :p', { p: dto.phone })
          .getOne();
      }

      if (guardian) {
        matched = true;
        // Tenía correo interno (nunca pudo entrar) y ahora traen uno real y libre.
        if (email && isPlaceholderEmail(guardian.email)) {
          guardian.email = email;
          guardian = await users.save(guardian);
          if (dto.createAccount) {
            tempPassword = generateTempPassword();
            await users.update(guardian.id, {
              password: await bcrypt.hash(tempPassword, 12),
              mustChangePassword: true,
              tokenVersion: (guardian.tokenVersion || 0) + 1,
            });
          }
        }
      } else {
        tempPassword = generateTempPassword();
        guardian = await this.createGuardianUser(m, {
          // Sin correo no hay cuenta posible; se genera uno interno no enrutable para
          // poder guardar el contacto igualmente (abuelas sin email es lo habitual).
          email: email || this.placeholderEmail(dto.name, dto.documentId),
          password: tempPassword,
          name: dto.name,
          code: dto.documentId || null,
          phone: dto.phone || '',
        });
        if (!dto.createAccount) tempPassword = null;
      }
    }

    const already = await links.findOne({ where: { childId, guardianId: guardian.id } });
    if (already) {
      throw new ConflictException('Ese representante ya está enlazado con el niño');
    }

    const link = links.create({
      childId,
      guardianId: guardian.id,
      relationship: dto.relationship || '',
      isPrimary: dto.isPrimary ?? false,
      canPickup: dto.canPickup ?? true,
      receivesReport: dto.receivesReport ?? true,
    });
    await links.save(link);

    // Sólo un contacto principal por niño.
    if (link.isPrimary) {
      await links.update({ childId, id: Not(link.id) }, { isPrimary: false });
    }

    const existingAccount = matched && !!dto.createAccount && !tempPassword;
    return { link, guardian, tempPassword, existingAccount };
  }

  /**
   * Crea la cuenta `guardian` dentro del `manager` dado (transacción). Mismas reglas que
   * `UsersService.create`: correo y documento únicos, hash bcrypt.
   */
  private async createGuardianUser(
    m: EntityManager,
    data: { email: string; password: string; name: string; code: string | null; phone: string },
  ): Promise<User> {
    const users = m.getRepository(User);
    const email = data.email.toLowerCase().trim();
    if (await users.findOne({ where: { email } })) {
      throw new ConflictException('Ya existe un usuario con ese correo');
    }
    if (data.code && (await users.findOne({ where: { code: data.code } }))) {
      throw new ConflictException('Ya existe una persona con ese documento');
    }
    const user = users.create({
      email,
      password: await bcrypt.hash(data.password, 12),
      name: data.name.trim(),
      role: 'guardian',
      code: data.code || null,
      phone: data.phone || '',
      active: true,
      // Sin `createAccount` la clave se descarta: queda como contacto, sin acceso real.
      mustChangePassword: true,
    });
    return users.save(user);
  }

  /** Sólo un representante puede ser el contacto principal de un niño. */
  private async demoteOtherPrimaries(childId: string, keepLinkId: string) {
    await this.linksRepo.update(
      { childId, id: Not(keepLinkId) },
      { isPrimary: false },
    );
  }

  async updateGuardianLink(childId: string, linkId: string, dto: UpdateGuardianLinkDto) {
    const link = await this.linksRepo.findOne({ where: { id: linkId, childId } });
    if (!link) throw new NotFoundException('Enlace no encontrado');
    if (dto.relationship !== undefined) link.relationship = dto.relationship;
    if (dto.canPickup !== undefined) link.canPickup = dto.canPickup;
    if (dto.receivesReport !== undefined) link.receivesReport = dto.receivesReport;
    if (dto.isPrimary !== undefined) link.isPrimary = dto.isPrimary;
    await this.linksRepo.save(link);
    if (link.isPrimary) await this.demoteOtherPrimaries(childId, link.id);
    return this.listGuardians(childId);
  }

  async unlinkGuardian(childId: string, linkId: string) {
    const link = await this.linksRepo.findOne({ where: { id: linkId, childId } });
    if (!link) throw new NotFoundException('Enlace no encontrado');
    await this.linksRepo.remove(link);
    return { ok: true as const };
  }

  /** Devuelve una contraseña temporal nueva para que el representante entre al portal. */
  /**
   * Elimina la cuenta de un representante y todos sus enlaces con niños. Sus sesiones dejan
   * de valer al instante (el JWT exige que el usuario exista).
   * Si es el ÚNICO representante de algún niño activo responde 409 con `children` (lista de
   * afectados), salvo que se pida `force`.
   */
  async removeGuardian(guardianId: string, force = false) {
    const guardian = await this.usersRepo.findOne({ where: { id: guardianId } });
    if (!guardian) throw new NotFoundException('Representante no encontrado');
    if (guardian.role !== 'guardian') {
      throw new BadRequestException('Esa cuenta no es de un representante');
    }
    const links = await this.linksRepo.find({ where: { guardianId }, relations: ['child'] });
    const nameOf = (l: ChildGuardian) => (l.child ? `${l.child.firstName} ${l.child.lastName}`.trim() : '');
    const activeChildIds = links.filter((l) => l.child?.active).map((l) => l.childId);
    let onlyGuardianOf: Array<{ id: string; name: string }> = [];
    if (activeChildIds.length) {
      const others: Array<{ childId: string }> = await this.dataSource.query(
        `SELECT DISTINCT "childId" FROM child_guardians WHERE "childId" = ANY($1) AND "guardianId" <> $2`,
        [activeChildIds, guardianId],
      );
      const withOthers = new Set(others.map((o) => o.childId));
      onlyGuardianOf = links
        .filter((l) => l.child?.active && !withOthers.has(l.childId))
        .map((l) => ({ id: l.childId, name: nameOf(l) }));
    }
    if (onlyGuardianOf.length && !force) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'ONLY_GUARDIAN',
        message:
          onlyGuardianOf.length === 1
            ? `Es el único representante de ${onlyGuardianOf[0].name}`
            : `Es el único representante de ${onlyGuardianOf.length} niños`,
        children: onlyGuardianOf,
      });
    }
    const snapshot = {
      id: guardian.id,
      name: guardian.name,
      email: isPlaceholderEmail(guardian.email) ? null : guardian.email,
      phone: guardian.phone,
      documentId: guardian.code,
      children: links.map((l) => ({ id: l.childId, name: nameOf(l), relationship: l.relationship })),
    };
    // Enlaces explícitos; suscripciones push y demás caen por ON DELETE CASCADE.
    await this.dataSource.transaction(async (m) => {
      await m.getRepository(ChildGuardian).delete({ guardianId });
      await m.getRepository(User).delete({ id: guardianId });
    });
    return { ok: true as const, guardian: snapshot, childrenLeftWithoutGuardian: onlyGuardianOf };
  }

  async resetGuardianAccess(guardianId: string) {
    const guardian = await this.usersRepo.findOne({ where: { id: guardianId } });
    if (!guardian || guardian.role !== 'guardian') {
      throw new NotFoundException('Representante no encontrado');
    }
    const tempPassword = generateTempPassword();
    await this.usersService.resetPassword(guardianId, tempPassword);
    return { email: guardian.email, name: guardian.name, tempPassword };
  }

  /**
   * Directorio de representantes con sus niños. `q` busca por nombre, correo,
   * teléfono o documento. `ids` limita a esos representantes (uso interno).
   */
  async listAllGuardians(q?: string, ids?: string[]): Promise<GuardianDirectoryRow[]> {
    if (ids && !ids.length) return [];
    const qb = this.usersRepo
      .createQueryBuilder('u')
      .where("u.role = 'guardian'")
      .orderBy('u.name', 'ASC');
    if (ids) qb.andWhere('u.id IN (:...gids)', { gids: ids });
    const term = (q || '').trim().toLowerCase();
    if (term) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('LOWER(u.name) LIKE :q', { q: `%${term}%` })
            // Los correos internos no cuentan como correo para la búsqueda.
            .orWhere("(LOWER(u.email) LIKE :q AND u.email NOT LIKE '%.invalid')")
            .orWhere('u.phone LIKE :q')
            .orWhere("LOWER(COALESCE(u.code, '')) LIKE :q");
        }),
      );
    }
    const guardians = await qb.getMany();
    if (!guardians.length) return [];
    const links = await this.linksRepo
      .createQueryBuilder('l')
      .leftJoin('l.child', 'child')
      .addSelect(['child.id', 'child.firstName', 'child.lastName', 'child.classroomId'])
      .leftJoin('child.classroom', 'room')
      .addSelect(['room.id', 'room.name'])
      .where('l.guardianId IN (:...ids)', { ids: guardians.map((g) => g.id) })
      .getMany();
    return guardians.map((g) => this.toDirectoryRow(g, links.filter((l) => l.guardianId === g.id)));
  }

  /**
   * `hasPortalAccess` = activo + correo real: el login es por correo, así que con uno
   * interno (`.invalid`) no hay forma de entrar, y una cuenta inactiva tampoco entra.
   * No se usa `!mustChangePassword` porque tras un "Restablecer acceso" vuelve a true.
   */
  private toDirectoryRow(g: User, links: ChildGuardian[]): GuardianDirectoryRow {
    const realEmail = !isPlaceholderEmail(g.email);
    const hasPortalAccess = g.active && realEmail;
    return {
      id: g.id,
      name: g.name,
      email: realEmail ? g.email : null,
      phone: g.phone,
      documentId: g.code,
      active: g.active,
      lastLoginAt: g.lastLoginAt ?? null,
      hasPortalAccess,
      accessStatus: !hasPortalAccess ? 'none' : g.lastLoginAt ? 'active' : 'pending',
      children: links
        .filter((l) => !!l.child)
        .map((l) => ({
          id: l.childId,
          name: `${l.child.firstName} ${l.child.lastName}`.trim(),
          classroomName: l.child.classroom?.name || '',
          relationship: l.relationship,
          canPickup: l.canPickup,
          receivesReport: l.receivesReport,
        })),
    };
  }

  /**
   * Edita la cuenta de un representante (sólo rol `guardian`).
   * `email: ''` vuelve a un correo interno (le quita el acceso al portal).
   * Desactivar o cambiar el correo cierra sus sesiones abiertas (tokenVersion + 1).
   */
  async updateGuardian(guardianId: string, dto: UpdateGuardianDto) {
    const guardian = await this.usersRepo.findOne({ where: { id: guardianId } });
    if (!guardian || guardian.role !== 'guardian') {
      throw new NotFoundException('Representante no encontrado');
    }
    const before = this.toDirectoryRow(guardian, []);

    let email: string | undefined;
    if (dto.email !== undefined) {
      const next = dto.email
        ? dto.email.toLowerCase().trim()
        : isPlaceholderEmail(guardian.email)
          ? guardian.email
          : this.placeholderEmail(dto.name || guardian.name, guardian.code || undefined);
      if (next !== guardian.email) {
        const dup = await this.usersRepo.findOne({ where: { email: next, id: Not(guardianId) } });
        if (dup) throw new ConflictException('Ya existe un usuario con ese correo');
        email = next;
      }
    }

    // `UsersService.update` vuelve a validar el correo único.
    await this.usersService.update(guardianId, { name: dto.name, phone: dto.phone, email });
    // setActive sube tokenVersion al desactivar (cierra sus sesiones al instante).
    if (dto.active !== undefined) await this.usersService.setActive(guardianId, dto.active);
    if (email) await this.usersService.bumpTokenVersion(guardianId);

    const [after] = await this.listAllGuardians(undefined, [guardianId]);
    return { before, after };
  }

  /**
   * Correo interno para representantes sin email. No es enrutable a propósito:
   * el dominio `.invalid` está reservado por la RFC 2606 justamente para esto,
   * así nadie confunde el registro con una dirección real.
   */
  private placeholderEmail(name: string, documentId?: string): string {
    const slug = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.|\.$/g, '')
      .slice(0, 40);
    const suffix = documentId || Date.now().toString(36);
    return `${slug || 'representante'}.${suffix}@sinCorreo.invalid`.toLowerCase();
  }
}
