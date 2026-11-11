import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DailyReport } from './daily-report.entity';
import { Child } from '../children/child.entity';
import { Justification } from '../justifications/justification.entity';
import { ChildAttendance } from '../attendance/child-attendance.entity';
import { Meal } from '../meals/meal.entity';
import { DailyLog } from '../daily-logs/daily-log.entity';
import { Activity } from '../activities/activity.entity';
import { ActivityParticipant } from '../activities/activity-participant.entity';
import { Photo } from '../photos/photo.entity';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { ChildrenModule } from '../children/children.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { MealsModule } from '../meals/meals.module';
import { DailyLogsModule } from '../daily-logs/daily-logs.module';
import { ActivitiesModule } from '../activities/activities.module';
import { PhotosModule } from '../photos/photos.module';
import { WorkScheduleModule } from '../schedule/work-schedule.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DailyReport,
      Child,
      Justification,
      ChildAttendance,
      Meal,
      DailyLog,
      Activity,
      ActivityParticipant,
      Photo,
    ]),
    ChildrenModule,
    AttendanceModule,
    MealsModule,
    DailyLogsModule,
    ActivitiesModule,
    PhotosModule,
    WorkScheduleModule,
    WhatsappModule,
    AuditModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
