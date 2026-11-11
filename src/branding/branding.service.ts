import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppBranding } from './branding.entity';
import { UploadsService } from '../uploads/uploads.service';

import { UpdateBrandingDto } from './dto/update-branding.dto';

export { UpdateBrandingDto };

@Injectable()
export class BrandingService {
  private readonly log = new Logger('BrandingService');

  constructor(
    @InjectRepository(AppBranding) private readonly repo: Repository<AppBranding>,
    private readonly uploads: UploadsService,
  ) {}

  /** Devuelve la (única) config de branding; la crea con defaults si no existe. */
  async get(): Promise<AppBranding> {
    const found = await this.repo.find({ take: 1, order: { createdAt: 'ASC' } });
    if (found[0]) return found[0];
    return this.repo.save(this.repo.create({}));
  }

  async update(dto: UpdateBrandingDto): Promise<AppBranding> {
    const current = await this.get();
    if (dto.companyName !== undefined) current.companyName = String(dto.companyName).trim().slice(0, 120) || 'Sonrisas';
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
        current.logoUrl = ''; // limpiar
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
