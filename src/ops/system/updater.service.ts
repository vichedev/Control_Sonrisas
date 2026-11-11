import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { opsConfig } from '../ops.config';

/**
 * Puente con el contenedor `updater` (ver ops/updater). Sin red ni puertos: la api deja
 * una petición JSON en /ops/jobs y el actualizador la valida, ejecuta deploy.sh y escribe
 * el estado y el log en /ops/status (montado en la api como SÓLO LECTURA).
 */
export type JobAction = 'update' | 'rollback' | 'restore';
export const VERSION_RE = /^v\d+\.\d+\.\d+$/;
export const JOB_ID_RE = /^\d{14}-[a-f0-9]{8}$/;

export interface JobStatus {
  id: string;
  action: JobAction | string;
  state: 'queued' | 'running' | 'success' | 'failed' | 'rejected';
  message?: string;
  version?: string;
  file?: string;
  requestedBy?: string;
  requestedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Compara versiones vX.Y.Z (devuelve <0, 0, >0). */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

@Injectable()
export class UpdaterService {
  private readonly cfg = opsConfig();

  private get jobStatusDir() {
    return path.join(this.cfg.statusDir, 'jobs');
  }

  status() {
    const hb = readJson<{ lastSeen?: string; busy?: boolean; currentJob?: string; updaterVersion?: string; gitRef?: string; error?: string }>(
      path.join(this.cfg.statusDir, 'updater.json'),
    );
    const last = hb?.lastSeen ? new Date(hb.lastSeen).getTime() : 0;
    return {
      online: !!last && Date.now() - last < 45_000,
      lastSeen: hb?.lastSeen || null,
      busy: !!hb?.busy,
      currentJob: hb?.currentJob || null,
      gitRef: hb?.gitRef || null,
      error: hb?.error || null,
    };
  }

  versions() {
    const v = readJson<{ fetchedAt?: string; current?: string; error?: string; tags?: Array<{ tag: string; date?: string; subject?: string; notes?: string }> }>(
      path.join(this.cfg.statusDir, 'versions.json'),
    );
    const tags = (v?.tags || []).filter((t) => VERSION_RE.test(t.tag));
    return { fetchedAt: v?.fetchedAt || null, current: v?.current || null, error: v?.error || null, tags };
  }

  history() {
    const h = readJson<any[]>(path.join(this.cfg.statusDir, 'history.json'));
    return Array.isArray(h) ? h.slice(-50).reverse() : [];
  }

  job(id: string): JobStatus & { log: string } {
    if (!JOB_ID_RE.test(id)) throw new BadRequestException('Id de tarea inválido');
    const st = readJson<JobStatus>(path.join(this.jobStatusDir, `${id}.json`));
    if (!st) {
      if (fs.existsSync(path.join(this.cfg.jobsDir, `${id}.json`))) return { id, action: '', state: 'queued', log: '' };
      throw new NotFoundException('Tarea no encontrada');
    }
    return { ...st, log: this.tail(path.join(this.jobStatusDir, `${id}.log`)) };
  }

  jobs(limit = 10): JobStatus[] {
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.jobStatusDir).filter((n) => /^\d{14}-[a-f0-9]{8}\.json$/.test(n));
    } catch {
      return [];
    }
    return names
      .sort()
      .reverse()
      .slice(0, limit)
      .map((n) => readJson<JobStatus>(path.join(this.jobStatusDir, n)))
      .filter(Boolean) as JobStatus[];
  }

  private tail(file: string, max = 64 * 1024): string {
    try {
      const st = fs.statSync(file);
      const fd = fs.openSync(file, 'r');
      try {
        const len = Math.min(max, st.size);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, st.size - len);
        // Quita códigos de color ANSI del log de deploy.sh
        // eslint-disable-next-line no-control-regex
        return buf.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '');
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return '';
    }
  }

  private hasActiveJob(): boolean {
    try {
      if (fs.readdirSync(this.cfg.jobsDir).some((n) => n.endsWith('.json'))) return true;
    } catch {
      /* sin carpeta */
    }
    const recent = this.jobs(3);
    return recent.some(
      (j) => (j.state === 'running' || j.state === 'queued') && Date.now() - new Date(j.startedAt || j.requestedAt || 0).getTime() < 3 * 3600_000,
    );
  }

  /** Encola una tarea para el actualizador. Los parámetros ya vienen validados. */
  submit(action: JobAction, params: { version?: string; file?: string; restoreDb?: boolean }, actor: { id: string; email: string }) {
    if (!this.status().online) {
      throw new ServiceUnavailableException('El actualizador no está en línea. Revisa el contenedor sonrisas_updater en el servidor.');
    }
    if (this.hasActiveJob()) throw new ConflictException('Ya hay una tarea del sistema en curso');
    const d = new Date();
    const id = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${randomBytes(4).toString('hex')}`;
    const job = {
      id,
      action,
      ...(params.version ? { version: params.version } : {}),
      ...(params.file ? { file: params.file } : {}),
      ...(action === 'rollback' ? { restoreDb: !!params.restoreDb } : {}),
      requestedBy: actor.email,
      requestedAt: d.toISOString(),
    };
    fs.mkdirSync(this.cfg.jobsDir, { recursive: true });
    const tmp = path.join(this.cfg.jobsDir, `.${id}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(job), { mode: 0o640 });
    fs.renameSync(tmp, path.join(this.cfg.jobsDir, `${id}.json`));
    return { jobId: id };
  }
}
