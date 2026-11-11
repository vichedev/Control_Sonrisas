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
import { TasksService } from './tasks.service';
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';

@Controller('tasks')
export class TasksController {
  constructor(private readonly service: TasksService) {}

  @UseGuards(StaffGuard)
  @Get()
  list(@Query('assigneeId') assigneeId?: string, @Query('status') status?: string) {
    return this.service.list({ assigneeId, status });
  }

  /** Mis pendientes abiertos. */
  @UseGuards(StaffGuard)
  @Get('mine')
  mine(@Req() req: any) {
    return this.service.findMine(req.user.id);
  }

  @UseGuards(StaffGuard)
  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @UseGuards(CoordinatorGuard)
  @Post()
  create(@Req() req: any, @Body() dto: CreateTaskDto) {
    return this.service.create(dto, req.user);
  }

  @UseGuards(StaffGuard)
  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.service.update(id, dto, req.user);
  }

  @UseGuards(CoordinatorGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
