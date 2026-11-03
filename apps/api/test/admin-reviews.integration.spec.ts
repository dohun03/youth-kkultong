import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { AdminReviewDetail, ReviewKind, ReviewStatus } from '@youth-kkultong/shared';
import type { DataSource } from 'typeorm';
import request from 'supertest';
import { loadEnvironment } from '../src/common/environment';
import * as database from '../src/database/data-source';
import { createApplication } from '../src/main';
import { AdminCookieService } from '../src/modules/admin/services/admin-cookie.service';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { PolicyReview } from '../src/modules/policies/entities/policy-review.entity';
import { SourcePolicy } from '../src/modules/policies/entities/source-policy.entity';
import { PolicyReviewRepository } from '../src/modules/policies/repositories/policy-review.repository';
import { PolicyRepository } from '../src/modules/policies/repositories/policy.repository';
import { PolicyReviewsReadService } from '../src/modules/policies/services/reviews/policy-reviews-read.service';
import { createYouthCenterPolicyContentHash } from '../src/modules/ingestion/youth-center/youth-center-policy.hash';
import { transformYouthCenterPolicy } from '../src/modules/ingestion/youth-center/youth-center-policy.transform';
import { testAdminValues } from './helpers/admin';
import { clearPolicyTables, createCollectionWriter, seedMigratedPolicies } from './helpers/policy-collection';

const createdAt = new Date('2026-11-01T01:02:03.456Z');
const closedAt = new Date('2026-11-02T01:02:03.456Z');

/** 최소 원문에 미확인 중첩 필드와 조회수를 포함한 테스트 정책 준비 */
function raw(externalId: string, title: string, inqCnt = '10') {
  return { plcyNo: externalId, plcyNm: title, inqCnt, unknown: { nested: [null, ' 원문\n '] } };
}

