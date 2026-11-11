import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Photo } from './photo.entity';
import { PhotoChild } from './photo-child.entity';
import { Child } from '../children/child.entity';
import { Activity } from '../activities/activity.entity';
import { PhotosService } from './photos.service';
import { PhotosController } from './photos.controller';
import { UploadsModule } from '../uploads/uploads.module';
import { ConsentsModule } from '../consents/consents.module';

@Module({
  imports: [TypeOrmModule.forFeature([Photo, PhotoChild, Child, Activity]), UploadsModule, ConsentsModule],
  controllers: [PhotosController],
  providers: [PhotosService],
  exports: [PhotosService],
})
export class PhotosModule {}
