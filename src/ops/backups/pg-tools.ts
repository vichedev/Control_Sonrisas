import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DbCreds } from '../../database/db-options';

/**
 * Localiza pg_dump / pg_restore. Orden: PG_BIN_DIR → (Windows) la versión más alta en
 * C:\Program Files\PostgreSQL\<n>\bin → PATH. En la imagen Docker vienen de
 * postgresql-client-16 (misma versión mayor que el servidor).
 */
export function pgBinary(name: 'pg_dump' | 'pg_restore' | 'psql'): string {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  if (process.env.PG_BIN_DIR) return path.join(process.env.PG_BIN_DIR, exe);
  if (process.platform === 'win32') {
    const base = 'C:\\Program Files\\PostgreSQL';
    try {
      const versions = fs
        .readdirSync(base)
        .filter((d) => /^\d+(\.\d+)?$/.test(d))
        .sort((a, b) => parseFloat(b) - parseFloat(a));
      for (const v of versions) {
        const p = path.join(base, v, 'bin', exe);
        if (fs.existsSync(p)) return p;
      }
    } catch {
      /* sin instalación local */
    }
  }
  return name;
}

export function pgEnv(db: DbCreds, database = db.database): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGHOST: db.host,
    PGPORT: String(db.port),
    PGUSER: db.username,
    PGPASSWORD: db.password,
    PGDATABASE: database,
    PGCONNECT_TIMEOUT: '15',
  };
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

/** Ejecuta un binario SIN shell (los argumentos nunca se interpretan). */
export function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 60 * 60 * 1000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const cap = (s: string, add: string) => (s.length > 64_000 ? s : s + add);
    child.stdout.on('data', (d) => (stdout = cap(stdout, d.toString())));
    child.stderr.on('data', (d) => (stderr = cap(stderr, d.toString())));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e: any) => {
      clearTimeout(timer);
      reject(
        e?.code === 'ENOENT'
          ? new Error(`No se encontró ${cmd}. Instala el cliente de PostgreSQL o define PG_BIN_DIR.`)
          : e,
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(cmd)} terminó con código ${code}: ${stderr.trim().slice(-1500)}`));
    });
  });
}

/** Versión mayor de un binario de PostgreSQL ("pg_dump (PostgreSQL) 16.4" → 16). */
export async function pgMajor(name: 'pg_dump' | 'pg_restore'): Promise<number> {
  const { stdout } = await run(pgBinary(name), ['--version'], process.env, 15_000);
  const m = /(\d+)(?:\.\d+)?/.exec(stdout);
  return m ? parseInt(m[1], 10) : 0;
}
