import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../users/users.service';
import { MediaAccessService } from '../uploads/media-access.service';

/**
 * Rutas permitidas mientras la cuenta tiene contraseña temporal (`mustChangePassword`).
 * Son las que usa la pantalla /cambiar-clave: leer la sesión, cambiar la clave y cerrar sesiones.
 */
const FORCED_CHANGE_ALLOWED = new Set([
  'GET /api/auth/me',
  'POST /api/auth/change-password',
  'POST /api/auth/logout-all',
]);

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
    private readonly mediaAccess: MediaAccessService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(req: any, payload: { sub: string; email: string; role?: string; tv?: number; type?: string }) {
    // Sólo los access tokens son sesión. El token temporal del 2FA (`type: 'pre-2fa'`)
    // va firmado con el mismo secreto: sin este control, bastaría la contraseña para
    // entrar saltándose el segundo factor. Los access tokens siempre llevan `tv`.
    if (payload.type || typeof payload.tv !== 'number') {
      throw new UnauthorizedException();
    }
    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.active) {
      throw new UnauthorizedException();
    }
    // Si el JWT viene de una versión anterior (cambio de pw / logout-all) → invalidamos.
    if (typeof payload.tv === 'number' && payload.tv !== (user.tokenVersion || 0)) {
      throw new UnauthorizedException('Sesión expirada');
    }
    // Contraseña temporal: el servidor también lo exige, no sólo el frontend.
    if (user.mustChangePassword) {
      const path = String(req?.originalUrl || req?.url || '').split('?')[0].replace(/\/+$/, '');
      if (!FORCED_CHANGE_ALLOWED.has(`${String(req?.method || '').toUpperCase()} ${path}`)) {
        throw new ForbiddenException('Debes cambiar tu contraseña temporal');
      }
    }
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
      // Se re-emite en cada `/auth/me` para que el frontend siempre tenga uno
      // válido con el que pedir las fotos protegidas de /uploads.
      mediaToken: this.mediaAccess.issue(user.id, user.tokenVersion || 0),
    };
  }
}
