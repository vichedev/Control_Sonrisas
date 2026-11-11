#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Genera la migración BASELINE (esquema completo actual) contra una BD temporal VACÍA.
 *   npm run migration:baseline
 *
 * 1. Crea la BD `sonrisas_baseline_tmp` en el Postgres local (credenciales de .env).
 * 2. Ejecuta `typeorm migration:generate src/database/migrations/Baseline` apuntando a ella:
 *    como está vacía, la migración contiene TODO el esquema.
 * 3. Borra la BD temporal.
 *
 * El archivo resultante es `<timestamp>-Baseline.ts` con la clase `Baseline<timestamp>`;
 * schema-manager.ts lo reconoce por ese nombre para adoptar BD existentes sin re-ejecutarlo.
 * No toca la BD de desarrollo.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'src', 'database', 'migrations');
const TMP_DB = process.env.BASELINE_TMP_DB || 'sonrisas_baseline_tmp';

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

async function main() {
  loadEnv();
  if (!/^[a-z0-9_]+$/.test(TMP_DB)) throw new Error('Nombre de BD temporal inválido');
  if (TMP_DB === process.env.DB_NAME) throw new Error('La BD temporal no puede ser la BD de desarrollo');

  fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
  const existing = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /-Baseline\.ts$/.test(f));
  if (existing.length && !process.argv.includes('--force')) {
    throw new Error(`Ya existe un baseline (${existing.join(', ')}). Bórralo o usa --force.`);
  }

  const admin = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: 'postgres',
  });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${TMP_DB}"`);
    await admin.query(`CREATE DATABASE "${TMP_DB}" TEMPLATE template0 ENCODING 'UTF8'`);
    console.log(`BD temporal ${TMP_DB} creada`);

    const cli = path.join(ROOT, 'node_modules', 'typeorm', 'cli-ts-node-commonjs.js');
    const r = spawnSync(
      process.execPath,
      [cli, '-d', 'src/database/data-source.ts', 'migration:generate', 'src/database/migrations/Baseline'],
      { cwd: ROOT, stdio: 'inherit', env: { ...process.env, DB_NAME: TMP_DB, DB_SYNC: 'false' } },
    );
    if (r.status !== 0) throw new Error('migration:generate falló');

    // Eliminar archivos viejos si se usó --force (queda sólo el recién generado).
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /-Baseline\.ts$/.test(f)).sort();
    for (const f of files.slice(0, -1)) fs.unlinkSync(path.join(MIGRATIONS_DIR, f));
    console.log(`\nBaseline generado: src/database/migrations/${files[files.length - 1]}`);
    console.log('Revísalo y súbelo a git. Las BD existentes lo adoptarán sin re-ejecutarlo.');
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS "${TMP_DB}"`).catch(() => {});
    await admin.end();
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message || e}`);
  process.exit(1);
});
