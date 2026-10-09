import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { POLICY_CATEGORIES, USER_STATUSES } from '@kkultong/contracts';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { DataSource } from 'typeorm';
import { Mvp0CorePolicy1760000000000 } from '../../src/database/migrations/001-mvp0-core-policy';
import { MetaController } from '../../src/modules/meta/meta.controller';
import { MetaService } from '../../src/modules/meta/meta.service';
import { RegionEntity } from '../../src/modules/meta/entities/region.entity';

const TEST_TIMEOUT_MS = 60_000;
const POSTGRES_PORT = 5432;
const TEST_DATABASE_NAME = 'kkultong_test';
const TEST_DATABASE_USER = 'kkultong';
const TEST_DATABASE_PASSWORD = 'kkultong_test';
const POSTGRES_READY_LOG_COUNT = 2;

jest.setTimeout(TEST_TIMEOUT_MS);

describe('GET /api/v1/meta PostgreSQL 통합', () => {
  let container: StartedTestContainer;
  let dataSource: DataSource;
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    // 공식 이미지의 초기화용 임시 서버와 최종 서버 로그를 모두 기다려 TCP 연결을 보장한다.
    container = await new GenericContainer('postgres:16')
      .withEnvironment({
        POSTGRES_DB: TEST_DATABASE_NAME,
        POSTGRES_USER: TEST_DATABASE_USER,
        POSTGRES_PASSWORD: TEST_DATABASE_PASSWORD,
      })
      .withExposedPorts(POSTGRES_PORT)
      .withWaitStrategy(
        Wait.forLogMessage(/database system is ready to accept connections/, POSTGRES_READY_LOG_COUNT),
      )
      .start();
    dataSource = new DataSource({
      type: 'postgres',
      url: `postgresql://${TEST_DATABASE_USER}:${TEST_DATABASE_PASSWORD}@${container.getHost()}:${container.getMappedPort(POSTGRES_PORT)}/${TEST_DATABASE_NAME}`,
      entities: [RegionEntity],
      migrations: [Mvp0CorePolicy1760000000000],
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    const metaService = new MetaService(dataSource);
    const testingModule = await Test.createTestingModule({
      controllers: [MetaController],
      providers: [{ provide: MetaService, useValue: metaService }],
    }).compile();
    app = testingModule.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');

    const address = app.getHttpServer().address();

    if (address === null || typeof address === 'string') {
      throw new Error('통합 테스트 HTTP 서버 주소를 확인할 수 없습니다.');
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await dataSource.getRepository(RegionEntity).clear();
  });

  afterAll(async () => {
    await app?.close();

    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }

    await container?.stop();
  });

  it('활성 시·도만 행정 코드 순서로 반환한다', async () => {
    await dataSource.getRepository(RegionEntity).save([
      { code: '26', parentCode: null, level: 1, name: '부산광역시', active: true },
      { code: '11', parentCode: null, level: 1, name: '서울특별시', active: true },
      { code: '41', parentCode: null, level: 1, name: '경기도', active: false },
      { code: '11110', parentCode: '11', level: 2, name: '종로구', active: true },
    ]);

    const response = await fetch(`${baseUrl}/api/v1/meta/regions`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { code: '11', name: '서울특별시' },
      { code: '26', name: '부산광역시' },
    ]);
  });

  it('공유 contracts의 카테고리와 사용자 상태 enum을 그대로 반환한다', async () => {
    const [categoriesResponse, statusesResponse] = await Promise.all([
      fetch(`${baseUrl}/api/v1/meta/categories`),
      fetch(`${baseUrl}/api/v1/meta/statuses`),
    ]);

    expect(categoriesResponse.status).toBe(200);
    expect(statusesResponse.status).toBe(200);
    await expect(categoriesResponse.json()).resolves.toEqual(POLICY_CATEGORIES);
    await expect(statusesResponse.json()).resolves.toEqual(USER_STATUSES);
  });
});
