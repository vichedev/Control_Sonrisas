import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Classroom } from '../../classrooms/classroom.entity';
import { Child } from '../../children/child.entity';
import { ScopeService } from './scope.service';

/** Global: cualquier módulo puede inyectar `ScopeService` sin importarlo. */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Classroom, Child])],
  providers: [ScopeService],
  exports: [ScopeService],
})
export class ScopeModule {}
