import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as webpush from 'web-push';
import { PushSubscription } from './push-subscription.entity';
import { User } from '../users/user.entity';

export interface NotifyPayload {
  title: string;
  body: string;
  /** Ruta interna a abrir al hacer click (ej: '/admin/justifications'). */
  url?: string;
  /** Icono opcional (se sirve desde /public/icon.png si existe). */
  icon?: string;
  /** Etiqueta para agrupar / reemplazar notificaciones del mismo tipo. */
  tag?: string;
}

/**
 * Hosts de los servicios push de los navegadores. Cualquier otro endpoint se
 * rechaza: si no, `POST /push/test` haría que el servidor pida URLs arbitrarias (SSRF).
 */
const PUSH_HOST_EXACT = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
]);
const PUSH_HOST_SUFFIXES = ['.push.services.mozilla.com', '.notify.windows.com', '.push.apple.com'];

/** true si el endpoint es https, puerto por defecto y de un servicio push conocido. */
export function isAllowedPushEndpoint(endpoint: unknown): boolean {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  if (u.port && u.port !== '443') return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOST_EXACT.has(host) || PUSH_HOST_SUFFIXES.some((sfx) => host.endsWith(sfx));
}

@Injectable()
export class PushService implements OnModuleInit {
  private readonly log = new Logger('PushService');
  private configured = false;

  constructor(
    @InjectRepository(PushSubscription) private readonly repo: Repository<PushSubscription>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const pub = this.config.get<string>('VAPID_PUBLIC_KEY');
    const prv = this.config.get<string>('VAPID_PRIVATE_KEY');
    const subject = this.config.get<string>('VAPID_SUBJECT') || 'mailto:admin@example.com';
    if (!pub || !prv) {
      this.log.warn('VAPID keys no configuradas. Las notificaciones push estarán deshabilitadas.');
      return;
    }
    webpush.setVapidDetails(subject, pub, prv);
    this.configured = true;
    this.log.log(`Push notifications habilitadas (subject=${subject})`);
  }

  get enabled(): boolean {
    return this.configured;
  }

  publicKey(): string | null {
    return this.config.get<string>('VAPID_PUBLIC_KEY') || null;
  }

  /** Registra o renueva una suscripción para un usuario. */
  async subscribe(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent = '') {
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      throw new Error('Suscripción inválida');
    }
    if (!isAllowedPushEndpoint(sub.endpoint)) throw new Error('Servicio push no permitido');
    const existing = await this.repo.findOne({ where: { endpoint: sub.endpoint } });
    if (existing) {
      // Si el endpoint cambió de usuario (poco probable pero posible), lo actualizamos.
      existing.userId = userId;
      existing.p256dh = sub.keys.p256dh;
      existing.auth = sub.keys.auth;
      existing.userAgent = (userAgent || '').slice(0, 240);
      return this.repo.save(existing);
    }
    return this.repo.save(
      this.repo.create({
        userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent: (userAgent || '').slice(0, 240),
      }),
    );
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.repo.delete({ userId, endpoint });
    return { ok: true };
  }

  /** Envía una notificación a todas las suscripciones del usuario. Errores no propagan. */
  async notifyUser(userId: string, payload: NotifyPayload): Promise<{ sent: number; pruned: number }> {
    return this.notifyUsers([userId], payload);
  }

  /** Envía a varios usuarios a la vez (admins, equipo, etc.). */
  async notifyUsers(userIds: string[], payload: NotifyPayload): Promise<{ sent: number; pruned: number }> {
    if (!this.configured || !userIds.length) return { sent: 0, pruned: 0 };
    const subs = await this.repo.find({ where: { userId: In(userIds) } });
    if (!subs.length) return { sent: 0, pruned: 0 };
    let sent = 0, pruned = 0;
    const body = JSON.stringify(payload);
    for (const s of subs) {
      // Suscripciones antiguas a hosts no permitidos: se descartan sin pedirlas.
      if (!isAllowedPushEndpoint(s.endpoint)) {
        await this.repo.delete({ id: s.id }).catch(() => {});
        pruned += 1;
        continue;
      }
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 60 * 60 * 24 },
        );
        sent += 1;
      } catch (e: any) {
        const code = e?.statusCode;
        if (code === 404 || code === 410) {
          await this.repo.delete({ id: s.id }).catch(() => {});
          pruned += 1;
        } else {
          this.log.warn(`Fallo enviando push a ${s.endpoint.slice(0, 40)}…: ${e?.message || e}`);
        }
      }
    }
    return { sent, pruned };
  }

  /** Notifica a TODOS los administradores activos. */
  async notifyAdmins(payload: NotifyPayload): Promise<{ sent: number; pruned: number }> {
    if (!this.configured) return { sent: 0, pruned: 0 };
    const admins = await this.usersRepo.find({ where: { role: 'admin', active: true }, select: ['id'] });
    const ids = admins.map((a) => a.id);
    return this.notifyUsers(ids, payload);
  }
}
