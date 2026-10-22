import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
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

/** 실제 앱·DB·HTTP로 상세 원문·코드 표시·링크 검증과 예외를 확인한다. */
describe('정책 상세 API 통합', () => {
  const schema = `step42_test_${randomUUID().replaceAll('-', '')}`;
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
    const factory = jest.spyOn(database, 'createDataSource').mockReturnValue(dataSource);
    try { app = await createApplication(); } finally { factory.mockRestore(); }
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
    // 실패 여부와 무관하게 이번 테스트가 만든 자원만 정리한다.
    try { if (app) await app.close(); } finally {
      try { if (dataSource?.isInitialized) await dataSource.destroy(); } finally {
        try { if (schemaCreated && admin?.isInitialized) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
        finally { if (admin?.isInitialized) await admin.destroy(); }
      }
    }
  });

  /** 상세 검증용 정책을 임시 스키마에만 저장한다. */
  async function seed(changes: Partial<Policy> = {}): Promise<Policy> {
    return dataSource.getRepository(Policy).save({ source: 'youthcenter', externalId: '000001', title: '상세 정책',
      category: '주거', subcategory: '주거지원', description: '설명\n 원문 ', benefitText: '지원 내용\n 원문 ', viewCount: 12,
      ageMin: 19, ageMax: 34, jobCodes: ['0013003', '0013009'], schoolCodes: ['0049007'], regionCodes: ['41111', '41110'],
      applicationPeriodCode: '0057001', applicationPeriodRaw: '20261001 ~ 20261031',
      applicationStartDate: '2026-10-01', applicationEndDate: '2026-10-31',
      extraQualification: '추가 자격\n 원문', participationRestriction: '참여 제한\n 원문',
      applyUrl: 'https://example.com/apply?x=1', referenceUrl1: 'http://example.com/reference', referenceUrl2: null,
      rawJson: { privateInternal: '상세에 노출하지 않을 원본 필드' }, contentHash: 'a'.repeat(64), ...changes });
  }

  it('정상 상세는 긴 설명·조건·신청기간·링크를 공용 계약으로 반환한다', async () => {
    const row = await seed();
    await request(app.getHttpServer()).get(`/api/v1/policies/${row.id}`).expect(200).expect({
      id: row.id, title: '상세 정책', category: '주거', subcategory: '주거지원',
      benefitPreview: row.benefitText, descriptionPreview: row.description, applicationStatus: 'OPEN', applicationPeriodText: '20261001 ~ 20261031',
      applicationEndDate: '2026-10-31', viewCount: 12, score: 0, tags: [], source: 'youthcenter', externalId: '000001',
      description: row.description, benefitText: row.benefitText, ageRangeText: '19~34세',
      jobConditionText: '미취업자, 기타', schoolConditionText: '대학 졸업', regionText: '경기도 수원시 장안구, 경기도 수원시',
      extraQualification: row.extraQualification, participationRestriction: row.participationRestriction,
      links: [{ label: '신청', url: row.applyUrl }, { label: '참고', url: row.referenceUrl1 }],
    });
  });

  it.each(['not-a-uuid', '20261014005400213950', '00000000-0000-0000-0000-00000000000z'])('잘못된 UUID %s는 DB 접근 전에 400이다', async (id) => {
    const queries = jest.spyOn(dataSource.logger, 'logQuery');
    await request(app.getHttpServer()).get(`/api/v1/policies/${id}`).expect(400)
      .expect({ code: 'BAD_REQUEST', message: '요청값이 올바르지 않습니다.' });
    expect(queries).not.toHaveBeenCalled();
  });

  it('없는 UUID는 404이며 지역 조회를 하지 않는다', async () => {
    const regions = jest.spyOn(app.get(RegionRepository), 'findByCodes');
    await request(app.getHttpServer()).get(`/api/v1/policies/${randomUUID()}`).expect(404)
      .expect({ code: 'NOT_FOUND', message: '요청한 대상을 찾을 수 없습니다.' });
    expect(regions).not.toHaveBeenCalled();
  });

  it('마감·나이 불일치 정책도 직접 상세 URL로 조회할 수 있고 쿼리 조건으로 점수화하지 않는다', async () => {
    const row = await seed({ ageMin: 35, ageMax: 39, applicationEndDate: '2026-10-20', extraQualification: null, participationRestriction: null });
    const response = await request(app.getHttpServer()).get(`/api/v1/policies/${row.id}?age=28`).expect(200);
    expect(response.body).toMatchObject({ id: row.id, applicationStatus: 'CLOSED', ageRangeText: '35~39세', score: 0, tags: [] });
  });

  it('기간 원문이 모호하면 확인 필요로 표시하고 원문을 보존한다', async () => {
    const row = await seed({ applicationPeriodRaw: '1차·2차 일정 추후 공지', applicationStartDate: null, applicationEndDate: null });
    const response = await request(app.getHttpServer()).get(`/api/v1/policies/${row.id}`).expect(200);
    expect(response.body).toMatchObject({ applicationStatus: 'UNKNOWN', applicationPeriodText: '1차·2차 일정 추후 공지', applicationEndDate: null });
  });

  it('미확인 코드와 폐지 지역의 원래 의미를 보존하고 0~0을 제한 없음으로 바꾸지 않는다', async () => {
    const row = await seed({ ageMin: 0, ageMax: 0, jobCodes: ['0013010', 'unknown'], schoolCodes: ['0049010'],
      regionCodes: ['28110', 'unknown'] });
    const response = await request(app.getHttpServer()).get(`/api/v1/policies/${row.id}`).expect(200);
    expect(response.body).toMatchObject({ ageRangeText: '0~0세', jobConditionText: '제한없음, unknown',
      schoolConditionText: '제한없음', regionText: '인천광역시 중구, unknown' });
  });

  it('누락된 설명·조건은 NULL이며 링크가 없으면 빈 배열이다 (T-23)', async () => {
    const row = await seed({ description: null, benefitText: null, ageMin: null, ageMax: null, jobCodes: null,
      schoolCodes: null, regionCodes: null, extraQualification: null, participationRestriction: null,
      applyUrl: null, referenceUrl1: null, referenceUrl2: null });
    const queries = jest.spyOn(dataSource.logger, 'logQuery');
    const response = await request(app.getHttpServer()).get(`/api/v1/policies/${row.id}`).expect(200);
    expect(response.body).toMatchObject({ description: null, benefitText: null, benefitPreview: '', ageRangeText: null,
      jobConditionText: null, schoolConditionText: null, regionText: null, extraQualification: null, participationRestriction: null, links: [] });
    expect(queries).toHaveBeenCalledTimes(1);
  });

  it.each([null, '', ' ', 'javascript:alert(1)', 'data:text/html,abc', 'ftp://example.com', 'mailto:a@example.com',
    '//example.com', '/apply', 'not-a-url', 'https://', 'https:example.com', 'https://exa mple.com', 'https://example.com/\npath'])(
    '안전하지 않거나 잘못된 링크 %j는 노출하지 않는다', async (url) => {
      const row = await seed({ applyUrl: url, referenceUrl1: null });
      const response = await request(app.getHttpServer()).get(`/api/v1/policies/${row.id}`).expect(200);
      expect(response.body.links).toEqual([]);
    },
  );

  it('혼합 링크는 유효한 HTTP(S)만 원래 순서와 표시명으로 반환한다', async () => {
    const row = await seed({ applyUrl: ' javascript:alert(1) ', referenceUrl1: ' HTTPS://example.com/a?x=1#section ',
      referenceUrl2: 'http://example.com/b' });
    const response = await request(app.getHttpServer()).get(`/api/v1/policies/${row.id}`).expect(200);
    expect(response.body.links).toEqual([{ label: '참고', url: 'HTTPS://example.com/a?x=1#section' }, { label: '참고', url: 'http://example.com/b' }]);
  });

  it('여러 지역도 정책·지역을 각 한 번만 조회하며 SQL은 SELECT뿐이다', async () => {
    const row = await seed({ regionCodes: ['41111', '41110', '28110', 'unknown', '41111'] });
    const queries = jest.spyOn(dataSource.logger, 'logQuery');
    await request(app.getHttpServer()).get(`/api/v1/policies/${row.id}`).expect(200);
    expect(queries).toHaveBeenCalledTimes(2);
    expect(queries.mock.calls.every(([sql]) => /^SELECT\b/i.test(sql))).toBe(true);
  });

  it('목록과 상세의 지원 요약은 이모지도 온전한 200자로 일치한다', async () => {
    const row = await seed({ benefitText: '😀'.repeat(205), description: '🌿'.repeat(205) });
    const detail = await request(app.getHttpServer()).get(`/api/v1/policies/${row.id}`).expect(200);
    const list = await request(app.getHttpServer()).post('/api/v1/policies/search').send({}).expect(200);
    expect(detail.body.benefitPreview).toBe('😀'.repeat(200));
    expect(detail.body.benefitPreview).toBe(list.body.items[0].benefitPreview);
    expect(detail.body.benefitText).toBe('😀'.repeat(205));
    expect(detail.body.descriptionPreview).toBe('🌿'.repeat(200));
    expect(detail.body.descriptionPreview).toBe(list.body.items[0].descriptionPreview);
    expect(detail.body.description).toBe('🌿'.repeat(205));
  });

  it('상태는 요청 시점의 한국 날짜로 다시 계산한다', async () => {
    const row = await seed({ applicationEndDate: '2026-10-21' });
    const first = await request(app.getHttpServer()).get(`/api/v1/policies/${row.id}`).expect(200);
    expect(first.body.applicationStatus).toBe('CLOSING_SOON');
    jest.mocked(dates.getKoreaToday).mockReturnValue('2026-10-22');
    const second = await request(app.getHttpServer()).get(`/api/v1/policies/${row.id}`).expect(200);
    expect(second.body.applicationStatus).toBe('CLOSED');
  });

  it('조회로 정책 내용·조회수·저장 시각을 변경하지 않는다', async () => {
    const row = await seed();
    const before = await dataSource.getRepository(Policy).findOneByOrFail({ id: row.id });
    await request(app.getHttpServer()).get(`/api/v1/policies/${row.id}`).expect(200);
    expect(await dataSource.getRepository(Policy).findOneByOrFail({ id: row.id })).toEqual(before);
  });

  it('저장소 오류는 원문 노출 없이 500이다', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(app.get(PolicyRepository), 'findById').mockRejectedValueOnce(new Error('private-detail-error'));
    await request(app.getHttpServer()).get(`/api/v1/policies/${randomUUID()}`).expect(500)
      .expect({ code: 'INTERNAL_SERVER_ERROR', message: '서버 내부 오류가 발생했습니다.' });
  });

  it('실제 DB 연결 종료는 503이다', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    await dataSource.destroy();
    await request(app.getHttpServer()).get(`/api/v1/policies/${randomUUID()}`).expect(503)
      .expect({ code: 'SERVICE_UNAVAILABLE', message: 'DB에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.' });
  });
});
