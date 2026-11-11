import { createHash, Hash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { PassThrough, Transform, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import { Client } from 'pg';
import { BackupKind, OpsConfig } from '../ops.config';
import { safeEntryPath, TarPacker, TarParser, writeAsync } from './tar';
import { createDecryptStream, createEncryptStream, isEncryptedFile } from './crypto-stream';
import { pgBinary, pgEnv, pgMajor, run } from './pg-tools';

/**
 * Motor de respaldos (sin Nest): lo usan la api, el contenedor nocturno y deploy.sh
 * (a través de `node dist/ops/cli.js`), así todos producen y leen el MISMO formato.
 *
 * Archivo: sonrisas-backup-AAAAMMDD-HHMMSS-<tipo>.tar[.enc]
 *   manifest.json   versión, fecha, tamaños y sha256 de cada pieza
 *   db.dump         pg_dump -Fc (formato custom, comprimido)
 *   uploads.tar.gz  fotos (/app/uploads)
 * + un `.json` al lado con el resumen (para listar sin descifrar).
 */

export const BACKUP_FORMAT = 'sonrisas-backup/1';
export const BACKUP_NAME_RE =
  /^sonrisas-backup-(\d{8})-(\d{6})-(nightly|manual|pre-update|pre-restore|pre-rollback|uploaded)\.tar(\.enc)?$/;
/** Respaldos del script anterior (SQL plano + fotos aparte). Se listan y descargan; no se restauran desde la app. */
export const LEGACY_NAME_RE = /^ftw-(uploads-)?(\d{8})-(\d{6})\.(sql\.gz|tar\.gz)$/;

const MEMBERS = new Set(['manifest.json', 'db.dump', 'uploads.tar.gz']);
const SAFETY_KINDS: BackupKind[] = ['pre-update', 'pre-restore', 'pre-rollback'];

export interface BackupManifest {
  format: string;
  kind: BackupKind;
  createdAt: string;
  createdBy: string;
  note: string;
  host: string;
  app: { version: string; commit: string; builtAt: string };
  db: { name: string; file: string; size: number; sha256: string; pgDumpMajor: number };
  uploads: { file: string; size: number; sha256: string; files: number; bytes: number };
}

export interface BackupInfo {
  file: string;
  kind: BackupKind | 'legacy';
  originalKind?: string;
  createdAt: string;
  size: number;
  encrypted: boolean;
  sha256?: string;
  app?: { version: string; commit: string };
  db?: { size: number };
  uploads?: { size: number; files: number; bytes: number };
  createdBy?: string;
  note?: string;
  legacy: boolean;
  restorable: boolean;
}

export class BackupBusyError extends Error {}
export class BackupNotFoundError extends Error {}
export class BackupInvalidError extends Error {}

const pad = (n: number) => String(n).padStart(2, '0');
/** Sello en hora LOCAL del proceso (TZ del contenedor). */
export function stamp(d = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function stampToIso(date: string, time: string): string {
  const d = new Date(
    +date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8),
    +time.slice(0, 2), +time.slice(2, 4), +time.slice(4, 6),
  );
  return d.toISOString();
}
const sidecarOf = (file: string) => file.replace(/\.tar(\.enc)?$/, '.json');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function hashFile(file: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk as Buffer);
  return h.digest('hex');
}

function hashingTransform(h: Hash): Transform {
  return new Transform({
    transform(chunk, _e, cb) {
      h.update(chunk);
      cb(null, chunk);
    },
  });
}

/**
 * Destino de una entrada del TAR: calcula sha256, opcionalmente escribe a un archivo
 * (vía temporal + rename al terminar) y/o reenvía a otro stream (validador de fotos).
 */
class EntrySink extends Writable {
  readonly hash = createHash('sha256');
  size = 0;
  private ws: fs.WriteStream | null = null;

  constructor(
    private readonly file?: { tmp: string; final: string },
    private readonly forward?: { input: Writable; done: Promise<void> },
    private readonly collect?: Buffer[],
  ) {
    super();
    if (file) {
      this.ws = fs.createWriteStream(file.tmp, { mode: 0o640 });
      this.ws.on('error', (e) => this.destroy(e));
    }
  }

  _write(chunk: Buffer, _e: string, cb: (e?: Error | null) => void) {
    this.hash.update(chunk);
    this.size += chunk.length;
    if (this.collect) this.collect.push(chunk);
    const tasks: Promise<void>[] = [];
    if (this.ws) tasks.push(writeAsync(this.ws, chunk));
    if (this.forward) tasks.push(writeAsync(this.forward.input, chunk));
    Promise.all(tasks).then(() => cb(), (e) => cb(e));
  }

  _final(cb: (e?: Error | null) => void) {
    const tasks: Promise<void>[] = [];
    if (this.ws) {
      const ws = this.ws;
      tasks.push(
        new Promise<void>((resolve, reject) => {
          ws.once('close', () => resolve());
          ws.once('error', reject);
          ws.end();
        }).then(() => (this.file ? fs.promises.rename(this.file.tmp, this.file.final) : undefined)),
      );
    }
    if (this.forward) {
      this.forward.input.end();
      tasks.push(this.forward.done);
    }
    Promise.all(tasks).then(() => cb(), (e) => cb(e));
  }
}

export class BackupEngine {
  constructor(
    private readonly cfg: OpsConfig,
    private readonly log: (msg: string) => void = () => undefined,
  ) {}

  get dir() {
    return this.cfg.backupDir;
  }

  get encrypted() {
    return !!this.cfg.encryptionKey;
  }

  async ensureDir() {
    await fs.promises.mkdir(this.dir, { recursive: true });
  }

  /** Valida el nombre (whitelist) y devuelve la ruta absoluta. */
  resolve(file: string): string {
    const name = path.basename(String(file || ''));
    if (name !== file || !(BACKUP_NAME_RE.test(name) || LEGACY_NAME_RE.test(name))) {
      throw new BackupInvalidError('Nombre de respaldo inválido');
    }
    const full = path.join(this.dir, name);
    if (!fs.existsSync(full)) throw new BackupNotFoundError('El respaldo no existe');
    return full;
  }

  // ------------------------------------------------------------------ bloqueo
  private async withLock<T>(op: string, fn: () => Promise<T>): Promise<T> {
    await this.ensureDir();
    const lock = path.join(this.dir, '.lock');
    for (let attempt = 0; ; attempt++) {
      try {
        const fh = await fs.promises.open(lock, 'wx', 0o640);
        await fh.writeFile(JSON.stringify({ op, pid: process.pid, host: os.hostname(), at: new Date().toISOString() }));
        await fh.close();
        break;
      } catch (e: any) {
        if (e?.code !== 'EEXIST') throw e;
        const st = await fs.promises.stat(lock).catch(() => null);
        // Bloqueo huérfano (proceso muerto): más de 6 h.
        if (attempt === 0 && st && Date.now() - st.mtimeMs > 6 * 3600_000) {
          await fs.promises.unlink(lock).catch(() => undefined);
          continue;
        }
        throw new BackupBusyError('Hay otra operación de respaldo en curso. Inténtalo en unos minutos.');
      }
    }
    try {
      return await fn();
    } finally {
      await fs.promises.unlink(lock).catch(() => undefined);
    }
  }

  isBusy(): boolean {
    return fs.existsSync(path.join(this.dir, '.lock'));
  }

  // ------------------------------------------------------------------ listar
  async list(): Promise<BackupInfo[]> {
    await this.ensureDir();
    const names = await fs.promises.readdir(this.dir);
    const out: BackupInfo[] = [];
    for (const name of names) {
      const m = BACKUP_NAME_RE.exec(name);
      const lm = m ? null : LEGACY_NAME_RE.exec(name);
      if (!m && !lm) continue;
      const st = await fs.promises.stat(path.join(this.dir, name)).catch(() => null);
      if (!st?.isFile()) continue;
      if (lm) {
        out.push({
          file: name,
          kind: 'legacy',
          createdAt: stampToIso(lm[2], lm[3]),
          size: st.size,
          encrypted: false,
          note: lm[1] ? 'Fotos (formato anterior)' : 'Base de datos SQL (formato anterior)',
          legacy: true,
          restorable: false,
        });
        continue;
      }
      let side: any = null;
      try {
        side = JSON.parse(await fs.promises.readFile(path.join(this.dir, sidecarOf(name)), 'utf8'));
      } catch {
        /* sin resumen: datos mínimos */
      }
      out.push({
        file: name,
        kind: m[3] as BackupKind,
        originalKind: side?.originalKind,
        createdAt: side?.createdAt || stampToIso(m[1], m[2]),
        size: st.size,
        encrypted: !!m[4],
        sha256: side?.sha256,
        app: side?.app,
        db: side?.db ? { size: side.db.size } : undefined,
        uploads: side?.uploads,
        createdBy: side?.createdBy,
        note: side?.note,
        legacy: false,
        restorable: true,
      });
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  // ------------------------------------------------------------------ crear
  private async dbSizeBytes(): Promise<number> {
    const c = new Client({ ...this.clientCreds(), database: this.cfg.db.database });
    await c.connect();
    try {
      const r = await c.query('SELECT pg_database_size(current_database())::bigint AS s');
      return Number(r.rows[0].s);
    } finally {
      await c.end();
    }
  }

  private async dirSize(dir: string): Promise<{ files: number; bytes: number }> {
    let files = 0;
    let bytes = 0;
    const walk = async (d: string) => {
      const items = await fs.promises.readdir(d, { withFileTypes: true }).catch(() => []);
      for (const it of items) {
        const p = path.join(d, it.name);
        if (it.isDirectory()) await walk(p);
        else if (it.isFile()) {
          files++;
          bytes += (await fs.promises.stat(p)).size;
        }
      }
    };
    await walk(dir);
    return { files, bytes };
  }

  private async checkFreeSpace() {
    const statfs = (fs.promises as any).statfs;
    if (!statfs) return;
    try {
      const s = await statfs(this.dir);
      const free = Number(s.bavail) * Number(s.bsize);
      const need = ((await this.dbSizeBytes()) + (await this.dirSize(this.cfg.uploadsDir)).bytes) * 1.3 + 50 * 1024 * 1024;
      if (free < need) {
        throw new BackupInvalidError(
          `Espacio insuficiente para el respaldo: libres ${Math.round(free / 1048576)} MB, se necesitan ~${Math.round(need / 1048576)} MB.`,
        );
      }
    } catch (e) {
      if (e instanceof BackupInvalidError) throw e;
      // statfs no disponible en este sistema de archivos: seguimos.
    }
  }

  /** Empaqueta un directorio (fotos) en tar.gz. Ignora enlaces simbólicos. */
  private async packDirectory(src: string, dest: string) {
    const gz = zlib.createGzip({ level: 6 });
    const done = pipeline(gz, fs.createWriteStream(dest, { mode: 0o640 }));
    const packer = new TarPacker(gz);
    let files = 0;
    let bytes = 0;
    const walk = async (dir: string, rel: string) => {
      const items = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
      items.sort((a, b) => a.name.localeCompare(b.name));
      for (const it of items) {
        if (it.name.endsWith('.restore-tmp')) continue;
        const full = path.join(dir, it.name);
        const r = rel ? `${rel}/${it.name}` : it.name;
        if (it.isDirectory()) {
          await packer.addDir(r);
          await walk(full, r);
        } else if (it.isFile()) {
          const st = await fs.promises.stat(full).catch(() => null);
          if (!st) continue; // borrado durante el respaldo
          await packer.addFile(r, full, st);
          files++;
          bytes += st.size;
        }
      }
    };
    try {
      await walk(src, '');
      await packer.finish();
    } catch (e) {
      gz.destroy(e as Error);
      await done.catch(() => undefined);
      throw e;
    }
    await done;
    return { files, bytes };
  }

  /** Escribe el contenedor TAR (cifrado si hay clave) y devuelve su sha256. */
  private async writeArchive(
    dest: string,
    entries: Array<{ name: string; buffer?: Buffer; file?: string }>,
    encrypt: boolean,
  ): Promise<string> {
    const src = new PassThrough();
    const h = createHash('sha256');
    const ws = fs.createWriteStream(dest, { mode: 0o640 });
    const done = encrypt
      ? pipeline(src, createEncryptStream(this.cfg.encryptionKey), hashingTransform(h), ws)
      : pipeline(src, hashingTransform(h), ws);
    const packer = new TarPacker(src);
    try {
      for (const e of entries) {
        if (e.buffer) await packer.addBuffer(e.name, e.buffer);
        else if (e.file) await packer.addFile(e.name, e.file);
      }
      await packer.finish();
    } catch (e) {
      src.destroy(e as Error);
      await done.catch(() => undefined);
      throw e;
    }
    await done;
    return h.digest('hex');
  }

  private async writeSidecar(file: string, data: Record<string, any>) {
    const p = path.join(this.dir, sidecarOf(file));
    await fs.promises.writeFile(`${p}.tmp`, JSON.stringify(data, null, 2), { mode: 0o640 });
    await fs.promises.rename(`${p}.tmp`, p);
  }

  private async uniqueName(kind: BackupKind, enc: boolean, at = () => new Date()): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const name = `sonrisas-backup-${stamp(at())}-${kind}.tar${enc ? '.enc' : ''}`;
      if (!fs.existsSync(path.join(this.dir, name))) return name;
      await sleep(1100);
    }
    throw new BackupBusyError('No se pudo generar un nombre único para el respaldo');
  }

  async create(kind: BackupKind, meta: { createdBy?: string; note?: string } = {}): Promise<BackupInfo> {
    return this.withLock(`create:${kind}`, async () => {
      await this.checkFreeSpace();
      const enc = this.encrypted;
      const name = await this.uniqueName(kind, enc);
      const work = await fs.promises.mkdtemp(path.join(this.dir, '.work-'));
      const partial = path.join(this.dir, `.${name}.partial`);
      const t0 = Date.now();
      try {
        this.log(`Respaldo ${kind}: volcando base de datos…`);
        const dump = path.join(work, 'db.dump');
        await run(pgBinary('pg_dump'), ['-Fc', '--no-owner', '--no-privileges', '-f', dump], pgEnv(this.cfg.db));
        const pgDumpMajor = await pgMajor('pg_dump');

        this.log(`Respaldo ${kind}: empaquetando fotos…`);
        const up = path.join(work, 'uploads.tar.gz');
        const upStats = await this.packDirectory(this.cfg.uploadsDir, up);

        const [dbSize, upSize] = [(await fs.promises.stat(dump)).size, (await fs.promises.stat(up)).size];
        const manifest: BackupManifest = {
          format: BACKUP_FORMAT,
          kind,
          createdAt: new Date().toISOString(),
          createdBy: meta.createdBy || 'sistema',
          note: (meta.note || '').slice(0, 200),
          host: os.hostname(),
          app: { ...this.cfg.app },
          db: { name: this.cfg.db.database, file: 'db.dump', size: dbSize, sha256: await hashFile(dump), pgDumpMajor },
          uploads: { file: 'uploads.tar.gz', size: upSize, sha256: await hashFile(up), ...upStats },
        };
        const sha256 = await this.writeArchive(
          partial,
          [
            { name: 'manifest.json', buffer: Buffer.from(JSON.stringify(manifest, null, 2)) },
            { name: 'db.dump', file: dump },
            { name: 'uploads.tar.gz', file: up },
          ],
          enc,
        );
        await fs.promises.rename(partial, path.join(this.dir, name));
        const size = (await fs.promises.stat(path.join(this.dir, name))).size;
        await this.writeSidecar(name, {
          file: name,
          kind,
          createdAt: manifest.createdAt,
          size,
          sha256,
          encrypted: enc,
          app: { version: manifest.app.version, commit: manifest.app.commit },
          db: { size: dbSize, pgDumpMajor },
          uploads: { size: upSize, files: upStats.files, bytes: upStats.bytes },
          createdBy: manifest.createdBy,
          note: manifest.note,
        });
        this.log(`Respaldo ${kind} listo: ${name} (${Math.round(size / 1024)} KB, ${Math.round((Date.now() - t0) / 1000)} s)`);
        await this.applyRetention().catch((e) => this.log(`Retención: ${e?.message || e}`));
        return (await this.list()).find((b) => b.file === name)!;
      } finally {
        await fs.promises.rm(work, { recursive: true, force: true }).catch(() => undefined);
        await fs.promises.rm(partial, { force: true }).catch(() => undefined);
      }
    });
  }

  // ------------------------------------------------------------------ verificar / extraer
  /**
   * Lee el archivo completo: descifra, recorre el TAR, calcula sha256 de cada pieza y los
   * compara con el manifiesto. Con `extractDir` además deja las piezas en disco.
   */
  async scan(file: string, opts: { extractDir?: string; validateUploads?: boolean } = {}) {
    const encrypted = await isEncryptedFile(file);
    if (encrypted && !this.cfg.encryptionKey) {
      throw new BackupInvalidError('El respaldo está cifrado y BACKUP_ENCRYPTION_KEY no está configurada en este servidor.');
    }
    const manifestChunks: Buffer[] = [];
    const sinks = new Map<string, EntrySink>();
    const uploadsStats = { files: 0, bytes: 0 };

    const parser = new TarParser((entry) => {
      const name = safeEntryPath(entry.name);
      if (!name || entry.type === 'dir') return null;
      if (entry.type !== 'file' || !MEMBERS.has(name)) {
        throw new BackupInvalidError(`Contenido inesperado en el respaldo: ${name.slice(0, 80)}`);
      }
      if (sinks.has(name)) throw new BackupInvalidError(`Pieza duplicada en el respaldo: ${name}`);
      if (name === 'manifest.json') {
        if (entry.size > 256 * 1024) throw new BackupInvalidError('Manifiesto demasiado grande');
        const s = new EntrySink(undefined, undefined, manifestChunks);
        sinks.set(name, s);
        return s;
      }
      let forward: { input: Writable; done: Promise<void> } | undefined;
      if (opts.validateUploads && name === 'uploads.tar.gz') forward = this.uploadsValidator(uploadsStats);
      const fileTarget = opts.extractDir
        ? { tmp: path.join(opts.extractDir, `${name}.part`), final: path.join(opts.extractDir, name) }
        : undefined;
      const s = new EntrySink(fileTarget, forward);
      sinks.set(name, s);
      return s;
    });

    try {
      if (encrypted) await pipeline(fs.createReadStream(file), createDecryptStream(this.cfg.encryptionKey), parser);
      else await pipeline(fs.createReadStream(file), parser);
    } catch (e: any) {
      if (e instanceof BackupInvalidError) throw e;
      if (encrypted) {
        throw new BackupInvalidError('No se pudo descifrar el respaldo: la clave BACKUP_ENCRYPTION_KEY no coincide o el archivo está dañado.');
      }
      throw new BackupInvalidError(e?.message || 'No se pudo leer el respaldo');
    }

    let manifest: BackupManifest;
    try {
      manifest = JSON.parse(Buffer.concat(manifestChunks).toString('utf8'));
    } catch {
      throw new BackupInvalidError('El respaldo no tiene un manifiesto válido');
    }
    if (manifest?.format !== BACKUP_FORMAT) throw new BackupInvalidError('Formato de respaldo no reconocido');
    for (const [name, meta] of [
      ['db.dump', manifest.db],
      ['uploads.tar.gz', manifest.uploads],
    ] as const) {
      const s = sinks.get(name);
      if (!s) throw new BackupInvalidError(`Falta ${name} en el respaldo`);
      const digest = s.hash.digest('hex');
      if (s.size !== meta?.size || digest !== meta?.sha256) {
        throw new BackupInvalidError(`La pieza ${name} está dañada (sha256 no coincide)`);
      }
    }
    return { manifest, encrypted, uploadsStats };
  }

  /** Recorre el tar.gz de fotos y rechaza enlaces, dispositivos o rutas que salgan del destino. */
  private uploadsValidator(stats: { files: number; bytes: number }) {
    const gunzip = zlib.createGunzip();
    const parser = new TarParser((e) => {
      safeEntryPath(e.name);
      if (e.type === 'other') throw new BackupInvalidError(`Entrada no permitida en las fotos: ${e.name.slice(0, 80)}`);
      if (e.type === 'file') {
        stats.files++;
        stats.bytes += e.size;
      }
      return null;
    });
    return { input: gunzip as Writable, done: pipeline(gunzip, parser) };
  }

  async verify(file: string) {
    const full = this.resolve(file);
    if (!BACKUP_NAME_RE.test(file)) throw new BackupInvalidError('Los respaldos del formato anterior no se pueden verificar');
    const { manifest } = await this.scan(full, { validateUploads: true });
    return manifest;
  }

  // ------------------------------------------------------------------ importar (subida)
  async importFile(tmpPath: string, meta: { createdBy?: string } = {}): Promise<BackupInfo> {
    return this.withLock('import', async () => {
      const { manifest, encrypted } = await this.scan(tmpPath, { validateUploads: true });
      try {
        const major = await pgMajor('pg_restore');
        if (major && manifest.db.pgDumpMajor > major) {
          throw new BackupInvalidError(
            `El respaldo se hizo con PostgreSQL ${manifest.db.pgDumpMajor} y este servidor tiene pg_restore ${major}: no es compatible.`,
          );
        }
      } catch (e) {
        if (e instanceof BackupInvalidError) throw e;
      }
      const created = new Date(manifest.createdAt);
      const when = Number.isFinite(created.getTime()) ? created : new Date();
      const enc = this.encrypted;
      const name = `sonrisas-backup-${stamp(when)}-uploaded.tar${enc ? '.enc' : ''}`;
      const dest = path.join(this.dir, name);
      if (fs.existsSync(dest)) throw new BackupInvalidError('Ese respaldo ya fue subido antes');
      const partial = path.join(this.dir, `.${name}.partial`);
      try {
        let sha256: string;
        if (enc && !encrypted) {
          // Cifrar en reposo lo que llega sin cifrar.
          const h = createHash('sha256');
          await pipeline(
            fs.createReadStream(tmpPath),
            createEncryptStream(this.cfg.encryptionKey),
            hashingTransform(h),
            fs.createWriteStream(partial, { mode: 0o640 }),
          );
          sha256 = h.digest('hex');
          await fs.promises.rm(tmpPath, { force: true });
        } else if (!enc && encrypted) {
          throw new BackupInvalidError('Respaldo cifrado sin clave configurada'); // (scan ya lo habría rechazado)
        } else {
          await fs.promises.rename(tmpPath, partial);
          sha256 = await hashFile(partial);
        }
        await fs.promises.rename(partial, dest);
        const size = (await fs.promises.stat(dest)).size;
        await this.writeSidecar(name, {
          file: name,
          kind: 'uploaded',
          originalKind: manifest.kind,
          createdAt: manifest.createdAt,
          uploadedAt: new Date().toISOString(),
          size,
          sha256,
          encrypted: enc,
          app: { version: manifest.app?.version || '', commit: manifest.app?.commit || '' },
          db: { size: manifest.db.size, pgDumpMajor: manifest.db.pgDumpMajor },
          uploads: { size: manifest.uploads.size, files: manifest.uploads.files, bytes: manifest.uploads.bytes },
          createdBy: meta.createdBy || '',
          note: `Subido · original: ${manifest.kind} de ${manifest.host || 'otro servidor'}`,
        });
        await this.applyRetention().catch(() => undefined);
        return (await this.list()).find((b) => b.file === name)!;
      } finally {
        await fs.promises.rm(partial, { force: true }).catch(() => undefined);
      }
    });
  }

  // ------------------------------------------------------------------ restaurar
  private clientCreds() {
    const d = this.cfg.db;
    return { host: d.host, port: d.port, user: d.username, password: d.password };
  }

  /**
   * Restaura un respaldo.
   *  · `swap` (actualizador/CLI, con la api DETENIDA): restaura en una BD nueva y, si
   *    todo salió bien, la intercambia por la actual. La anterior queda como `<bd>_prev`
   *    (vuelta atrás inmediata con `cli.js swap-prev`).
   *  · `inplace` (desarrollo, api encendida): pg_restore --clean en una sola transacción.
   * Las fotos se FUSIONAN (no se borra ninguna foto existente).
   */
  async restore(file: string, opts: { mode: 'swap' | 'inplace'; restoreUploads?: boolean }) {
    const full = this.resolve(file);
    if (!BACKUP_NAME_RE.test(file)) throw new BackupInvalidError('Ese respaldo es del formato anterior: restáuralo a mano (ver DEPLOY.md).');
    return this.withLock('restore', async () => {
      const work = await fs.promises.mkdtemp(path.join(this.dir, '.work-'));
      try {
        this.log(`Restaurando ${file}: verificando integridad…`);
        const { manifest } = await this.scan(full, { extractDir: work, validateUploads: true });
        const major = await pgMajor('pg_restore');
        if (major && manifest.db.pgDumpMajor > major) {
          throw new BackupInvalidError(`pg_restore ${major} no puede leer un volcado de PostgreSQL ${manifest.db.pgDumpMajor}`);
        }
        const dump = path.join(work, 'db.dump');
        if (opts.mode === 'swap') await this.restoreDbSwap(dump);
        else await this.restoreDbInPlace(dump);
        if (opts.restoreUploads !== false) {
          this.log('Restaurando fotos (fusión: no se borra ninguna existente)…');
          await this.extractUploads(path.join(work, 'uploads.tar.gz'), this.cfg.uploadsDir);
        }
        this.log(`Restauración completada desde ${file}`);
        return manifest;
      } finally {
        await fs.promises.rm(work, { recursive: true, force: true }).catch(() => undefined);
      }
    });
  }

  private async restoreDbInPlace(dump: string) {
    this.log('Restaurando base de datos (en una sola transacción)…');
    await run(
      pgBinary('pg_restore'),
      ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--single-transaction', '--exit-on-error', '-d', this.cfg.db.database, dump],
      pgEnv(this.cfg.db),
    );
  }

  private dbNames() {
    const db = this.cfg.db.database;
    if (!/^[A-Za-z0-9_]{1,40}$/.test(db)) throw new BackupInvalidError('Nombre de base de datos no soportado para el intercambio');
    return { db, tmp: `${db}_restore_tmp`, prev: `${db}_prev` };
  }

  private async admin<T>(fn: (c: any) => Promise<T>): Promise<T> {
    const c = new Client({ ...this.clientCreds(), database: 'postgres' });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  }

  private async renameWithRetry(c: any, from: string, to: string) {
    for (let i = 0; i < 6; i++) {
      await c.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [from]);
      try {
        await c.query(`ALTER DATABASE "${from}" RENAME TO "${to}"`);
        return;
      } catch (e) {
        if (i === 5) throw e;
        await sleep(1000);
      }
    }
  }

  private async restoreDbSwap(dump: string) {
    const { db, tmp, prev } = this.dbNames();
    this.log(`Restaurando base de datos en ${tmp}…`);
    await this.admin(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS "${tmp}" WITH (FORCE)`);
      await c.query(`CREATE DATABASE "${tmp}" TEMPLATE template0 ENCODING 'UTF8'`);
    });
    try {
      await run(
        pgBinary('pg_restore'),
        ['--no-owner', '--no-privileges', '--exit-on-error', '-d', tmp, dump],
        pgEnv(this.cfg.db, tmp),
      );
      const check = new Client({ ...this.clientCreds(), database: tmp });
      await check.connect();
      try {
        const r = await check.query("SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'");
        if (!r.rows[0].n) throw new BackupInvalidError('El volcado restaurado no contiene tablas');
      } finally {
        await check.end();
      }
    } catch (e) {
      await this.admin((c) => c.query(`DROP DATABASE IF EXISTS "${tmp}" WITH (FORCE)`)).catch(() => undefined);
      throw e;
    }
    this.log(`Intercambiando ${tmp} → ${db} (la actual queda como ${prev})…`);
    await this.admin(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS "${prev}" WITH (FORCE)`);
      await this.renameWithRetry(c, db, prev);
      try {
        await c.query(`ALTER DATABASE "${tmp}" RENAME TO "${db}"`);
      } catch (e) {
        await c.query(`ALTER DATABASE "${prev}" RENAME TO "${db}"`); // dejar todo como estaba
        throw e;
      }
    });
  }

  /** Vuelve a la BD anterior al último restore (`<bd>_prev`). La actual pasa a `<bd>_prev`. */
  async swapPrev() {
    const { db, tmp, prev } = this.dbNames();
    await this.admin(async (c) => {
      const r = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [prev]);
      if (!r.rowCount) throw new BackupNotFoundError(`No existe ${prev}: no hay restauración que deshacer`);
      await c.query(`DROP DATABASE IF EXISTS "${tmp}" WITH (FORCE)`);
      await this.renameWithRetry(c, db, tmp);
      await c.query(`ALTER DATABASE "${prev}" RENAME TO "${db}"`);
      await c.query(`ALTER DATABASE "${tmp}" RENAME TO "${prev}"`);
    });
    this.log(`${db} vuelve a ser la base anterior a la restauración`);
  }

  private async extractUploads(archive: string, dest: string) {
    const root = path.resolve(dest);
    await fs.promises.mkdir(root, { recursive: true });
    const parser = new TarParser(async (e) => {
      const rel = safeEntryPath(e.name);
      if (!rel) return null;
      const target = path.resolve(root, ...rel.split('/'));
      if (!target.startsWith(root + path.sep)) throw new BackupInvalidError('Ruta fuera de la carpeta de fotos');
      if (e.type === 'dir') {
        await fs.promises.mkdir(target, { recursive: true });
        return null;
      }
      if (e.type !== 'file') throw new BackupInvalidError('Entrada no permitida en las fotos');
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      const lst = await fs.promises.lstat(target).catch(() => null);
      if (lst?.isSymbolicLink() || lst?.isDirectory()) throw new BackupInvalidError(`No se puede sobrescribir ${rel}`);
      return new EntrySink({ tmp: `${target}.restore-tmp`, final: target });
    });
    await pipeline(fs.createReadStream(archive), zlib.createGunzip(), parser);
  }

  // ------------------------------------------------------------------ borrar / retención
  async delete(file: string) {
    const full = this.resolve(file);
    await fs.promises.unlink(full);
    if (BACKUP_NAME_RE.test(file)) await fs.promises.rm(path.join(this.dir, sidecarOf(file)), { force: true });
  }

  /**
   * Retención:
   *  · nocturnos: los últimos BACKUP_KEEP_DAILY;
   *  · de seguridad (pre-update / pre-restore / pre-rollback): los últimos BACKUP_KEEP_SAFETY;
   *  · manuales + subidos: nunca se borran solos salvo que superen BACKUP_MAX_MANUAL.
   * Los del formato anterior no se tocan.
   */
  async applyRetention(): Promise<string[]> {
    const names = (await fs.promises.readdir(this.dir)).filter((n) => BACKUP_NAME_RE.test(n)).sort().reverse();
    const groups: Array<{ kinds: string[]; keep: number }> = [
      { kinds: ['nightly'], keep: this.cfg.retention.keepNightly },
      { kinds: SAFETY_KINDS, keep: this.cfg.retention.keepSafety },
      { kinds: ['manual', 'uploaded'], keep: this.cfg.retention.maxManual },
    ];
    const removed: string[] = [];
    for (const g of groups) {
      const list = names.filter((n) => g.kinds.includes(BACKUP_NAME_RE.exec(n)![3]));
      for (const n of list.slice(g.keep)) {
        await this.delete(n).catch(() => undefined);
        removed.push(n);
      }
    }
    if (removed.length) this.log(`Retención: eliminados ${removed.join(', ')}`);
    // Restos de operaciones interrumpidas (más de 1 día).
    const stale = async (p: string) => {
      const st = await fs.promises.stat(p).catch(() => null);
      if (st && Date.now() - st.mtimeMs > 86_400_000) await fs.promises.rm(p, { recursive: true, force: true }).catch(() => undefined);
    };
    for (const n of await fs.promises.readdir(this.dir)) {
      if (/^\.work-/.test(n) || /^\..+\.partial$/.test(n)) await stale(path.join(this.dir, n));
    }
    const incoming = path.join(this.dir, '.incoming');
    for (const n of await fs.promises.readdir(incoming).catch(() => [] as string[])) await stale(path.join(incoming, n));
    return removed;
  }
}
