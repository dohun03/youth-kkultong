import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { ReviewStatus } from '@youth-kkultong/shared';
import type { DataSource } from 'typeorm';
import request from 'supertest';
import { loadEnvironment } from '../src/common/environment';
import * as database from '../src/database/data-source';
import { createApplication } from '../src/main';
import { AdminCookieService } from '../src/modules/admin/services/admin-cookie.service';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { PolicyReview } from '../src/modules/policies/entities/policy-review.entity';
import { SourcePolicy } from '../src/modules/policies/entities/source-policy.entity';
import { SourcePolicyRepository } from '../src/modules/policies/repositories/source-policy.repository';
import { PolicyRepository } from '../src/modules/policies/repositories/policy.repository';
import { createYouthCenterPolicyContentHash } from '../src/modules/ingestion/youth-center/youth-center-policy.hash';
import { transformYouthCenterPolicy } from '../src/modules/ingestion/youth-center/youth-center-policy.transform';
import { testAdminValues } from './helpers/admin';
import { clearPolicyTables, createCollectionWriter, seedMigratedPolicies } from './helpers/policy-collection';

const collectedAt = new Date('2026-11-02T19:00:00.123Z');

/** 테스트용 정책 원문 준비 */
function raw(externalId: string, title: string) {
  return { plcyNo: externalId, plcyNm: title, inqCnt: '10' };
}

