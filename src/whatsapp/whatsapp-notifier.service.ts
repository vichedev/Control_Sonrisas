import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from 'rxjs';
import { RealtimeService } from '../realtime/realtime.service';
import { RealtimeEvent } from '../realtime/realtime.types';
import { ChildGuardian } from '../children/child-guardian.entity';
import { Child } from '../children/child.entity';
import { ChildAttendance } from '../attendance/child-attendance.entity';
import { DailyLog } from '../daily-logs/daily-log.entity';
import { Justification } from '../justifications/justification.entity';
import { AppBranding } from '../branding/branding.entity';
import { dayKey, minutesOfDay, timeKey } from '../common/day.util';
import { WhatsappSettings } from './whatsapp-settings.entity';
import { WhatsappService } from './whatsapp.service';
import { LinkedWhatsappService } from './linked-whatsapp.service';
import { ConsentsService } from '../consents/consents.service';

export type NotifyKind = 'arrival' | 'pickup' | 'health' | 'justification';

export interface UpdateSettingsInput {
  enabled?: boolean;
  notifyArrival?: boolean;
  notifyPickup?: boolean;
  notifyHealth?: boolean;
  notifyJustification?: boolean;
  quietStart?: string;
  quietEnd?: string;
  signature?: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const fmtDate = (d: string) => {
  const [y, m, day] = (d || '').split('-');
  return y && m && day ? `${day}/${m}/${y}` : d || '';
};

/**
 * Avisos automáticos "de cualquier novedad" por el WhatsApp vinculado del centro.
 *
 * Escucha el bus interno (`RealtimeService.events$`) y escribe a los representantes con
 * recepción de reportes activada. Sólo usa el WhatsApp vinculado: si no está conectado,
 * el aviso queda registrado como fallido (nunca se abren enlaces wa.me).
 */
@Injectable()
export class WhatsappNotifierService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('WhatsappNotifier');
  private sub: Subscription | null = null;
  private cache: WhatsappSettings | null = null;
  /** Claves ya procesadas en este proceso (evita carreras entre eventos casi simultáneos). */
  private readonly seen = new Map<string, number>();

  constructor(
    @InjectRepository(WhatsappSettings) private readonly settingsRepo: Repository<WhatsappSettings>,
    @InjectRepository(ChildGuardian) private readonly linksRepo: Repository<ChildGuardian>,
    @InjectRepository(Child) private readonly childrenRepo: Repository<Child>,
    @InjectRepository(ChildAttendance) private readonly attendanceRepo: Repository<ChildAttendance>,
    @InjectRepository(DailyLog) private readonly logsRepo: Repository<DailyLog>,
    @InjectRepository(Justification) private readonly justRepo: Repository<Justification>,
    @InjectRepository(AppBranding) private readonly brandingRepo: Repository<AppBranding>,
    private readonly realtime: RealtimeService,
    private readonly whatsapp: WhatsappService,
    private readonly linked: LinkedWhatsappService,
    private readonly consents: ConsentsService,
  ) {}

  onModuleInit() {
    this.sub = this.realtime.events$.subscribe((ev) => {
      this.handle(ev).catch((e) => this.log.warn(`Aviso no enviado: ${e?.message || e}`));
    });
  }

  onModuleDestroy() {
    this.sub?.unsubscribe();
  }

  // ------------------------------------------------------------------ ajustes

  async getSettings(): Promise<WhatsappSettings> {
    if (this.cache) return this.cache;
    const found = await this.settingsRepo.find({ take: 1 });
    this.cache = found[0] || (await this.settingsRepo.save(this.settingsRepo.create({})));
    return this.cache;
  }

  async updateSettings(input: UpdateSettingsInput): Promise<WhatsappSettings> {
    const s = await this.getSettings();
    const bools: Array<keyof UpdateSettingsInput> = [
      'enabled',
      'notifyArrival',
      'notifyPickup',
      'notifyHealth',
      'notifyJustification',
    ];
    for (const k of bools) if (typeof input[k] === 'boolean') (s as any)[k] = input[k];
    for (const k of ['quietStart', 'quietEnd'] as const) {
      if (input[k] === undefined) continue;
      const v = String(input[k] || '').trim();
      if (v && !HHMM.test(v)) throw new Error(`${k} debe tener formato HH:mm`);
      s[k] = v;
    }
    if (input.signature !== undefined) s.signature = String(input.signature).trim().slice(0, 120);
    this.cache = await this.settingsRepo.save(s);
    return this.cache;
  }

