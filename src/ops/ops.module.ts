import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { AuditModule } from '../audit/audit.module';
import { HealthController } from './health.controller';
import { ReauthService } from './reauth.service';
import { BackupsService } from './backups/backups.service';
import { BackupsController } from './backups/backups.controller';
import { UpdaterService } from './system/updater.service';
import { SystemController } from './system/system.controller';

/** Operaciones: salud, respaldos, actualizaciones y vuelta atrás. */
@Module({
  imports: [TypeOrmModule.forFeature([User]), AuditModule],
  controllers: [HealthController, BackupsController, SystemController],
  providers: [ReauthService, BackupsService, UpdaterService],
})
export class OpsModule {}
