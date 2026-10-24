import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { PolicySearchResponse } from '@youth-kkultong/shared';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import * as database from '../src/database/data-source';
import { CreatePolicies1792162800000 } from '../src/database/migrations/1792162800000-create-policies';
import { CreateRegions1792162801000 } from '../src/database/migrations/1792162801000-create-regions';
import snapshot from '../src/database/seeds/regions.json';
import { seedRegions } from '../src/database/seeds/regions.seed';
import { createApplication } from '../src/main';
import * as dates from '../src/modules/policies/application-status';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { PolicyRepository } from '../src/modules/policies/repositories/policy.repository';
import { RegionRepository } from '../src/modules/meta/repositories/region.repository';
import { Region } from '../src/modules/meta/entities/region.entity';
import { IngestionLogService } from '../src/modules/ingestion/services/ingestion-log.service';

/** 실제 앱·PostgreSQL·HTTP로 검색 계약과 사용자 조건 미저장을 검증한다. */
describe('정책 검색 API 통합', () => {
  const schema = `step41_test_${randomUUID().replaceAll('-', '')}`;
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
    dataSource = database.createDataSource(environment).setOptions({ schema,
      migrations: [CreatePolicies1792162800000, CreateRegions1792162801000],
      extra: { options: `-c timezone=${environment.TZ} -c search_path=${schema}` } });
    // 모듈·컨트롤러·서비스는 실제 등록 상태를 사용하고 DB만 임시 스키마로 바꾼다.
    const factory = jest.spyOn(database, 'createDataSource').mockReturnValue(dataSource);
    try {
      app = await createApplication();
    } finally {
      factory.mockRestore();
    }
    await dataSource.runMigrations();
    await seedRegions(dataSource, snapshot.regions);
    await app.listen(0, '127.0.0.1');
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM "${schema}".policies`);
    jest.spyOn(dates, 'getKoreaToday').mockReturnValue('2026-10-21');
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    // 도중에 실패해도 앱·DB 연결·테스트 스키마를 각각 정리한다.
    try { if (app) await app.close(); } finally {
      try { if (dataSource?.isInitialized) await dataSource.destroy(); } finally {
        try { if (schemaCreated && admin?.isInitialized) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
        finally { if (admin?.isInitialized) await admin.destroy(); }
      }
    }
  });

  /** 테스트 스키마에만 기본 검색 정책을 저장한다. */
  async function seed(changes: Partial<Policy> = {}): Promise<Policy> {
    return dataSource.getRepository(Policy).save({ source: 'youthcenter', externalId: randomUUID(), title: '검색 정책',
      category: '주거', description: '정책 소개', benefitText: '지원 내용', viewCount: 10,
      applicationPeriodCode: '0057001', applicationPeriodRaw: '20261001 ~ 20261031',
      applicationStartDate: '2026-10-01', applicationEndDate: '2026-10-31', ageMin: 19, ageMax: 34,
      jobCodes: ['0013003'], schoolCodes: ['0049007'], regionCodes: ['41110'], rawJson: {},
      contentHash: 'a'.repeat(64), ...changes });
  }

  it('빈 DB도 POST 검색에 200과 공용 빈 응답을 반환한다', async () => {
    await request(app.getHttpServer()).post('/api/v1/policies/search').send({}).expect(200)
      .expect({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 }, appliedSort: 'popular' });
  });

  it('실제 DB 후보에 네 조건을 매칭해 3.5점과 카드 계약을 반환한다', async () => {
    const saved = await seed();
    const response = await request(app.getHttpServer()).post('/api/v1/policies/search')
      .send({ conditions: { age: 28, jobCode: '0013003', schoolCode: '0049007', regionCode: '41111' } }).expect(200);
    const body: PolicySearchResponse = response.body;
    expect(body).toEqual({ items: [{ id: saved.id, title: '검색 정책', category: '주거', subcategory: null,
      benefitPreview: '지원 내용', descriptionPreview: '정책 소개', applicationStatus: 'OPEN', applicationPeriodText: '20261001 ~ 20261031',
      applicationEndDate: '2026-10-31', viewCount: 10, score: 3.5,
      tags: ['AGE_MATCH', 'JOB_MATCH', 'SCHOOL_MATCH', 'REGION_RELATED'] }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 }, appliedSort: 'recommended' });
  });

  it('분야·마감·자격 필터를 실제 검색 경로에 적용한다', async () => {
    const kept = await seed({ title: '부합' });
    const closed = await seed({ title: '마감', applicationEndDate: '2026-10-20' });
    await seed({ category: '일자리' });
    await seed({ ageMin: 35, ageMax: 39 });
    const body = { category: '주거', conditions: { age: 28 } };
    const first = await request(app.getHttpServer()).post('/api/v1/policies/search').send(body).expect(200);
    expect(first.body.items.map((row: { id: string }) => row.id)).toEqual([kept.id]);
    const included = await request(app.getHttpServer()).post('/api/v1/policies/search').send({ ...body, includeClosed: true }).expect(200);
    expect(new Set(included.body.items.map((row: { id: string }) => row.id))).toEqual(new Set([kept.id, closed.id]));
  });

  it.each(['extraQualification', 'participationRestriction'] as const)('실제 %s 설명이 있으면 나이 불일치를 보류한다', async (field) => {
    await seed({ ageMin: 35, ageMax: 39, [field]: '추가 확인 조건' });
    const response = await request(app.getHttpServer()).post('/api/v1/policies/search').send({ conditions: { age: 28 } }).expect(200);
    expect(response.body.items[0]).toMatchObject({ score: 0, tags: ['EXTRA_REVIEW', 'AGE_REVIEW'] });
  });

  it('공백뿐인 설명은 제외를 보류하지 않는다', async () => {
    await seed({ ageMin: 35, ageMax: 39, extraQualification: ' \t\n ', participationRestriction: ' ' });
    await request(app.getHttpServer()).post('/api/v1/policies/search').send({ conditions: { age: 28 } }).expect(200)
      .expect({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 }, appliedSort: 'recommended' });
  });

  it('후보 수와 무관하게 지역·정책을 각 한 번 조회하고 날짜도 한 번 정한다', async () => {
    await seed(); await seed({ regionCodes: ['11110'] });
    const regionRead = jest.spyOn(app.get(RegionRepository), 'findActive');
    const policyRead = jest.spyOn(app.get(PolicyRepository), 'findCandidates');
    const queries = jest.spyOn(dataSource.logger, 'logQuery');
    const response = await request(app.getHttpServer()).post('/api/v1/policies/search').send({ conditions: { regionCode: '41111' } }).expect(200);
    expect(response.body.items).toHaveLength(2);
    expect(regionRead).toHaveBeenCalledTimes(1);
    expect(policyRead).toHaveBeenCalledTimes(1);
    expect(queries).toHaveBeenCalledTimes(2);
    expect(dates.getKoreaToday).toHaveBeenCalledTimes(1);
  });

  it('DB에서 폐지 처리한 지역은 다음 요청 검증에서 즉시 거부한다', async () => {
    const table = dataSource.getRepository(Region);
    await table.update('41111', { isActive: false });
    try {
      await request(app.getHttpServer()).post('/api/v1/policies/search').send({ conditions: { regionCode: '41111' } }).expect(400);
    } finally {
      await table.update('41111', { isActive: true });
    }
  });

  it('필터·점수 이후 전역 정렬의 두 번째 페이지를 반환한다', async () => {
    for (let index = 0; index < 45; index++) await seed({ viewCount: index });
    const response = await request(app.getHttpServer()).post('/api/v1/policies/search').send({ page: 2 }).expect(200);
    expect(response.body.items.map((row: { viewCount: number }) => row.viewCount)).toEqual(Array.from({ length: 20 }, (_, index) => 24 - index));
    expect(response.body.pagination).toEqual({ page: 2, limit: 20, total: 45, totalPages: 3 });
  });

  it('조건 없는 맞춤순은 인기순으로 전환하고 초과 페이지도 200이다', async () => {
    await seed();
    await request(app.getHttpServer()).post('/api/v1/policies/search').send({ sort: 'recommended', page: 99 }).expect(200)
      .expect({ items: [], pagination: { page: 99, limit: 20, total: 1, totalPages: 1 }, appliedSort: 'popular' });
  });

  it.each([
    { page: 0 }, { page: '1' }, { limit: 51 }, { limit: 1.5 }, { sort: 'invalid' }, { includeClosed: 'false' },
    { category: null }, { conditions: null }, { conditions: { age: 121 } }, { conditions: { age: null } },
    { conditions: { age: '28' } }, { conditions: { regionCode: '28110' } }, { conditions: { regionCode: '99999' } },
    { conditions: { jobCode: '0049007' } }, { conditions: { schoolCode: '0013003' } },
  ])('잘못된 요청 %j는 공통 400이며 정책 조회를 하지 않는다', async (body) => {
    const policyRead = jest.spyOn(app.get(PolicyRepository), 'findCandidates');
    await request(app.getHttpServer()).post('/api/v1/policies/search').send(body).expect(400)
      .expect({ code: 'BAD_REQUEST', message: '요청값이 올바르지 않습니다.' });
    expect(policyRead).not.toHaveBeenCalled();
  });

  it('JSON 구문 오류도 공통 400으로 응답한다', async () => {
    await request(app.getHttpServer()).post('/api/v1/policies/search').set('Content-Type', 'application/json')
      .send('{"conditions":').expect(400).expect({ code: 'BAD_REQUEST', message: '요청값이 올바르지 않습니다.' });
  });

  it.each(['/policies/search', '/api/policies/search'])('잘못된 접두사 %s는 404다', async (path) => {
    await request(app.getHttpServer()).post(path).send({}).expect(404);
  });

  it('GET의 search 문자열은 상세 UUID가 아니므로 400이다', async () => {
    await request(app.getHttpServer()).get('/api/v1/policies/search').expect(400);
  });

  it('정상·오류 요청의 사용자 조건을 DB나 파일·기본 로그에 기록하지 않는다', async () => {
    await seed();
    const before = await dataSource.query(`SELECT md5(string_agg(to_jsonb(p)::text, '' ORDER BY id)) AS hash FROM "${schema}".policies p`);
    const logFile = resolve(__dirname, '../../../logs/policies-import.jsonl');
    const oldFile = existsSync(logFile) ? readFileSync(logFile, 'utf8') : null;
    const logs = ['log', 'warn', 'error', 'debug', 'verbose'].map((method) =>
      jest.spyOn(Logger.prototype, method as 'log').mockImplementation(() => {}));
    const fileLog = jest.spyOn(app.get(IngestionLogService), 'write');
    const queries = jest.spyOn(dataSource.logger, 'logQuery');
    const privateValue = 'step41-private-condition';
    await request(app.getHttpServer()).post('/api/v1/policies/search').send({ category: privateValue, keyword: privateValue,
      conditions: { age: 28, regionCode: '41111' } }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/policies/search').send({ conditions: { jobCode: privateValue } }).expect(400);
    // 검색 요청 동안 실제 SQL은 조회뿐이며 사용자 조건은 쿼리나 로그에 남지 않는다.
    expect(queries.mock.calls.every(([sql]) => /^SELECT\b/i.test(sql))).toBe(true);
    expect(JSON.stringify(queries.mock.calls.map(([sql, parameters]) => ({ sql, parameters })))).not.toContain(privateValue);
    expect(fileLog).not.toHaveBeenCalled();
    expect(logs.every((log) => log.mock.calls.length === 0)).toBe(true);
    expect(existsSync(logFile) ? readFileSync(logFile, 'utf8') : null).toBe(oldFile);
    const after = await dataSource.query(`SELECT md5(string_agg(to_jsonb(p)::text, '' ORDER BY id)) AS hash FROM "${schema}".policies p`);
    expect(after).toEqual(before);
  });

  it('내부 오류는 사용자 값과 원문 노출 없이 500으로 응답한다', async () => {
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(app.get(PolicyRepository), 'findCandidates').mockRejectedValueOnce(new Error('step41-private-error'));
    await request(app.getHttpServer()).post('/api/v1/policies/search').send({ conditions: { age: 28 } }).expect(500)
      .expect({ code: 'INTERNAL_SERVER_ERROR', message: '서버 내부 오류가 발생했습니다.' });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('step41-private-error');
  });

  it('제목 검색을 전체 후보에 적용한 뒤 정렬·페이지 분리하고 검색어만으로 맞춤순을 켜지 않는다', async () => {
    await seed({ title: '청년 IT 주거 1', viewCount: 30 });
    await seed({ title: '청년 IT 주거 2', viewCount: 20 });
    await seed({ title: '청년 취업', description: '청년 IT 주거', viewCount: 100 });
    const response = await request(app.getHttpServer()).post('/api/v1/policies/search')
      .send({ keyword: '  it 주거  ', limit: 1, page: 2, sort: 'recommended' }).expect(200);
    expect(response.body.items.map((item: { title: string }) => item.title)).toEqual(['청년 IT 주거 2']);
    expect(response.body.pagination).toEqual({ total: 2, totalPages: 2, page: 2, limit: 1 });
    expect(response.body.appliedSort).toBe('popular');
    await request(app.getHttpServer()).post('/api/v1/policies/search').send({ keyword: '가'.repeat(101) }).expect(400);
    await request(app.getHttpServer()).post('/api/v1/policies/search').send({ keyword: null }).expect(400);
  });

  it('T-12~T-15: 재수집 없이 한국 날짜가 바뀌면 검색·상세 상태와 기본 노출이 바뀐다', async () => {
    const saved = await seed({ applicationStartDate: '2026-10-01', applicationEndDate: '2026-10-29',
      applicationPeriodRaw: '20261001 ~ 20261029' });
    const before = await dataSource.getRepository(Policy).findOneByOrFail({ id: saved.id });
    for (const [today, status] of [
      ['2026-09-30', 'UPCOMING'], ['2026-10-21', 'OPEN'], ['2026-10-22', 'CLOSING_SOON'],
      ['2026-10-29', 'CLOSING_SOON'], ['2026-10-30', 'CLOSED'],
    ]) {
      jest.mocked(dates.getKoreaToday).mockReturnValue(today);
      const result = await request(app.getHttpServer()).post('/api/v1/policies/search').send({}).expect(200);
      expect(result.body.items.map((item: { applicationStatus: string }) => item.applicationStatus))
        .toEqual(status === 'CLOSED' ? [] : [status]);
      const included = await request(app.getHttpServer()).post('/api/v1/policies/search').send({ includeClosed: true }).expect(200);
      expect(included.body.items[0].applicationStatus).toBe(status);
      const detail = await request(app.getHttpServer()).get(`/api/v1/policies/${saved.id}`).expect(200);
      expect(detail.body.applicationStatus).toBe(status);
    }
    // 날짜 계산 때문에 원문·저장 시각까지 바뀌지 않았는지 실제 행을 대조한다.
    expect(await dataSource.getRepository(Policy).findOneByOrFail({ id: saved.id })).toEqual(before);
    await dataSource.getRepository(Policy).update(saved.id, { applicationStartDate: '2026-10-29',
      applicationEndDate: '2026-10-01', applicationPeriodRaw: '20261029 ~ 20261001' });
    const unknown = await request(app.getHttpServer()).post('/api/v1/policies/search').send({}).expect(200);
    expect(unknown.body.items[0].applicationStatus).toBe('UNKNOWN');
  });

  it('T-16·T-17·T-22: 명확한 부적합 제외 후 전체 맞춤 정렬의 21~40번째를 반환한다', async () => {
    const saved: Policy[] = [];
    // 저장 순서·조회수 순서와 다른 기대 정렬을 미리 만든다. 제품 정렬 함수를 기대값에 사용하지 않는다.
    for (let index = 0; index < 45; index += 1) {
      saved.push(await seed({ externalId: `rank-${String(index).padStart(2, '0')}`, viewCount: index,
        ageMin: index < 5 ? 35 : 19, ageMax: index < 5 ? 39 : 34,
        applicationEndDate: index % 2 === 0 ? '2026-10-28' : '2026-10-31',
        applicationPeriodRaw: index % 2 === 0 ? '20261001 ~ 20261028' : '20261001 ~ 20261031' }));
    }
    const remaining = saved.filter((policy) => policy.ageMin === 19);
    const expected = [
      ...remaining.filter((policy) => Number(policy.viewCount) % 2 === 0).reverse(),
      ...remaining.filter((policy) => Number(policy.viewCount) % 2 === 1).reverse(),
    ];
    const pages: string[] = [];
    for (const page of [1, 2]) {
      const result = await request(app.getHttpServer()).post('/api/v1/policies/search')
        .send({ conditions: { age: 28 }, page }).expect(200);
      expect(result.body.appliedSort).toBe('recommended');
      expect(result.body.pagination).toEqual({ page, limit: 20, total: 40, totalPages: 2 });
      expect(result.body.items.map((item: { id: string }) => item.id)).toEqual(expected.slice((page - 1) * 20, page * 20).map((policy) => policy.id));
      expect(result.body.items.every((item: { score: number }) => item.score === 1)).toBe(true);
      pages.push(...result.body.items.map((item: { id: string }) => item.id));
    }
    expect(new Set(pages).size).toBe(40);
  });

  it('실제 DB 연결 종료 시 빈 정상 결과 대신 503을 반환한다', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    await dataSource.destroy();
    await request(app.getHttpServer()).post('/api/v1/policies/search').send({}).expect(503)
      .expect({ code: 'SERVICE_UNAVAILABLE', message: 'DB에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.' });
  });


});
