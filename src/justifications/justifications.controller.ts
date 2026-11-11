import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard, CoordinatorGuard, StaffGuard } from '../auth/roles.guard';
import { JustificationsService } from './justifications.service';
import { CreateJustificationDto } from './dto/create-justification.dto';
import { DecideJustificationDto } from './dto/decide-justification.dto';
import { AuditService, auditCtx } from '../audit/audit.service';
import { ScopeService } from '../common/scope/scope.service';

@Controller('justifications')
export class JustificationsController {
  constructor(
    private readonly service: JustificationsService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  @UseGuards(StaffGuard)
  @Get()
  async list(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('childId') childId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    // Educadora: sólo justificaciones de niños de sus salas.
    if (childId) await this.scope.assertChild(req.user, childId);
    const classroomIds = await this.scope.classroomFilter(req.user);
    return this.service.list({ status, childId, classroomIds, from, to });
  }

  @UseGuards(StaffGuard)
  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    const j = await this.service.findOne(id);
    await this.scope.assertChild(req.user, j.childId);
    return j;
  }

  /** Alta desde el panel: la familia avisó por teléfono y la educadora lo registra. */
  @UseGuards(StaffGuard)
  @Post()
  async create(@Req() req: any, @Body() dto: CreateJustificationDto) {
    await this.scope.assertChild(req.user, dto.childId);
    return this.service.create(dto, req.user);
  }

  @UseGuards(CoordinatorGuard)
  @Post(':id/decide')
  async decide(@Req() req: any, @Param('id') id: string, @Body() dto: DecideJustificationDto) {
    const j = await this.service.decide(id, dto, req.user);
    await this.audit.record(auditCtx(req), {
      entity: 'justification',
      entityId: id,
      action: 'update',
      summary: `${dto.decision === 'approved' ? 'Aprobó' : 'Rechazó'} una justificación de ausencia`,
      after: { status: j.status, adminNote: j.adminNote },
    });
    return j;
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
