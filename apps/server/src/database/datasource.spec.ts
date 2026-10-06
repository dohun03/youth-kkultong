import type { DataSource } from 'typeorm';

describe('dataSource', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://kkultong:kkultong_local@localhost:5432/youth_kkultong';
    process.env.MAX_HOUSEHOLD_SIZE = '8';
  });

  it('PostgreSQL migration 설정과 synchronize 비활성화를 유지한다', () => {
    let dataSource: DataSource;

    jest.isolateModules(() => {
      ({ dataSource } = require('./datasource') as { dataSource: DataSource });
    });

    expect(dataSource!.options).toMatchObject({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      synchronize: false,
    });
    expect(dataSource!.options.entities).toHaveLength(1);
    expect(dataSource!.options.migrations).toHaveLength(1);
  });
});
