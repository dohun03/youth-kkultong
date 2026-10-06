import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { join } from 'node:path';
import { validateEnv } from '../common/config/env.schema';

const env = validateEnv(process.env);

export const dataSource = new DataSource({
  type: 'postgres',
  url: env.DATABASE_URL,
  entities: [join(__dirname, '../modules/**/*.entity{.ts,.js}')],
  migrations: [join(__dirname, 'migrations/*{.ts,.js}')],
  synchronize: false,
});
