import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WhatsappMessage } from './whatsapp-message.entity';
import {
  CloudApiWhatsappProvider,
  ManualWhatsappProvider,
  WhatsappProviderName,
  WhatsappSendResult,
} from './whatsapp.provider';
import { LinkedWhatsappService } from './linked-whatsapp.service';
import { ConsentsService } from '../consents/consents.service';

export interface SendParams {
  phone: string;
  body: string;
  toName?: string;
  childId?: string | null;
  guardianId?: string | null;
  reportId?: string | null;
  actorId?: string | null;
  /** Origen: 'report' | 'direct' | 'test' | 'arrival' | 'pickup' | 'health' | 'justification'. */
  source?: string | null;
  sourceRef?: string | null;
  /**
   * true = sólo por el WhatsApp vinculado (avisos automáticos, prueba): si no está conectado
   * se registra como fallido en vez de preparar un enlace wa.me que nadie va a abrir.
   */
  linkedOnly?: boolean;
  /**
   * Texto que queda en la bitácora en lugar de `body` (p. ej. credenciales: la
   * contraseña temporal nunca se guarda).
   */
  logBody?: string;
}

const NOT_CONNECTED = 'El WhatsApp del centro no está conectado';

@Injectable()
export class WhatsappService implements OnApplicationBootstrap {
  private readonly log = new Logger('WhatsappService');
  /**
   * Lo elegido en WHATSAPP_PROVIDER. Por defecto 'linked': el número vinculado es EL canal
   * y sin conexión el envío falla (no se generan enlaces wa.me). 'manual' sólo si se
   * configura explícitamente (modo heredado).
   */
  readonly configuredProvider: WhatsappProviderName;
  private readonly manual = new ManualWhatsappProvider();
  private readonly cloud: CloudApiWhatsappProvider | null;

  constructor(
    @InjectRepository(WhatsappMessage)
    private readonly repo: Repository<WhatsappMessage>,
    private readonly config: ConfigService,
    private readonly linked: LinkedWhatsappService,
    private readonly consents: ConsentsService,
  ) {
    const configured = (config.get<string>('WHATSAPP_PROVIDER') || 'linked').trim().toLowerCase();
    this.configuredProvider =
      configured === 'cloud' ? 'cloud' : configured === 'manual' ? 'manual' : 'linked';
    this.cloud = this.configuredProvider === 'cloud' ? new CloudApiWhatsappProvider(config) : null;
    this.log.log(
      `Proveedor de WhatsApp: ${this.configuredProvider}` +
        (this.configuredProvider === 'manual'
          ? ' (heredado: enlaces wa.me cuando el WhatsApp vinculado no está conectado)'
          : this.configuredProvider === 'linked'
            ? ' (sin conexión los envíos fallan y se pueden reintentar)'
            : ''),
    );
  }

  /** Mensajes que quedaron en cola al apagarse el servidor: ya no saldrán. */
  async onApplicationBootstrap() {
    try {
      await this.repo
        .createQueryBuilder()
        .update(WhatsappMessage)
        .set({ status: 'failed', errorMessage: 'Interrumpido por un reinicio del servidor' })
        .where("status = 'queued' AND provider = 'linked'")
        .execute();
    } catch (e: any) {
      this.log.warn(`No se pudo limpiar la cola: ${e?.message || e}`);
    }
  }

  /**
   * Proveedor efectivo AHORA: 'cloud' si así se configuró; si no, 'linked'. Sólo con
   * WHATSAPP_PROVIDER=manual (heredado) se cae a 'manual' cuando no hay conexión.
   */
  get providerName(): WhatsappProviderName {
    if (this.cloud) return 'cloud';
    if (this.configuredProvider === 'manual' && !this.linked.isConnected) return 'manual';
    return 'linked';
  }

  get cloudConfigured(): boolean {
    return !!this.cloud;
  }

  /** ¿Sale un mensaje de verdad ahora (sin enlaces wa.me)? */
  get canSendDirect(): boolean {
    return !!this.cloud || this.linked.isConnected;
  }

  /** ¿Se puede enviar algo ahora mismo? (linked sin conexión = no). */
  get canSend(): boolean {
    return !!this.cloud || this.linked.isConnected || this.configuredProvider === 'manual';
  }

  /** Respuesta de GET /whatsapp/provider (compatible: `provider` sigue siendo el efectivo). */
  providerInfo() {
    const s = this.linked.status();
    const provider = this.providerName;
    return {
      provider,
      configured: this.configuredProvider,
      automatic: provider !== 'manual',
      /** true si un envío saldría ahora (linked conectado, cloud o manual heredado). */
      canSend: this.canSend,
      connected: this.linked.isConnected,
      linked: { state: s.state, phone: s.phone, name: s.name, queueLength: s.queueLength },
    };
  }

  /** Código de país por defecto para números escritos sin prefijo (Ecuador: 593). */
  private get defaultCountryCode(): string {
    return (this.config.get<string>('WHATSAPP_COUNTRY_CODE') || '593').replace(/\D/g, '');
  }

