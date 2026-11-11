import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappMessage } from './whatsapp-message.entity';
import { WhatsappSettings } from './whatsapp-settings.entity';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { LinkedWhatsappService } from './linked-whatsapp.service';
import { WhatsappNotifierService } from './whatsapp-notifier.service';
import { ChildGuardian } from '../children/child-guardian.entity';
import { Child } from '../children/child.entity';
import { ChildAttendance } from '../attendance/child-attendance.entity';
import { DailyLog } from '../daily-logs/daily-log.entity';
import { Justification } from '../justifications/justification.entity';
import { AppBranding } from '../branding/branding.entity';
import { ConsentsModule } from '../consents/consents.module';
import { AuditModule } from '../audit/audit.module';
import { User } from '../users/user.entity';
import { WhatsappAccessService } from './whatsapp-access.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WhatsappMessage,
      WhatsappSettings,
      // Lectura para los avisos automáticos (sin importar módulos: evita ciclos).
      ChildGuardian,
      Child,
      ChildAttendance,
      DailyLog,
      Justification,
      AppBranding,
      User,
    ]),
    ConsentsModule,
    AuditModule,
  ],
  controllers: [WhatsappController],
  providers: [LinkedWhatsappService, WhatsappService, WhatsappNotifierService, WhatsappAccessService],
  exports: [WhatsappService, LinkedWhatsappService],
})
export class WhatsappModule {}
