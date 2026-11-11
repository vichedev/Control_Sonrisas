import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '../users/user.entity';

/** Base: JWT válido + rol dentro de la lista permitida. */
abstract class RoleGuard extends AuthGuard('jwt') {
  protected abstract readonly allowed: UserRole[];
  protected abstract readonly message: string;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ok = (await super.canActivate(context)) as boolean;
    if (!ok) return false;
    const req = context.switchToHttp().getRequest();
    if (!this.allowed.includes(req.user?.role)) {
      throw new ForbiddenException(this.message);
    }
    return true;
  }
}

/** Sólo dirección. Configuración, cuentas, auditoría, borrados. */
@Injectable()
export class AdminGuard extends RoleGuard {
  protected readonly allowed: UserRole[] = ['admin'];
  protected readonly message = 'Sólo la dirección puede hacer esto';
}

/** Dirección + coordinación. Revisar, aprobar, enviar reportes, ver todo. */
@Injectable()
export class CoordinatorGuard extends RoleGuard {
  protected readonly allowed: UserRole[] = ['admin', 'coordinator'];
  protected readonly message = 'Sólo dirección y coordinación pueden hacer esto';
}

/**
 * Todo el personal (dirección, coordinación y educadoras).
 * Es el guard del día a día: registrar entradas, comidas, actividades y bitácora.
 */
@Injectable()
export class StaffGuard extends RoleGuard {
  protected readonly allowed: UserRole[] = ['admin', 'coordinator', 'teacher'];
  protected readonly message = 'Sólo el personal de la guardería puede hacer esto';
}

/** Sólo representantes. Portal familiar. */
@Injectable()
export class GuardianGuard extends RoleGuard {
  protected readonly allowed: UserRole[] = ['guardian'];
  protected readonly message = 'Sólo representantes';
}
