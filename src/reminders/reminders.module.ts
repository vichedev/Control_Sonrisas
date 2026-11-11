import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReminderSent } from './reminder-sent.entity';
import { User } from '../users/user.entity';
import { WorkScheduleModule } from '../schedule/work-schedule.module';
import { PushModule } from '../push/push.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { DailyLogsModule } from '../daily-logs/daily-logs.module';
import { ReportsModule } from '../reports/reports.module';
import { RemindersService } from './reminders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReminderSent, User]),
    WorkScheduleModule,
    PushModule,
    AttendanceModule,
    DailyLogsModule,
    ReportsModule,
  ],
  providers: [RemindersService],
})
export class RemindersModule {}
