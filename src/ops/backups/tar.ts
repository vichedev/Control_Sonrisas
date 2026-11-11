import * as fs from 'fs';
import { Writable } from 'stream';

/**
 * Lector/escritor TAR (ustar + pax/GNU longname) mínimo, sin dependencias.
 * Se usa para el contenedor del respaldo y para las fotos. Sólo maneja archivos
 * regulares y directorios: enlaces y dispositivos se rechazan al validar.
 */

const BLOCK = 512;
const ZERO = Buffer.alloc(BLOCK * 2);

function writeOctal(buf: Buffer, offset: number, len: number, value: number) {
  const max = Math.pow(8, len - 1) - 1;
  if (value > max) {
    // base-256 (extensión GNU) para tamaños > 8 GB
    buf[offset] = 0x80;
    let v = value;
    for (let i = offset + len - 1; i > offset; i--) {
      buf[i] = v & 0xff;
      v = Math.floor(v / 256);
    }
    return;
  }
  const s = value.toString(8).padStart(len - 1, '0');
  buf.write(s, offset, len - 1, 'ascii');
  buf[offset + len - 1] = 0;
}

function readNumber(buf: Buffer, offset: number, len: number): number {
  if (buf[offset] & 0x80) {
    let v = 0;
    for (let i = offset + 1; i < offset + len; i++) v = v * 256 + buf[i];
    return v;
  }
  const s = buf.toString('ascii', offset, offset + len).replace(/\0.*$/, '').trim();
  return s ? parseInt(s, 8) : 0;
}

function readString(buf: Buffer, offset: number, len: number): string {
  const end = buf.indexOf(0, offset);
  return buf.toString('utf8', offset, end >= 0 && end < offset + len ? end : offset + len);
}

function checksum(header: Buffer): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
  return sum;
}

function rawHeader(name: string, size: number, type: string, mtime: Date, mode: number, prefix = ''): Buffer {
  const h = Buffer.alloc(BLOCK);
  h.write(name, 0, 100, 'utf8');
  writeOctal(h, 100, 8, mode);
  writeOctal(h, 108, 8, 0);
  writeOctal(h, 116, 8, 0);
  writeOctal(h, 124, 12, size);
  writeOctal(h, 136, 12, Math.floor(mtime.getTime() / 1000));
  h.write(type, 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  if (prefix) h.write(prefix, 345, 155, 'utf8');
  const sum = checksum(h);
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return h;
}

function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return `${len}${body}`;
}

function padding(size: number): number {
  return (BLOCK - (size % BLOCK)) % BLOCK;
}

/** Escribe un TAR en `out` respetando la contrapresión. */
export class TarPacker {
  constructor(private readonly out: Writable) {}

  private write(buf: Buffer): Promise<void> {
    if (this.out.destroyed) return Promise.reject(new Error('stream cerrado'));
    return writeAsync(this.out, buf);
  }

  private async header(name: string, size: number, type: '0' | '5', mtime: Date, mode: number) {
    const bytes = Buffer.byteLength(name);
    if (bytes <= 100) return this.write(rawHeader(name, size, type, mtime, mode));
    // ustar: prefijo (≤155) + nombre (≤100) partido en una '/'
    const idx = name.lastIndexOf('/', 155);
    if (idx > 0 && Buffer.byteLength(name.slice(0, idx)) <= 155 && Buffer.byteLength(name.slice(idx + 1)) <= 100) {
      return this.write(rawHeader(name.slice(idx + 1), size, type, mtime, mode, name.slice(0, idx)));
    }
    // pax: cabecera extendida con la ruta completa
    const pax = Buffer.from(paxRecord('path', name), 'utf8');
    await this.write(rawHeader('PaxHeader', pax.length, 'x', mtime, 0o644));
    await this.write(pax);
    await this.write(Buffer.alloc(padding(pax.length)));
    return this.write(rawHeader(name.slice(0, 100), size, type, mtime, mode));
  }

  async addBuffer(name: string, data: Buffer, mtime = new Date()) {
    await this.header(name, data.length, '0', mtime, 0o640);
    await this.write(data);
    const pad = padding(data.length);
    if (pad) await this.write(Buffer.alloc(pad));
  }

  /** Añade un archivo del disco. Lee exactamente `size` bytes (el archivo puede crecer mientras tanto). */
  async addFile(name: string, filePath: string, stat?: fs.Stats) {
    const st = stat || (await fs.promises.stat(filePath));
    const size = st.size;
    await this.header(name, size, '0', st.mtime, 0o640);
    let written = 0;
    if (size > 0) {
      const rs = fs.createReadStream(filePath, { start: 0, end: size - 1 });
      for await (const chunk of rs) {
        written += (chunk as Buffer).length;
        await this.write(chunk as Buffer);
      }
    }
    if (written < size) await this.write(Buffer.alloc(size - written)); // se encogió: rellenar
    const pad = padding(size);
    if (pad) await this.write(Buffer.alloc(pad));
  }

  async addDir(name: string, mtime = new Date()) {
    await this.header(name.endsWith('/') ? name : `${name}/`, 0, '5', mtime, 0o750);
  }

  async finish() {
    await this.write(ZERO);
    await new Promise<void>((resolve, reject) => {
      this.out.once('error', reject);
      this.out.end(() => resolve());
    });
  }
}

export interface TarEntry {
  name: string;
  size: number;
  type: 'file' | 'dir' | 'other';
  rawType: string;
}

