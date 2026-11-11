import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { UsersService } from './users/users.service';
import { Classroom } from './classrooms/classroom.entity';
import { checkPasswordStrength } from './common/password.validator';
import * as fs from 'fs';

/**
 * Siembra inicial: la cuenta de dirección y, si no hay ninguna, un juego de salas
 * por defecto. Es idempotente — se puede ejecutar tantas veces como haga falta.
 *
 * Variables:
 *  - ADMIN_EMAIL, ADMIN_NAME.
 *  - La contraseña llega por la ENTRADA ESTÁNDAR si ADMIN_PASSWORD_STDIN=1 (así la usan
 *    install.sh y `deploy.sh admin`: no queda en disco, ni en el entorno del contenedor,
 *    ni en la lista de procesos) o, si no, por ADMIN_PASSWORD (instalaciones manuales).
 *  - SEED_RESET_PASSWORD=1: si la cuenta ya existe, le pone esa contraseña (recuperación
 *    de acceso). Cierra sus sesiones abiertas; la verificación en dos pasos se conserva.
 * La contraseña nunca se imprime.
 */
function readPassword(config: ConfigService): string {
  if (process.env.ADMIN_PASSWORD_STDIN === '1') {
    try {
      // Primera línea de la entrada estándar (sin el salto de línea final).
      return fs.readFileSync(0, 'utf8').split(/[\r\n]/)[0] || '';
    } catch {
      return '';
    }
  }
  return config.get<string>('ADMIN_PASSWORD') || '';
}

async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const config = app.get(ConfigService);
  const usersService = app.get(UsersService);
  const ds = app.get(DataSource);

  const email = (config.get<string>('ADMIN_EMAIL') || '').trim().toLowerCase();
  const password = readPassword(config);
  const name = config.get<string>('ADMIN_NAME') || 'Dirección';
  const reset = process.env.SEED_RESET_PASSWORD === '1';

  const fail = async (msg: string) => {
    console.error(msg);
    await app.close();
    process.exit(1);
  };

  if (!email) return fail('Falta ADMIN_EMAIL (correo de la cuenta de dirección).');

  const existing = await usersService.findByEmail(email);
  if (existing && !(reset && password)) {
    console.log(`✓ La cuenta de dirección ${email} ya existe.`);
  } else {
    if (!password) {
      return fail(
        'Falta la contraseña de la cuenta de dirección. Usa ./deploy.sh admin (la pide de forma segura).',
      );
    }
    const weak = checkPasswordStrength(password);
    if (weak) return fail(`Contraseña rechazada: ${weak}.`);
    if (existing) {
      await usersService.update(existing.id, { password });
      console.log(`✓ Contraseña de ${email} actualizada (se cerraron sus sesiones abiertas).`);
    } else {
      await usersService.create({
        email,
        password,
        name,
        role: 'admin',
        position: 'Dirección',
      });
      console.log(`✓ Cuenta de dirección creada: ${email}`);
    }
  }

  const classroomsRepo = ds.getRepository(Classroom);
  const roomCount = await classroomsRepo.count();
  if (roomCount === 0) {
    await classroomsRepo.save([
      classroomsRepo.create({ name: 'Lactantes', level: 'lactantes', ageMinMonths: 3, ageMaxMonths: 12, capacity: 8, color: '#f9a8d4' }),
      classroomsRepo.create({ name: 'Maternal', level: 'maternal', ageMinMonths: 12, ageMaxMonths: 24, capacity: 12, color: '#fdba74' }),
      classroomsRepo.create({ name: 'Caminadores', level: 'caminadores', ageMinMonths: 24, ageMaxMonths: 36, capacity: 15, color: '#86efac' }),
      classroomsRepo.create({ name: 'Prekínder', level: 'prekinder', ageMinMonths: 36, ageMaxMonths: 48, capacity: 18, color: '#93c5fd' }),
      classroomsRepo.create({ name: 'Kínder', level: 'kinder', ageMinMonths: 48, ageMaxMonths: 60, capacity: 20, color: '#c4b5fd' }),
    ]);
    console.log('✓ Salas por defecto creadas (Lactantes, Maternal, Caminadores, Prekínder, Kínder).');
  } else {
    console.log(`✓ Ya hay ${roomCount} sala(s) configuradas.`);
  }

  await app.close();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Error en seed:', err);
  process.exit(1);
});
