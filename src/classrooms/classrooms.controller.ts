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
import { AdminGuard, StaffGuard } from '../auth/roles.guard';
import { ClassroomsService } from './classrooms.service';
import { CreateClassroomDto, UpdateClassroomDto } from './dto/classroom.dto';
import { AuditService, auditCtx } from '../audit/audit.service';
import { ScopeService } from '../common/scope/scope.service';

@Controller('classrooms')
export class ClassroomsController {
  constructor(
    private readonly service: ClassroomsService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  @UseGuards(StaffGuard)
  @Get()
  async list(@Req() req: any, @Query('includeInactive') includeInactive?: string) {
    // Educadora: sólo sus salas (el selector de sala del panel depende de esto).
    const allowed = await this.scope.allowedClassroomIds(req.user);
    return this.service.findAll(includeInactive !== 'false', allowed ?? undefined);
  }

  @UseGuards(StaffGuard)
  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    await this.scope.assertClassroom(req.user, id);
    return this.service.findOne(id);
  }

  @UseGuards(AdminGuard)
  @Post()
  async create(@Req() req: any, @Body() dto: CreateClassroomDto) {
    const room = await this.service.create(dto);
    await this.audit.record(auditCtx(req), {
      entity: 'classroom',
      entityId: room.id,
      action: 'create',
      summary: `Creó la sala "${room.name}"`,
      after: { name: room.name, level: room.level },
    });
    return room;
  }

  @UseGuards(AdminGuard)
  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateClassroomDto) {
    const before = await this.service.findOne(id);
    const room = await this.service.update(id, dto);
    await this.audit.record(auditCtx(req), {
      entity: 'classroom',
      entityId: id,
      action: 'update',
      summary: `Editó la sala "${room.name}"`,
      before: { name: before.name, teacherId: before.teacherId, active: before.active },
      after: { name: room.name, teacherId: room.teacherId, active: room.active },
    });
    return room;
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const room = await this.service.findOne(id);
    const res = await this.service.remove(id);
    await this.audit.record(auditCtx(req), {
      entity: 'classroom',
      entityId: id,
      action: 'delete',
      summary: `Eliminó la sala "${room.name}"`,
      before: { name: room.name },
    });
    return res;
  }
}
