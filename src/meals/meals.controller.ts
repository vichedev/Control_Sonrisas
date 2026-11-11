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
import { MealsService } from './meals.service';
import { BulkMealDto, CreateMealDto, UpdateMealDto } from './dto/meal.dto';
import { ScopeService } from '../common/scope/scope.service';

@Controller('meals')
export class MealsController {
  constructor(
    private readonly service: MealsService,
    private readonly scope: ScopeService,
  ) {}

  @UseGuards(StaffGuard)
  @Get()
  async list(
    @Req() req: any,
    @Query('date') date?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('childId') childId?: string,
    @Query('classroomId') classroomId?: string,
    @Query('type') type?: string,
  ) {
    if (childId) await this.scope.assertChild(req.user, childId);
    const classroomIds = await this.scope.classroomFilter(req.user, classroomId);
    return this.service.list({ date, from, to, childId, classroomIds, type });
  }

  @UseGuards(StaffGuard)
  @Get('summary')
  async summary(
    @Req() req: any,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('childId') childId?: string,
    @Query('classroomId') classroomId?: string,
  ) {
    if (childId) await this.scope.assertChild(req.user, childId);
    const classroomIds = await this.scope.classroomFilter(req.user, classroomId);
    return this.service.intakeSummary({ from, to, childId, classroomIds });
  }

  @UseGuards(StaffGuard)
  @Post()
  async create(@Req() req: any, @Body() dto: CreateMealDto) {
    await this.scope.assertChild(req.user, dto.childId);
    return this.service.create(dto, req.user);
  }

  /** Registro de una comida para toda la sala de una vez. */
  @UseGuards(StaffGuard)
  @Post('bulk')
  async createBulk(@Req() req: any, @Body() dto: BulkMealDto) {
    if (dto.classroomId) await this.scope.assertClassroom(req.user, dto.classroomId);
    await this.scope.assertChildren(req.user, dto.entries.map((e) => e.childId));
    return this.service.createBulk(dto, req.user);
  }

  @UseGuards(StaffGuard)
  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateMealDto) {
    const meal = await this.service.findOne(id);
    await this.scope.assertChild(req.user, meal.childId);
    return this.service.update(id, dto, req.user);
  }

  @UseGuards(CoordinatorGuard)
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const meal = await this.service.findOne(id);
    await this.scope.assertChild(req.user, meal.childId);
    return this.service.remove(id);
  }
}
