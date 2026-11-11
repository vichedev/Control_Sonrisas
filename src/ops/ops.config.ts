import * as fs from 'fs';
import * as path from 'path';
import { dbCredsFromEnv, DbCreds } from '../database/db-options';

/** Versión de la app: package.json + metadatos de build (args del Dockerfile). */
export interface AppVersionInfo {
  version: string;
  commit: string;
  builtAt: string;
}

let pkgVersion: string | null = null;
function packageVersion(): string {
  if (pkgVersion) return pkgVersion;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
    pkgVersion = String(pkg.version || '0.0.0');
  } catch {
    pkgVersion = '0.0.0';
  }
  return pkgVersion;
}

export function appVersion(env: NodeJS.ProcessEnv = process.env): AppVersionInfo {
  return {
    version: (env.APP_VERSION || '').replace(/^v/, '') || packageVersion(),
    commit: env.APP_COMMIT || '',
    builtAt: env.APP_BUILT_AT || '',
  };
}

export type BackupKind = 'nightly' | 'manual' | 'pre-update' | 'pre-restore' | 'pre-rollback' | 'uploaded';
export const BACKUP_KINDS: BackupKind[] = ['nightly', 'manual', 'pre-update', 'pre-restore', 'pre-rollback', 'uploaded'];

export interface OpsConfig {
  backupDir: string;
  uploadsDir: string;
  jobsDir: string;
  statusDir: string;
  db: DbCreds;
  encryptionKey: string;
  retention: { keepNightly: number; keepSafety: number; maxManual: number };
  uploadMaxBytes: number;
  inProcessRestore: boolean;
  app: AppVersionInfo;
}

function int(v: string | undefined, def: number, min = 0): number {
  const n = parseInt(v || '', 10);
  return Number.isFinite(n) && n >= min ? n : def;
}

/** Configuración de operaciones a partir del entorno. Mismos valores para la app y el CLI. */
export function opsConfig(env: NodeJS.ProcessEnv = process.env): OpsConfig {
  const prod = env.NODE_ENV === 'production';
  return {
    backupDir: path.resolve(env.BACKUP_DIR || (prod ? '/backups' : 'backups')),
    uploadsDir: path.resolve(process.cwd(), 'uploads'),
    jobsDir: path.resolve(env.OPS_JOBS_DIR || (prod ? '/ops/jobs' : '.ops/jobs')),
    statusDir: path.resolve(env.OPS_STATUS_DIR || (prod ? '/ops/status' : '.ops/status')),
    db: dbCredsFromEnv(env),
    encryptionKey: (env.BACKUP_ENCRYPTION_KEY || '').trim(),
    retention: {
      keepNightly: int(env.BACKUP_KEEP_DAILY, 14, 1),
      keepSafety: int(env.BACKUP_KEEP_SAFETY, 10, 1),
      maxManual: int(env.BACKUP_MAX_MANUAL, 30, 1),
    },
    uploadMaxBytes: int(env.BACKUP_UPLOAD_MAX_MB, 2048, 1) * 1024 * 1024,
    // En desarrollo no hay actualizador: el restore corre dentro de la api.
    inProcessRestore: env.OPS_INPROCESS_RESTORE ? env.OPS_INPROCESS_RESTORE === 'true' : !prod,
    app: appVersion(env),
  };
}
