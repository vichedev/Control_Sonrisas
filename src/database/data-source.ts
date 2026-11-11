import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { loadDotEnv } from './env';
import { cliDataSourceOptions } from './db-options';

/**
 * DataSource para el CLI de TypeORM (migration:generate / run / revert / show).
 *   Desarrollo:  npm run migration:generate -- src/database/migrations/NombreCambio
 *   Producción:  node dist/database/migrate-cli.js run   (ver package.json)
 * Respeta las variables de entorno ya definidas (p. ej. DB_NAME temporal del baseline).
 */
loadDotEnv();

const AppDataSource = new DataSource(cliDataSourceOptions());
export default AppDataSource;
