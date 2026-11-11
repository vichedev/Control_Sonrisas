import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, promises as fs, readFileSync } from 'fs';
import { join, resolve } from 'path';
import * as QRCode from 'qrcode';
import type { WhatsappSendResult } from './whatsapp.provider';

/**
 * WhatsApp del centro vinculado por QR (WhatsApp Web multidispositivo, librería Baileys).
 *
 * - La sesión se guarda en `WHATSAPP_SESSION_DIR` (por defecto `./.wa-auth`).
 * - Los envíos pasan por una cola con ritmo pausado (para que WhatsApp no bloquee el número).
 * - Nunca tumba la aplicación: cualquier error queda en `lastError`.
 */

export type LinkedState = 'disconnected' | 'connecting' | 'qr' | 'connected' | 'logged_out';

export interface LinkedStatus {
  state: LinkedState;
  phone: string;
  name: string;
  /** QR actual como data URL (sólo en estado 'qr'). */
  qr: string;
  qrUpdatedAt: string | null;
  connectedSince: string | null;
  lastError: string;
  hasSession: boolean;
  queueLength: number;
  sentLastMinute: number;
}

interface Job {
  to: string;
  text: string;
  attempts: number;
  resolve: (r: WhatsappSendResult) => void;
}

// Baileys 7 es sólo ESM: con `module: commonjs`, TS convertiría `import()` en `require()`.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>;

// Ritmo de envío: un mensaje cada 2–4 s y como máximo 20 por minuto.
const MIN_GAP_MS = 2000;
const MAX_GAP_MS = 4000;
const MAX_PER_MINUTE = 20;
const MAX_RETRIES = 2;
const MAX_QUEUE = 500;
const SEND_TIMEOUT_MS = 30_000;
/** Cuánto espera un mensaje en cola a que vuelva la conexión antes de darse por fallido. */
const WAIT_RECONNECT_MS = 90_000;
const MAX_RECONNECT_ATTEMPTS = 12;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(msg)), ms);
    p.then(
      (v) => { clearTimeout(t); res(v); },
      (e) => { clearTimeout(t); rej(e); },
    );
  });
}

