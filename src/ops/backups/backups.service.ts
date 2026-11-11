import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import * as fs from 'fs';
import { opsConfig } from '../ops.config';
import {
  BackupBusyError,
  BackupEngine,
  BackupInvalidError,
  BackupNotFoundError,
  BACKUP_NAME_RE,
} from './backup-engine';
import { UpdaterService } from '../system/updater.service';

export interface Actor {
  id: string;
  email: string;
  name?: string;
}

export interface Operation {
  id: string;
  type: 'create' | 'restore' | 'upload';
  state: 'running' | 'success' | 'error';
  file?: string;
  message?: string;
  startedAt: string;
  finishedAt?: string;
  by: string;
}

/** Traduce los errores del motor a respuestas HTTP. */
export function mapEngineError(e: any): never {
  if (e instanceof BackupBusyError) throw new ConflictException(e.message);
  if (e instanceof BackupNotFoundError) throw new NotFoundException(e.message);
  if (e instanceof BackupInvalidError) throw new BadRequestException(e.message);
  throw e;
}

@Injectable()
export class BackupsService implements OnModuleInit {
  private readonly logger = new Logger('Backups');
  readonly cfg = opsConfig();
  readonly engine = new BackupEngine(this.cfg, (m) => this.logger.log(m));
  private op: Operation | null = null;
  private readonly tokenKey: Buffer;
  private readonly usedTokens = new Map<string, number>();

  constructor(
    config: ConfigService,
    private readonly updater: UpdaterService,
  ) {
    // Clave propia para los enlaces de descarga, derivada del JWT_SECRET.
    this.tokenKey = createHash('sha256')
      .update(`sonrisas-backup-download:${config.get<string>('JWT_SECRET') || randomBytes(32).toString('hex')}`)
      .digest();
  }

  async onModuleInit() {
    try {
      await this.engine.ensureDir();
    } catch (e: any) {
      this.logger.warn(`No se pudo preparar ${this.cfg.backupDir}: ${e?.message || e}`);
    }
    if (this.cfg.encryptionKey && this.cfg.encryptionKey.length < 16) {
      this.logger.warn('BACKUP_ENCRYPTION_KEY es muy corta (mínimo recomendado: 32 caracteres).');
    }
  }

  settings() {
    return {
      encrypted: this.engine.encrypted,
      retention: this.cfg.retention,
      uploadMaxMb: Math.round(this.cfg.uploadMaxBytes / 1048576),
      inProcessRestore: this.cfg.inProcessRestore,
      schedule: process.env.BACKUP_CRON || '15 3 * * *',
    };
  }

  async overview() {
    let items: any[] = [];
    let error: string | null = null;
    try {
      items = await this.engine.list();
    } catch (e: any) {
      error = e?.message || String(e);
    }
    let freeBytes: number | null = null;
    try {
      const s = await (fs.promises as any).statfs?.(this.cfg.backupDir);
      if (s) freeBytes = Number(s.bavail) * Number(s.bsize);
    } catch {
      /* no disponible */
    }
    return {
      items,
      error,
      freeBytes,
      operation: this.op,
      busy: this.engine.isBusy(),
      settings: this.settings(),
      updater: this.updater.status(),
    };
  }

  private begin(type: Operation['type'], actor: Actor, file?: string): Operation {
    if (this.op?.state === 'running') throw new ConflictException('Ya hay una operación de respaldo en curso');
    if (this.engine.isBusy()) throw new ConflictException('Hay otra operación de respaldo en curso (posiblemente el respaldo nocturno)');
    this.op = {
      id: randomBytes(6).toString('hex'),
      type,
      state: 'running',
      file,
      startedAt: new Date().toISOString(),
      by: actor.email,
    };
    return this.op;
  }

  private finish(op: Operation, ok: boolean, message: string, file?: string) {
    op.state = ok ? 'success' : 'error';
    op.message = message;
    op.finishedAt = new Date().toISOString();
    if (file) op.file = file;
  }

