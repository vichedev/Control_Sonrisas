import { Logger as NestLogger } from '@nestjs/common';
import { DataSource, MigrationInterface } from 'typeorm';
import { schemaMode } from './env';
import { MIGRATIONS_TABLE } from './db-options';
import { preSyncFixups } from './schema-fixups';

/**
 * Gestión del esquema al arrancar.
 *
 *  · Modo `sync` (desarrollo, DB_SYNC=true): fixups + synchronize (como siempre).
 *  · Modo `migrations` (producción, DB_SYNC=false): NUNCA synchronize. Se ejecutan las
 *    migraciones pendientes en una única transacción.
 *
 * Adopción del baseline: las BD de producción existentes se crearon con synchronize y no
 * tienen tabla `migrations`. Si la tabla está vacía/no existe y ya hay tablas del sistema
 * (`users`, `children`), la migración Baseline se marca como ejecutada SIN correrla
 * (crearía tablas que ya existen). Antes se aplican sólo cambios ADITIVOS que falten
 * (tablas/columnas/índices nuevos); si el ajuste implicara borrar o cambiar el tipo de
 * columnas, el arranque se detiene sin tocar nada.
 */

/** Nombre de clase de la migración base: `Baseline<13 dígitos>` (lo genera `npm run migration:baseline`). */
export const BASELINE_RE = /^Baseline\d{13}$/;

/** Bloqueo consultivo de Postgres: evita que api y seed migren a la vez. */
const SCHEMA_LOCK_KEY = 7_270_301;

const log = new NestLogger('Schema');

export function migrationName(m: MigrationInterface): string {
  return (m as any).name || m.constructor.name;
}

export function migrationTimestamp(m: MigrationInterface): number {
  const n = parseInt(migrationName(m).slice(-13), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Sentencias que pueden perder datos. Borrar índices/constraints no se considera destructivo. */
export function isDestructiveSql(sql: string): boolean {
  return (
    /\bDROP\s+TABLE\b/i.test(sql) ||
    /\bDROP\s+COLUMN\b/i.test(sql) ||
    /\bTRUNCATE\b/i.test(sql) ||
    /\bALTER\s+COLUMN\s+"[^"]+"\s+(SET\s+DATA\s+)?TYPE\b/i.test(sql) ||
    /\bDELETE\s+FROM\b/i.test(sql)
  );
}

/** Diferencia entidades ↔ BD (lo que haría synchronize), sin ejecutarla. */
export async function pendingSchemaChanges(ds: DataSource) {
  const sql = await ds.driver.createSchemaBuilder().log();
  return sql.upQueries;
}

/**
 * Aplica sólo los cambios aditivos de synchronize, en una transacción.
 * Lanza si hay sentencias destructivas (salvo DB_ALLOW_DESTRUCTIVE_SYNC=true).
 */
export async function safeSync(ds: DataSource, reason: string): Promise<number> {
  const ups = await pendingSchemaChanges(ds);
  if (!ups.length) return 0;
  const destructive = ups.filter((q) => isDestructiveSql(q.query));
  if (destructive.length && process.env.DB_ALLOW_DESTRUCTIVE_SYNC !== 'true') {
    const list = destructive.slice(0, 8).map((q) => `  · ${q.query.slice(0, 200)}`).join('\n');
    throw new Error(
      `[${reason}] El ajuste de esquema borraría o transformaría datos; no se aplica nada.\n${list}\n` +
        'Crea una migración explícita o, tras un respaldo, arranca una vez con DB_ALLOW_DESTRUCTIVE_SYNC=true.',
    );
  }
  const qr = ds.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  try {
    for (const q of ups) await qr.query(q.query, q.parameters);
    await qr.commitTransaction();
  } catch (e) {
    await qr.rollbackTransaction();
    throw e;
  } finally {
    await qr.release();
  }
  log.log(`[${reason}] ${ups.length} cambios de esquema aditivos aplicados`);
  return ups.length;
}

async function executedMigrationsCount(ds: DataSource): Promise<number> {
  const qr = ds.createQueryRunner();
  try {
    if (!(await qr.hasTable(MIGRATIONS_TABLE))) return 0;
    const rows = await qr.query(`SELECT COUNT(*)::int AS c FROM "${MIGRATIONS_TABLE}"`);
    return Number(rows?.[0]?.c || 0);
  } finally {
    await qr.release();
  }
}

async function hasCoreTables(ds: DataSource): Promise<boolean> {
  const qr = ds.createQueryRunner();
  try {
    return (await qr.hasTable('users')) && (await qr.hasTable('children'));
  } finally {
    await qr.release();
  }
}

/** Marca la migración como ejecutada (mismo formato que usa TypeORM). */
async function markExecuted(ds: DataSource, m: MigrationInterface) {
  await ds.query(
    `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" ("id" SERIAL NOT NULL, "timestamp" bigint NOT NULL, "name" character varying NOT NULL, CONSTRAINT "PK_8c82d7f526340ab734260ea46be" PRIMARY KEY ("id"))`,
  );
  await ds.query(`INSERT INTO "${MIGRATIONS_TABLE}" ("timestamp", "name") VALUES ($1, $2)`, [
    migrationTimestamp(m),
    migrationName(m),
  ]);
}

async function withSchemaLock<T>(ds: DataSource, fn: () => Promise<T>): Promise<T> {
  const qr = ds.createQueryRunner();
  await qr.connect();
  try {
    await qr.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK_KEY]);
    return await fn();
  } finally {
    try {
      await qr.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK_KEY]);
    } catch {
      /* la conexión se cierra igual */
    }
    await qr.release();
  }
}

