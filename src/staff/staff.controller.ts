import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { AdminGuard, StaffGuard } from '../auth/roles.guard';
import { UsersService } from '../users/users.service';
import { STAFF_ROLES, User, UserRole } from '../users/user.entity';
import { UploadsService } from '../uploads/uploads.service';
import { generateTempPassword, IsStrongPassword } from '../common/password.validator';
import { AuditService, auditCtx } from '../audit/audit.service';

const trim = ({ value }: { value: any }) =>
  typeof value === 'string' ? value.trim() : value;

const STAFF_ROLE_VALUES = ['admin', 'coordinator', 'teacher'];

class CreateStaffDto {
  @Transform(trim) @IsEmail()
  email: string;

  @IsString() @IsStrongPassword()
  password: string;

  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120)
  name: string;

  @IsIn(STAFF_ROLE_VALUES)
  role: UserRole;

  /** Cargo visible: "Educadora", "Auxiliar", "Coordinadora pedagógica"… */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80)
  position?: string;

  @IsOptional() @IsUUID()
  classroomId?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(30)
  phone?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(40)
  code?: string;

  /** Foto de perfil en data URL base64. */
  @IsOptional() @IsString()
  photo?: string;
}

class UpdateStaffDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120)
  name?: string;

  @IsOptional() @IsIn(STAFF_ROLE_VALUES)
  role?: UserRole;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(80)
  position?: string;

  @IsOptional() @IsUUID()
  classroomId?: string | null;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(30)
  phone?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(40)
  code?: string;

  @IsOptional() @IsString()
  photo?: string;

  @IsOptional() @IsBoolean()
  active?: boolean;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(4000)
  internalNotes?: string;
}

/**
 * Gestión de las cuentas del personal (dirección, coordinación y educadoras).
 *
 * Sustituye a los antiguos módulos `admins` y `workers`, que separaban artificialmente
 * dos listas de personas del mismo centro. Los representantes se gestionan desde la
 * ficha del niño (`/children/:id/guardians`), no aquí.
 */
@Controller('staff')
export class StaffController {
  constructor(
    private readonly users: UsersService,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly uploads: UploadsService,
    private readonly audit: AuditService,
  ) {}

