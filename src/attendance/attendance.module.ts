import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChildAttendance } from './child-attendance.entity';
import { StaffAttendance } from './staff-attendance.entity';
import { Child } from '../children/child.entity';
import { ChildGuardian } from '../children/child-guardian.entity';
import { JustificationsModule } from '../justifications/justifications.module';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { WorkScheduleModule } from '../schedule/work-schedule.module';
import { PhotosModule } from '../photos/photos.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChildAttendance,
      StaffAttendance,
      Child,
      ChildGuardian,
    ]),
    WorkScheduleModule,
    PhotosModule,
    JustificationsModule,
    AuditModule,
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
