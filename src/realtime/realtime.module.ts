import { Global, Module } from '@nestjs/common';
import { RealtimeService } from './realtime.service';
import { RealtimeCapture } from './realtime.capture';
import { ChildClassroomCache } from './child-classroom.cache';
import { RealtimeStreamService } from './realtime-stream.service';
import { RealtimeController } from './realtime.controller';

/**
 * Global: `RealtimeService` se puede inyectar en cualquier módulo.
 * - RealtimeCapture: EntitySubscriber de TypeORM → `events$` (tras COMMIT).
 * - RealtimeStreamService + controller: SSE filtrado por rol en /api/realtime/stream.
 */
@Global()
@Module({
  controllers: [RealtimeController],
  providers: [RealtimeService, ChildClassroomCache, RealtimeCapture, RealtimeStreamService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
