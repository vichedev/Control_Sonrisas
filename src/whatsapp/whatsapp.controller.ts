import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AdminGuard, CoordinatorGuard, StaffGuard } from '../auth/roles.guard';
import { WhatsappService } from './whatsapp.service';
import { LinkedWhatsappService } from './linked-whatsapp.service';
import { WhatsappNotifierService } from './whatsapp-notifier.service';
import { RateLimit } from '../common/rate-limit.decorator';
import { WhatsappAccessService } from './whatsapp-access.service';
import { AuditService, auditCtx } from '../audit/audit.service';

const trim = ({ value }: { value: any }) =>
  typeof value === 'string' ? value.trim() : value;

class SendMessageDto {
  @Transform(trim) @IsString() @MinLength(6) @MaxLength(30)
  phone: string;

  @Transform(trim) @IsString() @MinLength(1) @MaxLength(4000)
  body: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(120)
  toName?: string;

  @IsOptional() @IsUUID()
  childId?: string;

  @IsOptional() @IsUUID()
  guardianId?: string;
}

class SendAccessDto {
  @IsOptional() @IsUUID()
  userId?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(200)
  email?: string;

  @IsString() @MinLength(4) @MaxLength(100)
  tempPassword: string;
}

class TestMessageDto {
  @Transform(trim) @IsString() @MinLength(6) @MaxLength(30)
  phone: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000)
  body?: string;
}

const HHMM_OR_EMPTY = /^$|^([01]\d|2[0-3]):[0-5]\d$/;

class UpdateSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() notifyArrival?: boolean;
  @IsOptional() @IsBoolean() notifyPickup?: boolean;
  @IsOptional() @IsBoolean() notifyHealth?: boolean;
  @IsOptional() @IsBoolean() notifyJustification?: boolean;

  @IsOptional() @Transform(trim) @IsString()
  @Matches(HHMM_OR_EMPTY, { message: 'La hora de inicio del silencio debe ser HH:mm' })
  quietStart?: string;

  @IsOptional() @Transform(trim) @IsString()
  @Matches(HHMM_OR_EMPTY, { message: 'La hora de fin del silencio debe ser HH:mm' })
  quietEnd?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(120)
  signature?: string;
}

