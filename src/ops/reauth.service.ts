import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { verifySync } from 'otplib';
import { User } from '../users/user.entity';

/**
 * Re-confirmación de identidad para operaciones críticas (restaurar, actualizar, volver
 * atrás, descargar o borrar respaldos): contraseña + código 2FA si la cuenta lo tiene.
 * Responde 400 (no 401) ante datos incorrectos: el frontend trata 401 como sesión caducada.
 */
@Injectable()
export class ReauthService {
  private readonly failures = new Map<string, number[]>();
  private readonly lastStep = new Map<string, number>();

  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  private tooMany(userId: string): boolean {
    const now = Date.now();
    const list = (this.failures.get(userId) || []).filter((t) => now - t < 15 * 60_000);
    this.failures.set(userId, list);
    return list.length >= 5;
  }

  private fail(userId: string, msg: string): never {
    const list = this.failures.get(userId) || [];
    list.push(Date.now());
    this.failures.set(userId, list);
    throw new BadRequestException(msg);
  }

  async verify(userId: string, password?: string, code?: string): Promise<void> {
    if (!userId) throw new BadRequestException('Sesión inválida');
    if (this.tooMany(userId)) {
      throw new HttpException('Demasiados intentos fallidos. Espera 15 minutos.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.password')
      .addSelect('u.totpSecret')
      .where('u.id = :id', { id: userId })
      .getOne();
    if (!user || user.role !== 'admin' || !user.active) throw new BadRequestException('Cuenta no autorizada');
    if (!password || !(await bcrypt.compare(String(password), user.password))) {
      this.fail(userId, 'Contraseña incorrecta');
    }
    if (user.totpEnabled) {
      if (!code) this.fail(userId, 'Ingresa el código de verificación en dos pasos');
      let res: any = null;
      try {
        res = verifySync({
          token: String(code).trim(),
          secret: user.totpSecret,
          digits: 6,
          period: 30,
          epochTolerance: 30,
          afterTimeStep: this.lastStep.get(userId),
        });
      } catch {
        res = null;
      }
      if (!res?.valid) this.fail(userId, 'Código de verificación incorrecto');
      if (typeof res.timeStep === 'number') this.lastStep.set(userId, res.timeStep);
    }
    this.failures.delete(userId);
  }
}
