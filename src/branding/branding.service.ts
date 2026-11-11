import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { AppBranding } from './branding.entity';
import { UploadsService } from '../uploads/uploads.service';

import { UpdateBrandingDto } from './dto/update-branding.dto';

export { UpdateBrandingDto };

/** Identidad por defecto del centro (instalación de Sonrisitas). */
export const DEFAULT_COMPANY_NAME = 'Sonrisitas';
export const DEFAULT_TAGLINE = 'Centro de Desarrollo Infantil';
/**
 * Logo por defecto: archivo estático de la SPA (client/public/brand → public/brand).
 * Se usa cuando el centro no subió uno propio.
 */
export const DEFAULT_LOGO_URL = '/brand/sonrisitas-logo.png';
const DEFAULT_LOGO_FILE = path.resolve(process.cwd(), 'public', 'brand', 'sonrisitas-logo.png');

/** Lo que devuelve la API pública: la fila + si el logo es el de por defecto. */
export type BrandingView = AppBranding & { logoIsDefault: boolean };

@Injectable()
export class BrandingService {
  private readonly log = new Logger('BrandingService');

  constructor(
    @InjectRepository(AppBranding) private readonly repo: Repository<AppBranding>,
    private readonly uploads: UploadsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Devuelve la (única) config de branding; la crea si no existe con el nombre y lema
   * de COMPANY_NAME / COMPANY_TAGLINE (los escribe install.sh) o los de Sonrisitas.
   */
  async get(): Promise<AppBranding> {
    const found = await this.repo.find({ take: 1, order: { createdAt: 'ASC' } });
    if (found[0]) return found[0];
    return this.repo.save(
      this.repo.create({
        companyName: (this.config.get<string>('COMPANY_NAME') || '').trim().slice(0, 120) || DEFAULT_COMPANY_NAME,
        tagline: (this.config.get<string>('COMPANY_TAGLINE') || '').trim().slice(0, 200) || DEFAULT_TAGLINE,
      }),
    );
  }

  /**
   * Vista pública: si no hay logo propio, `logoUrl` apunta al logo por defecto
   * (`/brand/sonrisitas-logo.png`, que también sirve GET /api/branding/logo) y
   * `logoIsDefault` = true. En la BD el campo sigue vacío.
   */
  toView(b: AppBranding): BrandingView {
    if (b.logoUrl || !fs.existsSync(DEFAULT_LOGO_FILE)) return { ...b, logoIsDefault: false };
    return { ...b, logoUrl: DEFAULT_LOGO_URL, logoIsDefault: true };
  }

  /** Logo del centro (propio o, si no hay, el de por defecto) para servirlo público. */
  async logoFile(): Promise<{ buf: Buffer; mime: string } | null> {
    const b = await this.get();
    return (b.logoUrl ? this.uploads.readBuffer(b.logoUrl) : null) || this.defaultLogo();
  }

  private defaultLogo(): { buf: Buffer; mime: string } | null {
    try {
      if (!fs.existsSync(DEFAULT_LOGO_FILE)) return null;
      return { buf: fs.readFileSync(DEFAULT_LOGO_FILE), mime: 'image/png' };
    } catch {
      return null;
    }
  }

  async update(dto: UpdateBrandingDto): Promise<AppBranding> {
    const current = await this.get();
    if (dto.companyName !== undefined) current.companyName = String(dto.companyName).trim().slice(0, 120) || DEFAULT_COMPANY_NAME;
    if (dto.tagline !== undefined) current.tagline = String(dto.tagline).trim().slice(0, 200);
    if (dto.primaryColor !== undefined) {
      const c = String(dto.primaryColor).trim();
      if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c)) {
        throw new BadRequestException('primaryColor debe ser un color hex (#rrggbb o #rrggbbaa)');
      }
      current.primaryColor = c.toLowerCase();
    }
    if (dto.logoBase64 !== undefined) {
      if (dto.logoBase64 === '') {
        current.logoUrl = ''; // limpiar → vuelve el logo por defecto
      } else {
        try {
          current.logoUrl = this.uploads.saveDataUrl(dto.logoBase64, 'logo');
        } catch (e: any) {
          throw new BadRequestException(e?.message || 'Logo inválido');
        }
      }
    }
    return this.repo.save(current);
  }
}
