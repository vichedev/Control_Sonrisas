import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { UsersService } from './users/users.service';
import { Classroom } from './classrooms/classroom.entity';

/**
 * Siembra inicial: la cuenta de dirección y, si no hay ninguna, un juego de salas
 * por defecto. Es idempotente — se puede ejecutar tantas veces como haga falta.
 */
async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const config = app.get(ConfigService);
  const usersService = app.get(UsersService);
  const ds = app.get(DataSource);

  const email = config.get<string>('ADMIN_EMAIL');
  const password = config.get<string>('ADMIN_PASSWORD');
  const name = config.get<string>('ADMIN_NAME') || 'Dirección';

  if (!email || !password) {
    console.error('ADMIN_EMAIL y ADMIN_PASSWORD son requeridos en .env');
    await app.close();
    process.exit(1);
  }

  const existing = await usersService.findByEmail(email);
  if (existing) {
    console.log(`✓ La cuenta de dirección ${email} ya existe.`);
  } else {
    await usersService.create({
      email,
      password,
      name,
      role: 'admin',
      position: 'Dirección',
    });
    console.log(`✓ Cuenta de dirección creada: ${email} / ${password}`);
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
