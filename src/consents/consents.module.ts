import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConsentPolicy } from './consent-policy.entity';
import { ChildConsent } from './child-consent.entity';
import { Child } from '../children/child.entity';
import { ChildGuardian } from '../children/child-guardian.entity';
import { AppBranding } from '../branding/branding.entity';
import { AuditModule } from '../audit/audit.module';
import { ConsentsService } from './consents.service';
import { ConsentsController, FamilyConsentsController } from './consents.controller';

/**
 * Consentimientos LOPDP. No importa módulos de dominio (sólo entidades) para que
 * fotos, niños, familia y WhatsApp puedan importarlo sin ciclos.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ConsentPolicy, ChildConsent, Child, ChildGuardian, AppBranding]),
    AuditModule,
  ],
  controllers: [FamilyConsentsController, ConsentsController],
  providers: [ConsentsService],
  exports: [ConsentsService],
})
export class ConsentsModule {}
