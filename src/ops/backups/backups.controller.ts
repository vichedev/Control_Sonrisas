import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { diskStorage } from 'multer';
import type { Response } from 'express';
import { AdminGuard } from '../../auth/roles.guard';
import { AuditService, auditCtx } from '../../audit/audit.service';
import { CreateBackupDto, ReauthDto, RestoreBackupDto } from '../ops.dto';
import { opsConfig } from '../ops.config';
import { ReauthService } from '../reauth.service';
import { Actor, BackupsService, mapEngineError } from './backups.service';

const cfg = opsConfig();
const incomingDir = path.join(cfg.backupDir, '.incoming');

const actorOf = (req: any): Actor => ({ id: req.user?.id, email: req.user?.email || '', name: req.user?.name });

@Controller('system/backups')
export class BackupsController {
  constructor(
    private readonly backups: BackupsService,
    private readonly reauth: ReauthService,
    private readonly audit: AuditService,
  ) {}

  @UseGuards(AdminGuard)
  @Get()
  overview() {
    return this.backups.overview();
  }

  @UseGuards(AdminGuard)
  @Post()
  @HttpCode(202)
  create(@Body() dto: CreateBackupDto, @Req() req: any) {
    const actor = actorOf(req);
    const ctx = auditCtx(req);
    return this.backups.startCreate(actor, dto.note, (ok, file, msg) => {
      this.audit.record(ctx, {
        entity: 'backup',
        entityId: file || 'manual',
        action: 'create',
        summary: ok ? `Creó un respaldo manual (${file})` : `Respaldo manual fallido: ${msg || ''}`,
      });
    });
  }

  /** Paso 1 de la descarga: re-confirmar identidad y obtener un enlace de un solo uso. */
  @UseGuards(AdminGuard)
  @Post(':file/download-link')
  @HttpCode(200)
  async downloadLink(@Param('file') file: string, @Body() dto: ReauthDto, @Req() req: any) {
    await this.reauth.verify(req.user?.id, dto.password, dto.code);
    const token = this.backups.issueDownloadToken(file, actorOf(req));
    return { url: `/api/system/backups/download?token=${encodeURIComponent(token)}`, expiresIn: 120 };
  }

  /** Paso 2: descarga en streaming con el token (sin cabecera Authorization, para <a href>). */
  @Get('download')
  async download(@Query('token') token: string, @Req() req: any, @Res() res: Response) {
    const t = this.backups.consumeDownloadToken(token);
    let full = '';
    try {
      full = this.backups.engine.resolve(t.file);
    } catch (e) {
      mapEngineError(e);
    }
    const st = await fs.promises.stat(full);
    await this.audit.record(
      { ...auditCtx(req), actorId: t.userId, actorEmail: t.email },
      { entity: 'backup', entityId: t.file, action: 'security', summary: `Descargó el respaldo ${t.file}` },
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(st.size));
    res.setHeader('Content-Disposition', `attachment; filename="${t.file}"`);
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(full)
      .on('error', () => res.destroy())
      .pipe(res);
  }

  @UseGuards(AdminGuard)
  @Post(':file/verify')
  @HttpCode(200)
  async verify(@Param('file') file: string) {
    const m = await this.backups.verify(file);
    return { ok: true, manifest: m };
  }

  @UseGuards(AdminGuard)
  @Post(':file/delete')
  @HttpCode(200)
  async remove(@Param('file') file: string, @Body() dto: ReauthDto, @Req() req: any) {
    await this.reauth.verify(req.user?.id, dto.password, dto.code);
    await this.backups.remove(file);
    await this.audit.record(auditCtx(req), {
      entity: 'backup',
      entityId: file.slice(0, 64),
      action: 'delete',
      summary: `Eliminó el respaldo ${file}`,
    });
    return { ok: true };
  }

  @UseGuards(AdminGuard)
  @Post(':file/restore')
  @HttpCode(202)
  async restore(@Param('file') file: string, @Body() dto: RestoreBackupDto, @Req() req: any) {
    await this.reauth.verify(req.user?.id, dto.password, dto.code);
    const ctx = auditCtx(req);
    const result = this.backups.restore(file, actorOf(req), (ok, msg, safety) => {
      this.audit.record(ctx, {
        entity: 'backup',
        entityId: file.slice(0, 64),
        action: 'security',
        summary: ok
          ? `Restauró el sistema desde ${file} (seguridad previa: ${safety})`
          : `Restauración fallida desde ${file}: ${msg || ''}`,
      });
    });
    await this.audit.record(ctx, {
      entity: 'backup',
      entityId: file.slice(0, 64),
      action: 'security',
      summary: `Solicitó restaurar el respaldo ${file} (${result.mode === 'updater' ? 'actualizador' : 'en proceso'})`,
    });
    return result;
  }

  @UseGuards(AdminGuard)
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          fs.mkdir(incomingDir, { recursive: true }, (err) => cb(err, incomingDir));
        },
        filename: (_req, _file, cb) => cb(null, `upload-${Date.now()}-${randomBytes(6).toString('hex')}`),
      }),
      limits: { fileSize: cfg.uploadMaxBytes, files: 1, fields: 5 },
      fileFilter: (_req, file, cb) => {
        const ok = /\.tar(\.enc)?$/i.test(file.originalname || '');
        cb(ok ? null : new BadRequestException('Sólo se aceptan respaldos .tar o .tar.enc'), ok);
      },
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file?.path) throw new BadRequestException('Falta el archivo');
    const info = await this.backups.importUpload(file.path, actorOf(req));
    await this.audit.record(auditCtx(req), {
      entity: 'backup',
      entityId: info.file,
      action: 'create',
      summary: `Subió un respaldo externo (${String(file.originalname).slice(0, 100)} → ${info.file})`,
    });
    return info;
  }
}
