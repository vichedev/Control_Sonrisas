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
import { AdminGuard, CoordinatorGuard, StaffGuard } from '../auth/roles.guard';
import { AttendanceService } from './attendance.service';
import {
  CheckInDto,
  CheckOutDto,
  ManualStaffMarkDto,
  StaffMarkDto,
  UpdateAttendanceDto,
} from './dto/attendance.dto';
import { AuditService, auditCtx } from '../audit/audit.service';
import { ScopeService } from '../common/scope/scope.service';

@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly service: AttendanceService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  // ---------------------------------------------------------------- niños

  /** Tablero del día: todos los niños con su estado. */
  @UseGuards(StaffGuard)
  @Get('board')
  async board(
    @Req() req: any,
    @Query('date') date?: string,
    @Query('classroomId') classroomId?: string,
  ) {
    // La educadora sólo ve sus salas.
    const classroomIds = await this.scope.classroomFilter(req.user, classroomId);
    return this.service.board({ date, classroomIds });
  }

  @UseGuards(StaffGuard)
  @Get('flagged')
  async flagged(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    const classroomIds = await this.scope.classroomFilter(req.user);
    return this.service.flagged({ from, to, classroomIds });
  }

  @UseGuards(StaffGuard)
  @Get('children/:childId')
  async history(
    @Req() req: any,
    @Param('childId') childId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    await this.scope.assertChild(req.user, childId);
    return this.service.history(childId, { from, to });
  }

  @UseGuards(StaffGuard)
  @Post('children/:childId/in')
  async checkIn(@Req() req: any, @Param('childId') childId: string, @Body() dto: CheckInDto) {
    await this.scope.assertChild(req.user, childId);
    return this.service.checkIn(childId, dto, req.user);
  }

  @UseGuards(StaffGuard)
  @Post('children/:childId/out')
  async checkOut(@Req() req: any, @Param('childId') childId: string, @Body() dto: CheckOutDto) {
    await this.scope.assertChild(req.user, childId);
    const rec = await this.service.checkOut(childId, dto, req.user);
    // Un retiro fuera de la lista de autorizados se audita siempre: es el evento del
    // que hay que poder dar cuenta si algo sale mal.
    if (rec.flagged) {
      await this.audit.record(auditCtx(req), {
        entity: 'child_attendance',
        entityId: rec.id,
        action: 'update',
        summary: `Retiro no autorizado registrado: ${rec.flagReason}`,
        after: { childId, personName: rec.personName, personDocument: rec.personDocument },
      });
    }
    return rec;
  }

  @UseGuards(CoordinatorGuard)
  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateAttendanceDto) {
    const before = await this.service.findOne(id);
    await this.scope.assertChild(req.user, before.childId);
    const after = await this.service.update(id, dto);
    await this.audit.record(auditCtx(req), {
      entity: 'child_attendance',
      entityId: id,
      action: 'update',
      summary: `Corrigió un registro de ${before.type === 'in' ? 'llegada' : 'retiro'}`,
      before: { at: before.createdAt, notes: before.notes, flagged: before.flagged },
      after: { at: after.createdAt, notes: after.notes, flagged: after.flagged },
    });
    return after;
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const before = await this.service.findOne(id);
    await this.scope.assertChild(req.user, before.childId);
    const res = await this.service.remove(id);
    await this.audit.record(auditCtx(req), {
      entity: 'child_attendance',
      entityId: id,
      action: 'delete',
      summary: `Eliminó un registro de ${before.type === 'in' ? 'llegada' : 'retiro'}`,
      before: { childId: before.childId, at: before.createdAt },
    });
    return res;
  }

  // ------------------------------------------------------------- personal

  /** Marcaje del propio usuario (educadora, coordinación, dirección). */
  @UseGuards(StaffGuard)
  @Post('staff/mark')
  markStaff(@Req() req: any, @Body() dto: StaffMarkDto) {
    return this.service.markStaff(req.user.id, req.user.name, dto);
  }

  @UseGuards(StaffGuard)
  @Get('staff/me')
  staffToday(@Req() req: any) {
    return this.service.staffToday(req.user.id);
  }

  @UseGuards(StaffGuard)
  @Get('staff/me/history')
  staffHistory(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.staffList({ userId: req.user.id, from, to });
  }

  @UseGuards(CoordinatorGuard)
  @Get('staff')
  staffList(
    @Query('date') date?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
  ) {
    return this.service.staffList({ date, from, to, userId });
  }

  @UseGuards(AdminGuard)
  @Post('staff/manual')
  async createManualStaffMark(@Req() req: any, @Body() dto: ManualStaffMarkDto) {
    const rec = await this.service.createManualStaffMark(dto);
    await this.audit.record(auditCtx(req), {
      entity: 'staff_attendance',
      entityId: rec.id,
      action: 'create',
      summary: 'Creó un marcaje manual del personal',
      after: { userId: dto.userId, type: rec.type, at: rec.createdAt },
    });
    return rec;
  }

  @UseGuards(AdminGuard)
  @Delete('staff/:id')
  async removeStaffMark(@Req() req: any, @Param('id') id: string) {
    const res = await this.service.removeStaffMark(id);
    await this.audit.record(auditCtx(req), {
      entity: 'staff_attendance',
      entityId: id,
      action: 'delete',
      summary: 'Eliminó un marcaje del personal',
    });
    return res;
  }
}