@Injectable()
export class LinkedWhatsappService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('WhatsappLinked');
  private baileys: any = null;
  private logger: any = null;
  private sock: any = null;
  /** Se incrementa en cada socket nuevo: los eventos de sockets viejos se ignoran. */
  private generation = 0;
  private state: LinkedState = 'disconnected';
  private qrDataUrl = '';
  private qrUpdatedAt: Date | null = null;
  private connectedSince: Date | null = null;
  private phone = '';
  private name = '';
  private lastError = '';
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private destroyed = false;

  private readonly queue: Job[] = [];
  private processing = false;
  private lastSendAt = 0;
  private sentTimes: number[] = [];
  /** Caché de onWhatsApp: número → jid (o null si no tiene WhatsApp). */
  private readonly lookup = new Map<string, { jid: string | null; at: number }>();
  private readonly listeners = new Set<(s: LinkedState) => void>();

  constructor(private readonly config: ConfigService) {}

  get sessionDir(): string {
    return resolve(process.cwd(), this.config.get<string>('WHATSAPP_SESSION_DIR') || '.wa-auth');
  }

  /** Hay sesión sólo si el teléfono llegó a vincularse (creds con `me`). */
  hasSession(): boolean {
    const file = join(this.sessionDir, 'creds.json');
    if (!existsSync(file)) return false;
    try {
      return !!JSON.parse(readFileSync(file, 'utf8'))?.me?.id;
    } catch {
      return false;
    }
  }

  get isConnected(): boolean {
    return this.state === 'connected' && !!this.sock;
  }

  get currentState(): LinkedState {
    return this.state;
  }

  onStateChange(fn: (s: LinkedState) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Arranque automático si ya hay sesión guardada. No bloquea el arranque. */
  onApplicationBootstrap() {
    if (!this.hasSession()) return;
    setTimeout(() => {
      this.connect().catch((e) => this.log.warn(`No se pudo reconectar WhatsApp: ${e?.message || e}`));
    }, 1500);
  }

  async onModuleDestroy() {
    this.destroyed = true;
    this.clearReconnect();
    this.closeSocket();
    this.failQueue('El servidor se está reiniciando');
  }

  status(): LinkedStatus {
    const now = Date.now();
    this.sentTimes = this.sentTimes.filter((t) => now - t < 60_000);
    return {
      state: this.state,
      phone: this.phone,
      name: this.name,
      qr: this.state === 'qr' ? this.qrDataUrl : '',
      qrUpdatedAt: this.state === 'qr' && this.qrUpdatedAt ? this.qrUpdatedAt.toISOString() : null,
      connectedSince: this.connectedSince ? this.connectedSince.toISOString() : null,
      lastError: this.lastError,
      hasSession: this.hasSession(),
      queueLength: this.queue.length,
      sentLastMinute: this.sentTimes.length,
    };
  }

  // ------------------------------------------------------------------ conexión

  /** Inicia la conexión (con sesión → reconecta; sin sesión → genera QR). */
  async connect(): Promise<LinkedStatus> {
    if (this.sock && (this.state === 'connected' || this.state === 'connecting' || this.state === 'qr')) {
      return this.status();
    }
    this.clearReconnect();
    this.reconnectAttempts = 0;
    this.lastError = '';
    await this.start();
    return this.status();
  }

  /** Cierra el socket y vuelve a abrirlo (p. ej. para pedir un QR nuevo). */
  async restart(): Promise<LinkedStatus> {
    this.clearReconnect();
    this.closeSocket();
    this.reconnectAttempts = 0;
    this.lastError = '';
    await this.start();
    return this.status();
  }

  /** Detiene la conexión sin borrar la sesión (o cancela un QR pendiente). */
  async stop(): Promise<LinkedStatus> {
    this.clearReconnect();
    this.closeSocket();
    if (!this.hasSession()) await this.clearSession(); // QR cancelado: no deja restos
    this.lastError = '';
    this.setState('disconnected');
    this.failQueue('WhatsApp detenido');
    return this.status();
  }

  /** Desvincula el número: cierra la sesión en WhatsApp y borra la carpeta local. */
  async logout(): Promise<LinkedStatus> {
    this.clearReconnect();
    const sock = this.sock;
    const wasLinked = this.state === 'connected';
    if (sock && wasLinked) {
      try {
        await withTimeout(sock.logout(), 10_000, 'timeout');
      } catch (e: any) {
        this.log.warn(`logout: ${e?.message || e}`);
      }
    }
    this.closeSocket();
    await this.clearSession();
    this.failQueue('WhatsApp desvinculado');
    this.setState(wasLinked ? 'logged_out' : 'disconnected');
    return this.status();
  }

  private async loadBaileys() {
    if (!this.baileys) {
      this.baileys = await dynamicImport('@whiskeysockets/baileys');
      const pino = (await dynamicImport('pino')).default;
      this.logger = pino({ level: this.config.get<string>('WHATSAPP_LOG_LEVEL') || 'silent' });
    }
    return this.baileys;
  }

  private async start() {
    if (this.destroyed) return;
    const gen = ++this.generation;
    this.setState('connecting');
    try {
      const b = await this.loadBaileys();
      await fs.mkdir(this.sessionDir, { recursive: true });
      const { state, saveCreds } = await b.useMultiFileAuthState(this.sessionDir);

      // Versión actual de WhatsApp Web; si falla la consulta se usa la que trae Baileys.
      let version: number[] | undefined;
      try {
        const v: any = await withTimeout(b.fetchLatestBaileysVersion(), 6000, 'timeout');
        if (Array.isArray(v?.version)) version = v.version;
      } catch {
        /* versión por defecto */
      }
      if (gen !== this.generation) return;

      const sock = b.makeWASocket({
        auth: { creds: state.creds, keys: b.makeCacheableSignalKeyStore(state.keys, this.logger) },
        logger: this.logger,
        ...(version ? { version } : {}),
        browser: ['Sonrisas', 'Chrome', '1.0.0'],
        markOnlineOnConnect: false,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        generateHighQualityLinkPreview: false,
        // Sólo enviamos: no hace falta guardar mensajes para reintentos de descifrado.
        getMessage: async () => undefined,
      });
      this.sock = sock;
      sock.ev.on('creds.update', () => {
        saveCreds().catch((e: any) => this.log.warn(`No se pudo guardar la sesión: ${e?.message || e}`));
      });
      sock.ev.on('connection.update', (u: any) => {
        this.onConnectionUpdate(gen, sock, u).catch((e) =>
          this.log.warn(`connection.update: ${e?.message || e}`),
        );
      });
    } catch (e: any) {
      if (gen !== this.generation) return;
      this.lastError = `No se pudo iniciar WhatsApp: ${e?.message || e}`;
      this.log.error(this.lastError);
      this.sock = null;
      this.setState('disconnected');
      if (this.hasSession()) this.scheduleReconnect();
    }
  }

  private async onConnectionUpdate(gen: number, sock: any, u: any) {
    if (gen !== this.generation) return;
    const { connection, lastDisconnect, qr } = u || {};

    if (qr) {
      this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 360 });
      this.qrUpdatedAt = new Date();
      this.setState('qr');
    }

    if (connection === 'open') {
      const id: string = sock.user?.id || '';
      this.phone = id.split(':')[0].split('@')[0].replace(/\D/g, '');
      this.name = sock.user?.name || sock.user?.verifiedName || sock.user?.notify || '';
      this.connectedSince = new Date();
      this.reconnectAttempts = 0;
      this.lastError = '';
      this.qrDataUrl = '';
      this.setState('connected');
      this.log.log(`WhatsApp vinculado conectado (${this.phone || 'número desconocido'})`);
      this.processQueue();
      return;
    }

    if (connection !== 'close') return;

    const code: number | undefined =
      lastDisconnect?.error?.output?.statusCode ?? lastDisconnect?.error?.statusCode;
    const reason = lastDisconnect?.error?.message || '';
    const R = this.baileys?.DisconnectReason || {};
    this.sock = null;
    this.connectedSince = null;

    if (code === R.loggedOut || code === R.forbidden) {
      // Desvinculado desde el teléfono (o bloqueado): la sesión ya no sirve.
      this.log.warn(`WhatsApp cerró la sesión (código ${code})`);
      await this.clearSession();
      this.lastError =
        code === R.forbidden
          ? 'WhatsApp rechazó la sesión (número bloqueado o restringido).'
          : 'El número se desvinculó desde el teléfono.';
      this.failQueue('WhatsApp desvinculado');
      this.setState('logged_out');
      return;
    }

    if (code === R.connectionReplaced) {
      // Otra instancia del servidor abrió la misma sesión: no peleamos por ella.
      this.lastError = 'La sesión se abrió en otro servidor. Pulsa "Conectar" para recuperarla.';
      this.log.warn(this.lastError);
      this.setState('disconnected');
      return;
    }

    const registered = !!sock?.authState?.creds?.registered || !!sock?.authState?.creds?.me;
    if (code === R.restartRequired) {
      // Normal justo después de escanear el QR.
      await this.start();
      return;
    }

    if (!registered) {
      // El QR expiró sin escanearse: no se reintenta solo.
      this.lastError = this.state === 'qr' ? 'El código QR expiró. Genera uno nuevo.' : reason;
      this.qrDataUrl = '';
      await this.clearSession(); // restos de un intento sin vincular
      this.setState('disconnected');
      return;
    }

    this.lastError = reason ? `Conexión perdida: ${reason}` : 'Conexión perdida';
    this.setState('connecting');
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.destroyed || this.reconnectTimer) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.lastError = 'No se pudo reconectar con WhatsApp. Pulsa "Conectar" para reintentar.';
      this.setState('disconnected');
      this.failQueue('WhatsApp desconectado');
      return;
    }
    const delay = Math.min(60_000, 2000 * 2 ** this.reconnectAttempts) + Math.random() * 1000;
    this.reconnectAttempts++;
    this.setState('connecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start().catch(() => undefined);
    }, delay);
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private closeSocket() {
    this.generation++; // ignora los eventos del socket que se cierra
    const sock = this.sock;
    this.sock = null;
    this.qrDataUrl = '';
    this.connectedSince = null;
    if (!sock) return;
    try {
      sock.ev?.removeAllListeners?.('connection.update');
      sock.end?.(undefined);
    } catch {
      /* ya cerrado */
    }
  }

  private async clearSession() {
    this.phone = '';
    this.name = '';
    this.lookup.clear();
    try {
      await fs.rm(this.sessionDir, { recursive: true, force: true });
    } catch (e: any) {
      this.log.warn(`No se pudo borrar la sesión: ${e?.message || e}`);
    }
  }

  private setState(s: LinkedState) {
    if (this.state === s) return;
    this.state = s;
    for (const fn of this.listeners) {
      try {
        fn(s);
      } catch {
        /* nada */
      }
    }
  }

  // ------------------------------------------------------------------ envío

  /**
   * Encola un texto y espera a que salga de verdad. Resuelve 'sent' cuando WhatsApp
   * aceptó el mensaje y 'failed' si no se pudo (nunca lanza).
   */
  send(to: string, text: string): Promise<WhatsappSendResult> {
    const digits = (to || '').replace(/\D/g, '');
    if (!digits) return Promise.resolve({ status: 'failed', error: 'Número inválido' });
    if (!this.isConnected) {
      return Promise.resolve({ status: 'failed', error: 'El WhatsApp del centro no está conectado' });
    }
    if (this.queue.length >= MAX_QUEUE) {
      return Promise.resolve({ status: 'failed', error: 'Cola de WhatsApp llena, intenta más tarde' });
    }
    return new Promise<WhatsappSendResult>((resolveJob) => {
      this.queue.push({ to: digits, text, attempts: 0, resolve: resolveJob });
      this.processQueue();
    });
  }

  get queueLength(): number {
    return this.queue.length;
  }

  private failQueue(error: string) {
    while (this.queue.length) this.queue.shift()!.resolve({ status: 'failed', error });
  }

  private async processQueue() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length && !this.destroyed) {
        // Espera a que vuelva la conexión (reconexión automática) antes de fallar.
        if (!this.isConnected) {
          const since = Date.now();
          while (!this.isConnected && Date.now() - since < WAIT_RECONNECT_MS && this.queue.length) {
            if (this.state === 'logged_out' || (this.state === 'disconnected' && !this.reconnectTimer)) break;
            await sleep(1000);
          }
          if (!this.isConnected) {
            this.failQueue('El WhatsApp del centro no está conectado');
            break;
          }
        }

        await this.waitForSlot();
        const job = this.queue[0];
        if (!job) break;
        const res = await this.trySend(job);
        if (res.status === 'failed' && res.retry && job.attempts < MAX_RETRIES) {
          job.attempts++;
          await sleep(4000 * job.attempts);
          continue; // sigue al frente de la cola
        }
        this.queue.shift();
        job.resolve({ status: res.status, externalId: res.externalId, error: res.error });
      }
    } finally {
      this.processing = false;
    }
  }

  /** Respeta la pausa mínima entre mensajes y el tope por minuto. */
  private async waitForSlot() {
    for (;;) {
      const now = Date.now();
      this.sentTimes = this.sentTimes.filter((t) => now - t < 60_000);
      const gap = MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS);
      const waitGap = this.lastSendAt + gap - now;
      const waitMinute =
        this.sentTimes.length >= MAX_PER_MINUTE ? this.sentTimes[0] + 60_000 - now : 0;
      const wait = Math.max(waitGap, waitMinute);
      if (wait <= 0) return;
      await sleep(Math.min(wait, 5000));
      if (wait <= 5000) return;
    }
  }

  private async resolveJid(to: string): Promise<string | null> {
    const cached = this.lookup.get(to);
    if (cached && Date.now() - cached.at < 24 * 3600_000) return cached.jid;
    const res = await withTimeout(
      this.sock.onWhatsApp(`${to}@s.whatsapp.net`),
      15_000,
      'WhatsApp no respondió a la verificación del número',
    );
    const hit = Array.isArray(res) ? res.find((r: any) => r?.exists) : null;
    const jid = hit ? hit.jid || `${to}@s.whatsapp.net` : null;
    this.lookup.set(to, { jid, at: Date.now() });
    return jid;
  }

  private async trySend(
    job: Job,
  ): Promise<{ status: 'sent' | 'failed'; externalId?: string; error?: string; retry?: boolean }> {
    if (!this.isConnected) return { status: 'failed', error: 'Desconectado', retry: true };
    try {
      const jid = await this.resolveJid(job.to);
      if (!jid) return { status: 'failed', error: `El número +${job.to} no tiene WhatsApp` };
      this.lastSendAt = Date.now();
      const msg = await withTimeout(
        this.sock.sendMessage(jid, { text: job.text.slice(0, 4096) }),
        SEND_TIMEOUT_MS,
        'WhatsApp no confirmó el envío a tiempo',
      );
      this.sentTimes.push(Date.now());
      return { status: 'sent', externalId: (msg as any)?.key?.id || '' };
    } catch (e: any) {
      this.lastSendAt = Date.now();
      const error = e?.message || String(e);
      this.log.warn(`Envío fallido a ${job.to}: ${error}`);
      return { status: 'failed', error, retry: true };
    }
  }
}
