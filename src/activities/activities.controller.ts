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
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CoordinatorGuard, StaffGuard } from '../auth/roles.guard';
import { ActivitiesService } from './activities.service';
import {
  CreateActivityDto,
  SetParticipantsDto,
  UpdateActivityDto,
} from './dto/activity.dto';
import { AuditService, auditCtx } from '../audit/audit.service';
import { ScopeService } from '../common/scope/scope.service';

class CompleteActivityDto {
  @IsOptional() @IsString() @MaxLength(2000)
  summary?: string;
}

@Controller('activities')
export class ActivitiesController {
  constructor(
    private readonly service: ActivitiesService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  /**
   * Alcance de escritura: la actividad de una sala, sólo quien la tiene a cargo; la de
   * todo el centro (sala nula), sólo dirección/coordinación.
   */
  private async assertActivityRoom(req: any, classroomId: string | null | undefined) {
    await this.scope.assertClassroom(req.user, classroomId || null);
  }

  private async assertParticipants(req: any, participants?: { childId: string }[]) {
    if (participants?.length) {
      await this.scope.assertChildren(req.user, participants.map((p) => p.childId));
    }
  }

  @UseGuards(StaffGuard)
  @Get()
  async list(
    @Req() req: any,
    @Query('date') date?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('classroomId') classroomId?: string,
    @Query('category') category?: string,
    @Query('childId') childId?: string,
  ) {
    if (childId) await this.scope.assertChild(req.user, childId);
    const classroomIds = await this.scope.classroomFilter(req.user, classroomId);
    // La educadora ve sus salas y, si no filtra por una, también las del centro.
    const includeCenterWide = !this.scope.isUnrestricted(req.user) && !classroomId;
    return this.service.list({ date, from, to, classroomIds, includeCenterWide, category, childId });
  }

  @UseGuards(StaffGuard)
  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    const activity = await this.service.findBasic(id);
    // Lectura: las del centro las ve todo el personal.
    if (activity.classroomId) await this.scope.assertClassroom(req.user, activity.classroomId);
    return this.service.findOne(id);
  }

  @UseGuards(StaffGuard)
  @Post()
  async create(@Req() req: any, @Body() dto: CreateActivityDto) {
    await this.assertActivityRoom(req, dto.classroomId);
    await this.assertParticipants(req, dto.participants);
    return this.service.create(dto, req.user);
  }

  @UseGuards(StaffGuard)
  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateActivityDto) {
    const activity = await this.service.findBasic(id);
    await this.assertActivityRoom(req, activity.classroomId);
    if (dto.classroomId !== undefined) await this.assertActivityRoom(req, dto.classroomId);
    await this.assertParticipants(req, dto.participants);
    return this.service.update(id, dto, req.user);
  }

  @UseGuards(StaffGuard)
  @Post(':id/complete')
  async complete(@Req() req: any, @Param('id') id: string, @Body() dto: CompleteActivityDto) {
    const activity = await this.service.findBasic(id);
    await this.assertActivityRoom(req, activity.classroomId);
    return this.service.complete(id, dto.summary);
  }

  /** Ajusta quién participó y cómo (lo que va al reporte individual). */
  @UseGuards(StaffGuard)
  @Patch(':id/participants')
  async setParticipants(@Req() req: any, @Param('id') id: string, @Body() dto: SetParticipantsDto) {
    const activity = await this.service.findBasic(id);
    await this.assertActivityRoom(req, activity.classroomId);
    await this.assertParticipants(req, dto.participants);
    return this.service.setParticipants(id, dto);
  }

  @UseGuards(CoordinatorGuard)
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const activity = await this.service.findOne(id);
    const res = await this.service.remove(id);
    await this.audit.record(auditCtx(req), {
      entity: 'activity',
      entityId: id,
      action: 'delete',
      summary: `Eliminó la actividad "${activity.title}"`,
      before: { title: activity.title, date: activity.date },
    });
    return res;
  }
}
