import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/roles.guard';
import { WorkScheduleService } from './work-schedule.service';
import { UpdateScheduleDto } from './dto/update-schedule.dto';

@Controller('schedule')
export class WorkScheduleController {
  constructor(private readonly service: WorkScheduleService) {}

  /** Cualquier usuario autenticado puede consultarlo (el portal familiar muestra el horario). */
  @UseGuards(JwtAuthGuard)
  @Get()
  get() {
    return this.service.get();
  }

  /** Sólo la dirección lo modifica. */
  @UseGuards(AdminGuard)
  @Patch()
  update(@Body() dto: UpdateScheduleDto) {
    return this.service.update(dto);
  }
}
