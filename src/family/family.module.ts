import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Child } from '../children/child.entity';
import { ChildAttendance } from '../attendance/child-attendance.entity';
import { DailyReport } from '../reports/daily-report.entity';
import { FamilyService } from './family.service';
import { FamilyController } from './family.controller';
import { ChildrenModule } from '../children/children.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { MealsModule } from '../meals/meals.module';
import { DailyLogsModule } from '../daily-logs/daily-logs.module';
import { ActivitiesModule } from '../activities/activities.module';
import { PhotosModule } from '../photos/photos.module';
import { ReportsModule } from '../reports/reports.module';
import { JustificationsModule } from '../justifications/justifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Child, ChildAttendance, DailyReport]),
    ChildrenModule,
    AttendanceModule,
    MealsModule,
    DailyLogsModule,
    ActivitiesModule,
    PhotosModule,
    ReportsModule,
    JustificationsModule,
  ],
  controllers: [FamilyController],
  providers: [FamilyService],
})
export class FamilyModule {}