/** 실제 관리자 HTTP와 임시 PostgreSQL 스키마에서 누락 목록의 조회 계약 검증 */
describe('관리자 누락 정책 목록 API', () => {
  const schema = `mvp2_step23_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource;
  let connection: DataSource;
  let app: INestApplication;
  let cookie: string;
  let schemaCreated = false;
  let requestTime = Date.now();

  beforeAll(async () => {
    const environment = loadEnvironment();
    admin = database.createDataSource(environment).setOptions({ entities: [], migrations: [] });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    connection = database.createDataSource(environment).setOptions({ schema,
      extra: { options: `-c timezone=Asia/Seoul -c search_path=${schema}` } });
    const factory = jest.spyOn(database, 'createDataSource').mockReturnValue(connection);
    try { app = await createApplication(testAdminValues); } finally { factory.mockRestore(); }
    await connection.runMigrations();
    await app.listen(0, '127.0.0.1');
  });

  beforeEach(async () => {
    await clearPolicyTables(connection);
    // 각 테스트의 호출 제한 시간을 분리하고 발급한 쿠키도 같은 시각 기준으로 준비
    requestTime += 60001;
    jest.spyOn(Date, 'now').mockReturnValue(requestTime);
    cookie = app.get(AdminCookieService).issue().cookie.split(';')[0];
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    try { if (app) await app.close(); } finally {
      try { if (connection?.isInitialized) await connection.destroy(); } finally {
        try { if (schemaCreated && admin?.isInitialized) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
        finally { if (admin?.isInitialized) await admin.destroy(); }
      }
    }
  });

  /** 원본의 누락 상태와 선택적인 공개본 및 검수 이력을 테스트 스키마에 준비 */
  async function seed(options: {
    title?: string; missingCount?: number; published?: boolean; reviewStatus?: ReviewStatus; lastCollectedAt?: Date | null;
  } = {}) {
    const value = raw(randomUUID(), options.title ?? '최신 원본 제목');
    const source = await connection.getRepository(SourcePolicy).save({
      source: 'youthcenter', externalId: value.plcyNo, title: value.plcyNm, rawJson: value,
      contentHash: createYouthCenterPolicyContentHash(value), viewCount: 10,
      firstCollectedAt: collectedAt, lastCollectedAt: options.lastCollectedAt === undefined ? collectedAt : options.lastCollectedAt,
      missingCount: options.missingCount ?? 1, lastCollectionResult: 'MISSING',
    });
    let published: Policy | null = null;
    if (options.published) {
      const base = raw(value.plcyNo, '기존 공개 제목');
      await new PolicyRepository().upsertPolicies(connection.manager, [{
        ...transformYouthCenterPolicy(base), contentHash: createYouthCenterPolicyContentHash(base),
      }]);
      published = await connection.getRepository(Policy).findOneByOrFail({ externalId: value.plcyNo });
    }
    let review: PolicyReview | null = null;
    if (options.reviewStatus) {
      const snapshot = raw(value.plcyNo, '과거 검수 제목');
      const status = options.reviewStatus;
      review = await connection.getRepository(PolicyReview).save({
        sourcePolicyId: source.id, kind: published ? 'CHANGED' : 'NEW', status,
        contentHash: createYouthCenterPolicyContentHash(snapshot), rawSnapshot: snapshot,
        basePolicyId: published?.id ?? null, baseContentHash: published?.contentHash ?? null,
        baseRawSnapshot: published ? raw(value.plcyNo, '기존 공개 제목') : null,
        reviewedBy: ['APPROVED', 'REJECTED'].includes(status) ? 'test-reviewer' : null,
        rejectionReason: status === 'REJECTED' ? '테스트 거절' : null,
        supersededReason: status === 'SUPERSEDED' ? 'SOURCE_CHANGED' : null,
        closedAt: status === 'PENDING' ? null : collectedAt,
      });
    }
    return { source, published, review };
  }

  /** 실제 인증 쿠키로 누락 목록 조회 */
  function list(query: Record<string, string | number> = {}) {
    return request(app.getHttpServer()).get('/api/v1/admin/source-policies/missing').query(query).set('Cookie', cookie);
  }

  it('누락 1 이상인 미공개 원본도 최신 제목과 공용 응답 계약으로 반환한다', async () => {
    const { source, review } = await seed({ reviewStatus: 'PENDING' });
    await seed({ missingCount: 0 });
    const response = await list().expect(200);
    expect(response.body).toEqual({ items: [{
      sourcePolicyId: source.id, source: 'youthcenter', externalId: source.externalId, title: source.title,
      policyId: null, contentHash: source.contentHash, lastCollectedAt: collectedAt.toISOString(),
      missingCount: 1, latestPendingReviewId: review!.id,
    }], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it.each([true, false])('공개본 존재 여부 %s에서 공개 UUID와 최신 대기 ID를 각각 반환한다', async (published) => {
    const row = await seed({ published, reviewStatus: 'PENDING' });
    const response = await list().expect(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({ policyId: row.published?.id ?? null, latestPendingReviewId: row.review!.id });
  });

  it.each(['APPROVED', 'REJECTED', 'SUPERSEDED'] as const)('종료 이력 %s는 대기 링크로 제공하지 않는다', async (reviewStatus) => {
    await seed({ reviewStatus });
    expect((await list().expect(200)).body.items[0].latestPendingReviewId).toBeNull();
  });

  it('종료 이력 여러 건과 대기가 있어도 원본은 한 건이고 링크는 현재 대기만 가리킨다', async () => {
    const { source, review } = await seed({ reviewStatus: 'REJECTED' });
    const values = {
      sourcePolicyId: source.id, kind: 'NEW' as const, contentHash: source.contentHash, rawSnapshot: source.rawJson,
      basePolicyId: null, baseContentHash: null, baseRawSnapshot: null,
    };
    await connection.getRepository(PolicyReview).save({ ...values, status: 'SUPERSEDED', supersededReason: 'SOURCE_CHANGED', closedAt: collectedAt });
    const pending = await connection.getRepository(PolicyReview).save({ ...values, status: 'PENDING' });
    expect(pending.id).not.toBe(review!.id);
    const response = await list().expect(200);
    expect(response.body.pagination.total).toBe(1);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].latestPendingReviewId).toBe(pending.id);
  });

  it('대기와 공개본이 없는 누락 원본도 두 링크를 NULL로 반환한다', async () => {
    await seed({ lastCollectedAt: null });
    expect((await list().expect(200)).body.items[0]).toMatchObject({ policyId: null, latestPendingReviewId: null, lastCollectedAt: null });
  });

  it('최소 누락 횟수와 최신 제목 검색은 AND 조건이며 영문 대소문자를 구분하지 않는다', async () => {
    const selected = await seed({ title: '청년 ABC 지원', missingCount: 3 });
    await seed({ title: '청년 ABC 지원', missingCount: 1 });
    await seed({ title: '다른 제목', missingCount: 5 });
    const response = await list({ minMissingCount: 3, keyword: '  abc  ' }).expect(200);
    expect(response.body.items.map(({ sourcePolicyId }: { sourcePolicyId: string }) => sourcePolicyId)).toEqual([selected.source.id]);
    expect(response.body.pagination.total).toBe(1);
    expect((await list({ minMissingCount: 4, keyword: 'abc' }).expect(200)).body.items).toEqual([]);
  });

  it.each(['%', '_', '\\', "' OR 1=1 --"])(
    '검색어 %s는 와일드카드나 SQL로 처리하지 않고 문자 그대로 검색한다', async (keyword) => {
      const row = await seed({ title: `선택 ${keyword} 제목` });
      await seed();
      expect((await list({ keyword }).expect(200)).body.items.map(({ sourcePolicyId }: { sourcePolicyId: string }) => sourcePolicyId))
        .toEqual([row.source.id]);
    },
  );

  it('빈 검색은 제한하지 않고 공개 제목이나 검수 제목 및 외부 ID는 검색하지 않는다', async () => {
    const { source } = await seed({ published: true, reviewStatus: 'PENDING' });
    expect((await list({ keyword: '   ' }).expect(200)).body.pagination.total).toBe(1);
    for (const keyword of ['기존 공개 제목', '과거 검수 제목', source.externalId]) {
      expect((await list({ keyword }).expect(200)).body.items).toEqual([]);
    }
  });

  it('누락 횟수 내림차순과 동률 UUID 오름차순으로 정렬하고 페이지를 나눈다', async () => {
    const low = await seed({ missingCount: 1 });
    const high = await seed({ missingCount: 5 });
    const tied = await seed({ missingCount: 5 });
    const first = await list({ page: 1, limit: 2 }).expect(200);
    const second = await list({ page: 2, limit: 2 }).expect(200);
    expect(first.body.pagination).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect([...first.body.items, ...second.body.items].map(({ sourcePolicyId }: { sourcePolicyId: string }) => sourcePolicyId))
      .toEqual([...[high.source.id, tied.source.id].sort(), low.source.id]);
  });

  it('기본 페이지는 20건이고 최대 50건 및 범위 밖과 빈 결과를 정확히 반환한다', async () => {
    expect((await list().expect(200)).body).toEqual({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    await Promise.all(Array.from({ length: 21 }, () => seed()));
    expect((await list().expect(200)).body.items).toHaveLength(20);
    expect((await list({ limit: 50 }).expect(200)).body.items).toHaveLength(21);
    expect((await list({ page: 3 }).expect(200)).body)
      .toEqual({ items: [], pagination: { page: 3, limit: 20, total: 21, totalPages: 2 } });
    expect((await list({ page: Number.MAX_SAFE_INTEGER, limit: 50 }).expect(200)).body.items).toEqual([]);
  });

  it('DB 정수 상한의 누락 횟수도 필터링한다', async () => {
    const { source } = await seed({ missingCount: 2147483647 });
    await seed({ missingCount: 2147483646 });
    const response = await list({ minMissingCount: 2147483647 }).expect(200);
    expect(response.body.items.map(({ sourcePolicyId }: { sourcePolicyId: string }) => sourcePolicyId)).toEqual([source.id]);
  });

  it.each(['page=0', 'page=-1', 'page=1.5', 'page=', 'page=1&page=2', 'limit=51', 'limit=0',
    'minMissingCount=0', 'minMissingCount=-1', 'minMissingCount=1.5', 'minMissingCount=2147483648',
    'minMissingCount=1&minMissingCount=2', 'keyword=a&keyword=b', 'keyword=' + '가'.repeat(101), 'extra=value'])
  ('잘못된 query %s는 DB 접근 전에 400이다', async (query) => {
    const queries = jest.spyOn(connection.logger, 'logQuery');
    await request(app.getHttpServer()).get(`/api/v1/admin/source-policies/missing?${encodeURI(query)}`)
      .set('Cookie', cookie).expect(400).expect({ code: 'BAD_REQUEST', message: '요청값이 올바르지 않습니다.' });
    expect(queries).not.toHaveBeenCalled();
  });

  it('무인증과 변조 및 만료 쿠키는 query 검사와 데이터 접근보다 먼저 401이다', async () => {
    const queries = jest.spyOn(connection.logger, 'logQuery');
    for (const header of [undefined, 'youth_admin_auth=tampered', cookie]) {
      if (header === cookie) jest.mocked(Date.now).mockReturnValue(requestTime + 28800000);
      const pending = request(app.getHttpServer()).get('/api/v1/admin/source-policies/missing?minMissingCount=bad');
      if (header) pending.set('Cookie', header);
      const response = await pending.expect(401).expect({ code: 'ADMIN_UNAUTHORIZED', message: '관리자 인증이 필요합니다.' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(queries).not.toHaveBeenCalled();
    // 다음 테스트도 호출 제한 창을 넘기도록 테스트 시각을 함께 이동
    requestTime += 28800000;
  });

  it('실제 이관 후 미수집 원본과 미공개 신규가 누락에 포함되고 재등장하면 해제된다 (T2-42)', async () => {
    const writer = createCollectionWriter(loadEnvironment());
    await seedMigratedPolicies(connection, [raw('migrated', '이관 원본')]);
    const value = raw('new', '미공개 신규');
    const runner = connection.createQueryRunner();
    try {
      // 이관 원본은 수집되지 않아 누락되고 신규는 실제 수집 시각을 기록
      await writer.saveCollection(runner, 'youthcenter', [{ ...transformYouthCenterPolicy(value),
        contentHash: createYouthCenterPolicyContentHash(value) }], collectedAt);
      let response = await list().expect(200);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0]).toMatchObject({ externalId: 'migrated', lastCollectedAt: null, missingCount: 1 });
      expect(response.body.items[0].policyId).toBeTruthy();
      // 같은 날 정상 수집에서 모두 빠지면 각각 누락 횟수가 증가
      await writer.saveCollection(runner, 'youthcenter', [], collectedAt);
      response = await list().expect(200);
      expect(response.body.items).toHaveLength(2);
      expect(response.body.items[0]).toMatchObject({ externalId: 'migrated', missingCount: 2, lastCollectedAt: null });
      expect(response.body.items[1]).toMatchObject({ externalId: 'new', missingCount: 1,
        policyId: null, lastCollectedAt: collectedAt.toISOString() });
      expect(response.body.items[1].latestPendingReviewId).toBeTruthy();
      await writer.saveCollection(runner, 'youthcenter', [{ ...transformYouthCenterPolicy(value),
        contentHash: createYouthCenterPolicyContentHash(value) }], new Date('2026-11-03T19:00:00Z'));
      expect((await list().expect(200)).body.items.map(({ externalId }: { externalId: string }) => externalId)).toEqual(['migrated']);
    } finally { await runner.release(); }
  });

  it('공개본과 대기 링크가 있어도 일반 SELECT 두 번으로 읽고 DB를 변경하지 않는다', async () => {
    await seed({ published: true, reviewStatus: 'PENDING' });
    await seed();
    /** 조회 전후 세 테이블의 전체 행 비교 */
    const state = async () => Promise.all([Policy, SourcePolicy, PolicyReview].map((entity) =>
      connection.getRepository(entity).find({ order: { id: 'ASC' } })));
    const before = await state();
    const queries = jest.spyOn(connection.logger, 'logQuery');
    await list().expect(200);
    expect(queries).toHaveBeenCalledTimes(2);
    expect(queries.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
    expect(queries.mock.calls.every(([sql]) => !/raw_json|raw_snapshot|FOR UPDATE/.test(sql))).toBe(true);
    queries.mockRestore();
    expect(await state()).toEqual(before);
  });

  it('공개 호출 한도를 소진해도 인증된 누락 목록 GET은 별도 한도로 200이다', async () => {
    for (let index = 0; index < 120; index++) await request(app.getHttpServer()).get('/api/v1/policies/invalid').expect(400);
    await request(app.getHttpServer()).get('/api/v1/policies/invalid').expect(429);
    await list().expect(200);
  });

  it('조회 오류는 내부 원문을 응답과 로그에 노출하지 않고 500으로 처리한다', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(app.get(SourcePolicyRepository), 'findMissingPolicies').mockRejectedValueOnce(new Error('private-missing-error'));
    const response = await list().expect(500)
      .expect({ code: 'INTERNAL_SERVER_ERROR', message: '서버 내부 오류가 발생했습니다.' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-missing-error');
    await list().expect(200);
  });

  it('실제 DB 연결 종료는 원문 없는 503으로 처리한다', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    await connection.destroy();
    const response = await list().expect(503)
      .expect({ code: 'SERVICE_UNAVAILABLE', message: 'DB에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.' });
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