/** 실제 관리자 모듈과 PostgreSQL에서 검수 목록 및 상세 계약과 읽기 일관성 검증 */
describe('관리자 검수 목록과 상세 및 이력 조회 API', () => {
  const schema = `mvp2_step22_${randomUUID().replaceAll('-', '')}`;
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

  /** 테스트 스키마에 정상 제약을 만족하는 후보와 원본 및 선택적인 공개 기준본 저장 */
  async function seed(options: {
    title?: string; kind?: ReviewKind; status?: ReviewStatus; createdAt?: Date; closedAt?: Date; id?: string;
  } = {}): Promise<PolicyReview> {
    const externalId = randomUUID();
    const target = raw(externalId, options.title ?? '검수 제목');
    const source = await connection.getRepository(SourcePolicy).save({
      source: 'youthcenter', externalId, title: target.plcyNm, rawJson: target,
      contentHash: createYouthCenterPolicyContentHash(target), viewCount: 10,
      firstCollectedAt: createdAt, lastCollectedAt: createdAt, lastCollectionResult: 'NEW', missingCount: 0,
    });
    let published: Policy | null = null;
    if (options.kind === 'CHANGED') {
      const base = raw(externalId, '공개 기준 제목');
      await new PolicyRepository().upsertPolicies(connection.manager, [{
        ...transformYouthCenterPolicy(base), contentHash: createYouthCenterPolicyContentHash(base),
      }]);
      published = await connection.getRepository(Policy).findOneByOrFail({ externalId });
    }
    const status = options.status ?? 'PENDING';
    return connection.getRepository(PolicyReview).save({
      id: options.id, sourcePolicyId: source.id, kind: options.kind ?? 'NEW', status,
      rawSnapshot: target, contentHash: source.contentHash,
      basePolicyId: published?.id ?? null, baseContentHash: published?.contentHash ?? null,
      baseRawSnapshot: published ? raw(externalId, '공개 기준 제목') : null,
      createdAt: options.createdAt ?? createdAt, closedAt: status === 'PENDING' ? null : options.closedAt ?? closedAt,
      reviewedBy: ['APPROVED', 'REJECTED'].includes(status) ? 'test-reviewer' : null,
      rejectionReason: status === 'REJECTED' ? '거절 사유\n 원문 ' : null,
      supersededReason: status === 'SUPERSEDED' ? 'SOURCE_CHANGED' : null,
    });
  }

  /** 실제 쿠키로 보호 목록 조회 */
  function list(query: Record<string, string | number> = {}) {
    return request(app.getHttpServer()).get('/api/v1/admin/reviews').query(query).set('Cookie', cookie);
  }

  /** 실제 쿠키로 보호 상세 조회 */
  function detail(id: string) {
    return request(app.getHttpServer()).get(`/api/v1/admin/reviews/${id}`).set('Cookie', cookie);
  }

  it('기본 목록은 대기만 반환하고 당시 제목과 경량 공용 계약 및 UTC 시각을 제공한다', async () => {
    const row = await seed();
    await seed({ status: 'APPROVED' });
    await connection.getRepository(SourcePolicy).update(row.sourcePolicyId, { title: '현재 원본 제목' });
    const response = await list().expect(200);
    expect(response.body).toEqual({ items: [{
      id: row.id, sourcePolicyId: row.sourcePolicyId, source: 'youthcenter', externalId: row.rawSnapshot.plcyNo,
      title: '검수 제목', kind: 'NEW', status: 'PENDING', contentHash: row.contentHash, baseContentHash: null,
      createdAt: createdAt.toISOString(), closedAt: null, reviewedBy: null, rejectionReason: null, supersededReason: null,
    }], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('기본 페이지는 20건이고 최대 50건 및 동률 UUID 오름차순으로 경계를 유지한다', async () => {
    const rows = await Promise.all(Array.from({ length: 23 }, () => seed()));
    const expected = rows.map(({ id }) => id).sort();
    const first = await list().expect(200);
    const second = await list({ page: 2 }).expect(200);
    expect(first.body.pagination).toEqual({ page: 1, limit: 20, total: 23, totalPages: 2 });
    expect([...first.body.items, ...second.body.items].map(({ id }: { id: string }) => id)).toEqual(expected);
    expect((await list({ limit: 50 }).expect(200)).body.items).toHaveLength(23);
  });

  it('빈 조건 결과와 범위 밖 페이지는 200 빈 배열 및 정확한 페이지 정보를 반환한다', async () => {
    expect((await list().expect(200)).body).toEqual({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    await seed();
    expect((await list({ page: 2, limit: 1 }).expect(200)).body)
      .toEqual({ items: [], pagination: { page: 2, limit: 1, total: 1, totalPages: 1 } });
    expect((await list({ page: Number.MAX_SAFE_INTEGER, limit: 50 }).expect(200)).body.items).toEqual([]);
  });

  it('개별 상태는 생성 시각 내림차순이고 PROCESSED는 종료 시각 내림차순이다', async () => {
    const oldCreated = new Date('2026-10-01T00:00:00Z');
    const first = await seed({ status: 'APPROVED', createdAt: oldCreated, closedAt: new Date('2026-11-02T03:00:00Z') });
    const second = await seed({ status: 'APPROVED', closedAt: new Date('2026-11-02T02:00:00Z') });
    const rejected = await seed({ status: 'REJECTED', closedAt: new Date('2026-11-02T01:00:00Z') });
    const superseded = await seed({ status: 'SUPERSEDED', closedAt: new Date('2026-11-02T01:00:00Z') });
    await seed();
    expect((await list({ status: 'APPROVED' }).expect(200)).body.items.map(({ id }: { id: string }) => id)).toEqual([second.id, first.id]);
    const history = await list({ status: 'PROCESSED' }).expect(200);
    expect(history.body.items.map(({ id }: { id: string }) => id))
      .toEqual([first.id, second.id, ...[rejected.id, superseded.id].sort()]);
    expect(history.body.items.find(({ id }: { id: string }) => id === rejected.id))
      .toMatchObject({ reviewedBy: 'test-reviewer', rejectionReason: '거절 사유\n 원문 ', supersededReason: null });
    expect(history.body.items.find(({ id }: { id: string }) => id === superseded.id))
      .toMatchObject({ reviewedBy: null, rejectionReason: null, supersededReason: 'SOURCE_CHANGED' });
    for (const status of ['REJECTED', 'SUPERSEDED']) {
      expect((await list({ status }).expect(200)).body.items).toHaveLength(1);
    }
  });

  it('종류와 상태 및 원본 ID와 후보 제목 검색은 모두 AND로 적용한다', async () => {
    const selected = await seed({ title: '  청년 ABC 지원  ', kind: 'CHANGED', status: 'REJECTED' });
    await seed({ title: '청년 ABC 지원', status: 'REJECTED' });
    await seed({ title: '다른 제목', kind: 'CHANGED', status: 'REJECTED' });
    const filters = { kind: 'CHANGED', status: 'PROCESSED', keyword: '  abc  ', sourcePolicyId: selected.sourcePolicyId };
    const response = await list(filters).expect(200);
    expect(response.body.items.map(({ id }: { id: string }) => id)).toEqual([selected.id]);
    expect(response.body.pagination.total).toBe(1);
    expect((await list({ ...filters, keyword: '없는 검색어' }).expect(200)).body.items).toEqual([]);
    expect((await list({ ...filters, sourcePolicyId: randomUUID() }).expect(200)).body.items).toEqual([]);
  });

  it.each(['%', '_', '\\', "' OR 1=1 --"])(
    '검색어 %s는 와일드카드나 SQL 대신 제목의 문자 그대로 검색한다', async (keyword) => {
      const selected = await seed({ title: `선택 ${keyword} 제목` });
      await seed({ title: '일반 제목' });
      expect((await list({ keyword }).expect(200)).body.items.map(({ id }: { id: string }) => id)).toEqual([selected.id]);
    },
  );

  it('빈 검색은 제한하지 않고 외부 ID나 최신 원본 제목은 제목 검색에 사용하지 않는다', async () => {
    const row = await seed();
    await connection.getRepository(SourcePolicy).update(row.sourcePolicyId, { title: '최신 제목 전용' });
    expect((await list({ keyword: '   ' }).expect(200)).body.pagination.total).toBe(1);
    for (const keyword of ['최신 제목 전용', String(row.rawSnapshot.plcyNo)]) {
      expect((await list({ keyword }).expect(200)).body.items).toEqual([]);
    }
  });

  it.each(['page=0', 'page=-1', 'page=1.5', 'page=', 'page=9007199254740992', 'page=1&page=2',
    'limit=51', 'limit=0', 'status=UNKNOWN', 'kind=UNKNOWN', 'sourcePolicyId=bad', 'keyword=' + '가'.repeat(101),
    'keyword=a&keyword=b', 'status=PENDING&status=APPROVED', 'extra=value'])
  ('잘못된 query %s는 DB 조회 전에 400이다', async (query) => {
    const queries = jest.spyOn(connection.logger, 'logQuery');
    await request(app.getHttpServer()).get(`/api/v1/admin/reviews?${encodeURI(query)}`).set('Cookie', cookie)
      .expect(400).expect({ code: 'BAD_REQUEST', message: '요청값이 올바르지 않습니다.' });
    expect(queries).not.toHaveBeenCalled();
  });

  it('미인증 및 변조 쿠키는 잘못된 입력이나 존재 여부 확인보다 먼저 401이다', async () => {
    const row = await seed();
    const queries = jest.spyOn(connection.logger, 'logQuery');
    for (const path of ['/api/v1/admin/reviews?status=INVALID', '/api/v1/admin/reviews/bad-id',
      `/api/v1/admin/reviews/${row.id}`, `/api/v1/admin/reviews/${randomUUID()}`]) {
      for (const header of [undefined, 'youth_admin_auth=tampered']) {
        const pending = request(app.getHttpServer()).get(path);
        if (header) pending.set('Cookie', header);
        const response = await pending.expect(401).expect({ code: 'ADMIN_UNAUTHORIZED', message: '관리자 인증이 필요합니다.' });
        expect(response.headers['cache-control']).toBe('no-store');
      }
    }
    expect(queries).not.toHaveBeenCalled();
  });

  it('잘못된 상세 UUID는 조회 전 400, 없는 후보는 안전한 404와 롤백 및 연결 반환이다', async () => {
    const queries = jest.spyOn(connection.logger, 'logQuery');
    await detail('bad-id').expect(400);
    expect(queries).not.toHaveBeenCalled();
    const create = connection.createQueryRunner.bind(connection);
    const runner = create();
    const released = jest.spyOn(runner, 'release');
    jest.spyOn(connection, 'createQueryRunner').mockReturnValueOnce(runner);
    const response = await detail(randomUUID()).expect(404)
      .expect({ code: 'REVIEW_NOT_FOUND', message: '검수 후보를 찾을 수 없습니다.' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(queries.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(released).toHaveBeenCalledTimes(1);
    expect(runner.isReleased).toBe(true);
    expect(runner.isTransactionActive).toBe(false);
  });

  it('신규 상세는 기준본과 공개본이 NULL이고 모든 원문 필드를 추가로 표시한다', async () => {
    const row = await seed();
    const response = await detail(row.id).expect(200);
    expect(response.body).toEqual({
      review: (await list().expect(200)).body.items[0], base: null,
      target: { contentHash: row.contentHash, raw: row.rawSnapshot }, currentPublished: null,
      latestSource: { contentHash: row.contentHash, viewCount: 10, lastCollectedAt: createdAt.toISOString(), missingCount: 0 },
      latestPendingReviewId: row.id, canReview: true,
      changedFields: ['plcyNm', 'plcyNo', 'unknown'].map((key) => ({
        key, beforeExists: false, afterExists: true, before: null, after: row.rawSnapshot[key],
      })),
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('변경 상세는 기준본과 변경본 및 현재 공개본을 제공하고 조회수만 달라도 검수 가능하다', async () => {
    const row = await seed({ kind: 'CHANGED' });
    await connection.getRepository(SourcePolicy).update(row.sourcePolicyId, { viewCount: 999, missingCount: 3, lastCollectedAt: null });
    await connection.getRepository(Policy).update(row.basePolicyId!, { viewCount: 999 });
    const response = await detail(row.id).expect(200);
    expect(response.body).toMatchObject({
      base: { contentHash: row.baseContentHash, raw: row.baseRawSnapshot },
      target: { contentHash: row.contentHash, raw: row.rawSnapshot },
      currentPublished: { id: row.basePolicyId, contentHash: row.baseContentHash, raw: row.baseRawSnapshot, viewCount: 999 },
      latestSource: { contentHash: row.contentHash, viewCount: 999, missingCount: 3, lastCollectedAt: null },
      latestPendingReviewId: row.id, canReview: true,
      changedFields: [{ key: 'plcyNm', beforeExists: true, afterExists: true, before: '공개 기준 제목', after: '검수 제목' }],
    });
  });

  it.each(['APPROVED', 'REJECTED', 'SUPERSEDED'] as const)('과거 %s 상세도 당시 스냅샷을 유지하고 canReview는 false다', async (status) => {
    const row = await seed({ kind: 'CHANGED', status });
    const current = raw(String(row.rawSnapshot.plcyNo), '현재 공개본');
    await new PolicyRepository().upsertPolicies(connection.manager, [{
      ...transformYouthCenterPolicy(current), contentHash: createYouthCenterPolicyContentHash(current),
    }]);
    await connection.getRepository(SourcePolicy).update(row.sourcePolicyId, { title: '최신 원본', contentHash: 'c'.repeat(64) });
    const response = await detail(row.id).expect(200);
    expect(response.body).toMatchObject({ review: { title: '검수 제목', status, closedAt: closedAt.toISOString() },
      base: { raw: row.baseRawSnapshot }, target: { raw: row.rawSnapshot }, currentPublished: { raw: current },
      latestSource: { contentHash: 'c'.repeat(64) }, latestPendingReviewId: null, canReview: false,
      changedFields: [{ key: 'plcyNm', beforeExists: true, afterExists: true, before: '공개 기준 제목', after: '검수 제목' }],
    });
  });

  it('실제 재수집으로 후보가 교체돼도 과거 상세와 검색 제목 및 차이는 당시 내용을 보존한다 (T2-34)', async () => {
    const environment = loadEnvironment();
    const writer = createCollectionWriter(environment);
    const base = raw('history-policy', '기준 A');
    await seedMigratedPolicies(connection, [base]);
    const first = raw('history-policy', '당시 B');
    const runner = connection.createQueryRunner();
    try {
      await writer.saveCollection(runner, 'youthcenter', [{ ...transformYouthCenterPolicy(first),
        contentHash: createYouthCenterPolicyContentHash(first) }], createdAt);
      const before = await connection.getRepository(PolicyReview).findOneByOrFail({ status: 'PENDING' });
      const beforeResponse: AdminReviewDetail = (await detail(before.id).expect(200)).body;
      const second = raw('history-policy', '최신 C', '99');
      await writer.saveCollection(runner, 'youthcenter', [{ ...transformYouthCenterPolicy(second),
        contentHash: createYouthCenterPolicyContentHash(second) }], closedAt);
      const latest = await connection.getRepository(PolicyReview).findOneByOrFail({ status: 'PENDING' });
      const afterResponse: AdminReviewDetail = (await detail(before.id).expect(200)).body;
      expect(afterResponse).toMatchObject({ review: { title: '당시 B', status: 'SUPERSEDED' },
        base: beforeResponse.base, target: beforeResponse.target, changedFields: beforeResponse.changedFields,
        latestPendingReviewId: latest.id, canReview: false, latestSource: { contentHash: latest.contentHash, viewCount: 99 } });
      expect((await list({ status: 'PROCESSED', keyword: '당시 B', sourcePolicyId: before.sourcePolicyId }).expect(200)).body.pagination.total).toBe(1);
      expect((await list({ status: 'PROCESSED', keyword: '최신 C' }).expect(200)).body.items).toEqual([]);
      expect((await detail(latest.id).expect(200)).body).toMatchObject({ canReview: true, review: { title: '최신 C' } });
    } finally { await runner.release(); }
  });

  it('상세는 읽기 전용 REPEATABLE READ로 읽고 성공 후 COMMIT 및 연결 반환을 수행한다', async () => {
    const row = await seed();
    const repo = app.get(PolicyReviewRepository);
    const find = repo.findReviewDetail.bind(repo);
    jest.spyOn(repo, 'findReviewDetail').mockImplementationOnce(async (manager, id) => {
      expect(await manager.query('SHOW transaction_isolation')).toEqual([{ transaction_isolation: 'repeatable read' }]);
      expect(await manager.query('SHOW transaction_read_only')).toEqual([{ transaction_read_only: 'on' }]);
      return find(manager, id);
    });
    const runner = connection.createQueryRunner();
    const release = jest.spyOn(runner, 'release');
    jest.spyOn(connection, 'createQueryRunner').mockReturnValueOnce(runner);
    const queries = jest.spyOn(connection.logger, 'logQuery');
    await detail(row.id).expect(200);
    expect(queries.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
    expect(queries.mock.calls.some(([sql]) => /FOR UPDATE/.test(sql))).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
    expect(runner.isReleased).toBe(true);
  });

  it('후보 조회 직후 다른 연결에서 원본과 공개본 및 대기를 바꿔도 상세는 같은 시점으로 일치한다', async () => {
    const row = await seed({ kind: 'CHANGED' });
    const repo = app.get(PolicyReviewRepository);
    const find = repo.findReviewDetail.bind(repo);
    const nextRaw = raw(String(row.rawSnapshot.plcyNo), '동시 변경 이후 정책', '99');
    const nextHash = createYouthCenterPolicyContentHash(nextRaw);
    let latestId: string | undefined;
    jest.spyOn(repo, 'findReviewDetail').mockImplementationOnce(async (manager, id) => {
      const entityRepository = manager.getRepository(PolicyReview);
      const read = entityRepository.findOneBy.bind(entityRepository);
      const firstRead = jest.spyOn(entityRepository, 'findOneBy').mockImplementationOnce(async (where) => {
        const candidate = await read(where);
        // 첫 후보 SELECT 뒤 다른 연결의 쓰기를 확정해 후속 조회 중 상태 변경을 재현
        await connection.transaction(async (writer) => {
          await writer.query(`UPDATE "${schema}".source_policies
            SET raw_json = $1::jsonb, title = $2, content_hash = $3, view_count = 99 WHERE id = $4`,
          [JSON.stringify(nextRaw), nextRaw.plcyNm, nextHash, row.sourcePolicyId]);
          await new PolicyRepository().upsertPolicies(writer, [{
            ...transformYouthCenterPolicy(nextRaw), contentHash: nextHash,
          }]);
          await writer.getRepository(PolicyReview).update(row.id, {
            status: 'SUPERSEDED', supersededReason: 'SOURCE_CHANGED', closedAt,
          });
          const latest = await writer.getRepository(PolicyReview).save({
            sourcePolicyId: row.sourcePolicyId, kind: 'CHANGED', status: 'PENDING', contentHash: nextHash,
            rawSnapshot: nextRaw, basePolicyId: row.basePolicyId, baseContentHash: nextHash, baseRawSnapshot: nextRaw,
          });
          latestId = latest.id;
        });
        return candidate;
      });
      try { return await find(manager, id); } finally { firstRead.mockRestore(); }
    });
    const response = await detail(row.id).expect(200);
    expect(latestId).toBeDefined();
    expect(response.body).toMatchObject({ review: { status: 'PENDING' },
      latestSource: { contentHash: row.contentHash, viewCount: 10 },
      currentPublished: { contentHash: row.baseContentHash, raw: row.baseRawSnapshot },
      latestPendingReviewId: row.id, canReview: true });
    const after = await detail(row.id).expect(200);
    expect(after.body).toMatchObject({ review: { status: 'SUPERSEDED' },
      latestSource: { contentHash: nextHash, viewCount: 99 }, currentPublished: { contentHash: nextHash },
      latestPendingReviewId: latestId, canReview: false });
  });

  it('최신 원본이나 공개 기준이 달라진 대기 상세는 canReview가 false다', async () => {
    const row = await seed({ kind: 'CHANGED' });
    await connection.getRepository(SourcePolicy).update(row.sourcePolicyId, { contentHash: 'c'.repeat(64) });
    expect((await detail(row.id).expect(200)).body.canReview).toBe(false);
    await connection.getRepository(SourcePolicy).update(row.sourcePolicyId, { contentHash: row.contentHash });
    await connection.getRepository(Policy).update(row.basePolicyId!, { contentHash: 'd'.repeat(64) });
    expect((await detail(row.id).expect(200)).body.canReview).toBe(false);
  });

  it('목록과 상세 조회는 공개본과 원본 및 검수 행을 변경하지 않는다', async () => {
    const row = await seed({ kind: 'CHANGED' });
    /** 세 테이블의 전체 행을 일정한 순서로 읽어 조회 전후 상태 비교 */
    const state = async () => Promise.all([Policy, SourcePolicy, PolicyReview].map((entity) =>
      connection.getRepository(entity).find({ order: { id: 'ASC' } })));
    const before = await state();
    await list().expect(200);
    await detail(row.id).expect(200);
    expect(await state()).toEqual(before);
  });

  it('목록은 N+1이나 트랜잭션 없이 두 SELECT로 조회한다', async () => {
    await Promise.all(Array.from({ length: 5 }, () => seed()));
    const queries = jest.spyOn(connection.logger, 'logQuery');
    const response = await list().expect(200);
    expect(response.body.items).toHaveLength(5);
    expect(queries).toHaveBeenCalledTimes(2);
    expect(queries.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
    expect(queries.mock.calls.some(([sql]) => /FOR UPDATE|START TRANSACTION/.test(sql))).toBe(false);
    expect(response.body.items.every((item: object) => !Object.hasOwn(item, 'rawSnapshot') && !Object.hasOwn(item, 'raw'))).toBe(true);
  });

  it('공개 한도를 120회 소진해도 인증된 검수 목록 GET은 별도 한도로 200이다', async () => {
    for (let index = 0; index < 120; index++) await request(app.getHttpServer()).get('/api/v1/policies/invalid').expect(400);
    await request(app.getHttpServer()).get('/api/v1/policies/invalid').expect(429);
    await list().expect(200);
  });

  it('조회 실패는 원문 없는 500과 연결 반환을 보장한다', async () => {
    const row = await seed();
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const repo = app.get(PolicyReviewRepository);
    jest.spyOn(repo, 'findReviewDetail').mockRejectedValueOnce(new Error('private-review-error'));
    const response = await detail(row.id).expect(500)
      .expect({ code: 'INTERNAL_SERVER_ERROR', message: '서버 내부 오류가 발생했습니다.' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(logged.mock.calls)).not.toContain('private-review-error');
    // 실패한 트랜잭션 뒤에도 같은 풀이 정상 조회를 처리
    await detail(row.id).expect(200);
  });

  it('실제 DB 연결 종료는 목록과 상세 모두 원문 없는 503으로 처리한다', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    await connection.destroy();
    for (const response of [await list().expect(503), await detail(randomUUID()).expect(503)]) {
      expect(response.body).toEqual({ code: 'SERVICE_UNAVAILABLE', message: 'DB에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });
});
