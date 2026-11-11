import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { User } from '../users/user.entity';

/** Extensiones que se pueden servir desde /uploads. Todo lo demás se bloquea. */
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg']);

/** Content-Type que forzamos según la extensión (nunca lo adivina el navegador). */
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  // Los SVG se sirven como texto plano: un SVG puede contener <script> y, servido
  // como image/svg+xml en el mismo origen, ejecutaría JS con la sesión del usuario.
  svg: 'text/plain; charset=utf-8',
};

/** Vigencia del token de medios (ms). El frontend lo renueva en cada `/auth/me`. */
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

/** Cache del estado del usuario (activo + tokenVersion) para no ir a BD por cada foto. */
const USER_CACHE_TTL_MS = 60 * 1000;
const USER_CACHE_MAX = 5000;

/**
 * Control de acceso a los archivos de /uploads (fotos de rostro y de marcaje:
 * datos biométricos).
 *
 * ANTES: `ServeStaticModule` publicaba el directorio entero sin ninguna
 * autenticación — cualquiera con la URL veía la foto, sin sesión.
 *
 * AHORA: cada petición debe traer un "media token" (`?mt=` o cookie `sonrisas_media`)
 * firmado con HMAC-SHA256 sobre el secreto del servidor. El token va ligado al
 * usuario y a su `tokenVersion`, así que "cerrar todas las sesiones" o cambiar
 * la contraseña también invalida los enlaces a las fotos.
 *
 * Se usa un token propio en vez del JWT del header porque las etiquetas <img>
 * del navegador no pueden enviar cabeceras `Authorization`.
 */
@Injectable()
export class MediaAccessService {
  private readonly logger = new Logger('MediaAccess');

  private readonly userCache = new Map<string, { ok: boolean; tv: number; at: number }>();

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
  ) {}

  private get secret(): string {
    // JWT_SECRET siempre existe (AuthModule no arranca sin él).
    return this.config.get<string>('JWT_SECRET') || '';
  }

  /** true si hay que exigir token para leer /uploads. */
  get required(): boolean {
    const raw = this.config.get<string>('UPLOADS_REQUIRE_AUTH');
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    // Por defecto: exigido en producción. En desarrollo el frontend corre en otro
    // puerto y conviene poder abrir las fotos a mano; se puede forzar con la env var.
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  /** Emite un token de medios para un usuario. Formato: `<userId>.<tokenVersion>.<exp>.<hmac>` */
  issue(userId: string, tokenVersion = 0): string {
    const exp = Date.now() + TOKEN_TTL_MS;
    const payload = `${userId}.${tokenVersion}.${exp}`;
    return `${payload}.${this.sign(payload)}`;
  }

  /** Valida un token de medios (firma + caducidad). Devuelve userId/tokenVersion o null. */
  verify(token: string | undefined | null): { userId: string; tokenVersion: number } | null {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 4) return null;
    const [userId, tokenVersion, expRaw, sig] = parts;
    const exp = Number(expRaw);
    if (!isFinite(exp) || exp < Date.now()) return null;
    const expected = this.sign(`${userId}.${tokenVersion}.${expRaw}`);
    // Comparación en tiempo constante (evita distinguir firmas por timing).
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const tv = Number(tokenVersion);
    if (!Number.isInteger(tv)) return null;
    return { userId, tokenVersion: tv };
  }

  /**
   * Comprueba que el usuario del token sigue existiendo, está activo y su
   * tokenVersion coincide (desactivar / logout-all revoca también las fotos).
   * Cachea el resultado ~60 s.
   */
  async isUserValid(userId: string, tokenVersion: number): Promise<boolean> {
    const now = Date.now();
    let entry = this.userCache.get(userId);
    // Si el token trae otra versión que la cacheada (p. ej. justo tras cambiar la
    // contraseña) se vuelve a leer de la BD en vez de rechazar durante un minuto.
    const stale = !!entry && entry.tv !== tokenVersion;
    if (!entry || stale || now - entry.at > USER_CACHE_TTL_MS) {
      let user: User | null = null;
      try {
        user = await this.usersRepo.findOne({
          where: { id: userId },
          select: { id: true, active: true, tokenVersion: true },
        });
      } catch {
        // userId no es un UUID válido u otro error de BD → denegar.
        user = null;
      }
      entry = { ok: !!user && !!user.active, tv: user?.tokenVersion || 0, at: now };
      if (this.userCache.size >= USER_CACHE_MAX) this.userCache.clear();
      this.userCache.set(userId, entry);
    }
    return entry.ok && entry.tv === tokenVersion;
  }

  /** Olvida el estado cacheado de un usuario (p. ej. tras desactivarlo). */
  forget(userId: string) {
    this.userCache.delete(userId);
  }

  /**
   * Middleware Express que protege /uploads. Se monta en `main.ts` ANTES de que
   * `ServeStaticModule` registre el servidor de estáticos, así que ninguna
   * petición llega al disco sin pasar por aquí.
   */
  middleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      // 1) Sólo lectura.
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.status(405).json({ statusCode: 405, message: 'Método no permitido' });
        return;
      }

      // 2) Nombre de archivo seguro (sin traversal) y extensión en lista blanca.
      const rawPath = decodeURIComponent((req.path || '').split('?')[0]);
      if (rawPath.includes('..') || rawPath.includes('\0')) {
        res.status(400).json({ statusCode: 400, message: 'Ruta inválida' });
        return;
      }
      const ext = (rawPath.split('.').pop() || '').toLowerCase();
      if (!ALLOWED_EXT.has(ext)) {
        // Bloquea el vector de XSS almacenado: un .html/.js subido antes de este
        // parche (o por cualquier otra vía) deja de servirse.
        res.status(404).json({ statusCode: 404, message: 'No encontrado' });
        return;
      }

      // 3) Cabeceras defensivas para TODO lo que salga de /uploads.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', MIME_BY_EXT[ext] || 'application/octet-stream');
      // Aunque el archivo consiguiera ser HTML, este CSP le prohíbe ejecutar nada.
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
      // Datos biométricos: nunca en cachés compartidas.
      res.setHeader('Cache-Control', 'private, max-age=3600');

      if (!this.required) return next();

      // 4) Token: query `?mt=` (lo añade el frontend en cada <img>) o cookie.
      const fromQuery = typeof req.query?.mt === 'string' ? req.query.mt : null;
      const fromCookie = readCookie(req.headers.cookie, 'sonrisas_media');
      const tok = this.verify(fromQuery || fromCookie);
      if (!tok || !(await this.isUserValid(tok.userId, tok.tokenVersion))) {
        res.status(403).json({
          statusCode: 403,
          message: 'Acceso no autorizado a este archivo',
        });
        return;
      }
      return next();
    };
  }
}

/** Lee una cookie del header `Cookie` sin añadir dependencias. */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}
