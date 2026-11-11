import { Body, Controller, Get, Patch, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AdminGuard } from '../auth/roles.guard';
import { BrandingService } from './branding.service';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import { UploadsService } from '../uploads/uploads.service';

@Controller('branding')
export class BrandingController {
  constructor(
    private readonly service: BrandingService,
    private readonly uploads: UploadsService,
  ) {}

  /** Público: el login y la SPA leen marca antes de autenticarse. */
  @Get()
  get() {
    return this.service.get();
  }

  /**
   * Favicon dinámico — sirve el logo del branding si está configurado, si no el
   * default estático de /public/favicon.svg. Lo referenciamos desde index.html
   * así la PRIMERA petición HTTP ya devuelve la imagen correcta, evitando el
   * "flash" del icono azul mientras el JS se carga.
   *
   * Cache corto (60 s) + must-revalidate: con un logo recién subido el navegador
   * vuelve a pedirlo, pero no martilla al servidor en cada navegación.
   */
  /**
   * Logo público de la empresa. Existe porque /uploads dejó de ser público
   * (contiene fotos de rostro): la pantalla de login necesita mostrar el logo
   * SIN sesión, y el logo sí es información pública. Sirve sólo ese archivo,
   * nunca uno arbitrario.
   */
  @Get('logo')
  async logo(@Res() res: Response) {
    const b = await this.service.get();
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    const file = b.logoUrl ? this.uploads.readBuffer(b.logoUrl) : null;
    if (!file) return res.status(404).end();
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Length', String(file.buf.length));
    return res.end(file.buf);
  }

  @Get('favicon')
  async favicon(@Res() res: Response) {
    const b = await this.service.get();
    res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    if (b.logoUrl) {
      const file = this.uploads.readBuffer(b.logoUrl);
      if (file) {
        res.setHeader('Content-Type', file.mime);
        res.setHeader('Content-Length', String(file.buf.length));
        return res.end(file.buf);
      }
    }
    // Fallback: el favicon estático del frontend desplegado en /public.
    const def = path.resolve(process.cwd(), 'public', 'favicon.svg');
    if (fs.existsSync(def)) {
      const buf = fs.readFileSync(def);
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Content-Length', String(buf.length));
      return res.end(buf);
    }
    res.status(404).end();
  }

  @UseGuards(AdminGuard)
  @Patch()
  update(@Body() dto: UpdateBrandingDto) {
    return this.service.update(dto);
  }
}
