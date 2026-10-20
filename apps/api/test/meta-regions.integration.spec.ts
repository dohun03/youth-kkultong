import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { RegionOption } from '@youth-kkultong/shared';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import * as database from '../src/database/data-source';
import { CreateRegions1792162801000 } from '../src/database/migrations/1792162801000-create-regions';
import snapshot from '../src/database/seeds/regions.json';
import { seedRegions } from '../src/database/seeds/regions.seed';
import { createApplication } from '../src/main';
import { Region } from '../src/modules/meta/entities/region.entity';
import { RegionRepository } from '../src/modules/meta/repositories/region.repository';

describe('지역 메타 API의 실제 PostgreSQL·HTTP 검증', () => {
  const schema = `step30_test_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource;
  let dataSource: DataSource;
  let app: INestApplication;
  let schemaCreated = false;

  beforeAll(async () => {
    const environment = loadEnvironment();
    admin = database.createDataSource(environment).setOptions({ entities: [], migrations: [] });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    dataSource = database.createDataSource(environment).setOptions({
      schema, migrations: [CreateRegions1792162801000],
      extra: { options: `-c timezone=${environment.TZ} -c search_path=${schema}` },
    });

    // 실제 AppModule·MetaModule을 사용하되 DB 연결 대상만 임시 스키마로 교체
    const factory = jest.spyOn(database, 'createDataSource').mockReturnValue(dataSource);
    try {
      app = await createApplication();
    } finally {
      factory.mockRestore();
    }
    await dataSource.runMigrations();
    await app.listen(0, '127.0.0.1');
  });

  beforeEach(async () => {
    // 초기화 대상은 이 테스트가 만든 스키마의 지역 테이블뿐
    await dataSource.query(`DELETE FROM "${schema}".regions`);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    // 중간 실패가 발생해도 앱·DB 연결·임시 스키마를 각각 정리
    try {
      if (app) await app.close();
    } finally {
      try {
        if (dataSource?.isInitialized) await dataSource.destroy();
      } finally {
        try {
          if (schemaCreated && admin?.isInitialized) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
        } finally {
          if (admin?.isInitialized) await admin.destroy();
        }
      }
    }
  });

  it('지역이 없는 DB는 200과 빈 배열을 반환한다', async () => {
    await request(app.getHttpServer()).get('/api/v1/meta/regions')
      .expect(200).expect('Content-Type', /json/).expect([]);
  });

  it('공식 자료 537개 중 현행 284개만 제공하며 구·상위 시 관계를 보존한다', async () => {
    await seedRegions(dataSource, snapshot.regions);
    const response = await request(app.getHttpServer()).get('/api/v1/meta/regions').expect(200);
    const items: RegionOption[] = response.body;
    const expected = snapshot.regions.filter(({ isActive }) => isActive)
      .map(({ code, name, provinceName, parentCode }) => ({ code, name, provinceName, parentCode }));
    expect(items).toEqual(expected);
    expect(items).toHaveLength(284);
    expect(items).toContainEqual({
      code: '41111', name: '경기도 수원시 장안구', provinceName: '경기도', parentCode: '41110',
    });
    expect(items).toContainEqual({
      code: '41110', name: '경기도 수원시', provinceName: '경기도', parentCode: '41000',
    });
    expect(items.find(({ code }) => code === '11000')?.parentCode).toBeNull();
    expect(items.some(({ code }) => code === '28110')).toBe(false);
    expect(await dataSource.getRepository(Region).countBy({ isActive: false })).toBe(253);
  });

  it('시드가 아닌 현재 DB 값을 단일 조회하며 코드 앞자리와 다른 부모도 그대로 반환한다', async () => {
    const table = dataSource.getRepository(Region);
    await table.save({ code: '11000', name: '부모 이름', provinceName: '그룹', parentCode: null, isActive: true });
    await table.save({ code: '99990', name: '검증 자식', provinceName: '그룹', parentCode: '11000', isActive: true });
    const repository = app.get(RegionRepository);
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    let selected: RegionOption[];
    try {
      // 실제 SQL이 한 번만 실행되는지 확인해 지역별 부모 추가 조회를 예방
      const query = jest.spyOn(runner, 'query');
      selected = await repository.findActive(runner.manager);
      expect(query).toHaveBeenCalledTimes(1);
    } finally {
      await runner.release();
    }
    expect(selected).toEqual([
      { code: '11000', name: '부모 이름', provinceName: '그룹', parentCode: null },
      { code: '99990', name: '검증 자식', provinceName: '그룹', parentCode: '11000' },
    ]);

    await table.update('99990', { name: 'DB에서 변경한 이름' });
    await request(app.getHttpServer()).get('/api/v1/meta/regions').expect(200).expect([
      selected[0], { ...selected[1], name: 'DB에서 변경한 이름' },
    ]);
    await table.update('99990', { isActive: false });
    await request(app.getHttpServer()).get('/api/v1/meta/regions').expect(200).expect([selected[0]]);
  });

  it.each(['/meta/regions', '/api/meta/regions'])('접두사가 다른 %s는 404다', async (path) => {
    await request(app.getHttpServer()).get(path).expect(404);
  });

  it('POST 요청은 제공하지 않는다', async () => {
    await request(app.getHttpServer()).post('/api/v1/meta/regions').expect(404);
  });

  it('조회 내부 오류를 빈 배열로 숨기지 않고 공통 500 응답으로 처리한다', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(app.get(RegionRepository), 'findActive').mockRejectedValueOnce(new Error('private-db-error'));
    await request(app.getHttpServer()).get('/api/v1/meta/regions').expect(500)
      .expect({ code: 'INTERNAL_SERVER_ERROR', message: '서버 내부 오류가 발생했습니다.' });
  });

  it('DB 연결이 닫히면 공통 503으로 응답한다', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    // 임시 스키마 연결만 종료하며 실제 개발 DB 서버는 계속 실행
    await dataSource.destroy();
    await request(app.getHttpServer()).get('/api/v1/meta/regions').expect(503)
      .expect({ code: 'SERVICE_UNAVAILABLE', message: 'DB에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.' });
  });
});
