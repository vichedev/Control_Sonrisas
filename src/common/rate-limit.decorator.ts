import { applyDecorators } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

/**
 * Límite de peticiones para un endpoint concreto.
 *
 * ⚠️ Por qué existe este helper y no usamos `@Throttle({ default: {...} })`:
 * en `@nestjs/throttler` v6 la clave del objeto que recibe `@Throttle` debe
 * coincidir con el NOMBRE de un throttler declarado en `ThrottlerModule.forRoot`.
 * Como en `app.module.ts` los throttlers se llaman `short` / `medium` / `long`,
 * un `{ default: ... }` NO coincide con ninguno y el override se ignora EN
 * SILENCIO — el endpoint se quedaba con los límites globales (200/min), que es
 * inútil contra un ataque de fuerza bruta al login.
 *
 * Aplicando el mismo límite a los tres throttlers nombrados, el efectivo es
 * `limit` peticiones por `ttlMs` (el más restrictivo gana).
 */
export function RateLimit(limit: number, ttlMs = 60_000) {
  return applyDecorators(
    Throttle({
      short: { ttl: ttlMs, limit },
      medium: { ttl: ttlMs, limit },
      long: { ttl: ttlMs, limit },
    }),
  );
}
