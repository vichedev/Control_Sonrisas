import { Controller, Get, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import type { Response } from 'express';
import { appVersion } from './ops.config';

/**
 * GET /api/health — público y mínimo (sin secretos). Lo usan el healthcheck de Docker y
 * el actualizador para decidir si una versión nueva arrancó bien. 503 si la BD no responde.
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly ds: DataSource) {}

  @Get()
  async health(@Res({ passthrough: true }) res: Response) {
    let db: 'ok' | 'error' = 'error';
    try {
      await Promise.race([
        this.ds.query('SELECT 1'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
      db = 'ok';
    } catch {
      db = 'error';
    }
    res.setHeader('Cache-Control', 'no-store');
    if (db !== 'ok') res.status(503);
    return { status: db === 'ok' ? 'ok' : 'error', version: appVersion().version, db };
  }
}
