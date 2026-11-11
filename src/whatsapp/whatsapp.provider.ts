import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface WhatsappSendInput {
  /** Número ya normalizado a formato internacional sin '+'. */
  to: string;
  body: string;
}

export interface WhatsappSendResult {
  /** 'sent' cuando el proveedor confirmó el envío; 'manual_pending' cuando sólo preparó el enlace. */
  status: 'sent' | 'manual_pending' | 'failed';
  /** Enlace wa.me a abrir (sólo proveedor manual). */
  link?: string;
  /** Id del mensaje devuelto por la API (Cloud API o WhatsApp vinculado). */
  externalId?: string;
  error?: string;
}

export type WhatsappProviderName = 'manual' | 'cloud' | 'linked';

export interface WhatsappProvider {
  readonly name: WhatsappProviderName;
  send(input: WhatsappSendInput): Promise<WhatsappSendResult>;
}

/**
 * Proveedor manual: no envía nada por sí mismo. Genera el enlace `wa.me` con el mensaje
 * ya redactado para que la educadora lo abra y pulse enviar desde su propio WhatsApp.
 *
 * Sin costo, sin verificación de Meta y funciona desde el primer día. La contrapartida
 * es que el envío no es automático ni masivo.
 */
export class ManualWhatsappProvider implements WhatsappProvider {
  readonly name = 'manual' as const;

  async send(input: WhatsappSendInput): Promise<WhatsappSendResult> {
    const link = `https://wa.me/${input.to}?text=${encodeURIComponent(input.body)}`;
    return { status: 'manual_pending', link };
  }
}

/**
 * WhatsApp Cloud API (Meta). Envía de verdad y sin intervención humana.
 *
 * Requiere cuenta de Meta Business, número verificado y — fuera de la ventana de 24 h
 * de atención al cliente — una plantilla aprobada. Por eso el envío de texto libre sólo
 * funciona si la familia escribió antes; para el reporte diario programado hay que
 * configurar `WHATSAPP_TEMPLATE_NAME`.
 */
export class CloudApiWhatsappProvider implements WhatsappProvider {
  readonly name = 'cloud' as const;
  private readonly log = new Logger('WhatsappCloudApi');

  constructor(private readonly config: ConfigService) {}

  private get phoneNumberId(): string {
    return this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID') || '';
  }

  private get token(): string {
    return this.config.get<string>('WHATSAPP_TOKEN') || '';
  }

  private get apiVersion(): string {
    return this.config.get<string>('WHATSAPP_API_VERSION') || 'v21.0';
  }

  private get templateName(): string {
    return this.config.get<string>('WHATSAPP_TEMPLATE_NAME') || '';
  }

  private get templateLang(): string {
    return this.config.get<string>('WHATSAPP_TEMPLATE_LANG') || 'es';
  }

  async send(input: WhatsappSendInput): Promise<WhatsappSendResult> {
    if (!this.phoneNumberId || !this.token) {
      return {
        status: 'failed',
        error: 'Faltan WHATSAPP_PHONE_NUMBER_ID o WHATSAPP_TOKEN',
      };
    }

    // Con plantilla configurada se usa esa vía: es la única que permite iniciar la
    // conversación. El texto del reporte va como parámetro del cuerpo.
    const payload = this.templateName
      ? {
          messaging_product: 'whatsapp',
          to: input.to,
          type: 'template',
          template: {
            name: this.templateName,
            language: { code: this.templateLang },
            components: [
              {
                type: 'body',
                parameters: [{ type: 'text', text: input.body.slice(0, 1024) }],
              },
            ],
          },
        }
      : {
          messaging_product: 'whatsapp',
          to: input.to,
          type: 'text',
          text: { preview_url: false, body: input.body.slice(0, 4096) },
        };

    try {
      const res = await fetch(
        `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = data?.error?.message || `HTTP ${res.status}`;
        this.log.warn(`Envío fallido a ${input.to}: ${error}`);
        return { status: 'failed', error };
      }
      return { status: 'sent', externalId: data?.messages?.[0]?.id || '' };
    } catch (e: any) {
      const error = e?.message || String(e);
      this.log.warn(`Error de red enviando a ${input.to}: ${error}`);
      return { status: 'failed', error };
    }
  }
}
