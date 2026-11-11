import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkSchedule } from './work-schedule.entity';
import { WorkScheduleService } from './work-schedule.service';
import { WorkScheduleController } from './work-schedule.controller';

@Module({
  imports: [TypeOrmModule.forFeature([WorkSchedule])],
  providers: [WorkScheduleService],
  controllers: [WorkScheduleController],
  exports: [WorkScheduleService],
})
export class WorkScheduleModule {}