  /**
   * Normaliza un teléfono a formato internacional sin '+'.
   *
   * En Ecuador la gente escribe "0987654321"; WhatsApp necesita "593987654321". El 0
   * inicial es prefijo nacional y sobra al anteponer el código de país.
   */
  normalizePhone(raw: string): string {
    let digits = (raw || '').replace(/\D/g, '');
    if (!digits) return '';
    const cc = this.defaultCountryCode;
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith(cc)) return digits;
    if (digits.startsWith('0')) digits = digits.slice(1);
    return `${cc}${digits}`;
  }

  /**
   * Envía (o prepara) un mensaje y deja constancia en la bitácora.
   *
   * - linked (por defecto): se registra como `queued` y se espera a que la cola lo envíe →
   *   `sent`/`failed`. Sin conexión → `failed` ("no está conectado"), para reintentar luego.
   * - manual (sólo si se configuró así): devuelve `link` y estado `manual_pending`.
   * - cloud: estado final devuelto por Meta.
   */
  async send(params: SendParams) {
    const to = this.normalizePhone(params.phone);
    if (!to) {
      throw new NotFoundException('El representante no tiene un número de teléfono válido');
    }
    // Sólo el modo manual heredado prepara enlaces wa.me; en cualquier otro caso, linked o nada.
    const linkedOnly = params.linkedOnly === true;
    const allowManual = !linkedOnly && this.configuredProvider === 'manual';
    // LOPDP: si la familia rechazó los avisos por WhatsApp de este niño, no se envía nada.
    // (Pendiente se permite mientras las familias responden.)
    if (params.childId && !(await this.consents.canWhatsapp(params.childId))) {
      throw new ForbiddenException('La familia no autorizó los avisos por WhatsApp de este niño');
    }

    const base = {
      toPhone: to,
      toName: params.toName || '',
      childId: params.childId || null,
      guardianId: params.guardianId || null,
      reportId: params.reportId || null,
      body: params.logBody ?? params.body,
      sentById: params.actorId || null,
      source: params.source || (params.reportId ? 'report' : null),
      sourceRef: params.sourceRef || null,
    };

    let provider: WhatsappProviderName;
    let result: WhatsappSendResult;

    if (this.cloud && !linkedOnly) {
      provider = 'cloud';
      result = await this.cloud.send({ to, body: params.body });
    } else if (this.linked.isConnected) {
      provider = 'linked';
      // Se guarda primero como 'queued' para que la bitácora muestre la cola en vivo.
      const queued = await this.repo.save(
        this.repo.create({ ...base, provider, status: 'queued', link: '', externalId: '', errorMessage: '' }),
      );
      result = await this.linked.send(to, params.body);
      if (result.status === 'failed' && allowManual && !this.linked.isConnected) {
        // Se cortó la conexión mientras esperaba: respaldo manual para no perder el mensaje.
        this.log.warn(`WhatsApp vinculado desconectado; respaldo manual para ${to}`);
        provider = 'manual';
        result = await this.manual.send({ to, body: params.body });
      }
      Object.assign(queued, this.resultFields(provider, result));
      const saved = await this.repo.save(queued);
      return { ...saved, link: result.link || '' };
    } else if (allowManual) {
      provider = 'manual';
      result = await this.manual.send({ to, body: params.body });
    } else {
      provider = 'linked';
      result = { status: 'failed', error: NOT_CONNECTED };
    }

    const saved = await this.repo.save(
      this.repo.create({ ...base, ...this.resultFields(provider, result) }),
    );
    return { ...saved, link: result.link || '' };
  }

  private resultFields(provider: WhatsappProviderName, result: WhatsappSendResult) {
    return {
      provider,
      status: result.status,
      link: result.link || '',
      externalId: result.externalId || '',
      errorMessage: result.error || '',
      sentAt: result.status === 'sent' ? new Date() : null,
    };
  }

  /** ¿Ya se envió (o está en cola) un aviso de este origen a este representante? */
  async alreadyNotified(source: string, sourceRef: string, guardianId: string): Promise<boolean> {
    const n = await this.repo
      .createQueryBuilder('m')
      .where('m.source = :source AND m.sourceRef = :ref AND m.guardianId = :gid', {
        source,
        ref: sourceRef,
        gid: guardianId,
      })
      .andWhere("m.status IN ('sent', 'queued')")
      .getCount();
    return n > 0;
  }

  /** Confirma que un mensaje preparado a mano se envió de verdad. */
  async markSent(id: string) {
    const msg = await this.repo.findOne({ where: { id } });
    if (!msg) throw new NotFoundException('Mensaje no encontrado');
    msg.status = 'sent';
    msg.sentAt = new Date();
    return this.repo.save(msg);
  }

  async list(
    opts: { childId?: string; reportId?: string; status?: string; source?: string; limit?: number } = {},
  ) {
    const qb = this.repo.createQueryBuilder('m').orderBy('m.createdAt', 'DESC');
    if (opts.childId) qb.andWhere('m.childId = :cid', { cid: opts.childId });
    if (opts.reportId) qb.andWhere('m.reportId = :rid', { rid: opts.reportId });
    if (opts.status) qb.andWhere('m.status = :s', { s: opts.status });
    if (opts.source) qb.andWhere('m.source = :src', { src: opts.source });
    qb.limit(Math.min(Math.max(opts.limit || 200, 1), 1000));
    return qb.getMany();
  }

  /** Mensajes de un reporte concreto, para mostrar a quién se le mandó. */
  byReport(reportId: string) {
    return this.repo.find({ where: { reportId }, order: { createdAt: 'ASC' } });
  }
}
