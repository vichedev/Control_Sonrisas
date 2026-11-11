import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AdminGuard } from '../../auth/roles.guard';
import { AuditService, auditCtx } from '../../audit/audit.service';
import { MIGRATIONS_TABLE } from '../../database/db-options';
import { schemaMode } from '../../database/env';
import { RollbackSystemDto, UpdateSystemDto } from '../ops.dto';
import { appVersion } from '../ops.config';
import { ReauthService } from '../reauth.service';
import { compareVersions, UpdaterService } from './updater.service';

/** Versión, actualizaciones y vuelta atrás. Todo sólo dirección. */
@UseGuards(AdminGuard)
@Controller('system')
export class SystemController {
  constructor(
    private readonly updater: UpdaterService,
    private readonly reauth: ReauthService,
    private readonly audit: AuditService,
    private readonly ds: DataSource,
  ) {}

  private async migrations() {
    try {
      const rows = await this.ds.query(
        `SELECT name FROM "${MIGRATIONS_TABLE}" ORDER BY id DESC LIMIT 1`,
      );
      const count = await this.ds.query(`SELECT COUNT(*)::int AS c FROM "${MIGRATIONS_TABLE}"`);
      return { executed: Number(count?.[0]?.c || 0), last: rows?.[0]?.name || null };
    } catch {
      return { executed: 0, last: null };
    }
  }

  @Get('version')
  async version() {
    return {
      ...appVersion(),
      nodeEnv: process.env.NODE_ENV || 'development',
      schemaMode: schemaMode(),
      migrations: await this.migrations(),
      updater: this.updater.status(),
      jobs: this.updater.jobs(10),
    };
  }

  @Get('versions')
  versions() {
    const v = this.updater.versions();
    const current = appVersion().version;
    return {
      ...v,
      installed: current,
      tags: v.tags.map((t) => ({ ...t, newer: compareVersions(t.tag, current) > 0, current: compareVersions(t.tag, current) === 0 })),
    };
  }

  @Get('history')
  history() {
    return this.updater.history();
  }

  @Get('jobs')
  jobs() {
    return this.updater.jobs(20);
  }

  @Get('jobs/:id')
  job(@Param('id') id: string) {
    return this.updater.job(id);
  }

  @Post('update')
  @HttpCode(202)
  async update(@Body() dto: UpdateSystemDto, @Req() req: any) {
    await this.reauth.verify(req.user?.id, dto.password, dto.code);
    const known = this.updater.versions().tags.map((t) => t.tag);
    if (known.length && !known.includes(dto.version)) {
      throw new BadRequestException('Esa versión no está publicada en el repositorio');
    }
    if (compareVersions(dto.version, appVersion().version) <= 0) {
      throw new BadRequestException('Sólo se puede actualizar a una versión más nueva. Para volver atrás usa "Volver a la versión anterior".');
    }
    const res = this.updater.submit('update', { version: dto.version }, { id: req.user.id, email: req.user.email });
    await this.audit.record(auditCtx(req), {
      entity: 'system',
      entityId: res.jobId,
      action: 'security',
      summary: `Solicitó actualizar el sistema de ${appVersion().version} a ${dto.version}`,
    });
    return res;
  }

  @Post('rollback')
  @HttpCode(202)
  async rollback(@Body() dto: RollbackSystemDto, @Req() req: any) {
    await this.reauth.verify(req.user?.id, dto.password, dto.code);
    const res = this.updater.submit('rollback', { restoreDb: !!dto.restoreDb }, { id: req.user.id, email: req.user.email });
    await this.audit.record(auditCtx(req), {
      entity: 'system',
      entityId: res.jobId,
      action: 'security',
      summary: `Solicitó volver a la versión anterior${dto.restoreDb ? ' restaurando la base de datos previa a la actualización' : ''}`,
    });
    return res;
  }
}