  async defaultSignature(): Promise<string> {
    try {
      const b = await this.brandingRepo.find({ take: 1, order: { createdAt: 'ASC' } });
      return b[0]?.companyName || 'Sonrisas';
    } catch {
      return 'Sonrisas';
    }
  }

  /** Ajustes + datos que necesita el panel para mostrar los ejemplos. */
  async settingsView() {
    const s = await this.getSettings();
    const defaultSignature = await this.defaultSignature();
    return {
      ...s,
      defaultSignature,
      quietNow: this.inQuietHours(s),
      examples: this.examples(s.signature || defaultSignature),
    };
  }

  private examples(signature: string) {
    const sign = (t: string) => this.withSignature(t, signature);
    return {
      arrival: sign('✅ Sofía llegó a la guardería a las 08:05.'),
      pickup: sign('👋 Sofía salió a las 16:30 con María Pérez (mamá).'),
      health: sign('⚠️ Aviso sobre Sofía: Tiene 38,2 °C de temperatura, le dimos agua y está descansando.'),
      justification: sign(
        '📝 La justificación de ausencia de Sofía (10/11/2026) fue aprobada.',
      ),
    };
  }

  private withSignature(text: string, signature: string) {
    return signature ? `${text}\n\n— ${signature}` : text;
  }

  /** ¿Estamos en horario de silencio? Admite rangos que cruzan medianoche (20:00–06:30). */
  inQuietHours(s: WhatsappSettings, now = new Date()): boolean {
    if (!s.quietStart || !s.quietEnd || s.quietStart === s.quietEnd) return false;
    const cur = minutesOfDay(timeKey(now));
    const a = minutesOfDay(s.quietStart);
    const b = minutesOfDay(s.quietEnd);
    return a < b ? cur >= a && cur < b : cur >= a || cur < b;
  }

  // ------------------------------------------------------------------ eventos

