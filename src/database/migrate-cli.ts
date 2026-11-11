/* eslint-disable no-console */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { loadDotEnv } from './env';
import { cliDataSourceOptions, MIGRATIONS_TABLE } from './db-options';
import { prepareSchema } from './schema-manager';

/**
 * CLI de migraciones para producción (dentro de la imagen, sin ts-node):
 *   node dist/database/migrate-cli.js run          aplica pendientes (con adopción de baseline)
 *   node dist/database/migrate-cli.js show         lista ejecutadas/pendientes
 *   node dist/database/migrate-cli.js revert [n]   deshace las n últimas (down())
 *   node dist/database/migrate-cli.js count        imprime el nº de migraciones ejecutadas
 */
async function main() {
  loadDotEnv();
  const [cmd = 'show', arg] = process.argv.slice(2);
  // `run` usa el mismo camino que la app: siempre modo migraciones.
  if (cmd === 'run') process.env.DB_SYNC = 'false';
  const ds = await new DataSource(cliDataSourceOptions()).initialize();
  try {
    switch (cmd) {
      case 'run':
        await prepareSchema(ds);
        break;
      case 'count': {
        const qr = ds.createQueryRunner();
        const has = await qr.hasTable(MIGRATIONS_TABLE);
        const rows = has ? await qr.query(`SELECT COUNT(*)::int AS c FROM "${MIGRATIONS_TABLE}"`) : [{ c: 0 }];
        await qr.release();
        console.log(String(rows[0].c));
        break;
      }
      case 'show': {
        const qr = ds.createQueryRunner();
        const has = await qr.hasTable(MIGRATIONS_TABLE);
        const done: { name: string }[] = has
          ? await qr.query(`SELECT name FROM "${MIGRATIONS_TABLE}" ORDER BY id`)
          : [];
        await qr.release();
        const doneSet = new Set(done.map((r) => r.name));
        const known = ds.migrations.map((m: any) => m.name || m.constructor.name);
        for (const n of known) console.log(`${doneSet.has(n) ? '[X]' : '[ ]'} ${n}`);
        for (const r of done) if (!known.includes(r.name)) console.log(`[?] ${r.name} (no existe en esta versión)`);
        break;
      }
      case 'revert': {
        const n = Math.max(1, parseInt(arg || '1', 10) || 1);
        for (let i = 0; i < n; i++) {
          await ds.undoLastMigration({ transaction: 'each' });
        }
        console.log(`Revertidas ${n} migración(es)`);
        break;
      }
      default:
        console.error(`Comando desconocido: ${cmd}`);
        process.exitCode = 2;
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
