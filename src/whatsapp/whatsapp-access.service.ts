import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../users/user.entity';
import { AppBranding } from '../branding/branding.entity';
import { AuditContext, AuditService } from '../audit/audit.service';
import { WhatsappService } from './whatsapp.service';

/** 0987654321 → •••••4321 (para respuestas y auditoría). */
export function maskPhone(phone: string): string {
  const d = (phone || '').replace(/\D/g, '');
  if (d.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(d.length - 4, 6))}${d.slice(-4)}`;
}

/**
 * Envío de credenciales de acceso por el WhatsApp del centro.
 *
 * Sólo puede mandar la contraseña temporal VIGENTE de una cuenta que aún debe cambiarla:
 * se compara con el hash guardado, así el endpoint no sirve para enviar texto arbitrario
 * desde el número del centro. La contraseña nunca queda en la bitácora ni en la auditoría.
 */
@Injectable()
export class WhatsappAccessService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AppBranding) private readonly branding: Repository<AppBranding>,
    private readonly whatsapp: WhatsappService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private async centerName(): Promise<string> {
    try {
      const b = await this.branding.find({ take: 1, order: { createdAt: 'ASC' } });
      return b[0]?.companyName || 'Sonrisas';
    } catch {
      return 'Sonrisas';
    }
  }

  private portalUrl(origin?: string): string {
    const env = this.config.get<string>('FRONTEND_URL') || this.config.get<string>('BACKEND_URL') || '';
    const url = env || origin || '';
    return url.replace(/\/+$/, '');
  }

  async sendAccess(
    input: { userId?: string; email?: string; tempPassword: string },
    ctx: AuditContext & { origin?: string },
  ) {
    if (!input.userId && !input.email) throw new BadRequestException('Falta el usuario');
    const qb = this.users.createQueryBuilder('u').addSelect('u.password');
    if (input.userId) qb.where('u.id = :id', { id: input.userId });
    else qb.where('LOWER(u.email) = :e', { e: input.email!.toLowerCase().trim() });
    const user = await qb.getOne();
    if (!user) throw new NotFoundException('Cuenta no encontrada');

    // Mismo mensaje para "ya la cambió" y "no coincide": no revela cuál de las dos pasa.
    const valid =
      user.mustChangePassword && !!user.password && (await bcrypt.compare(input.tempPassword, user.password));
    if (!valid) {
      throw new BadRequestException(
        'Esa no es la contraseña temporal vigente de la cuenta (o ya la cambió). Genera una nueva con «Restablecer acceso».',
      );
    }
    if (!user.active) throw new BadRequestException('La cuenta está desactivada');
    if (!user.phone || !this.whatsapp.normalizePhone(user.phone)) {
      throw new BadRequestException(`${user.name} no tiene un teléfono registrado`);
    }
    if (!this.whatsapp.canSendDirect) {
      throw new ConflictException('El WhatsApp del centro no está conectado');
    }

    const center = await this.centerName();
    const isFamily = user.role === 'guardian';
    const url = this.portalUrl(ctx.origin);
    const firstName = (user.name || '').trim().split(/\s+/)[0] || '';
    const lines = [
      `Hola ${firstName} 👋`,
      '',
      isFamily
        ? `Te damos la bienvenida al portal familiar de *${center}*. Ahí podrás ver el día de tu hijo/a: llegada, comidas, siestas, actividades y fotos.`
        : `Te damos la bienvenida al sistema de *${center}*.`,
      '',
      '*Tus datos de acceso*',
      ...(url ? [`🔗 ${url}`] : []),
      `👤 Usuario: ${user.email}`,
      `🔑 Contraseña temporal: ${input.tempPassword}`,
      '',
      'Al ingresar te pedirá crear tu propia contraseña. No compartas este mensaje.',
      '',
      `— ${center}`,
    ];
    const body = lines.join('\n');
    const logBody = body.replace(input.tempPassword, '••••••••');

    const msg = await this.whatsapp.send({
      phone: user.phone,
      body,
      logBody,
      toName: user.name,
      guardianId: isFamily ? user.id : null,
      actorId: ctx.actorId || null,
      source: 'access',
      sourceRef: user.id,
      // Nunca enlaces wa.me con una contraseña dentro.
      linkedOnly: !this.whatsapp.cloudConfigured,
    });

    const toPhone = maskPhone(msg.toPhone);
    await this.audit.record(ctx, {
      entity: isFamily ? 'guardian' : 'staff',
      entityId: user.id,
      action: 'security',
      summary:
        msg.status === 'sent'
          ? `Envió por WhatsApp los datos de acceso de "${user.name}" (${toPhone})`
          : `Falló el envío por WhatsApp de los datos de acceso de "${user.name}" (${toPhone}): ${msg.errorMessage || msg.status}`,
    });
    return {
      status: msg.status as 'sent' | 'failed' | 'queued' | 'manual_pending',
      toPhone,
      error: msg.errorMessage || '',
      messageId: msg.id,
    };
  }
}
