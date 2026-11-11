/* eslint-disable no-console */
import * as fs from 'fs';
import * as path from 'path';
import { CronJob } from 'cron';
import { loadDotEnv } from '../database/env';
import { BACKUP_KINDS, BackupKind, opsConfig } from './ops.config';
import { BackupEngine } from './backups/backup-engine';

/**
 * CLI de respaldos. Corre dentro de la imagen de la api (mismo código = mismo formato):
 *   node dist/ops/cli.js backup [--kind manual] [--by texto] [--note texto]
 *   node dist/ops/cli.js list [--json]
 *   node dist/ops/cli.js verify <archivo>
 *   node dist/ops/cli.js restore <archivo> [--mode swap|inplace] [--no-uploads] [--no-safety]
 *   node dist/ops/cli.js swap-prev        deshace el último restore (vuelve a <bd>_prev)
 *   node dist/ops/cli.js retention
 *   node dist/ops/cli.js scheduler        respaldo nocturno (BACKUP_CRON), proceso permanente
 * deploy.sh lo invoca con `docker compose run --rm --no-deps api node dist/ops/cli.js …`.
 */

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const ts = () => new Date().toISOString();
const log = (m: string) => console.log(`[${ts()}] ${m}`);

async function main() {
  loadDotEnv();
  const [cmd, ...args] = process.argv.slice(2);
  const cfg = opsConfig();
  const engine = new BackupEngine(cfg, log);

  switch (cmd) {
    case 'backup': {
      const kind = (flag(args, '--kind') || 'manual') as BackupKind;
      if (!BACKUP_KINDS.includes(kind) || kind === 'uploaded') throw new Error(`Tipo inválido: ${kind}`);
      const info = await engine.create(kind, { createdBy: flag(args, '--by') || 'cli', note: flag(args, '--note') });
      console.log(`BACKUP_FILE=${info.file}`);
      return;
    }
    case 'list': {
      const items = await engine.list();
      if (args.includes('--json')) return console.log(JSON.stringify(items, null, 2));
      for (const b of items) {
        console.log(
          `${b.createdAt.slice(0, 19).replace('T', ' ')}  ${b.kind.padEnd(12)} ${(b.size / 1048576).toFixed(1).padStart(8)} MB  ${b.app?.version || '-'}  ${b.file}`,
        );
      }
      if (!items.length) console.log('(no hay respaldos)');
      return;
    }
    case 'verify': {
      const m = await engine.verify(args[0]);
      console.log(`OK: ${args[0]} · ${m.kind} · ${m.createdAt} · versión ${m.app?.version} · ${m.uploads.files} fotos`);
      return;
    }
    case 'restore': {
      const file = args[0];
      engine.resolve(file);
      const mode = (flag(args, '--mode') || 'swap') as 'swap' | 'inplace';
      if (mode !== 'swap' && mode !== 'inplace') throw new Error('--mode debe ser swap o inplace');
      if (!args.includes('--no-safety')) {
        log('Respaldo de seguridad antes de restaurar…');
        const safety = await engine.create('pre-restore', { createdBy: 'cli', note: `Antes de restaurar ${file}` });
        console.log(`SAFETY_FILE=${safety.file}`);
      }
      await engine.restore(file, { mode, restoreUploads: !args.includes('--no-uploads') });
      console.log('RESTORE_OK=1');
      return;
    }
    case 'swap-prev':
      await engine.swapPrev();
      return;
    case 'retention': {
      const removed = await engine.applyRetention();
      console.log(removed.length ? removed.join('\n') : '(nada que borrar)');
      return;
    }
    case 'scheduler':
      return scheduler(engine);
    default:
      console.error('Uso: cli.js backup|list|verify|restore|swap-prev|retention|scheduler');
      process.exitCode = 2;
  }
}

async function scheduler(engine: BackupEngine) {
  const cron = process.env.BACKUP_CRON || '15 3 * * *';
  const tz = process.env.TZ || 'America/Guayaquil';
  // Verifica permisos de escritura al arrancar (sin generar un respaldo).
  await engine.ensureDir();
  const probe = path.join(engine.dir, `.probe-${process.pid}`);
  fs.writeFileSync(probe, 'ok');
  fs.unlinkSync(probe);

  let running = false;
  const job = CronJob.from({
    cronTime: cron,
    timeZone: tz,
    start: true,
    onTick: async () => {
      if (running) return;
      running = true;
      try {
        await engine.create('nightly', { createdBy: 'nocturno' });
      } catch (e: any) {
        log(`ERROR respaldo nocturno: ${e?.message || e}`);
      } finally {
        running = false;
      }
    },
  });
  log(`Respaldo nocturno programado: "${cron}" (${tz}). Próximo: ${job.nextDate().toISO()}`);
  const stop = () => {
    job.stop();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  await new Promise(() => undefined);
}

main().catch((e) => {
  console.error(`ERROR: ${e?.message || e}`);
  process.exit(1);
});
