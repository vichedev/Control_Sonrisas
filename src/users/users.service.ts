import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { STAFF_ROLES, User, UserRole } from './user.entity';

interface CreateUserData {
  email: string;
  password: string;
  name: string;
  role?: UserRole;
  code?: string | null;
  position?: string;
  classroomId?: string | null;
  phone?: string;
  photoUrl?: string;
  active?: boolean;
  /** Si true, forzará al usuario a cambiar la contraseña en su primer login. */
  mustChangePassword?: boolean;
}

interface UpdateUserData {
  email?: string;
  password?: string; // se vuelve a hashear si viene
  name?: string;
  code?: string | null;
  position?: string;
  classroomId?: string | null;
  phone?: string;
  photoUrl?: string;
  active?: boolean;
  internalNotes?: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  /** Incluye el hash de la contraseña (`password` es `select: false`); necesario para el login. */
  findByEmail(email: string) {
    return this.usersRepo
      .createQueryBuilder('u')
      .addSelect('u.password')
      .where('u.email = :email', { email: email.toLowerCase().trim() })
      .getOne();
  }

  findById(id: string) {
    return this.usersRepo.findOne({ where: { id } });
  }

  // --- Personal de la guardería ---

  /** Educadoras, auxiliares, coordinación y dirección. Nunca representantes. */
  findStaff(includeInactive = true): Promise<User[]> {
    return this.usersRepo.find({
      where: includeInactive
        ? { role: In(STAFF_ROLES) }
        : { role: In(STAFF_ROLES), active: true },
      order: { name: 'ASC' },
    });
  }

  async findStaffOrThrow(id: string): Promise<User> {
    const u = await this.usersRepo.findOne({ where: { id } });
    if (!u || u.role === 'guardian') {
      throw new NotFoundException('Miembro del personal no encontrado');
    }
    return u;
  }

  /** Educadoras activas (para asignarlas a una sala). */
  findTeachers(): Promise<User[]> {
    return this.usersRepo.find({
      where: { role: 'teacher', active: true },
      order: { name: 'ASC' },
    });
  }

  // --- Creación / actualización ---

  async create(data: CreateUserData): Promise<User> {
    const email = data.email.toLowerCase().trim();
    const existing = await this.findByEmail(email);
    if (existing) throw new ConflictException('Ya existe un usuario con ese correo');
    if (data.code) {
      const byCode = await this.usersRepo.findOne({ where: { code: data.code } });
      if (byCode) throw new ConflictException('Ya existe una persona con ese documento');
    }
    const user = this.usersRepo.create({
      email,
      password: await bcrypt.hash(data.password, 12),
      name: data.name.trim(),
      // Por defecto `teacher`: el rol de personal con menos privilegios. Nunca 'admin':
      // una llamada que olvide pasar `role` no debe crear a alguien con acceso total.
      role: data.role || 'teacher',
      code: data.code || null,
      position: data.position || '',
      classroomId: data.classroomId || null,
      phone: data.phone || '',
      photoUrl: data.photoUrl || '',
      active: data.active ?? true,
      mustChangePassword: data.mustChangePassword ?? false,
    });
    const saved = await this.usersRepo.save(user);
    await this.syncRoomTeacher(saved);
    return saved;
  }

  /**
   * La sala de una educadora se puede asignar en Personal (`User.classroomId`) o en Salas
   * (`Classroom.teacherId`). Si la sala aún no tiene educadora, se completa con ésta para
   * que ambas pantallas muestren lo mismo.
   */
  private async syncRoomTeacher(user: User) {
    if (user.role !== 'teacher' || !user.classroomId) return;
    await this.usersRepo.manager.query(
      'UPDATE classrooms SET "teacherId" = $1 WHERE id = $2 AND "teacherId" IS NULL',
      [user.id, user.classroomId],
    );
  }

