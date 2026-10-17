import { randomUUID } from 'node:crypto';
import type { MigrationInterface } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import { createDataSource } from '../src/database/data-source';

/** 업무 스키마를 만들지 않고 Migration 이력 저장·재실행을 검증하는 빈 변경이다. */
class EmptyStep61792108800000 implements MigrationInterface {
  async up(): Promise<void> {}
  async down(): Promise<void> {}
}

describe('실제 PostgreSQL 연결과 Migration', () => {
  it('한국 시간대로 연결하고 빈 Migration을 한 번만 적용한 뒤 연결을 반환한다', async () => {
    const dataSource = createDataSource(loadEnvironment()).setOptions({ entities: [], migrations: [] });
    const migrationSource = createDataSource(loadEnvironment()).setOptions({ entities: [] });
    // 매번 새 이름의 검증 전용 스키마를 사용하므로 개발 DB의 테이블·이력을 건드리지 않는다.
    const schema = `step6_test_${randomUUID().replaceAll('-', '')}`;
    let schemaCreated = false;
    try {
      await dataSource.initialize();
      expect(await dataSource.query('SELECT 1 AS connected')).toEqual([{ connected: 1 }]);
      expect(await dataSource.query('SHOW timezone')).toEqual([{ TimeZone: 'Asia/Seoul' }]);
      expect(dataSource.options.synchronize).toBe(false);
      expect(dataSource.options.migrationsRun).toBe(false);
      expect(await dataSource.showMigrations()).toBe(false);

      await dataSource.query(`CREATE SCHEMA "${schema}"`);
      schemaCreated = true;
      migrationSource.setOptions({ schema, migrations: [EmptyStep61792108800000] });
      await migrationSource.initialize();
      expect(await migrationSource.showMigrations()).toBe(true);
      expect((await migrationSource.runMigrations()).map((migration) => migration.name))
        .toEqual(['EmptyStep61792108800000']);
      expect(await migrationSource.showMigrations()).toBe(false);
      expect(await migrationSource.runMigrations()).toEqual([]);
    } finally {
      try {
        if (migrationSource.isInitialized) await migrationSource.destroy();
      } finally {
        try {
          if (schemaCreated && dataSource.isInitialized) {
            await dataSource.query(`DROP SCHEMA "${schema}" CASCADE`);
          }
        } finally {
          if (dataSource.isInitialized) await dataSource.destroy();
        }
      }
    }
    expect(dataSource.isInitialized).toBe(false);
  });
});
