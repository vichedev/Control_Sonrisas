import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

@Injectable()
export class UploadsService {
  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    const port = this.config.get<string>('PORT') || '3000';
    return this.config.get<string>('BACKEND_URL') || `http://localhost:${port}`;
  }

  private get dir(): string {
    const d = path.resolve(process.cwd(), 'uploads');
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    return d;
  }

  publicUrl(filename: string): string {
    return `${this.baseUrl}/uploads/${filename}`;
  }

  /**
   * Guarda una imagen recibida como data URL base64 en /uploads
   * y devuelve la URL pública.
   */
  saveDataUrl(dataUrl: string, prefix = 'img'): string {
    const m = /^data:(image\/(png|jpe?g|webp));base64,(.+)$/i.exec((dataUrl || '').trim());
    if (!m) throw new Error('Imagen base64 inválida (se espera data URL image/jpeg|png|webp)');
    const ext = m[2].toLowerCase() === 'jpeg' ? 'jpg' : m[2].toLowerCase();
    const buffer = Buffer.from(m[3], 'base64');
    if (buffer.length === 0) throw new Error('Imagen vacía');
    if (buffer.length > MAX_BYTES) throw new Error('Imagen demasiado grande (máx 8 MB)');
    const filename = `${prefix}-${Date.now()}-${randomBytes(6).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(this.dir, filename), buffer);
    return this.publicUrl(filename);
  }

  /**
   * Lee de vuelta una imagen guardada (a partir de su URL pública o nombre de archivo)
   * y la devuelve como data URL base64. Devuelve null si no existe.
   */
  readAsDataUrl(urlOrFilename: string | null | undefined): string | null {
    if (!urlOrFilename) return null;
    const filename = path.basename(urlOrFilename.split('?')[0].split('#')[0]);
    if (!filename || filename.includes('..')) return null;
    const full = path.join(this.dir, filename);
    try {
      if (!fs.existsSync(full)) return null;
      const buf = fs.readFileSync(full);
      if (!buf.length) return null;
      const ext = path.extname(filename).toLowerCase().replace('.', '') || 'jpeg';
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  }

  /**
   * Lee una imagen guardada como Buffer + content-type (más eficiente que data URL
   * cuando se va a servir directamente como respuesta HTTP, ej. favicon).
   */
  readBuffer(urlOrFilename: string | null | undefined): { buf: Buffer; mime: string } | null {
    if (!urlOrFilename) return null;
    const filename = path.basename(urlOrFilename.split('?')[0].split('#')[0]);
    if (!filename || filename.includes('..')) return null;
    const full = path.join(this.dir, filename);
    try {
      if (!fs.existsSync(full)) return null;
      const buf = fs.readFileSync(full);
      if (!buf.length) return null;
      const ext = path.extname(filename).toLowerCase().replace('.', '') || 'jpeg';
      const mime =
        ext === 'svg' ? 'image/svg+xml'
        : ext === 'png' ? 'image/png'
        : ext === 'webp' ? 'image/webp'
        : ext === 'gif' ? 'image/gif'
        : 'image/jpeg';
      return { buf, mime };
    } catch {
      return null;
    }
  }
}