  /** Resetea la contraseña a una temporal y marca `mustChangePassword=true`. */
  async resetPassword(id: string, tempPassword: string) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    const hash = await bcrypt.hash(tempPassword, 12);
    // tokenVersion + 1 invalida cualquier sesión activa que tuviera ese usuario.
    await this.usersRepo.update(id, {
      password: hash,
      mustChangePassword: true,
      tokenVersion: (user.tokenVersion || 0) + 1,
    });
    return { ok: true };
  }

  /** Incrementa tokenVersion → invalida TODOS los JWTs emitidos para ese usuario. */
  async bumpTokenVersion(id: string) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    await this.usersRepo.update(id, { tokenVersion: (user.tokenVersion || 0) + 1 });
    return { ok: true };
  }

  /**
   * Activa o desactiva una cuenta (cualquier rol, incl. representantes).
   * Al desactivar sube tokenVersion: invalida JWTs y tokens de medios al instante.
   */
  async setActive(userId: string, active: boolean): Promise<User> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    const patch: Partial<User> = { active };
    if (!active && user.active) patch.tokenVersion = (user.tokenVersion || 0) + 1;
    // update() parcial: no toca password ni totpSecret (select: false).
    await this.usersRepo.update(userId, patch);
    return (await this.usersRepo.findOne({ where: { id: userId } }))!;
  }

  async update(id: string, data: UpdateUserData): Promise<User> {
    // Cargamos los campos `select: false` (password y totpSecret) para que un save()
    // sin modificarlos NO los pise con su valor por defecto. Si no lo hacemos, alguien
    // con 2FA activado perdería el secreto al editarse cualquier campo.
    const user = await this.usersRepo
      .createQueryBuilder('u')
      .addSelect('u.password')
      .addSelect('u.totpSecret')
      .where('u.id = :id', { id })
      .getOne();
    if (!user) throw new NotFoundException('Usuario no encontrado');

    if (data.email && data.email.toLowerCase().trim() !== user.email) {
      const email = data.email.toLowerCase().trim();
      const dup = await this.usersRepo.findOne({ where: { email, id: Not(id) } });
      if (dup) throw new ConflictException('Ya existe un usuario con ese correo');
      user.email = email;
    }
    if (data.code !== undefined && data.code !== user.code) {
      if (data.code) {
        const dup = await this.usersRepo.findOne({ where: { code: data.code, id: Not(id) } });
        if (dup) throw new ConflictException('Ya existe una persona con ese documento');
      }
      user.code = data.code || null;
    }
    if (data.password) {
      user.password = await bcrypt.hash(data.password, 12);
      // Cambio de password ⇒ invalidar sesiones (defensa en profundidad).
      user.tokenVersion = (user.tokenVersion || 0) + 1;
    }
    if (data.name !== undefined) user.name = data.name.trim();
    if (data.position !== undefined) user.position = data.position;
    if (data.classroomId !== undefined) user.classroomId = data.classroomId || null;
    if (data.phone !== undefined) user.phone = data.phone;
    if (data.photoUrl !== undefined) user.photoUrl = data.photoUrl;
    // Desactivar cuenta ⇒ invalidar tokens activos, para que no siga operando con un
    // JWT abierto. La JwtStrategy ya bloquea por active=false; esto es la segunda barrera.
    if (data.active !== undefined) {
      if (data.active === false && user.active === true) {
        user.tokenVersion = (user.tokenVersion || 0) + 1;
      }
      user.active = data.active;
    }
    if (data.internalNotes !== undefined) {
      user.internalNotes = (data.internalNotes || '').slice(0, 4000);
    }
    const saved = await this.usersRepo.save(user);
    await this.syncRoomTeacher(saved);
    return saved;
  }

  /** Guarda cambios sueltos de un usuario ya cargado (uso interno). */
  patch(user: User): Promise<User> {
    return this.usersRepo.save(user);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    await this.usersRepo.remove(user);
    return { ok: true };
  }

  async validatePassword(plain: string, hash: string) {
    return bcrypt.compare(plain, hash);
  }
}