@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly service: WhatsappService,
    private readonly linked: LinkedWhatsappService,
    private readonly notifier: WhatsappNotifierService,
    private readonly access: WhatsappAccessService,
    private readonly audit: AuditService,
  ) {}

  /**
   * El frontend necesita saber si debe abrir el enlace wa.me o si el envío es automático.
   * `provider` es el efectivo AHORA: 'linked' | 'cloud' | 'manual'.
   */
  @UseGuards(StaffGuard)
  @Get('provider')
  provider() {
    return this.service.providerInfo();
  }

  @UseGuards(StaffGuard)
  @Get('messages')
  list(
    @Query('childId') childId?: string,
    @Query('reportId') reportId?: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list({ childId, reportId, status, source, limit: Number(limit) || undefined });
  }

  /**
   * Mensaje suelto a una familia (aviso puntual, no el reporte diario).
   * Teléfono y texto libres → sólo dirección/coordinación (evita usar el número
   * del centro para escribir a cualquiera). El frontend no lo usa hoy.
   */
  @RateLimit(20)
  @UseGuards(CoordinatorGuard)
  @Post('send')
  send(@Req() req: any, @Body() dto: SendMessageDto) {
    return this.service.send({
      phone: dto.phone,
      body: dto.body,
      toName: dto.toName,
      childId: dto.childId || null,
      guardianId: dto.guardianId || null,
      actorId: req.user?.id,
      source: 'direct',
    });
  }

  /**
   * Envía a la persona sus datos de acceso (usuario + contraseña temporal vigente) por el
   * WhatsApp del centro. Sólo acepta la contraseña temporal real de la cuenta.
   * → `{ status: 'sent'|'failed', toPhone (enmascarado), error }`; 409 si no está conectado.
   */
  @RateLimit(10)
  @UseGuards(CoordinatorGuard)
  @Post('send-access')
  sendAccess(@Req() req: any, @Body() dto: SendAccessDto) {
    return this.access.sendAccess(
      { userId: dto.userId, email: dto.email, tempPassword: dto.tempPassword },
      { ...auditCtx(req), origin: req.headers?.origin },
    );
  }

  /** Confirma que un mensaje preparado con el proveedor manual ya se envió. */
  @UseGuards(StaffGuard)
  @Post('messages/:id/sent')
  markSent(@Param('id') id: string) {
    return this.service.markSent(id);
  }

  // ------------------------------------------------ WhatsApp vinculado (QR)

  /** Estado del número vinculado. El QR sólo se entrega a dirección. */
  @UseGuards(CoordinatorGuard)
  @Get('linked/status')
  linkedStatus(@Req() req: any) {
    const s = this.linked.status();
    return req.user?.role === 'admin' ? s : { ...s, qr: '' };
  }

  /** Conecta: reconecta con la sesión guardada o genera un QR (`?fresh=1` fuerza uno nuevo). */
  @RateLimit(10)
  @UseGuards(AdminGuard)
  @Post('linked/connect')
  async linkedConnect(@Req() req: any, @Query('fresh') fresh?: string) {
    await this.audit.record(auditCtx(req), {
      entity: 'whatsapp',
      entityId: 'linked',
      action: 'security',
      summary: 'Inició la vinculación del WhatsApp del centro (QR)',
    });
    return fresh === '1' || fresh === 'true' ? this.linked.restart() : this.linked.connect();
  }

  /** Cancela un QR pendiente o detiene la conexión sin desvincular. */
  @UseGuards(AdminGuard)
  @Post('linked/stop')
  linkedStop() {
    return this.linked.stop();
  }

  /** Desvincula el número del centro y borra la sesión. */
  @RateLimit(5)
  @UseGuards(AdminGuard)
  @Post('linked/logout')
  async linkedLogout(@Req() req: any) {
    await this.audit.record(auditCtx(req), {
      entity: 'whatsapp',
      entityId: 'linked',
      action: 'security',
      summary: 'Desvinculó el WhatsApp del centro',
    });
    return this.linked.logout();
  }

  /** Mensaje de prueba por el WhatsApp vinculado. */
  @RateLimit(5)
  @UseGuards(AdminGuard)
  @Post('linked/test')
  async linkedTest(@Req() req: any, @Body() dto: TestMessageDto) {
    if (!this.linked.isConnected) {
      throw new BadRequestException('El WhatsApp del centro no está conectado');
    }
    const s = await this.notifier.getSettings();
    const signature = s.signature || (await this.notifier.defaultSignature());
    const body =
      dto.body ||
      `👋 Mensaje de prueba de ${signature}. Si lo recibiste, los avisos por WhatsApp están funcionando.`;
    return this.service.send({
      phone: dto.phone,
      body,
      toName: 'Prueba',
      actorId: req.user?.id,
      source: 'test',
      linkedOnly: true,
    });
  }

  // ------------------------------------------------ avisos automáticos

  @UseGuards(CoordinatorGuard)
  @Get('settings')
  getSettings() {
    return this.notifier.settingsView();
  }

  @UseGuards(AdminGuard)
  @Put('settings')
  async updateSettings(@Req() req: any, @Body() dto: UpdateSettingsDto) {
    const before = { ...(await this.notifier.getSettings()) };
    try {
      await this.notifier.updateSettings(dto);
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'Ajustes inválidos');
    }
    // Activar los avisos automáticos envía mensajes reales: queda registrado quién lo hizo.
    const after = { ...(await this.notifier.getSettings()) };
    await this.audit.record(auditCtx(req), {
      entity: 'whatsapp',
      entityId: 'settings',
      action: 'update',
      summary:
        before.enabled !== after.enabled
          ? `${after.enabled ? 'Activó' : 'Desactivó'} los avisos automáticos por WhatsApp`
          : 'Cambió los ajustes de avisos por WhatsApp',
      before: before as any,
      after: after as any,
    });
    return this.notifier.settingsView();
  }
}
