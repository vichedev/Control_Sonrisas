import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { GuardianGuard } from '../auth/roles.guard';
import { FamilyService } from './family.service';
import { CreateJustificationDto } from '../justifications/dto/create-justification.dto';

/**
 * Endpoints del portal familiar. Todos exigen rol `guardian`; el alcance lo decide
 * siempre el usuario autenticado, nunca un parámetro de la petición.
 */
@UseGuards(GuardianGuard)
@Controller('family')
export class FamilyController {
  constructor(private readonly service: FamilyService) {}

  @Get('children')
  myChildren(@Req() req: any) {
    return this.service.myChildren(req.user.id);
  }

  @Get('today')
  today(@Req() req: any) {
    return this.service.today(req.user.id);
  }

  @Get('gallery')
  gallery(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.gallery(req.user.id, { from, to });
  }

  @Get('children/:childId')
  profile(@Req() req: any, @Param('childId') childId: string) {
    return this.service.childProfile(req.user.id, childId);
  }

  @Get('children/:childId/day')
  day(@Req() req: any, @Param('childId') childId: string, @Query('date') date?: string) {
    return this.service.childDay(req.user.id, childId, date);
  }

  /** Galería por niño, paginada: `?from&to&page&limit&scope=child|room`. */
  @Get('children/:childId/photos')
  photos(
    @Req() req: any,
    @Param('childId') childId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('scope') scope?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.childPhotos(req.user.id, childId, {
      from,
      to,
      scope,
      page: Number(page) || 1,
      limit: Number(limit) || 30,
    });
  }

  @Get('children/:childId/attendance')
  attendance(
    @Req() req: any,
    @Param('childId') childId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.childAttendance(req.user.id, childId, from, to);
  }

  @Get('children/:childId/history')
  history(
    @Req() req: any,
    @Param('childId') childId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.childHistory(req.user.id, childId, from, to);
  }

  @Get('children/:childId/reports')
  reports(@Req() req: any, @Param('childId') childId: string) {
    return this.service.childReports(req.user.id, childId);
  }

  // --- Avisos de ausencia ---

  @Get('justifications')
  listJustifications(@Req() req: any) {
    return this.service.listJustifications(req.user.id);
  }

  @Post('justifications')
  createJustification(@Req() req: any, @Body() dto: CreateJustificationDto) {
    return this.service.createJustification(req.user.id, dto, req.user);
  }
}
