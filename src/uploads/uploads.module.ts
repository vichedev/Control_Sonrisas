import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { MediaAccessService } from './media-access.service';

@Module({
  // MediaAccessService consulta el estado del usuario (activo / tokenVersion).
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UploadsController],
  providers: [UploadsService, MediaAccessService],
  exports: [UploadsService, MediaAccessService],
})
export class UploadsModule {}
