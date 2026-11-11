import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Activity } from './activity.entity';
import { ActivityParticipant } from './activity-participant.entity';
import { Child } from '../children/child.entity';
import { ActivitiesService } from './activities.service';
import { ActivitiesController } from './activities.controller';
import { PhotosModule } from '../photos/photos.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Activity, ActivityParticipant, Child]),
    PhotosModule,
    AuditModule,
  ],
  controllers: [ActivitiesController],
  providers: [ActivitiesService],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
