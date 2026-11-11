import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RealtimeStreamService } from './realtime-stream.service';

/**
 * GET /api/realtime/stream — Server-Sent Events.
 * Auth con `Authorization: Bearer` (el cliente usa fetch en streaming, no EventSource:
 * el token nunca va en la URL). El guard JWT aplica activo/tokenVersion/clave temporal.
 */
@Controller('realtime')
export class RealtimeController {
  constructor(private readonly streams: RealtimeStreamService) {}

  @Get('stream')
  // v6: hay que nombrar los throttlers (short/medium/long); `@SkipThrottle()` sólo salta 'default'.
  @SkipThrottle({ short: true, medium: true, long: true })
  @UseGuards(JwtAuthGuard)
  async stream(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.streams.open(req, res);
  }
}
