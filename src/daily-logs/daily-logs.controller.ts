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
import { CoordinatorGuard, StaffGuard } from '../auth/roles.guard';
import { DailyLogsService } from './daily-logs.service';
import {
  BulkDailyLogDto,
  CreateDailyLogDto,
  UpdateDailyLogDto,
} from './dto/daily-log.dto';
import { ScopeService } from '../common/scope/scope.service';

@Controller('daily-logs')
export class DailyLogsController {
  constructor(
    private readonly service: DailyLogsService,
    private readonly scope: ScopeService,
  ) {}

  /** Carga la anotación y comprueba que el niño sea de una sala a cargo. */
  private async assertLog(req: any, id: string) {
    const log = await this.service.findOne(id);
    await this.scope.assertChild(req.user, log.childId);
  }

  @UseGuards(StaffGuard)
  @Get()
  async list(
    @Req() req: any,
    @Query('date') date?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('childId') childId?: string,
    @Query('classroomId') classroomId?: string,
    @Query('kind') kind?: string,
    @Query('pendingNotice') pendingNotice?: string,
  ) {
    if (childId) await this.scope.assertChild(req.user, childId);
    const classroomIds = await this.scope.classroomFilter(req.user, classroomId);
    return this.service.list({
      date,
      from,
      to,
      childId,
      classroomIds,
      kind,
      pendingNotice: pendingNotice === 'true',
    });
  }

  @UseGuards(StaffGuard)
  @Post()
  async create(@Req() req: any, @Body() dto: CreateDailyLogDto) {
    await this.scope.assertChild(req.user, dto.childId);
    return this.service.create(dto, req.user);
  }

  /** Misma anotación para varios niños (siesta de la sala, salida al patio…). */
  @UseGuards(StaffGuard)
  @Post('bulk')
  async createBulk(@Req() req: any, @Body() dto: BulkDailyLogDto) {
    await this.scope.assertChildren(req.user, dto.childIds);
    return this.service.createBulk(dto, req.user);
  }

  @UseGuards(StaffGuard)
  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateDailyLogDto) {
    await this.assertLog(req, id);
    return this.service.update(id, dto, req.user);
  }

  @UseGuards(StaffGuard)
  @Post(':id/notified')
  async markNotified(@Req() req: any, @Param('id') id: string) {
    await this.assertLog(req, id);
    return this.service.markNotified(id);
  }

  @UseGuards(CoordinatorGuard)
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    await this.assertLog(req, id);
    return this.service.remove(id);
  }
}
