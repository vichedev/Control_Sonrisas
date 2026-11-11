import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes, Decipher } from 'crypto';
import * as fs from 'fs';
import { Transform, TransformCallback } from 'stream';

/**
 * Cifrado en reposo compatible con OpenSSL, para poder descifrar un respaldo a mano:
 *   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 \
 *     -pass env:BACKUP_ENCRYPTION_KEY -in X.tar.enc -out X.tar
 * Formato: "Salted__" + sal (8 bytes) + AES-256-CBC (clave e IV por PBKDF2-SHA256).
 * La integridad la garantizan los sha256 del manifiesto (dentro del archivo cifrado).
 */
export const PBKDF2_ITER = 200_000;
const MAGIC = Buffer.from('Salted__', 'ascii');

function derive(pass: string, salt: Buffer) {
  const kiv = pbkdf2Sync(Buffer.from(pass, 'utf8'), salt, PBKDF2_ITER, 48, 'sha256');
  return { key: kiv.subarray(0, 32), iv: kiv.subarray(32, 48) };
}

export function createEncryptStream(pass: string): Transform {
  const salt = randomBytes(8);
  const { key, iv } = derive(pass, salt);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  let headerSent = false;
  const header = () => {
    if (headerSent) return null;
    headerSent = true;
    return Buffer.concat([MAGIC, salt]);
  };
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      const h = header();
      if (h) this.push(h);
      cb(null, cipher.update(chunk));
    },
    flush(cb: TransformCallback) {
      const h = header();
      if (h) this.push(h);
      try {
        cb(null, cipher.final());
      } catch (e: any) {
        cb(e);
      }
    },
  });
}

export function createDecryptStream(pass: string): Transform {
  let head = Buffer.alloc(0);
  let decipher: Decipher | null = null;
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      if (!decipher) {
        head = Buffer.concat([head, chunk]);
        if (head.length < 16) return cb();
        if (!head.subarray(0, 8).equals(MAGIC)) return cb(new Error('El archivo no está cifrado con el formato esperado'));
        const { key, iv } = derive(pass, head.subarray(8, 16));
        decipher = createDecipheriv('aes-256-cbc', key, iv);
        const rest = head.subarray(16);
        head = Buffer.alloc(0);
        return cb(null, rest.length ? decipher.update(rest) : undefined);
      }
      cb(null, decipher.update(chunk));
    },
    flush(cb: TransformCallback) {
      if (!decipher) return cb(new Error('Archivo cifrado vacío o truncado'));
      try {
        cb(null, decipher.final());
      } catch {
        cb(new Error('No se pudo descifrar: la clave BACKUP_ENCRYPTION_KEY no coincide o el archivo está dañado'));
      }
    },
  });
}

/** ¿El archivo empieza con la cabecera de OpenSSL? */
export async function isEncryptedFile(file: string): Promise<boolean> {
  const fh = await fs.promises.open(file, 'r');
  try {
    const b = Buffer.alloc(8);
    const { bytesRead } = await fh.read(b, 0, 8, 0);
    return bytesRead === 8 && b.equals(MAGIC);
  } finally {
    await fh.close();
  }
}
