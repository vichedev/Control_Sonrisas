import { Body, Controller, Get, Patch, Post, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TwoFactorService } from './two-factor.service';
import { Disable2FADto, TotpLoginDto, VerifyTotpDto } from './dto/two-factor.dto';
import { ChangePasswordDto, UpdateProfileDto } from './dto/profile.dto';
import { RateLimit } from '../common/rate-limit.decorator';
import { auditCtx } from '../audit/audit.service';

/**
 * NOTA DE SEGURIDAD — aquí NO hay endpoint de registro.
 * Existía un `POST /auth/register` público que creaba cuentas con rol `admin`:
 * cualquiera que conociera la URL se convertía en administrador del sistema.
 * Se eliminó. El primer administrador se crea con `npm run seed` (variables
 * ADMIN_EMAIL / ADMIN_PASSWORD) y el resto desde el panel: `POST /admins`
 * (protegido con AdminGuard).
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  // Límite real de intentos de login: 5 por minuto y por IP.
  // (Además, AuthService bloquea la CUENTA tras 5 fallos consecutivos, lo que
  //  cubre el caso de un atacante que rota de IP.)
  @RateLimit(5)
  @Post('login')
  login(@Req() req: any, @Body() dto: LoginDto) {
    return this.authService.login(dto, auditCtx(req));
  }

  @RateLimit(10)
  @Post('2fa/login')
  twoFactorLogin(@Req() req: any, @Body() dto: TotpLoginDto) {
    return this.authService.loginWith2FA(dto, auditCtx(req));
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return req.user;
  }

  // ── Perfil propio (cualquier usuario autenticado) ──
  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(req.user.id, dto);
  }

  @RateLimit(10)
  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(req.user.id, dto, auditCtx(req));
  }

  /** Invalida todas las otras sesiones del usuario (incrementa tokenVersion). */
  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  logoutAll(@Req() req: any) {
    return this.authService.logoutAllOtherSessions(req.user.id, auditCtx(req));
  }

  // ── 2FA: activación / verificación / desactivación (cualquier usuario autenticado) ──
  // Throttle agresivo: 2FA setup es un flujo poco frecuente; limitar previene
  // que un atacante con un token comprometido haga sweep para forzar/desactivar.
  @RateLimit(5)
  @UseGuards(JwtAuthGuard)
  @Post('2fa/setup')
  setup2FA(@Req() req: any) {
    return this.twoFactor.beginSetup(req.user.id);
  }

  @RateLimit(10)
  @UseGuards(JwtAuthGuard)
  @Post('2fa/verify-setup')
  async verify2FASetup(@Req() req: any, @Body() dto: VerifyTotpDto) {
    const res = await this.twoFactor.verifySetup(req.user.id, dto.code);
    await this.authService.recordSecurityEvent(req.user.id, auditCtx(req), 'Activó la verificación en dos pasos (2FA)');
    return res;
  }

  @RateLimit(5)
  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  async disable2FA(@Req() req: any, @Body() dto: Disable2FADto) {
    // disable() bumpea tokenVersion (invalida otras sesiones por seguridad).
    // Para no kick-out a la sesión que ejecutó la acción, emitimos un token
    // fresco con la nueva tokenVersion.
    await this.twoFactor.disable(req.user.id, dto.code, dto.password);
    await this.authService.recordSecurityEvent(req.user.id, auditCtx(req), 'Desactivó la verificación en dos pasos (2FA)');
    return this.authService.reissueToken(req.user.id);
  }
}
