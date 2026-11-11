import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Child } from './child.entity';
import { ChildGuardian } from './child-guardian.entity';
import { Classroom } from '../classrooms/classroom.entity';
import { User } from '../users/user.entity';
import { ChildrenService } from './children.service';
import { ChildrenController } from './children.controller';
import { UsersModule } from '../users/users.module';
import { UploadsModule } from '../uploads/uploads.module';
import { AuditModule } from '../audit/audit.module';
import { ConsentsModule } from '../consents/consents.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Child, ChildGuardian, Classroom, User]),
    UsersModule,
    UploadsModule,
    AuditModule,
    ConsentsModule,
  ],
  controllers: [ChildrenController],
  providers: [ChildrenService],
  exports: [ChildrenService, TypeOrmModule],
})
export class ChildrenModule {}
