import { randomUUID } from 'node:crypto';
import { QueryFailedError } from 'typeorm';
import type { DataSource, QueryRunner } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import { createDataSource } from '../src/database/data-source';
import { CreatePolicies1792162800000 } from '../src/database/migrations/1792162800000-create-policies';
import { CreatePolicyReviewTables1793199600000 } from '../src/database/migrations/1793199600000-create-policy-review-tables';
import { createYouthCenterPolicyContentHash } from '../src/modules/ingestion/youth-center/youth-center-policy.hash';
import { transformYouthCenterPolicy } from '../src/modules/ingestion/youth-center/youth-center-policy.transform';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { SourcePolicy } from '../src/modules/policies/entities/source-policy.entity';
import { PolicyReview } from '../src/modules/policies/entities/policy-review.entity';
import { PolicyRepository } from '../src/modules/policies/repositories/policy.repository';
import { SourcePolicyRepository } from '../src/modules/policies/repositories/source-policy.repository';
import { PolicyReviewRepository } from '../src/modules/policies/repositories/policy-review.repository';
import { PolicyReviewsWriteService } from '../src/modules/policies/services/policy-reviews-write.service';
import { PolicyCollectionWriteService } from '../src/modules/policies/services/policy-collection-write.service';
import type { PolicyWriteInput } from '../src/modules/policies/services/policies-write.service';

const firstAt = new Date('2026-10-29T19:00:00.123Z');
const nextAt = new Date('2026-10-30T03:00:00.456Z');

/** 전체 수집과 변환, 해시 계산을 마친 저장 입력 생성 */
function incoming(externalId: string, title = '정책 A', views = '10'): PolicyWriteInput {
  const rawJson = { plcyNo: externalId, plcyNm: title, inqCnt: views, extra: { nested: [null, ' 원문 '] } };
  return { ...transformYouthCenterPolicy(rawJson), contentHash: createYouthCenterPolicyContentHash(rawJson) };
}

