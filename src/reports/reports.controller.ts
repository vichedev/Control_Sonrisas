import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AdminGuard, CoordinatorGuard, StaffGuard } from '../auth/roles.guard';
import { ReportsService } from './reports.service';
import { normalizeDay } from '../common/day.util';
import { AuditService, auditCtx } from '../audit/audit.service';
import { ScopeService } from '../common/scope/scope.service';

const trim = ({ value }: { value: any }) =>
  typeof value === 'string' ? value.trim() : value;

class GenerateDto {
  @IsOptional() @IsUUID()
  childId?: string;

  @IsOptional() @IsString() @MaxLength(10)
  date?: string;

  @IsOptional() @IsUUID()
  classroomId?: string;

  /** Regenera también los reportes editados a mano (pisa el texto). */
  @IsOptional() @IsBoolean()
  force?: boolean;
}

class UpdateReportDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(4000)
  messageText?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  teacherNote?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true })
  photoUrls?: string[];
}

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly service: ReportsService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  /** 404 si el reporte no existe; 403 si el niño no es de una sala a cargo del usuario. */
  private async assertReport(user: any, id: string) {
    const childId = await this.service.childIdOf(id);
    await this.scope.assertChild(user, childId);
  }

  // --- Reportes diarios ---

  @UseGuards(StaffGuard)
  @Get('daily')
  async list(
    @Req() req: any,
    @Query('date') date?: string,
    @Query('classroomId') classroomId?: string,
    @Query('status') status?: string,
    @Query('childId') childId?: string,
  ) {
    const classroomIds = await this.scope.classroomFilter(req.user, classroomId);
    if (childId) await this.scope.assertChild(req.user, childId);
    return this.service.list({ date, classroomIds, status, childId });
  }

  @UseGuards(StaffGuard)
  @Get('daily/:id')
  async get(@Req() req: any, @Param('id') id: string) {
    await this.assertReport(req.user, id);
    return this.service.findOne(id);
  }

  /** Seguimiento del día: checklist de todos los niños de las salas a cargo. */
  @UseGuards(StaffGuard)
  @Get('checklists')
  async checklists(
    @Req() req: any,
    @Query('date') date?: string,
    @Query('classroomId') classroomId?: string,
  ) {
    const classroomIds = await this.scope.classroomFilter(req.user, classroomId);
    return this.service.dayChecklists(date, classroomIds);
  }

  /** Vista previa sin guardar nada: lo que se registró del niño ese día + checklist. */
  @UseGuards(StaffGuard)
  @Get('preview/:childId')
  async preview(@Req() req: any, @Param('childId') childId: string, @Query('date') date?: string) {
    await this.scope.assertChild(req.user, childId);
    const day = normalizeDay(date);
    const snapshot = await this.service.buildSnapshot(childId, day);
    const checklist = await this.service.buildChecklist(childId, day);
    snapshot.checklist = checklist;
    return { snapshot, checklist, messageText: await this.service.composeMessage(snapshot) };
  }

  /** Genera el reporte de un niño, o de toda una sala si no se indica `childId`. */
  @UseGuards(StaffGuard)
  @Post('generate')
  async generate(@Req() req: any, @Body() dto: GenerateDto) {
    if (dto.childId) {
      await this.scope.assertChild(req.user, dto.childId);
      return this.service.generate(dto.childId, dto.date || '', req.user, { force: dto.force });
    }
    const classroomIds = await this.scope.classroomFilter(req.user, dto.classroomId);
    return this.service.generateForDay(dto.date || '', classroomIds, req.user, { force: dto.force });
  }

  @UseGuards(StaffGuard)
  @Patch('daily/:id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateReportDto) {
    await this.assertReport(req.user, id);
    return this.service.update(id, dto);
  }

  @UseGuards(StaffGuard)
  @Post('daily/:id/send')
  async send(@Req() req: any, @Param('id') id: string) {
    await this.assertReport(req.user, id);
    const res = await this.service.send(id, req.user);
    await this.audit.record(auditCtx(req), {
      entity: 'daily_report',
      entityId: id,
      action: 'update',
      summary: `Envió el reporte diario de "${res.report.childName}" a ${res.report.sentTo}`,
    });
    return res;
  }

  /**
   * Reenvía un reporte YA enviado sólo a las familias a las que no les llegó
   * (p. ej. el WhatsApp del centro se desconectó a mitad del envío).
   */
  @UseGuards(StaffGuard)
  @Post('daily/:id/resend-failed')
  async resendFailed(@Req() req: any, @Param('id') id: string) {
    await this.assertReport(req.user, id);
    const res = await this.service.send(id, req.user, { onlyMissing: true });
    await this.audit.record(auditCtx(req), {
      entity: 'daily_report',
      entityId: id,
      action: 'update',
      summary: `Reenvió el reporte diario de "${res.report.childName}" a las familias pendientes`,
    });
    return res;
  }

  /**
   * Envío en bloque de todos los reportes listos de un día. La educadora también puede:
   * `classroomFilter` limita el envío a sus salas.
   */
  @UseGuards(StaffGuard)
  @Post('send-day')
  async sendDay(@Req() req: any, @Body() dto: GenerateDto) {
    const classroomIds = await this.scope.classroomFilter(req.user, dto.classroomId);
    const res = await this.service.sendForDay(dto.date || '', classroomIds, req.user);
    await this.audit.record(auditCtx(req), {
      entity: 'daily_report',
      entityId: dto.date || 'hoy',
      action: 'update',
      summary: `Envió ${res.sent} de ${res.total} reporte(s) diario(s) en bloque`,
    });
    return res;
  }

  @UseGuards(AdminGuard)
  @Delete('daily/:id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  // --- Informes generales ---

  @UseGuards(StaffGuard)
  @Get('overview')
  async overview(@Req() req: any, @Query('date') date?: string) {
    const classroomIds = await this.scope.classroomFilter(req.user);
    return this.service.overview(date, classroomIds);
  }

  @UseGuards(StaffGuard)
  @Get('attendance')
  async attendance(
    @Req() req: any,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('classroomId') classroomId?: string,
  ) {
    const classroomIds = await this.scope.classroomFilter(req.user, classroomId);
    return this.service.attendanceReport({ from, to, classroomIds });
  }

  @UseGuards(StaffGuard)
  @Get('attendance-trend')
  async trend(
    @Req() req: any,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('classroomId') classroomId?: string,
  ) {
    const classroomIds = await this.scope.classroomFilter(req.user, classroomId);
    return this.service.attendanceTrend(from, to, classroomIds);
  }
}
