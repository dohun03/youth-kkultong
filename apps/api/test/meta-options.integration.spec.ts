import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { EligibilityCodesResponse } from '@youth-kkultong/shared';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import * as database from '../src/database/data-source';
import { CreatePolicies1792162800000 } from '../src/database/migrations/1792162800000-create-policies';
import official from './fixtures/eligibility-codes.official.json';
import { createApplication } from '../src/main';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { PolicyRepository } from '../src/modules/policies/repositories/policy.repository';

describe('분야·자격 코드 메타 API의 실제 PostgreSQL·HTTP 검증', () => {
  const schema = `step31_test_${randomUUID().replaceAll('-', '')}`;
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
      schema, migrations: [CreatePolicies1792162800000],
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
    // 초기화 대상은 이 테스트가 만든 스키마의 정책 테이블뿐
    await dataSource.query(`DELETE FROM "${schema}".policies`);
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

  /** 기존 실제 정책과 분리된 테이블에 분야 확인용 최소 정책을 저장 */
  async function seed(category: string | null): Promise<Policy> {
    return dataSource.getRepository(Policy).save({
      source: 'youthcenter', externalId: randomUUID(), title: '분야 검증 정책',
      category, rawJson: {}, contentHash: 'a'.repeat(64),
    });
  }

  it('정책이 없는 DB는 분야를 빈 배열로 반환한다', async () => {
    await request(app.getHttpServer()).get('/api/v1/meta/categories')
      .expect(200).expect('Content-Type', /json/).expect([]);
  });

  it('분야의 중복·빈 값은 제외하고 묶음 분야명과 문장 부호는 그대로 반환한다', async () => {
    const expected = ['금융･복지･문화', '금융·복지·문화', '참여･기반', '일자리', '주거'];
    for (const category of [...expected, '주거', '일자리,일자리', '일자리,주거', null, '', ' \t\n']) await seed(category);
    const response = await request(app.getHttpServer()).get('/api/v1/meta/categories').expect(200);
    expect(response.body).toHaveLength(expected.length);
    expect(new Set(response.body)).toEqual(new Set(expected));
    expect(response.body).toEqual([...expected].sort((a, b) => a.localeCompare(b, 'ko')));
    expect((await dataSource.getRepository(Policy).findOneByOrFail({ category: '일자리,일자리' })).category).toBe('일자리,일자리');
  });

  it('정책 DB에서 변경한 분야가 다음 요청에 바로 반영된다', async () => {
    const row = await seed('기존 분야');
    await request(app.getHttpServer()).get('/api/v1/meta/categories').expect(200).expect(['기존 분야']);
    await dataSource.getRepository(Policy).update(row.id, { category: '새 분야' });
    await request(app.getHttpServer()).get('/api/v1/meta/categories').expect(200).expect(['새 분야']);
  });

  it('자격 코드 API는 DB 조회 없이 공식 코드·명칭 전체를 공용 계약으로 반환한다', async () => {
    const queryRunner = jest.spyOn(dataSource, 'createQueryRunner');
    const response = await request(app.getHttpServer()).get('/api/v1/meta/eligibility-codes')
      .expect(200).expect('Content-Type', /json/);
    const expected: EligibilityCodesResponse = { jobCodes: official.jobCd, schoolCodes: official.schoolCd };
    expect(response.body).toEqual(expected);
    expect(queryRunner).not.toHaveBeenCalled();
    expect(response.body.jobCodes).toContainEqual({ code: '0013010', label: '제한없음' });
    expect(response.body.schoolCodes).toContainEqual({ code: '0049010', label: '제한없음' });
  });

  it.each([
    '/meta/categories', '/api/meta/categories', '/meta/eligibility-codes', '/api/meta/eligibility-codes',
  ])('공통 접두사가 빠진 %s는 404다', async (path) => {
    await request(app.getHttpServer()).get(path).expect(404);
  });

  it.each(['categories', 'eligibility-codes'])('POST /meta/%s는 제공하지 않는다', async (path) => {
    await request(app.getHttpServer()).post(`/api/v1/meta/${path}`).expect(404);
  });

  it('분야 조회 내부 오류는 원문 노출 없이 공통 500을 반환한다', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(app.get(PolicyRepository), 'findCategories').mockRejectedValueOnce(new Error('private-db-error'));
    await request(app.getHttpServer()).get('/api/v1/meta/categories').expect(500)
      .expect({ code: 'INTERNAL_SERVER_ERROR', message: '서버 내부 오류가 발생했습니다.' });
  });

  it('실제 DB 연결 종료 시 분야는 503이고 정적 자격 코드표는 계속 200이다', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    // 이번 테스트가 만든 DB 연결만 종료. 개발 DB 서버·데이터는 유지
    await dataSource.destroy();
    await request(app.getHttpServer()).get('/api/v1/meta/categories').expect(503)
      .expect({ code: 'SERVICE_UNAVAILABLE', message: 'DB에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.' });
    await request(app.getHttpServer()).get('/api/v1/meta/eligibility-codes').expect(200)
      .expect({ jobCodes: official.jobCd, schoolCodes: official.schoolCd });
  });
});