/** Adopta el baseline en una BD creada con synchronize. */
async function adoptBaseline(ds: DataSource, migrations: MigrationInterface[]) {
  const baseline = migrations.find((m) => BASELINE_RE.test(migrationName(m)));
  if (!baseline) {
    throw new Error(
      'La BD ya tiene datos (creada con synchronize) pero no hay migración Baseline en esta versión. ' +
        'Genera el baseline (npm run migration:baseline) antes de desplegar con DB_SYNC=false.',
    );
  }
  const newer = migrations.filter((m) => migrationTimestamp(m) > migrationTimestamp(baseline));
  if (newer.length) {
    throw new Error(
      `La BD no tiene historial de migraciones y esta versión ya trae ${newer.length} migración(es) posteriores al baseline. ` +
        'Actualiza primero a la versión que introdujo las migraciones (la del baseline) y después a esta.',
    );
  }
  log.warn('BD existente sin historial de migraciones: adoptando baseline');
  await preSyncFixups(ds);
  await safeSync(ds, 'adopción del baseline');
  await markExecuted(ds, baseline);
  log.log(`Baseline ${migrationName(baseline)} marcado como ejecutado (no se volvió a correr)`);
}

/** Avisa si las entidades no coinciden con la BD (falta una migración). No cambia nada. */
async function reportDrift(ds: DataSource) {
  try {
    const ups = await pendingSchemaChanges(ds);
    if (!ups.length) return;
    log.warn(
      `El esquema difiere de las entidades (${ups.length} cambios). Falta una migración:\n` +
        ups.slice(0, 5).map((q) => `  · ${q.query.slice(0, 160)}`).join('\n'),
    );
  } catch (e: any) {
    log.warn(`No se pudo comparar el esquema: ${e?.message || e}`);
  }
}

/** Punto de entrada: deja el esquema listo antes de que la app atienda peticiones. */
export async function prepareSchema(ds: DataSource): Promise<void> {
  const mode = schemaMode();
  if (mode === 'sync') {
    if (process.env.NODE_ENV === 'production') {
      log.warn('DB_SYNC=true en producción: synchronize puede BORRAR columnas. Usa DB_SYNC=false.');
    }
    await preSyncFixups(ds);
    await ds.synchronize();
    return;
  }

  await withSchemaLock(ds, async () => {
    const migrations = [...ds.migrations].sort((a, b) => migrationTimestamp(a) - migrationTimestamp(b));
    const executed = await executedMigrationsCount(ds);
    const legacy = executed === 0 && (await hasCoreTables(ds));

    if (!migrations.length) {
      // Aún no se generó el baseline: modo prudente, sólo cambios aditivos.
      log.warn('No hay migraciones en esta versión: se aplican sólo cambios de esquema aditivos.');
      if (legacy) await preSyncFixups(ds);
      await safeSync(ds, 'sin migraciones');
      return;
    }

    if (legacy) await adoptBaseline(ds, migrations);

    const ran = await ds.runMigrations({ transaction: 'all' });
    if (ran.length) log.log(`Migraciones aplicadas: ${ran.map((m) => m.name).join(', ')}`);
    else log.log('Esquema al día: no hay migraciones pendientes');
    await reportDrift(ds);
  });
}