  /** Respaldo manual en segundo plano. El progreso se consulta en `overview().operation`. */
  startCreate(actor: Actor, note?: string, onDone?: (ok: boolean, file?: string, msg?: string) => void): Operation {
    const op = this.begin('create', actor);
    this.engine
      .create('manual', { createdBy: actor.email, note })
      .then((info) => {
        this.finish(op, true, 'Respaldo creado', info.file);
        onDone?.(true, info.file);
      })
      .catch((e) => {
        this.logger.error(`Respaldo manual falló: ${e?.message || e}`);
        this.finish(op, false, e?.message || 'Error al crear el respaldo');
        onDone?.(false, undefined, e?.message);
      });
    return op;
  }

  async importUpload(tmpPath: string, actor: Actor) {
    try {
      return await this.engine.importFile(tmpPath, { createdBy: actor.email });
    } catch (e) {
      await fs.promises.rm(tmpPath, { force: true }).catch(() => undefined);
      mapEngineError(e);
    }
  }

  async remove(file: string) {
    try {
      await this.engine.delete(file);
    } catch (e) {
      mapEngineError(e);
    }
  }

  async verify(file: string) {
    try {
      return await this.engine.verify(file);
    } catch (e) {
      mapEngineError(e);
    }
  }

  /**
   * Restaurar: con actualizador → tarea (detiene la api, restaura con intercambio de BD,
   * arranca y verifica). Sin actualizador (desarrollo) → en el propio proceso, tras un
   * respaldo de seguridad automático.
   */
  restore(file: string, actor: Actor, onDone?: (ok: boolean, msg?: string, safety?: string) => void) {
    try {
      this.engine.resolve(file);
    } catch (e) {
      mapEngineError(e);
    }
    if (!BACKUP_NAME_RE.test(file)) throw new BadRequestException('Ese respaldo es del formato anterior: se restaura a mano (ver DEPLOY.md)');
    if (this.updater.status().online) {
      const { jobId } = this.updater.submit('restore', { file }, actor);
      return { mode: 'updater' as const, jobId };
    }
    if (!this.cfg.inProcessRestore) {
      throw new ServiceUnavailableException(
        'El actualizador no está disponible. Restaura desde el servidor: ./deploy.sh restore <archivo>',
      );
    }
    const op = this.begin('restore', actor, file);
    (async () => {
      let safety: string | undefined;
      try {
        const s = await this.engine.create('pre-restore', { createdBy: actor.email, note: `Antes de restaurar ${file}` });
        safety = s.file;
        await this.engine.restore(file, { mode: 'inplace' });
        this.finish(op, true, `Restaurado. Respaldo de seguridad previo: ${safety}`, file);
        onDone?.(true, undefined, safety);
      } catch (e: any) {
        this.logger.error(`Restauración falló: ${e?.message || e}`);
        this.finish(op, false, e?.message || 'Error al restaurar', file);
        onDone?.(false, e?.message, safety);
      }
    })();
    return { mode: 'inprocess' as const, operationId: op.id };
  }

  // -------------------------------------------------------------- descargas
  /** Token de un solo uso (2 min) para descargar con un <a href> (sin cabecera Authorization). */
  issueDownloadToken(file: string, actor: Actor): string {
    try {
      this.engine.resolve(file);
    } catch (e) {
      mapEngineError(e);
    }
    const payload = Buffer.from(
      JSON.stringify({ f: file, u: actor.id, e: actor.email, x: Date.now() + 120_000, n: randomBytes(8).toString('hex') }),
    ).toString('base64url');
    const sig = createHmac('sha256', this.tokenKey).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }

  consumeDownloadToken(token: string): { file: string; userId: string; email: string } {
    const [payload, sig] = String(token || '').split('.');
    if (!payload || !sig) throw new ForbiddenException('Enlace de descarga inválido');
    const expected = createHmac('sha256', this.tokenKey).update(payload).digest();
    const got = Buffer.from(sig, 'base64url');
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new ForbiddenException('Enlace de descarga inválido');
    let data: any;
    try {
      data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw new ForbiddenException('Enlace de descarga inválido');
    }
    const now = Date.now();
    for (const [n, exp] of this.usedTokens) if (exp < now) this.usedTokens.delete(n);
    if (!data?.x || data.x < now) throw new ForbiddenException('El enlace de descarga caducó');
    if (this.usedTokens.has(data.n)) throw new ForbiddenException('El enlace de descarga ya se usó');
    this.usedTokens.set(data.n, data.x);
    return { file: data.f, userId: data.u, email: data.e };
  }
}
