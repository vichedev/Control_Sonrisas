import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { LoginDto } from './dto/login.dto';
import { TwoFactorService } from './two-factor.service';
import { TotpLoginDto } from './dto/two-factor.dto';
import { ChangePasswordDto, UpdateProfileDto } from './dto/profile.dto';
import { UploadsService } from '../uploads/uploads.service';
import { MediaAccessService } from '../uploads/media-access.service';
import { AuditContext, AuditService } from '../audit/audit.service';

// Hash dummy para defender contra timing attacks (cuando el usuario no existe)
const DUMMY_HASH =
  '$2b$10$abcdefghijklmnopqrstuuQwfPiTLXocxjzKAa1MmwlxLDpFWIjUe';

/** Intentos fallidos consecutivos antes de bloquear la cuenta. */
const MAX_FAILED_ATTEMPTS = 5;
/** Duración del bloqueo (minutos) al alcanzar MAX_FAILED_ATTEMPTS. */
const LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly twoFactor: TwoFactorService,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly uploads: UploadsService,
    private readonly audit: AuditService,
    private readonly mediaAccess: MediaAccessService,
  ) {}

  async login(dto: LoginDto, ctx: AuditContext = {}) {
    const user = await this.usersService.findByEmail(dto.email);

    // Cuenta bloqueada por intentos fallidos: no seguimos ni aunque acierte.
    if (user?.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const mins = Math.max(
        1,
        Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 60000),
      );
      await this.auditAuth(ctx, user, 'login_blocked', `Login rechazado: cuenta bloqueada (${mins} min restantes)`);
      throw new ForbiddenException(
        `Cuenta bloqueada temporalmente por intentos fallidos. Reinténtalo en ${mins} min o pide al administrador que la desbloquee.`,
      );
    }

    const hashToCompare = user?.password || DUMMY_HASH;
    const valid = await bcrypt.compare(dto.password, hashToCompare);

    if (!user || !valid) {
      if (user) await this.registerFailedAttempt(user, ctx);
      else {
        await this.auditAuth(ctx, null, 'login_failed', `Login fallido para un correo inexistente: ${dto.email}`);
      }
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (!user.active) {
      await this.auditAuth(ctx, user, 'login_blocked', 'Login rechazado: cuenta desactivada');
      throw new ForbiddenException('Cuenta desactivada. Contacta al administrador.');
    }

    // Credenciales correctas → limpiamos el contador de fallos.
    await this.clearFailedAttempts(user);

    // Cuenta con 2FA → devolvemos un token TEMPORAL en lugar del access token.
    // El frontend pide el código de 6 dígitos y llama a /auth/2fa/login.
    if (user.totpEnabled) {
      const tempToken = this.jwtService.sign(
        { sub: user.id, type: 'pre-2fa' },
        { expiresIn: '5m' },
      );
      await this.auditAuth(ctx, user, 'login', 'Contraseña correcta, pendiente del segundo factor (2FA)');
      return { requires2FA: true, tempToken };
    }
    await this.auditAuth(ctx, user, 'login', 'Inicio de sesión correcto');
    return this.buildTokenResponse(user);
  }

  async loginWith2FA(dto: TotpLoginDto, ctx: AuditContext = {}) {
    let payload: any;
    try {
      payload = this.jwtService.verify(dto.tempToken);
    } catch {
      throw new UnauthorizedException('Sesión 2FA expirada. Vuelve a iniciar sesión.');
    }
    if (payload?.type !== 'pre-2fa' || !payload?.sub) {
      throw new UnauthorizedException('Token 2FA inválido');
    }
    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.active) throw new UnauthorizedException('Usuario no disponible');
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      throw new ForbiddenException('Cuenta bloqueada temporalmente por intentos fallidos.');
    }
    const ok = await this.twoFactor.verifyCode(user.id, dto.code);
    if (!ok) {
      // Un código TOTP fallido también cuenta: si no, el 2FA sería fuerza-brutable.
      await this.registerFailedAttempt(user, ctx, 'Código 2FA incorrecto');
      throw new UnauthorizedException('Código incorrecto');
    }
    await this.clearFailedAttempts(user);
    await this.auditAuth(ctx, user, 'login', 'Inicio de sesión correcto (con 2FA)');
    return this.buildTokenResponse(user);
  }

  // ── Bloqueo por intentos fallidos ───────────────────────────────────────

  private async registerFailedAttempt(user: User, ctx: AuditContext, reason = 'Contraseña incorrecta') {
    const attempts = (user.failedLoginAttempts || 0) + 1;
    const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
    const lockedUntil = shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null;
    await this.usersRepo.update(user.id, {
      failedLoginAttempts: shouldLock ? 0 : attempts,
      lockedUntil,
    });
    await this.auditAuth(
      ctx,
      user,
      shouldLock ? 'login_blocked' : 'login_failed',
      shouldLock
        ? `Cuenta bloqueada ${LOCK_MINUTES} min tras ${MAX_FAILED_ATTEMPTS} intentos fallidos`
        : `Login fallido (${attempts}/${MAX_FAILED_ATTEMPTS}) — ${reason}`,
    );
  }

  private async clearFailedAttempts(user: User) {
    if (!user.failedLoginAttempts && !user.lockedUntil) {
      await this.usersRepo.update(user.id, { lastLoginAt: new Date() });
      return;
    }
    await this.usersRepo.update(user.id, {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    });
  }

  /** Registra un evento de autenticación en el audit log (nunca lanza). */
  private auditAuth(
    ctx: AuditContext,
    user: User | null,
    action: 'login' | 'login_failed' | 'login_blocked' | 'security',
    summary: string,
  ) {
    return this.audit.record(
      {
        ...ctx,
        actorId: user?.id ?? ctx.actorId ?? null,
        actorEmail: user?.email ?? ctx.actorEmail ?? '',
        actorName: user?.name ?? ctx.actorName ?? '',
      },
      {
        entity: 'auth',
        entityId: user?.id || '',
        action,
        summary,
        before: null,
        after: null,
      },
    );
  }

  publicUser(user: User) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      code: user.code,
      position: user.position,
      classroomId: user.classroomId,
      phone: user.phone,
      photoUrl: user.photoUrl,
      active: user.active,
      totpEnabled: !!user.totpEnabled,
      mustChangePassword: !!user.mustChangePassword,
    };
  }

  private buildTokenResponse(user: User) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tv: user.tokenVersion || 0,
    };
    const accessToken = this.jwtService.sign(payload);
    // Token de medios: las <img> no pueden mandar cabecera Authorization, así que
    // el frontend lo añade como `?mt=` al cargar las fotos de /uploads.
    const mediaToken = this.mediaAccess.issue(user.id, user.tokenVersion || 0);
    return { accessToken, mediaToken, user: this.publicUser(user) };
  }

  /** Permite a CUALQUIER usuario autenticado actualizar su propio perfil. */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const patch: Partial<User> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.phone !== undefined) patch.phone = (dto.phone || '').trim();
    if (dto.photoBase64) {
      try {
        patch.photoUrl = this.uploads.saveDataUrl(dto.photoBase64, 'profile');
      } catch (e: any) {
        throw new BadRequestException(e?.message || 'Foto inválida');
      }
    }
    // update() no toca columnas no presentes — preserva password y totpSecret.
    if (Object.keys(patch).length > 0) {
      await this.usersRepo.update(userId, patch);
    }
    const fresh = await this.usersService.findById(userId);
    return this.publicUser(fresh!);
  }

  /** Cambio de contraseña con verificación de la actual. */
  async changePassword(userId: string, dto: ChangePasswordDto, ctx: AuditContext = {}) {
    const user = await this.usersRepo
      .createQueryBuilder('u')
      .addSelect('u.password')
      .where('u.id = :id', { id: userId })
      .getOne();
    if (!user) throw new NotFoundException('Usuario no encontrado');
    const valid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!valid) {
      await this.auditAuth(ctx, user, 'login_failed', 'Cambio de contraseña rechazado: contraseña actual incorrecta');
      // 400 y no 401: el frontend interpreta cualquier 401 como sesión caducada.
      throw new BadRequestException('La contraseña actual es incorrecta');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('La nueva contraseña debe ser distinta de la actual');
    }
    // Si el usuario tiene 2FA activo, requerimos también el código TOTP.
    // Esto evita que un atacante con un token comprometido + la contraseña
    // antigua (ej. phishing) pueda cambiar la contraseña sin acceso al 2do factor.
    if (user.totpEnabled) {
      if (!dto.totpCode) {
        throw new BadRequestException(
          'Tu cuenta tiene 2FA activo. Incluye el código de 6 dígitos de tu app autenticadora.',
        );
      }
      const okCode = await this.twoFactor.verifyCode(userId, dto.totpCode);
      if (!okCode) throw new BadRequestException('Código TOTP incorrecto');
    }
    const newHash = await bcrypt.hash(dto.newPassword, 12);
    // Bump de tokenVersion invalida cualquier otra sesión activa de este usuario.
    await this.usersRepo.update(userId, {
      password: newHash,
      mustChangePassword: false,
      tokenVersion: (user.tokenVersion || 0) + 1,
    });
    // Devolver un nuevo accessToken con la nueva tokenVersion para que la sesión actual no se invalide.
    const fresh = await this.usersService.findById(userId);
    await this.auditAuth(ctx, fresh!, 'security', 'Cambió su contraseña (se cerraron las demás sesiones)');
    return this.buildTokenResponse(fresh!);
  }

  /** Cierra todas las otras sesiones del usuario (bump de tokenVersion). */
  async logoutAllOtherSessions(userId: string, ctx: AuditContext = {}) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    await this.usersRepo.update(userId, { tokenVersion: (user.tokenVersion || 0) + 1 });
    const fresh = await this.usersService.findById(userId);
    await this.auditAuth(ctx, fresh!, 'security', 'Cerró todas sus otras sesiones');
    return this.buildTokenResponse(fresh!);
  }

  /**
   * Reemite un access token con el tokenVersion actual del usuario, sin bump.
   * Útil tras una acción que ya hizo bump (ej. desactivar 2FA en TwoFactorService),
   * para que la sesión que ejecutó la acción no quede invalidada.
   */
  async reissueToken(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return this.buildTokenResponse(user);
  }

  /** Registra en auditoría un evento de seguridad del propio usuario (2FA, etc.). */
  async recordSecurityEvent(userId: string, ctx: AuditContext, summary: string) {
    const user = await this.usersService.findById(userId);
    await this.auditAuth(ctx, user ?? null, 'security', summary);
  }
}
