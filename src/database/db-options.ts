import * as fs from 'fs';
import * as path from 'path';
import { DataSourceOptions } from 'typeorm';

/** Nombre de la tabla donde TypeORM registra las migraciones ejecutadas. */
export const MIGRATIONS_TABLE = 'migrations';

/** Carpeta de migraciones (src/database/migrations con ts-node, dist/database/migrations compilado). */
export const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Lista explícita de archivos de migración. No usamos un glob porque en `dist/`
 * también hay `.d.ts` (tsconfig tiene `declaration: true`) y TypeORM intentaría cargarlos.
 */
export function migrationFiles(dir = MIGRATIONS_DIR): string[] {
  if (!fs.existsSync(dir)) return [];
  const isTs = __filename.endsWith('.ts');
  return fs
    .readdirSync(dir)
    .filter((f) => (isTs ? /\.ts$/.test(f) : /\.js$/.test(f)) && !f.endsWith('.d.ts'))
    .sort()
    .map((f) => path.join(dir, f));
}

/** Entidades por glob (sólo para el CLI; la app usa autoLoadEntities). */
export function entityGlobs(): string[] {
  const root = path.join(__dirname, '..');
  return [path.join(root, '**', '*.entity.{ts,js}').replace(/\\/g, '/')];
}

export interface DbCreds {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

export function dbCredsFromEnv(env: NodeJS.ProcessEnv = process.env): DbCreds {
  return {
    host: env.DB_HOST || 'localhost',
    port: parseInt(env.DB_PORT || '5432', 10),
    username: env.DB_USERNAME || 'postgres',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'sonrisas',
  };
}

/** Opciones comunes a la app y al CLI. `synchronize` siempre false: se decide en schema-manager. */
export function baseDbOptions(creds: DbCreds) {
  return {
    type: 'postgres' as const,
    host: creds.host,
    port: creds.port,
    username: creds.username,
    password: creds.password,
    database: creds.database,
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: MIGRATIONS_TABLE,
    migrations: migrationFiles(),
    // Todas las migraciones pendientes en UNA transacción: si una falla, no queda
    // el esquema a medias (y el actualizador sabe que no hubo cambios).
    migrationsTransactionMode: 'all' as const,
  };
}

export function cliDataSourceOptions(env: NodeJS.ProcessEnv = process.env): DataSourceOptions {
  return {
    ...baseDbOptions(dbCredsFromEnv(env)),
    entities: entityGlobs(),
  };
}
