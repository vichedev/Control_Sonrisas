import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomBytes } from 'crypto';
import { StaffGuard } from '../auth/roles.guard';
import { RateLimit } from '../common/rate-limit.decorator';

/**
 * Extensión permitida según el mimetype declarado.
 *
 * SEGURIDAD: antes la extensión salía de `extname(file.originalname)`, un dato
 * que controla el cliente. Con `mimetype: image/png` + `originalname: x.html`
 * el archivo quedaba en /uploads como .html y se servía como HTML en el MISMO
 * ORIGEN de la app → XSS almacenado y robo del token de sesión. Ahora la
 * extensión la decide el servidor y el mimetype está en lista blanca.
 */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Firmas binarias (magic bytes) esperadas por extensión. */
function sniff(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 6).toString('latin1').startsWith('GIF8')) return 'gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

// Sólo personal: el portal familiar no sube archivos por aquí (las fotos viajan en base64 en el JSON).
@UseGuards(StaffGuard)
@Controller('uploads')
export class UploadsController {
  constructor(private readonly config: ConfigService) {}

  @RateLimit(20)
  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (_req, file, cb) => {
          const ext = EXT_BY_MIME[file.mimetype];
          if (!ext) return cb(new BadRequestException('Tipo de imagen no permitido'), '');
          const id = randomBytes(8).toString('hex');
          cb(null, `${Date.now()}-${id}.${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
      fileFilter: (_req, file, cb) => {
        if (!EXT_BY_MIME[file.mimetype]) {
          return cb(new BadRequestException('Solo se permiten imágenes JPG, PNG, WEBP o GIF'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Archivo requerido');

    // Verificación de contenido real: el mimetype lo declara el cliente, los
    // magic bytes no. Si no coincide con una imagen conocida, se descarta.
    const fs = await import('fs/promises');
    const handle = await fs.open(file.path, 'r').catch(() => null);
    let ok = false;
    if (handle) {
      try {
        const head = Buffer.alloc(16);
        await handle.read(head, 0, 16, 0);
        const real = sniff(head);
        ok = !!real && EXT_BY_MIME[file.mimetype] === (real === 'jpg' ? 'jpg' : real);
      } finally {
        await handle.close();
      }
    }
    if (!ok) {
      await fs.unlink(file.path).catch(() => {});
      throw new BadRequestException('El archivo no es una imagen válida');
    }

    const port = this.config.get<string>('PORT') || '3000';
    const base =
      this.config.get<string>('BACKEND_URL') || `http://localhost:${port}`;
    return {
      url: `${base}/uploads/${file.filename}`,
      filename: file.filename,
      size: file.size,
    };
  }
}
