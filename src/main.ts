import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import helmet from 'helmet';
import compression from 'compression';
import { json, urlencoded, NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { MediaAccessService } from './uploads/media-access.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const app = await NestFactory.create(AppModule, {
    // Desactivamos el body parser por defecto (límite 100kb) y configuramos uno más amplio:
    // las fotos viajan como base64 dentro del JSON.
    bodyParser: false,
    logger:
      process.env.NODE_ENV === 'production'
        ? ['error', 'warn', 'log']
        : ['error', 'warn', 'log', 'debug', 'verbose'],
  });
  const config = app.get(ConfigService);

  // Body parser con límite amplio (suficiente para fotos en base64; UploadsService corta a 8 MB)
  app.use(json({ limit: '16mb' }));
  app.use(urlencoded({ extended: true, limit: '16mb' }));

  // HTTPS vs HTTP plano. Las cabeceras que obligan a usar HTTPS (HSTS y la directiva
  // CSP `upgrade-insecure-requests`) se envían SÓLO en peticiones que llegaron por
  // HTTPS: directamente (req.secure) o a través de un proxy con TLS (Caddy, Nginx,
  // Cloudflare…) que pone `X-Forwarded-Proto: https`. En el modo "puerto directo"
  // (http://IP:8986) no se envían: el navegador intentaría https://IP:8986, que no
  // existe, y la app no cargaría. Falsear la cabecera sólo afecta a la respuesta de
  // quien la falsea.
  const isSecureRequest = (req: Request): boolean =>
    req.secure ||
    String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase() === 'https';

  const publicMode = (config.get<string>('PUBLIC_MODE') || '').trim().toLowerCase();
  const publicHttps =
    publicMode === 'https' ||
    (config.get<string>('FRONTEND_URL') || '')
      .split(',')
      .some((u) => u.trim().toLowerCase().startsWith('https://'));
  if (!publicHttps && process.env.NODE_ENV === 'production') {
    logger.warn(
      'Publicado por HTTP sin TLS: la cámara del navegador y la instalación como app (PWA) necesitan HTTPS. Pon un proxy con certificado delante (ver DEPLOY.md).',
    );
  }

  // Seguridad: cabeceras HTTP
  //  · contentSecurityPolicy: se envía por CABECERA (además del <meta> del front).
  //    El <meta> se puede perder si alguien sirve el HTML de otra forma; la
  //    cabecera no. `upgrade-insecure-requests` sólo va aquí y sólo con HTTPS.
  //  · crossOriginResourcePolicy: cross-origin — fotos en /uploads necesitan poder
  //    cargarse desde el frontend (otro origen permitido).
  //  · crossOriginEmbedderPolicy: false — evita romper iframes / 3rd-party assets.
  //  · hsts: forzar HTTPS por 6 meses con preload (sólo en peticiones HTTPS; con
  //    HTTP plano dejaría el sitio inaccesible).
  //  · COOP sólo tiene efecto en orígenes seguros (en HTTP el navegador avisa).
  //  · noSniff y frameguard vienen on por defecto en helmet, no hace falta tocarlos.
  const securityHeaders = (secure: boolean) => {
    const directives: Record<string, string[]> = {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:'],
      'font-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'worker-src': ["'self'", 'blob:'],
      'manifest-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
    };
    if (secure) directives['upgrade-insecure-requests'] = [];
    return helmet({
      contentSecurityPolicy: { useDefaults: false, directives },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: secure ? { policy: 'same-origin' } : false,
      hsts: secure
        ? { maxAge: 60 * 60 * 24 * 180, includeSubDomains: true, preload: true } // 180 días
        : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    });
  };
  const helmetHttps = securityHeaders(true);
  const helmetHttp = securityHeaders(false);
  app.use((req: Request, res: Response, next: NextFunction) =>
    (isSecureRequest(req) ? helmetHttps : helmetHttp)(req, res, next),
  );

  // Control de acceso a /uploads. Aquí viven las fotos de los NIÑOS: nunca deben ser
  // públicas, ni siquiera con la URL. Cada petición exige un token de medios firmado.
  // Debe ir ANTES de que ServeStaticModule registre su handler: los middlewares
  // añadidos aquí se registran en Express de inmediato, mientras que los de los
  // módulos se aplican en `app.init()` (dentro de `listen()`).
  const mediaAccess = app.get(MediaAccessService);
  app.use('/uploads', mediaAccess.middleware());
  if (!mediaAccess.required) {
    logger.warn(
      '/uploads se está sirviendo SIN autenticación (desarrollo). En producción se exige token — fuérzalo con UPLOADS_REQUIRE_AUTH=true.',
    );
  }

  // Seguridad: ocultar header con versión de Express
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  // Performance: compresión gzip — EXCEPTO el stream de tiempo real (SSE): `compression`
  // acumula el cuerpo y los eventos llegarían tarde o nunca.
  app.use(
    compression({
      filter: (req, res) => {
        if (String(req.originalUrl || req.url || '').startsWith('/api/realtime/')) return false;
        if (String(res.getHeader('Content-Type') || '').includes('text/event-stream')) return false;
        return compression.filter(req, res);
      },
    }),
  );

  app.setGlobalPrefix('api', {
    exclude: [{ path: 'uploads/(.*)', method: RequestMethod.GET }],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Confianza limitada en proxy (solo si hay reverse proxy delante)
  if (config.get<string>('TRUST_PROXY') === 'true') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  const frontendUrl =
    config.get<string>('FRONTEND_URL') || 'http://localhost:5173';
  const allowedOrigins = frontendUrl
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
    ],
    exposedHeaders: ['Content-Length', 'Content-Range'],
    maxAge: 86400,
  });

  // Manejo grácil de cierre
  app.enableShutdownHooks();

  const port = config.get<number>('PORT') || 3000;
  await app.listen(port);
  logger.log(`Backend escuchando en http://localhost:${port}/api`);
  logger.log(`CORS permitido para: ${allowedOrigins.join(', ')}`);
}
bootstrap();
