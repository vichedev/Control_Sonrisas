import { Module } from '@nestjs/common';
import { JustificationsModule } from '../justifications/justifications.module';
import { TasksModule } from '../tasks/tasks.module';
import { DailyLogsModule } from '../daily-logs/daily-logs.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { ReportsModule } from '../reports/reports.module';
import { SummaryController } from './summary.controller';

@Module({
  imports: [
    JustificationsModule,
    TasksModule,
    DailyLogsModule,
    AttendanceModule,
    ReportsModule,
  ],
  controllers: [SummaryController],
})
export class SummaryModule {}
