import * as fs from 'fs';
import * as path from 'path';

/**
 * Carga `.env` (sólo claves que aún no existan en process.env) para los procesos que
 * corren fuera de Nest: CLI de migraciones, CLI de respaldos. En Docker las variables
 * ya vienen del entorno y el archivo no existe.
 */
export function loadDotEnv(file = path.resolve(process.cwd(), '.env')): void {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Modo de esquema: `sync` (desarrollo) o `migrations` (producción). */
export function schemaMode(env: NodeJS.ProcessEnv = process.env): 'sync' | 'migrations' {
  const v = (env.DB_SYNC || '').trim().toLowerCase();
  if (v === 'true') return 'sync';
  if (v === 'false') return 'migrations';
  // Sin valor explícito: producción nunca sincroniza.
  return env.NODE_ENV === 'production' ? 'migrations' : 'sync';
}