  private view(u: User) {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      position: u.position,
      classroomId: u.classroomId,
      phone: u.phone,
      code: u.code,
      photoUrl: u.photoUrl,
      active: u.active,
      totpEnabled: u.totpEnabled,
      mustChangePassword: u.mustChangePassword,
      lastLoginAt: u.lastLoginAt,
      lockedUntil: u.lockedUntil,
      createdAt: u.createdAt,
    };
  }

  /**
   * Vista reducida para quien no es dirección: sin datos de seguridad
   * (bloqueos, 2FA, último acceso) ni notas internas. Coordinación ve además el correo.
   */
  private safeView(u: User, viewerRole?: UserRole) {
    const base: Record<string, any> = {
      id: u.id,
      name: u.name,
      role: u.role,
      position: u.position,
      classroomId: u.classroomId,
      phone: u.phone,
      photoUrl: u.photoUrl,
      active: u.active,
    };
    if (viewerRole === 'coordinator') base.email = u.email;
    return base;
  }

  /** Vista según el rol de quien consulta: dirección ve la ficha completa. */
  private viewFor(u: User, req: any) {
    return req?.user?.role === 'admin' ? this.view(u) : this.safeView(u, req?.user?.role);
  }

  /** Lectura: todo el personal (la educadora necesita saber quién está a cargo de qué sala). */
  @UseGuards(StaffGuard)
  @Get()
  async list(@Req() req: any, @Query('includeInactive') includeInactive?: string) {
    const list = await this.users.findStaff(includeInactive !== 'false');
    return list.map((u) => this.viewFor(u, req));
  }

  /** Educadoras activas, para el selector de sala. */
  @UseGuards(StaffGuard)
  @Get('teachers')
  async teachers(@Req() req: any) {
    const list = await this.users.findTeachers();
    return list.map((u) => this.viewFor(u, req));
  }

  @UseGuards(StaffGuard)
  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    const u = await this.users.findStaffOrThrow(id);
    // Las notas internas son sólo para dirección.
    if (req.user?.role !== 'admin') return this.safeView(u, req.user?.role);
    return { ...this.view(u), internalNotes: u.internalNotes };
  }

  @UseGuards(AdminGuard)
  @Post()
  async create(@Req() req: any, @Body() dto: CreateStaffDto) {
    const photoUrl = dto.photo ? this.uploads.saveDataUrl(dto.photo, 'personal') : '';
    const u = await this.users.create({
      email: dto.email,
      password: dto.password,
      name: dto.name,
      role: dto.role,
      position: dto.position,
      classroomId: dto.classroomId,
      phone: dto.phone,
      code: dto.code || null,
      photoUrl,
      active: true,
      mustChangePassword: true,
    });
    await this.audit.record(auditCtx(req), {
      entity: 'staff',
      entityId: u.id,
      action: 'create',
      summary: `Creó la cuenta de "${u.name}" (${u.role})`,
      after: { email: u.email, role: u.role },
    });
    return this.view(u);
  }

  @UseGuards(AdminGuard)
  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateStaffDto) {
    const target = await this.usersRepo.findOne({ where: { id } });
    if (!target) throw new BadRequestException('Cuenta no encontrada');
    if (target.role === 'guardian') {
      throw new BadRequestException('Esa cuenta es de un representante');
    }
    if (id === req.user.id && dto.role && dto.role !== 'admin') {
      throw new BadRequestException(
        'No puedes quitarte tu propio rol de dirección. Pide a otra persona con ese rol que lo haga.',
      );
    }
    if (id === req.user.id && dto.active === false) {
      throw new BadRequestException('No puedes desactivar tu propia cuenta.');
    }
    // Nunca dejar el sistema sin nadie que pueda administrarlo.
    const losesAdmin =
      target.role === 'admin' &&
      ((dto.role && dto.role !== 'admin') || dto.active === false);
    if (losesAdmin) {
      const remaining = await this.usersRepo.count({
        where: { role: 'admin', active: true, id: Not(id) },
      });
      if (remaining === 0) {
        throw new BadRequestException(
          'No puedes desactivar ni degradar a la única cuenta de dirección activa.',
        );
      }
    }

    const photoUrl = dto.photo ? this.uploads.saveDataUrl(dto.photo, 'personal') : undefined;
    const updated = await this.users.update(id, {
      name: dto.name,
      position: dto.position,
      classroomId: dto.classroomId,
      phone: dto.phone,
      code: dto.code,
      photoUrl,
      active: dto.active,
      internalNotes: dto.internalNotes,
    });
    // El rol no pasa por `users.update`: es un cambio de privilegios y se aplica aparte
    // para que quede explícito en el código y en la auditoría.
    if (dto.role && dto.role !== target.role) {
      await this.usersRepo.update(id, { role: dto.role });
    }

    await this.audit.record(auditCtx(req), {
      entity: 'staff',
      entityId: id,
      action: 'update',
      summary: `Editó la cuenta de "${updated.name}"`,
      before: { role: target.role, active: target.active },
      after: { role: dto.role || target.role, active: updated.active },
    });
    return this.view(await this.users.findStaffOrThrow(id));
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    if (id === req.user.id) throw new BadRequestException('No puedes eliminar tu propia cuenta.');
    const target = await this.usersRepo.findOne({ where: { id } });
    if (!target) throw new BadRequestException('Cuenta no encontrada');
    if (target.role === 'guardian') {
      throw new ForbiddenException('Los representantes se gestionan desde la ficha del niño');
    }
    if (target.role === 'admin') {
      const remaining = await this.usersRepo.count({
        where: { role: 'admin', active: true, id: Not(id) },
      });
      if (remaining === 0) {
        throw new BadRequestException('No puedes eliminar a la única cuenta de dirección activa.');
      }
    }
    const res = await this.users.remove(id);
    await this.audit.record(auditCtx(req), {
      entity: 'staff',
      entityId: id,
      action: 'delete',
      summary: `Eliminó la cuenta de "${target.name}"`,
      before: { email: target.email, role: target.role },
    });
    return res;
  }

  /** Contraseña temporal nueva, para entregar en mano. */
  @UseGuards(AdminGuard)
  @Post(':id/reset-password')
  async reset(@Req() req: any, @Param('id') id: string) {
    if (id === req.user.id) {
      throw new BadRequestException('Para cambiar tu propia contraseña usa Mi cuenta.');
    }
    const target = await this.usersRepo.findOne({ where: { id } });
    if (!target || target.role === 'guardian') {
      throw new BadRequestException('Cuenta no encontrada');
    }
    // generateTempPassword usa crypto.randomInt (CSPRNG): una credencial nunca debe
    // salir de Math.random().
    const tempPassword = generateTempPassword();
    await this.users.resetPassword(id, tempPassword);
    await this.audit.record(auditCtx(req), {
      entity: 'staff',
      entityId: id,
      action: 'security',
      summary: `Reseteó la contraseña de "${target.name}"`,
    });
    return { tempPassword };
  }

  /** Adelanta el fin del bloqueo por intentos fallidos (caduca solo a los 15 min). */
  @UseGuards(AdminGuard)
  @Post(':id/unlock')
  async unlock(@Param('id') id: string) {
    const target = await this.usersRepo.findOne({ where: { id } });
    if (!target) throw new BadRequestException('Cuenta no encontrada');
    await this.usersRepo.update(id, { failedLoginAttempts: 0, lockedUntil: null });
    return { ok: true };
  }

  /** Cuentas del personal bloqueadas ahora mismo (panel de seguridad). */
  @UseGuards(AdminGuard)
  @Get('security/locked')
  async locked() {
    const list = await this.usersRepo.find({ where: { role: In(STAFF_ROLES) } });
    const now = Date.now();
    return list
      .filter((u) => u.lockedUntil && new Date(u.lockedUntil).getTime() > now)
      .map((u) => this.view(u));
  }
}