describe('전체 수집분의 원본과 검수 및 공개 조회수 저장', () => {
  const schema = `mvp2_step10_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource;
  let connection: DataSource;
  let runner: QueryRunner;
  let sources: SourcePolicyRepository;
  let policies: PolicyRepository;
  let reviews: PolicyReviewRepository;
  let reviewWriter: PolicyReviewsWriteService;
  let service: PolicyCollectionWriteService;
  let schemaCreated = false;

  beforeAll(async () => {
    const environment = loadEnvironment();
    admin = createDataSource(environment).setOptions({ entities: [], migrations: [] });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    connection = createDataSource(environment).setOptions({
      schema, entities: [Policy, SourcePolicy, PolicyReview],
      migrations: [CreatePolicies1792162800000, CreatePolicyReviewTables1793199600000],
      extra: { options: `-c timezone=Asia/Seoul -c search_path=${schema}` },
    });
    await connection.initialize();
    await connection.runMigrations();
    const settings = { ...environment, POLICY_IMPORT_BATCH_SIZE: 200 };
    sources = new SourcePolicyRepository(settings);
    policies = new PolicyRepository();
    reviews = new PolicyReviewRepository(settings);
    reviewWriter = new PolicyReviewsWriteService(reviews);
    service = new PolicyCollectionWriteService(sources, policies, reviews, reviewWriter, settings);
  });

  beforeEach(async () => {
    // 테스트 스키마의 행만 외래키 순서에 맞춰 정리
    await connection.getRepository(PolicyReview).deleteAll();
    await connection.getRepository(SourcePolicy).deleteAll();
    await connection.getRepository(Policy).deleteAll();
    runner = connection.createQueryRunner();
    await runner.connect();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    try { if (runner?.isTransactionActive) await runner.rollbackTransaction(); }
    finally { if (runner && !runner.isReleased) await runner.release(); }
  });

  afterAll(async () => {
    try { if (connection?.isInitialized) await connection.destroy(); }
    finally {
      try { if (schemaCreated && admin?.isInitialized) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
      finally { if (admin?.isInitialized) await admin.destroy(); }
    }
  });

  /** 실제 수집 전 이관 상태와 같은 공개 정책과 초기 원본을 준비 */
  async function seedPublished(values: PolicyWriteInput[]): Promise<void> {
    await policies.upsertPolicies(connection.manager, values);
    await connection.query(`INSERT INTO "${schema}".source_policies
      (source, external_id, title, raw_json, content_hash, view_count)
      SELECT source, external_id, title, raw_json, content_hash, view_count FROM "${schema}".policies`);
  }

  /** 세 테이블의 확정된 전체 행을 비교할 수 있도록 정렬 조회 */
  async function state() {
    return {
      sources: await connection.getRepository(SourcePolicy).find({ order: { externalId: 'ASC' } }),
      reviews: await connection.getRepository(PolicyReview).find({ order: { id: 'ASC' } }),
      policies: await connection.getRepository(Policy).find({ order: { externalId: 'ASC' } }),
    };
  }

  /** 온통청년의 정상 전체 수집을 저장 */
  async function save(values: readonly PolicyWriteInput[], collectedAt = firstAt) {
    return service.saveCollection(runner, 'youthcenter', values, collectedAt);
  }

  it('신규 수집은 원본과 NEW 대기를 생성하고 공개 정책을 만들지 않는다', async () => {
    const values = [incoming('new')];
    const before = structuredClone(values);
    expect(await save(values)).toEqual({ counts: { NEW: 1, CHANGED: 0, UNCHANGED: 0, MISSING: 0 },
      reviewCreatedCount: 1, reviewSupersededCount: 0, publicViewUpdatedCount: 0 });
    const after = await state();
    expect(after.policies).toEqual([]);
    expect(after.sources[0]).toMatchObject({ externalId: 'new', firstCollectedAt: firstAt, lastCollectedAt: firstAt,
      missingCount: 0, lastCollectionResult: 'NEW' });
    expect(after.reviews[0]).toMatchObject({ sourcePolicyId: after.sources[0].id, kind: 'NEW', status: 'PENDING',
      contentHash: values[0].contentHash, rawSnapshot: values[0].rawJson, basePolicyId: null, baseRawSnapshot: null });
    expect(values).toEqual(before);
    expect(runner.isReleased).toBe(false);
    expect(runner.isTransactionActive).toBe(false);
  });

  it('변경 수집은 원본과 CHANGED 대기에 저장하고 기존 공개 본문과 UUID를 보존한다', async () => {
    await seedPublished([incoming('changed')]);
    const before = await state();
    const value = incoming('changed', '수집한 B', '99');
    expect(await save([value])).toEqual({ counts: { NEW: 0, CHANGED: 1, UNCHANGED: 0, MISSING: 0 },
      reviewCreatedCount: 1, reviewSupersededCount: 0, publicViewUpdatedCount: 1 });
    const after = await state();
    expect(after.policies[0]).toEqual({ ...before.policies[0], viewCount: 99, updatedAt: expect.any(Date) });
    expect(after.sources[0]).toMatchObject({ title: value.title, rawJson: value.rawJson, contentHash: value.contentHash });
    expect(after.reviews[0]).toMatchObject({ kind: 'CHANGED', basePolicyId: before.policies[0].id,
      baseContentHash: before.policies[0].contentHash, baseRawSnapshot: before.policies[0].rawJson,
      rawSnapshot: value.rawJson, contentHash: value.contentHash });
  });

  it.each(['99', '0', '해석 불가'])('이관 동일 자료의 조회수 %s는 공개 원문을 보존하고 실제 첫 수집 시각을 채운다', async (views) => {
    await seedPublished([incoming('same')]);
    const before = await state();
    const value = incoming('same', '정책 A', views);
    expect(await save([value])).toEqual({ counts: { NEW: 0, CHANGED: 0, UNCHANGED: 1, MISSING: 0 },
      reviewCreatedCount: 0, reviewSupersededCount: 0, publicViewUpdatedCount: 1 });
    const after = await state();
    expect(after.policies[0]).toEqual({ ...before.policies[0], viewCount: value.viewCount, updatedAt: expect.any(Date) });
    expect(after.sources[0]).toMatchObject({ firstCollectedAt: firstAt, lastCollectedAt: firstAt, rawJson: value.rawJson });
    expect(after.reviews).toEqual([]);
  });

  it('B를 반복 수집하면 대기와 스냅샷을 유지하고 C로 바뀌면 기존 대기를 대체한다', async () => {
    await seedPublished([incoming('policy')]);
    await save([incoming('policy', 'B')]);
    const first = await state();
    const repeated = await save([incoming('policy', 'B', '99')], nextAt);
    expect(repeated.reviewCreatedCount).toBe(0);
    expect((await state()).reviews).toEqual(first.reviews);
    expect((await state()).sources[0]).toMatchObject({ firstCollectedAt: firstAt, lastCollectedAt: nextAt });
    expect(await save([incoming('policy', 'C')], nextAt)).toMatchObject({ reviewCreatedCount: 1, reviewSupersededCount: 1 });
    const after = await state();
    expect(after.reviews.find(({ id }) => id === first.reviews[0].id)).toEqual({ ...first.reviews[0],
      status: 'SUPERSEDED', supersededReason: 'SOURCE_CHANGED', closedAt: expect.any(Date) });
    expect(after.reviews.filter(({ status }) => status === 'PENDING')).toHaveLength(1);
  });

  it('공개 A로 돌아오면 B 대기를 대체하고 새 대기를 만들지 않는다', async () => {
    await seedPublished([incoming('policy')]);
    await save([incoming('policy', 'B')]);
    expect(await save([incoming('policy')], nextAt)).toMatchObject({ reviewCreatedCount: 0, reviewSupersededCount: 1 });
    expect((await state()).reviews).toEqual([expect.objectContaining({ status: 'SUPERSEDED', supersededReason: 'MATCHES_PUBLIC' })]);
  });

  it('거절했던 내용의 동일 재수집도 원본과 공개 조회수는 갱신한다', async () => {
    await seedPublished([incoming('policy')]);
    await save([incoming('policy', 'B')]);
    await connection.getRepository(PolicyReview).update({ status: 'PENDING' }, {
      status: 'REJECTED', reviewedBy: 'test-admin', rejectionReason: '검수 거절', closedAt: firstAt,
    });
    const before = await state();
    expect(await save([incoming('policy', 'B', '99')], nextAt)).toMatchObject({
      counts: { UNCHANGED: 1 }, reviewCreatedCount: 0, reviewSupersededCount: 0, publicViewUpdatedCount: 1,
    });
    const after = await state();
    expect(after.reviews).toEqual(before.reviews);
    expect(after.policies[0]).toEqual({ ...before.policies[0], viewCount: 99, updatedAt: expect.any(Date) });
  });

  it('누락은 공개본과 검수 스냅샷, 원본 내용과 실제 수집 시각을 유지한다', async () => {
    await seedPublished([incoming('missing')]);
    await save([incoming('missing', 'B')]);
    const before = await state();
    expect(await save([], nextAt)).toEqual({ counts: { NEW: 0, CHANGED: 0, UNCHANGED: 0, MISSING: 1 },
      reviewCreatedCount: 0, reviewSupersededCount: 0, publicViewUpdatedCount: 0 });
    const after = await state();
    expect(after.policies).toEqual(before.policies);
    expect(after.reviews).toEqual(before.reviews);
    expect(after.sources[0]).toEqual({ ...before.sources[0], missingCount: 1,
      lastCollectionResult: 'MISSING', updatedAt: expect.any(Date) });
    await save([], nextAt);
    expect((await state()).sources[0].missingCount).toBe(2);
    expect(await save([incoming('missing', 'B')], nextAt)).toMatchObject({ counts: { UNCHANGED: 1 }, reviewCreatedCount: 0 });
    expect((await state()).sources[0].missingCount).toBe(0);
    expect((await state()).reviews).toEqual(before.reviews);
  });

  it('정상 전체 0건은 미공개 원본과 아직 관찰되지 않은 이관 원본도 누락 처리한다', async () => {
    await seedPublished([incoming('unseen')]);
    await save([incoming('unpublished')]);
    const before = await state();
    const result = await save([], nextAt);
    expect(result.counts).toEqual({ NEW: 0, CHANGED: 0, UNCHANGED: 0, MISSING: 2 });
    const after = await state();
    expect(after.policies).toEqual(before.policies);
    expect(after.reviews).toEqual(before.reviews);
    expect(after.sources.find(({ externalId }) => externalId === 'unseen')).toMatchObject({
      firstCollectedAt: null, lastCollectedAt: null, missingCount: 2,
    });
  });

  it('원본 잠금 뒤에만 후보와 공개본을 읽고 모든 저장은 같은 관리자와 단일 트랜잭션을 사용한다', async () => {
    const sourceRead = jest.spyOn(sources, 'findBySourceForUpdate');
    const relatedReads = [jest.spyOn(policies, 'findPublicSnapshots'),
      jest.spyOn(reviews, 'findPendingReviews'), jest.spyOn(reviews, 'findRejectedHashes')];
    const writes = [jest.spyOn(sources, 'upsertCollectedPolicies'), jest.spyOn(sources, 'updateMissingPolicies'),
      jest.spyOn(reviewWriter, 'saveReviewChanges'), jest.spyOn(policies, 'refreshViewCounts')];
    const query = jest.spyOn(runner, 'query');
    const pid = (await runner.query('SELECT pg_backend_pid() AS pid'))[0].pid;
    await save([incoming('new')]);
    // 공개본과 검수 정보의 첫 조회는 원본 잠금과 신규 UUID 재조회 이후에 실행
    for (const read of relatedReads) {
      expect(sourceRead.mock.invocationCallOrder[1]).toBeLessThan(read.mock.invocationCallOrder[0]);
    }
    for (const method of [sourceRead, ...relatedReads, ...writes]) {
      for (const [manager] of method.mock.calls) expect(manager).toBe(runner.manager);
    }
    expect(query.mock.calls.filter(([sql]) => sql === 'START TRANSACTION')).toHaveLength(1);
    expect(query.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(1);
    expect(query.mock.calls.some(([sql]) => sql.includes('SAVEPOINT'))).toBe(false);
    expect((await runner.query('SELECT pg_backend_pid() AS pid'))[0].pid).toBe(pid);
  });

  it('401건은 200개씩 묶어 조회하고 저장하며 원본마다 개별 조회하지 않는다', async () => {
    const values = Array.from({ length: 401 }, (_, i) => incoming(`policy-${i}`));
    const originals = jest.spyOn(sources, 'findBySourceForUpdate');
    const publicRead = jest.spyOn(policies, 'findPublicSnapshots');
    const query = jest.spyOn(runner, 'query');
    expect(await save(values)).toEqual({ counts: { NEW: 401, CHANGED: 0, UNCHANGED: 0, MISSING: 0 },
      reviewCreatedCount: 401, reviewSupersededCount: 0, publicViewUpdatedCount: 0 });
    expect(originals).toHaveBeenCalledTimes(2);
    expect(publicRead.mock.calls.map(([, keys]) => keys.length)).toEqual([200, 200, 1]);
    const reads = query.mock.calls.filter(([sql]) => sql.startsWith('SELECT'));
    expect(reads).toHaveLength(11);
    expect((await state()).sources.every(({ firstCollectedAt, lastCollectedAt }) =>
      firstCollectedAt?.getTime() === firstAt.getTime() && lastCollectedAt?.getTime() === firstAt.getTime())).toBe(true);
  });

  it('후반 조회수 묶음의 실제 DB 오류는 앞서 저장한 원본과 후보, 조회수를 모두 취소한다', async () => {
    const values = Array.from({ length: 401 }, (_, i) => incoming(`policy-${i}`));
    await seedPublished(values);
    const before = await state();
    const updateViews = policies.refreshViewCounts.bind(policies);
    let batches = 0;
    jest.spyOn(policies, 'refreshViewCounts').mockImplementation(async (manager, batch) => {
      batches += 1;
      if (batches === 3) {
        expect(await manager.getRepository(PolicyReview).countBy({ status: 'PENDING' })).toBe(401);
        expect(await manager.getRepository(Policy).countBy({ viewCount: 99 })).toBe(400);
        expect(await state()).toEqual(before);
        // 저장 후반에 실제 PostgreSQL 정수 범위 오류를 발생시켜 전체 취소를 검증
        await manager.query('SELECT $1::integer', [2147483648]);
      }
      return updateViews(manager, batch);
    });
    await expect(save(values.map(({ externalId }) => incoming(externalId, '새 내용 B', '99'))))
      .rejects.toMatchObject({ driverError: { code: '22003' } });
    expect(batches).toBe(3);
    expect(await state()).toEqual(before);
    expect(runner.isTransactionActive).toBe(false);
    expect(runner.isReleased).toBe(false);
  });

  it('후보 스냅샷 해시 오류도 먼저 저장한 신규 원본을 취소한다', async () => {
    await expect(save([{ ...incoming('bad-hash'), contentHash: 'a'.repeat(64) }])).rejects.toThrow('내용과 해시');
    expect(await state()).toEqual({ sources: [], reviews: [], policies: [] });
  });

  it.each(['중복', '다른 출처'])('%s 입력은 기존 원본의 누락 횟수도 변경하지 않는다', async (condition) => {
    await seedPublished([incoming('existing')]);
    const before = await state();
    const values = condition === '중복' ? [incoming('new'), incoming('new')] : [{ ...incoming('new'), source: 'other' }];
    await expect(save(values)).rejects.toThrow(condition === '중복' ? '중복' : '출처');
    expect(await state()).toEqual(before);
  });

  it.each(['40P01', '40001'])('%s 충돌은 같은 연결에서 한 번 재시도하고 확정 건수만 반환한다', async (code) => {
    const conflict = new QueryFailedError('검증용 SQL', [], Object.assign(new Error('검증 충돌'), { code }));
    const update = policies.refreshViewCounts.bind(policies);
    jest.spyOn(policies, 'refreshViewCounts').mockRejectedValueOnce(conflict).mockImplementation(update);
    const attempts = jest.fn(async () => {});
    expect(await service.saveCollection(runner, 'youthcenter', [incoming('retry')], firstAt, attempts))
      .toMatchObject({ counts: { NEW: 1 }, reviewCreatedCount: 1 });
    expect(attempts).toHaveBeenNthCalledWith(1, 1);
    expect(attempts).toHaveBeenNthCalledWith(2, 2, conflict);
    expect((await state()).sources).toHaveLength(1);
    expect((await state()).reviews).toHaveLength(1);
  });

  it('재시도 대상 밖의 DB 오류는 한 번만 실행하고 모든 변경을 취소한다', async () => {
    const attempts = jest.fn(async () => {});
    await expect(service.saveCollection(runner, 'youthcenter', [{ ...incoming('invalid'), viewCount: -1 }], firstAt, attempts))
      .rejects.toMatchObject({ driverError: { code: '23514' } });
    expect(attempts).toHaveBeenCalledTimes(1);
    expect(await state()).toEqual({ sources: [], reviews: [], policies: [] });
  });

  it('이미 진행 중인 트랜잭션과 반환된 연결에서는 새 저장을 시작하지 않는다', async () => {
    await runner.startTransaction();
    await expect(save([])).rejects.toThrow('새 트랜잭션 연결');
    expect(runner.isTransactionActive).toBe(true);
    await runner.rollbackTransaction();
    await runner.release();
    await expect(save([])).rejects.toThrow('새 트랜잭션 연결');
  });
});
