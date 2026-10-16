import 'reflect-metadata';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import type { Environment } from '../config/environment';

/** API와 Migration CLI가 같은 DB 설정을 사용한다. 스키마 변경은 명시적 Migration으로만 한다. */
export function createDataSource(environment: Environment): DataSource {
  return new DataSource({
    type: 'postgres',
    url: environment.DATABASE_URL,
    entities: [join(__dirname, '../**/*.entity{.ts,.js}')],
    migrations: [join(__dirname, 'migrations/*{.ts,.js}')],
    synchronize: false,
    migrationsRun: false,
    migrationsTransactionMode: 'all',
    logging: false,
    connectTimeoutMS: 5000,
    extra: { options: `-c timezone=${environment.TZ}` },
  });
}