  private async handle(ev: RealtimeEvent) {
    if (!ev) return;
    const relevant =
      (ev.entity === 'attendance' && ev.action === 'created') ||
      (ev.entity === 'daily_log' && ev.action === 'created') ||
      (ev.entity === 'justification' && ev.action === 'updated');
    if (!relevant) return;

    const s = await this.getSettings();
    if (!s.enabled) return;

    if (ev.entity === 'attendance') {
      const rec: ChildAttendance | null =
        ev.record || (ev.id ? await this.attendanceRepo.findOne({ where: { id: ev.id } }) : null);
      if (!rec || rec.date !== dayKey()) return; // registros de días pasados: no avisar
      if (rec.type === 'in' && s.notifyArrival) {
        const when = timeKey(new Date(rec.createdAt || Date.now()));
        await this.notify(s, 'arrival', rec.id, rec.childId, (n) => `✅ ${n} llegó a la guardería a las ${when}.`);
      } else if (rec.type === 'out' && s.notifyPickup) {
        const when = timeKey(new Date(rec.createdAt || Date.now()));
        const who = rec.personName
          ? ` con ${rec.personName}${rec.personRelationship ? ` (${rec.personRelationship})` : ''}`
          : '';
        await this.notify(s, 'pickup', rec.id, rec.childId, (n) => `👋 ${n} salió a las ${when}${who}.`);
      }
      return;
    }

    if (ev.entity === 'daily_log') {
      if (!s.notifyHealth) return;
      const rec: DailyLog | null =
        ev.record || (ev.id ? await this.logsRepo.findOne({ where: { id: ev.id } }) : null);
      if (!rec || !rec.notifyGuardian) return;
      if (rec.kind !== 'health' && rec.kind !== 'incident') return;
      if (rec.date && rec.date < dayKey(new Date(Date.now() - 86400_000))) return;
      const parts: string[] = [];
      if (rec.notes) parts.push(rec.notes.trim());
      if (rec.temperature != null) parts.push(`Temperatura: ${String(rec.temperature).replace('.', ',')} °C.`);
      if (!parts.length) parts.push(rec.kind === 'incident' ? 'Tuvo un incidente.' : 'Hay una novedad de salud.');
      const body = parts.join(' ');
      const sent = await this.notify(s, 'health', rec.id, rec.childId, (n) => `⚠️ Aviso sobre ${n}: ${body}`);
      if (sent > 0) {
        // Queda como "familia avisada" (la bandeja de pendientes deja de mostrarlo).
        await this.logsRepo.update({ id: rec.id }, { guardianNotified: true }).catch(() => undefined);
      }
      return;
    }

    if (ev.entity === 'justification') {
      if (!s.notifyJustification) return;
      const rec: Justification | null =
        ev.record || (ev.id ? await this.justRepo.findOne({ where: { id: ev.id } }) : null);
      if (!rec || (rec.status !== 'approved' && rec.status !== 'rejected')) return;
      const range =
        rec.dateFrom === rec.dateTo
          ? fmtDate(rec.dateFrom)
          : `${fmtDate(rec.dateFrom)} al ${fmtDate(rec.dateTo)}`;
      const verdict = rec.status === 'approved' ? 'fue aprobada' : 'no fue aprobada';
      const icon = rec.status === 'approved' ? '📝' : '❗';
      const note = rec.adminNote ? `\nComentario: ${rec.adminNote.trim()}` : '';
      // Un aviso por estado: si se cambia de aprobada a rechazada se vuelve a avisar.
      await this.notify(
        s,
        'justification',
        rec.id,
        rec.childId,
        (n) => `${icon} La justificación de ausencia de ${n} (${range}) ${verdict}.${note}`,
        `justification_${rec.status}`,
      );
    }
  }

  /** Envía el aviso a cada representante. Devuelve cuántos salieron. */
  private async notify(
    s: WhatsappSettings,
    kind: NotifyKind,
    recordId: string,
    childId: string,
    compose: (childName: string) => string,
    sourceOverride?: string,
  ): Promise<number> {
    if (!recordId || !childId) return 0;
    const source = sourceOverride || kind;

    if (this.inQuietHours(s)) {
      this.log.log(`Horario de silencio: no se envía ${source} (${recordId})`);
      return 0;
    }

    const key = `${source}:${recordId}`;
    this.pruneSeen();
    if (this.seen.has(key)) return 0;
    this.seen.set(key, Date.now());

    const child = await this.childrenRepo.findOne({ where: { id: childId } });
    if (!child) return 0;
    // La familia rechazó los avisos por WhatsApp (LOPDP): se omite sin registrar error.
    if (!(await this.consents.canWhatsapp(childId))) return 0;
    const links = await this.linksRepo.find({
      where: { childId, receivesReport: true },
      relations: ['guardian'],
    });
    const recipients = links.filter((l) => l.guardian?.active && !!l.guardian.phone);
    if (!recipients.length) return 0;

    const signature = s.signature || (await this.defaultSignature());
    const body = this.withSignature(compose(child.firstName), signature);
    let sent = 0;

    for (const l of recipients) {
      try {
        if (await this.whatsapp.alreadyNotified(source, recordId, l.guardianId)) continue;
        const msg = await this.whatsapp.send({
          phone: l.guardian.phone,
          body,
          toName: l.guardian.name,
          childId,
          guardianId: l.guardianId,
          source,
          sourceRef: recordId,
          linkedOnly: true,
        });
        if (msg.status === 'sent') sent++;
      } catch (e: any) {
        this.log.warn(`Aviso ${source} a ${l.guardian?.name}: ${e?.message || e}`);
      }
    }
    if (!this.linked.isConnected) this.log.warn(`Aviso ${source} sin enviar: WhatsApp no conectado`);
    return sent;
  }

  private pruneSeen() {
    const limit = Date.now() - 6 * 3600_000;
    for (const [k, t] of this.seen) if (t < limit) this.seen.delete(k);
  }
}
