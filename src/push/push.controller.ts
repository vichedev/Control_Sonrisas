import { BadRequestException, Body, Controller, Delete, Get, Post, Req, UseGuards } from '@nestjs/common';
import { IsObject, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { isAllowedPushEndpoint, PushService } from './push.service';

/** Estructura mínima esperada en `subscription` (PushSubscriptionJSON del navegador). */
class PushSubscriptionDto {
  /**
   * Objeto crudo retornado por `pushSubscription.toJSON()` del navegador.
   * Validamos en el handler que `endpoint` exista y sea https — no dejamos pasar
   * cualquier objeto suelto al servicio.
   */
  @IsObject()
  subscription: any;

  @IsOptional() @IsString() @MaxLength(300)
  userAgent?: string;
}

class UnsubscribeDto {
  @IsString() @IsUrl({ protocols: ['https', 'http'], require_tld: false }) @MaxLength(500)
  endpoint: string;
}

@Controller('push')
export class PushController {
  constructor(private readonly service: PushService) {}

  /** El frontend pide la VAPID public key para registrar el Service Worker. */
  @Get('public-key')
  publicKey() {
    return { enabled: this.service.enabled, publicKey: this.service.publicKey() };
  }

  @UseGuards(JwtAuthGuard)
  @Post('subscribe')
  subscribe(@Req() req: any, @Body() dto: PushSubscriptionDto) {
    const sub = dto.subscription;
    // Validación adicional de forma: el push endpoint debe ser HTTPS para FCM/Mozilla.
    if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://')) {
      throw new BadRequestException('subscription.endpoint inválido (requiere https://)');
    }
    // Lista blanca de servicios push (FCM, Mozilla, Windows, Apple): evita SSRF vía /push/test.
    if (!isAllowedPushEndpoint(sub.endpoint)) {
      throw new BadRequestException('subscription.endpoint no pertenece a un servicio push permitido');
    }
    if (!sub.keys || typeof sub.keys !== 'object' || !sub.keys.p256dh || !sub.keys.auth) {
      throw new BadRequestException('subscription.keys.p256dh y subscription.keys.auth son requeridos');
    }
    return this.service.subscribe(
      req.user.id,
      sub,
      dto.userAgent || (req.headers['user-agent'] || '').toString().slice(0, 300),
    );
  }

  @UseGuards(JwtAuthGuard)
  @Delete('subscribe')
  unsubscribe(@Req() req: any, @Body() dto: UnsubscribeDto) {
    return this.service.unsubscribe(req.user.id, dto.endpoint);
  }

  /** Envía una notificación de prueba al propio usuario. */
  @UseGuards(JwtAuthGuard)
  @Post('test')
  test(@Req() req: any) {
    return this.service.notifyUser(req.user.id, {
      title: 'Notificación de prueba',
      body: 'Si ves esto, las notificaciones push funcionan correctamente.',
      url: '/',
      tag: 'test',
    });
  }
}