/** Devuelve un destino para los datos de la entrada, o null para descartarlos. */
export type TarEntryHandler = (entry: TarEntry) => Promise<Writable | null> | Writable | null;

export function writeAsync(w: Writable, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (w.destroyed || w.writableEnded) return reject(new Error('stream cerrado'));
    const onErr = (e: Error) => {
      cleanup();
      reject(e);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('stream cerrado'));
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      w.off('error', onErr);
      w.off('close', onClose);
      w.off('drain', done);
    };
    w.once('error', onErr);
    w.once('close', onClose);
    const ok = w.write(chunk, () => undefined);
    if (ok) done();
    else w.once('drain', done);
  });
}

function endAsync(w: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    w.once('error', reject);
    w.end(() => resolve());
  });
}

/** Parser TAR en streaming: `stream.pipeline(origen, new TarParser(handler))`. */
export class TarParser extends Writable {
  private buf: Buffer = Buffer.alloc(0);
  private remaining = 0;
  private pad = 0;
  private sink: Writable | null = null;
  private collect: Buffer[] | null = null;
  private collectKind: 'pax' | 'longname' | null = null;
  private collected = 0;
  private nextName: string | null = null;
  private ended = false;
  entries = 0;

  constructor(private readonly onEntry: TarEntryHandler) {
    super();
  }

  _write(chunk: Buffer, _enc: string, cb: (e?: Error | null) => void) {
    this.process(chunk).then(() => cb(), (e) => cb(e));
  }

  _final(cb: (e?: Error | null) => void) {
    if (this.remaining > 0 || this.sink) return cb(new Error('Archivo TAR incompleto (truncado)'));
    if (!this.ended && this.entries === 0) return cb(new Error('No es un archivo TAR válido'));
    cb();
  }

  private async process(chunk: Buffer) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.ended) {
        this.buf = Buffer.alloc(0);
        return;
      }
      if (this.remaining > 0) {
        if (!this.buf.length) return;
        const n = Math.min(this.remaining, this.buf.length);
        const part = this.buf.subarray(0, n);
        this.buf = this.buf.subarray(n);
        this.remaining -= n;
        if (this.collect) {
          this.collected += n;
          if (this.collected > 1024 * 1024) throw new Error('Cabecera TAR extendida demasiado grande');
          this.collect.push(Buffer.from(part));
        } else if (this.sink) {
          await writeAsync(this.sink, Buffer.from(part));
        }
        if (this.remaining === 0) await this.finishEntry();
        continue;
      }
      if (this.pad > 0) {
        const n = Math.min(this.pad, this.buf.length);
        if (!n) return;
        this.buf = this.buf.subarray(n);
        this.pad -= n;
        continue;
      }
      if (this.buf.length < BLOCK) return;
      const h = this.buf.subarray(0, BLOCK);
      this.buf = this.buf.subarray(BLOCK);
      if (h.every((b) => b === 0)) {
        this.ended = true;
        continue;
      }
      if (readNumber(h, 148, 8) !== checksum(h)) throw new Error('Archivo TAR dañado (checksum)');
      const size = readNumber(h, 124, 12);
      const rawType = String.fromCharCode(h[156] || 48);
      const magic = h.toString('ascii', 257, 262);
      const prefix = magic === 'ustar' ? readString(h, 345, 155) : '';
      const base = readString(h, 0, 100);
      this.remaining = size;
      this.pad = padding(size);

      if (rawType === 'x' || rawType === 'L') {
        this.collect = [];
        this.collected = 0;
        this.collectKind = rawType === 'x' ? 'pax' : 'longname';
        if (size === 0) await this.finishEntry();
        continue;
      }
      if (rawType === 'g') {
        this.sink = null;
        if (size === 0) await this.finishEntry();
        continue;
      }
      const name = this.nextName ?? (prefix ? `${prefix}/${base}` : base);
      this.nextName = null;
      const type: TarEntry['type'] =
        rawType === '0' || rawType === '\0' || rawType === '7' ? 'file' : rawType === '5' ? 'dir' : 'other';
      this.entries++;
      this.sink = (await this.onEntry({ name, size, type, rawType })) || null;
      if (size === 0) await this.finishEntry();
    }
  }

  private async finishEntry() {
    if (this.collect) {
      const data = Buffer.concat(this.collect).toString('utf8');
      if (this.collectKind === 'longname') {
        this.nextName = data.replace(/\0+$/, '');
      } else {
        const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data);
        if (m) this.nextName = m[1];
      }
      this.collect = null;
      this.collectKind = null;
      return;
    }
    if (this.sink) {
      const s = this.sink;
      this.sink = null;
      await endAsync(s);
    }
  }
}

/**
 * Normaliza la ruta de una entrada y la rechaza si intenta salir del destino.
 * Devuelve '' para la raíz ('.' / './').
 */
export function safeEntryPath(name: string): string {
  const n = name.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  if (n === '' || n === '.') return '';
  if (n.includes('\\') || n.includes('\0') || n.startsWith('/') || /^[A-Za-z]:/.test(n)) {
    throw new Error(`Ruta no permitida en el archivo: ${name.slice(0, 120)}`);
  }
  if (n.split('/').some((seg) => seg === '..' || seg === '')) {
    throw new Error(`Ruta no permitida en el archivo: ${name.slice(0, 120)}`);
  }
  return n;
}
