import { randomUUID } from 'node:crypto';
import type { DataSource, QueryRunner } from 'typeorm';
import type { CollectionResult, ReviewStatus, SupersededReason } from '@youth-kkultong/shared';
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
import type { ReviewCandidateInput } from '../src/modules/policies/services/policy-reviews-write.service';
import { decidePolicyReview } from '../src/modules/policies/policy-review-decision';

const collectedAt = new Date('2026-10-29T03:00:00.123Z');
const closedAt = new Date('2026-10-29T04:00:00.456Z');

/** 미확인 필드와 중첩 값을 포함한 테스트용 정책 원문 생성 */
function raw(externalId: string, title = '검수할 정책', views = '10') {
  return { plcyNo: externalId, plcyNm: title, inqCnt: views,
    extra: { nested: [null, false, ' 원문\n ', { value: '그대로 보존' }] } };
}

describe('검수 후보와 스냅샷 저장의 실제 PostgreSQL 검증', () => {
  const schema = `mvp2_step6_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource;
  let connection: DataSource;
  let runner: QueryRunner;
  let repository: PolicyReviewRepository;
  let service: PolicyReviewsWriteService;
  let sources: SourcePolicyRepository;
  let schemaCreated = false;

  beforeAll(async () => {
    const environment = loadEnvironment();
    admin = createDataSource(environment).setOptions({ entities: [], migrations: [] });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    // 실제 제품 데이터와 분리된 임시 스키마에 원본과 검수 테이블을 준비
    connection = createDataSource(environment).setOptions({
      schema, entities: [Policy, SourcePolicy, PolicyReview],
      migrations: [CreatePolicies1792162800000, CreatePolicyReviewTables1793199600000],
      extra: { options: `-c timezone=Asia/Seoul -c search_path=${schema}` },
    });
    await connection.initialize();
    await connection.runMigrations();
    repository = new PolicyReviewRepository({ ...environment, POLICY_IMPORT_BATCH_SIZE: 200 });
    service = new PolicyReviewsWriteService(repository);
    sources = new SourcePolicyRepository(environment);
  });

  beforeEach(async () => {
    runner = connection.createQueryRunner();
    await runner.connect();
    await runner.startTransaction('READ COMMITTED');
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

  /** 지정한 개수의 수집 원본을 저장하고 잠근 뒤 후보 생성 입력으로 준비 */
  async function candidates(count = 1): Promise<ReviewCandidateInput[]> {
    const incoming = Array.from({ length: count }, (_, i) => {
      const value = raw(`policy-${String(i).padStart(3, '0')}`);
      return { ...transformYouthCenterPolicy(value), contentHash: createYouthCenterPolicyContentHash(value),
        rawJson: value, lastCollectionResult: 'NEW' as const };
    });
    await sources.upsertCollectedPolicies(runner.manager, incoming, collectedAt);
    return (await sources.findBySourceForUpdate(runner.manager, 'youthcenter'))
      .map((sourcePolicy) => ({ sourcePolicy, basePolicy: null }));
  }

  /** 별도 공개 내용을 저장해 변경 후보의 공개 기준본으로 준비 */
  async function withBase(candidate: ReviewCandidateInput): Promise<ReviewCandidateInput> {
    const value = raw(candidate.sourcePolicy.externalId, '기존 공개 정책', '2');
    await new PolicyRepository().upsertPolicies(runner.manager, [{
      ...transformYouthCenterPolicy(value), contentHash: createYouthCenterPolicyContentHash(value),
    }]);
    const basePolicy = await runner.manager.getRepository(Policy).findOneByOrFail({
      source: candidate.sourcePolicy.source, externalId: candidate.sourcePolicy.externalId,
    });
    return { ...candidate, basePolicy };
  }

  /** 같은 트랜잭션에서 검수 전체 행을 안정적인 순서로 조회 */
  async function reviews(): Promise<PolicyReview[]> {
    return runner.manager.getRepository(PolicyReview).find({ order: { sourcePolicyId: 'ASC', id: 'ASC' } });
  }

  /** 승인과 거절 저장을 구현하기 전 테스트용 종료 이력을 준비 */
  async function finish(id: string, status: Exclude<ReviewStatus, 'PENDING'>): Promise<void> {
    await runner.manager.getRepository(PolicyReview).update({ id }, {
      status, closedAt, reviewedBy: status === 'SUPERSEDED' ? null : 'test-admin',
      rejectionReason: status === 'REJECTED' ? '테스트 거절 사유' : null,
      supersededReason: status === 'SUPERSEDED' ? 'SOURCE_CHANGED' : null,
    });
  }

  /** 실제 DB에서 읽은 상태로 판단한 결과를 기존 검수 저장 서비스에 적용 */
  async function applyDecision(sourcePolicyId: string, collectionResult: CollectionResult = 'CHANGED') {
    const sourcePolicy = await runner.manager.getRepository(SourcePolicy).findOneByOrFail({ id: sourcePolicyId });
    const publicPolicy = await runner.manager.getRepository(Policy).findOneBy({
      source: sourcePolicy.source, externalId: sourcePolicy.externalId,
    });
    const pendingReview = (await repository.findPendingReviews(runner.manager, [sourcePolicyId]))[0] ?? null;
    const rejectedHashes = await repository.findRejectedHashes(runner.manager, [sourcePolicyId]);
    const decision = decidePolicyReview({ sourcePolicy, publicPolicy, pendingReview, rejectedHashes, collectionResult });
    if (decision.action !== 'KEEP') {
      await service.saveReviewChanges(runner.manager, decision.superseded ? [decision.superseded] : [],
        decision.action === 'CREATE' ? [{ sourcePolicy, basePolicy: publicPolicy }] : [], closedAt);
    }
    return decision;
  }

  /** 테스트 원본을 재수집한 내용으로 갱신 */
  async function observe(externalId: string, title: string, views = '10'): Promise<void> {
    const value = raw(externalId, title, views);
    await sources.upsertCollectedPolicies(runner.manager, [{ ...transformYouthCenterPolicy(value), rawJson: value,
      contentHash: createYouthCenterPolicyContentHash(value), lastCollectionResult: 'CHANGED' }], closedAt);
  }

  it('빈 입력은 조회와 저장 쿼리를 실행하지 않는다', async () => {
    const query = jest.spyOn(runner, 'query');
    expect(await repository.findPendingReviews(runner.manager, [])).toEqual([]);
    expect(await repository.findRejectedHashes(runner.manager, [])).toEqual([]);
    await service.saveReviewChanges(runner.manager, [], [], closedAt);
    expect(query).not.toHaveBeenCalled();
  });

  it('신규 후보는 변경본 스냅샷을 저장하고 기준본 세 값은 SQL NULL로 저장한다', async () => {
    const [candidate] = await candidates();
    const before = structuredClone(candidate);
    await service.saveReviewChanges(runner.manager, [], [candidate], closedAt);
    const [saved] = await reviews();
    expect(saved).toMatchObject({ sourcePolicyId: candidate.sourcePolicy.id, kind: 'NEW', status: 'PENDING',
      rawSnapshot: candidate.sourcePolicy.rawJson, contentHash: candidate.sourcePolicy.contentHash,
      basePolicyId: null, baseContentHash: null, baseRawSnapshot: null,
      reviewedBy: null, rejectionReason: null, supersededReason: null, closedAt: null });
    expect(candidate).toEqual(before);
    expect(await connection.getRepository(PolicyReview).count()).toBe(0);
    expect(runner.isTransactionActive).toBe(true);
  });

  it('변경 후보는 당시 공개 ID와 원문, 해시를 함께 저장한다', async () => {
    const candidate = await withBase((await candidates())[0]);
    await service.saveReviewChanges(runner.manager, [], [candidate], closedAt);
    expect((await reviews())[0]).toMatchObject({ kind: 'CHANGED',
      basePolicyId: candidate.basePolicy!.id, baseContentHash: candidate.basePolicy!.contentHash,
      baseRawSnapshot: candidate.basePolicy!.rawJson, rawSnapshot: candidate.sourcePolicy.rawJson });
  });

  it('원본과 공개본이 나중에 바뀌어도 두 스냅샷과 당시 제목은 보존된다', async () => {
    const candidate = await withBase((await candidates())[0]);
    await service.saveReviewChanges(runner.manager, [], [candidate], closedAt);
    const [before] = await reviews();
    const value = raw(candidate.sourcePolicy.externalId, '나중에 수집된 제목', '99');
    await sources.upsertCollectedPolicies(runner.manager, [{ ...transformYouthCenterPolicy(value), rawJson: value,
      contentHash: createYouthCenterPolicyContentHash(value), lastCollectionResult: 'CHANGED' }], closedAt);
    // 공개 기준 변경 방어 경로를 테스트 전용 스키마에서 재현
    await new PolicyRepository().upsertPolicies(runner.manager, [{
      ...transformYouthCenterPolicy(value), contentHash: createYouthCenterPolicyContentHash(value),
    }]);
    expect((await reviews())[0]).toEqual(before);
    expect(before.rawSnapshot.plcyNm).toBe('검수할 정책');
    expect(before.baseRawSnapshot!.plcyNm).toBe('기존 공개 정책');
  });

  it('첫 비동기 저장 전에 중첩 스냅샷을 복사해 입력 변경으로부터 보호한다', async () => {
    const candidate = await withBase((await candidates())[0]);
    const before = structuredClone(candidate);
    const supersede = repository.supersedePendingReviews.bind(repository);
    jest.spyOn(repository, 'supersedePendingReviews').mockImplementation(async (...args) => {
      (candidate.sourcePolicy.rawJson.extra as { nested: unknown[] }).nested.push('뒤늦은 변경');
      (candidate.basePolicy!.rawJson.extra as { nested: unknown[] }).nested.push('기준본 입력 변경');
      await supersede(...args);
    });
    await service.saveReviewChanges(runner.manager, [], [candidate], closedAt);
    expect((await reviews())[0]).toMatchObject({ rawSnapshot: before.sourcePolicy.rawJson,
      baseRawSnapshot: before.basePolicy!.rawJson });
  });

  it.each(['SOURCE_CHANGED', 'PUBLIC_BASE_CHANGED', 'MATCHES_PUBLIC', 'PREVIOUSLY_REJECTED'] as SupersededReason[])(
    '%s 사유로 기존 대기를 먼저 종료한 뒤 새 후보를 추가한다', async (reason) => {
      const [candidate] = await candidates();
      await service.saveReviewChanges(runner.manager, [], [candidate], closedAt);
      const [before] = await reviews();
      const query = jest.spyOn(runner, 'query');
      await service.saveReviewChanges(runner.manager, [{ id: before.id, reason }], [candidate], closedAt);
      const writes = query.mock.calls.filter(([sql]) => /^(UPDATE|INSERT)/.test(sql));
      expect(writes.map(([sql]) => sql.split(' ')[0])).toEqual(['UPDATE', 'INSERT']);
      const after = await reviews();
      expect(after.find(({ id }) => id === before.id)).toEqual({ ...before,
        status: 'SUPERSEDED', supersededReason: reason, closedAt });
      expect(after.filter(({ status }) => status === 'PENDING')).toHaveLength(1);
    },
  );

  it('새 후보 없이 기존 대기만 대체할 수 있다', async () => {
    const input = await candidates();
    await service.saveReviewChanges(runner.manager, [], input, closedAt);
    const [before] = await reviews();
    await service.saveReviewChanges(runner.manager, [{ id: before.id, reason: 'MATCHES_PUBLIC' }], [], closedAt);
    expect(await repository.findPendingReviews(runner.manager, [before.sourcePolicyId])).toEqual([]);
    expect(await reviews()).toHaveLength(1);
  });

  it('기존 대기를 종료하지 않고 같은 원본에 새 대기를 넣으면 DB 유일성 제약으로 거부한다', async () => {
    const input = await candidates();
    await service.saveReviewChanges(runner.manager, [], input, closedAt);
    await expect(service.saveReviewChanges(runner.manager, [], input, closedAt))
      .rejects.toMatchObject({ driverError: { code: '23505', constraint: 'UQ_policy_reviews_pending' } });
  });

  it('대기 조회는 지정한 원본의 PENDING만 반환한다', async () => {
    const input = await candidates(4);
    await service.saveReviewChanges(runner.manager, [], input, closedAt);
    const before = await reviews();
    await finish(before[0].id, 'APPROVED');
    await finish(before[1].id, 'REJECTED');
    const expected = before.slice(2);
    const query = jest.spyOn(runner, 'query');
    expect(await repository.findPendingReviews(runner.manager,
      [...before.map(({ sourcePolicyId }) => sourcePolicyId), before[0].sourcePolicyId, randomUUID()])).toEqual(expected);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).not.toContain('FOR UPDATE');
  });

  it('거절 해시는 원본별로 구분하고 반복된 거절 이력의 같은 해시는 한 번만 반환한다', async () => {
    const input = await candidates(2);
    await service.saveReviewChanges(runner.manager, [], input, closedAt);
    const first = await reviews();
    await finish(first[0].id, 'REJECTED');
    await finish(first[1].id, 'APPROVED');
    const rejectedInput = input.find(({ sourcePolicy }) => sourcePolicy.id === first[0].sourcePolicyId)!;
    await service.saveReviewChanges(runner.manager, [], [rejectedInput], closedAt);
    const repeated = (await repository.findPendingReviews(runner.manager, [first[0].sourcePolicyId]))[0];
    await finish(repeated.id, 'REJECTED');
    await service.saveReviewChanges(runner.manager, [], [rejectedInput], closedAt);
    const query = jest.spyOn(runner, 'query');
    expect(await repository.findRejectedHashes(runner.manager, first.map(({ sourcePolicyId }) => sourcePolicyId)))
      .toEqual([{ sourcePolicyId: first[0].sourcePolicyId, contentHash: first[0].contentHash }]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).not.toContain('raw_snapshot');
    expect(await repository.findRejectedHashes(runner.manager, [first[1].sourcePolicyId, randomUUID()])).toEqual([]);
  });

  it('401개 원본의 후보 저장과 대기 조회를 각각 세 묶음으로 처리한다', async () => {
    const input = await candidates(401);
    const before = structuredClone(input);
    const query = jest.spyOn(runner, 'query');
    await service.saveReviewChanges(runner.manager, [], input, closedAt);
    expect(query.mock.calls.filter(([sql]) => sql.startsWith('INSERT'))).toHaveLength(3);
    const saved = await reviews();
    expect(saved).toHaveLength(401);
    expect(input).toEqual(before);
    query.mockClear();
    expect(await repository.findPendingReviews(runner.manager, input.map(({ sourcePolicy }) => sourcePolicy.id))).toHaveLength(401);
    expect(query).toHaveBeenCalledTimes(3);
    query.mockClear();
    await service.saveReviewChanges(runner.manager, saved.map(({ id }) => ({ id, reason: 'SOURCE_CHANGED' })), [], closedAt);
    expect(query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE'))).toHaveLength(3);
    query.mockClear();
    expect(await repository.findRejectedHashes(runner.manager, input.map(({ sourcePolicy }) => sourcePolicy.id))).toEqual([]);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it.each(['source', 'externalId'] as const)('공개 기준본의 %s가 원본과 다르면 저장 전에 거부한다', async (field) => {
    const candidate = await withBase((await candidates())[0]);
    candidate.basePolicy![field] = 'different';
    const query = jest.spyOn(runner, 'query');
    await expect(service.saveReviewChanges(runner.manager, [], [candidate], closedAt)).rejects.toThrow('출처 또는 외부 ID');
    expect(query).not.toHaveBeenCalled();
  });

  it.each(['sourcePolicy', 'basePolicy'] as const)('%s의 해시가 원문과 다르면 기존 대기도 변경하지 않는다', async (target) => {
    const candidate = await withBase((await candidates())[0]);
    await service.saveReviewChanges(runner.manager, [], [candidate], closedAt);
    const [before] = await reviews();
    candidate[target]!.contentHash = 'a'.repeat(64);
    const query = jest.spyOn(runner, 'query');
    await expect(service.saveReviewChanges(runner.manager,
      [{ id: before.id, reason: 'SOURCE_CHANGED' }], [candidate], closedAt)).rejects.toThrow('내용과 해시');
    expect(query).not.toHaveBeenCalled();
    expect(await reviews()).toEqual([before]);
  });

  it.each([null, [], { plcyNm: '식별자 없음' }])('잘못된 원본 객체 %j를 저장 전에 거부한다', async (invalid) => {
    const [candidate] = await candidates();
    candidate.sourcePolicy.rawJson = invalid as unknown as SourcePolicy['rawJson'];
    await expect(service.saveReviewChanges(runner.manager, [], [candidate], closedAt)).rejects.toThrow('원본 정책 객체');
    expect(await reviews()).toEqual([]);
  });

  it('중복 후보 생성과 중복 대체 ID를 쓰기 전에 거부한다', async () => {
    const [candidate] = await candidates();
    const query = jest.spyOn(runner, 'query');
    await expect(service.saveReviewChanges(runner.manager, [], [candidate, candidate], closedAt)).rejects.toThrow('원본 ID가 중복');
    const item = { id: randomUUID(), reason: 'SOURCE_CHANGED' as const };
    await expect(service.saveReviewChanges(runner.manager, [item, item], [], closedAt)).rejects.toThrow('ID가 중복');
    expect(query).not.toHaveBeenCalled();
  });

  it.each(['APPROVED', 'REJECTED', 'SUPERSEDED'] as const)('이미 %s인 과거 이력은 다시 대체하지 않는다', async (status) => {
    const input = await candidates();
    await service.saveReviewChanges(runner.manager, [], input, closedAt);
    const [first] = await reviews();
    await finish(first.id, status);
    const [before] = await reviews();
    await expect(service.saveReviewChanges(runner.manager,
      [{ id: before.id, reason: 'PUBLIC_BASE_CHANGED' }], [], closedAt)).rejects.toThrow('이미 종료');
    expect(await reviews()).toEqual([before]);
  });

  it('없는 대기 후보의 대체 요청은 새 후보를 생성하기 전에 거부한다', async () => {
    const input = await candidates();
    await expect(service.saveReviewChanges(runner.manager,
      [{ id: randomUUID(), reason: 'SOURCE_CHANGED' }], input, closedAt)).rejects.toThrow('후보가 없거나');
    expect(await reviews()).toEqual([]);
  });

  it('후반 묶음의 FK 오류가 나면 기존 대기 대체와 앞 묶음 삽입을 함께 취소한다', async () => {
    const input = await candidates(201);
    await service.saveReviewChanges(runner.manager, [], input, closedAt);
    await runner.commitTransaction();
    const before = await connection.getRepository(PolicyReview).find({ order: { sourcePolicyId: 'ASC', id: 'ASC' } });
    await runner.startTransaction('READ COMMITTED');
    await sources.findBySourceForUpdate(runner.manager, 'youthcenter');
    const next = structuredClone(input);
    next[200].sourcePolicy.id = randomUUID();
    const query = jest.spyOn(runner, 'query');
    await expect(service.saveReviewChanges(runner.manager,
      before.map(({ id }) => ({ id, reason: 'SOURCE_CHANGED' })), next, closedAt))
      .rejects.toMatchObject({ driverError: { code: '23503' } });
    expect(query.mock.calls.filter(([sql]) => sql.startsWith('INSERT'))).toHaveLength(2);
    await runner.rollbackTransaction();
    expect(await connection.getRepository(PolicyReview).find({ order: { sourcePolicyId: 'ASC', id: 'ASC' } })).toEqual(before);
    // 다음 사례를 위해 이 테스트에서 확정한 전용 스키마의 행을 FK 순서로 정리
    await connection.getRepository(PolicyReview).deleteAll();
    await connection.getRepository(SourcePolicy).deleteAll();
  });

  it('같은 B는 기존 대기를 유지하고 C를 거쳐 B로 복귀하면 과거 B와 다른 최신 후보를 생성한다', async () => {
    const candidate = await withBase((await candidates())[0]);
    const { id, externalId } = candidate.sourcePolicy;
    await applyDecision(id);
    const [firstB] = await reviews();
    await observe(externalId, '검수할 정책', '99');
    expect(await applyDecision(id, 'UNCHANGED')).toEqual({ action: 'KEEP', pendingReviewId: firstB.id });
    expect(await reviews()).toEqual([firstB]);

    await observe(externalId, '변경 C');
    await applyDecision(id);
    const closedB = (await reviews()).find((row) => row.id === firstB.id)!;
    expect(closedB).toEqual({ ...firstB, status: 'SUPERSEDED', supersededReason: 'SOURCE_CHANGED', closedAt });
    await observe(externalId, '검수할 정책');
    await applyDecision(id);
    const [latestB] = await repository.findPendingReviews(runner.manager, [id]);
    expect(latestB.id).not.toBe(firstB.id);
    expect(latestB.contentHash).toBe(firstB.contentHash);
    expect((await reviews()).find((row) => row.id === firstB.id)).toEqual(closedB);
    expect(await reviews()).toHaveLength(3);
  });

  it('거절 B는 반복과 공개 기준 변경 후에도 후보를 만들지 않고 새 C만 검수 대상으로 삼는다', async () => {
    const candidate = await withBase((await candidates())[0]);
    const { id, externalId } = candidate.sourcePolicy;
    await applyDecision(id);
    const [firstB] = await reviews();
    await finish(firstB.id, 'REJECTED');
    const [rejectedB] = await reviews();
    expect(await applyDecision(id, 'UNCHANGED')).toEqual({ action: 'SKIP', superseded: null });

    await observe(externalId, '변경 C');
    expect((await applyDecision(id)).action).toBe('CREATE');
    const [pendingC] = await repository.findPendingReviews(runner.manager, [id]);
    // 공개 기준 변경 방어 경로를 테스트 스키마의 공개 행 변경으로 재현
    const publicRaw = raw(externalId, '공개 기준 D');
    await new PolicyRepository().upsertPolicies(runner.manager, [{ ...transformYouthCenterPolicy(publicRaw),
      contentHash: createYouthCenterPolicyContentHash(publicRaw) }]);
    await observe(externalId, '검수할 정책');
    expect(await applyDecision(id)).toEqual({ action: 'SKIP',
      superseded: { id: pendingC.id, reason: 'PREVIOUSLY_REJECTED' } });
    expect(await repository.findPendingReviews(runner.manager, [id])).toEqual([]);
    expect((await reviews()).find((row) => row.id === firstB.id)).toEqual(rejectedB);
  });

  it('과거 승인 A가 현재 공개 B와 다른 내용으로 돌아오면 승인 이력을 보존하며 새 후보를 생성한다', async () => {
    const candidate = await withBase((await candidates())[0]);
    const { id, externalId } = candidate.sourcePolicy;
    await applyDecision(id);
    const [pendingA] = await reviews();
    const approvedRaw = raw(externalId);
    await new PolicyRepository().saveApprovedPolicy(runner.manager, { ...transformYouthCenterPolicy(approvedRaw),
      contentHash: createYouthCenterPolicyContentHash(approvedRaw) }, candidate.basePolicy!.id);
    await finish(pendingA.id, 'APPROVED');
    const [approvedA] = await reviews();
    const publicRaw = raw(externalId, '현재 공개 B');
    await new PolicyRepository().upsertPolicies(runner.manager, [{ ...transformYouthCenterPolicy(publicRaw),
      contentHash: createYouthCenterPolicyContentHash(publicRaw) }]);
    expect(await applyDecision(id, 'UNCHANGED')).toEqual({ action: 'CREATE', kind: 'CHANGED', superseded: null });
    const [latest] = await repository.findPendingReviews(runner.manager, [id]);
    expect(latest.contentHash).toBe(approvedA.contentHash);
    expect(latest.baseRawSnapshot).toEqual(publicRaw);
    expect(latest.id).not.toBe(approvedA.id);
    expect((await reviews()).find((row) => row.id === approvedA.id)).toEqual(approvedA);
  });

  it('원본 B는 그대로여도 공개 기준 변경 뒤에는 현재 기준 스냅샷으로 대기를 교체한다', async () => {
    const candidate = await withBase((await candidates())[0]);
    const { id, externalId } = candidate.sourcePolicy;
    await applyDecision(id);
    const [before] = await reviews();
    const publicRaw = raw(externalId, '바뀐 공개 기준 C');
    await new PolicyRepository().upsertPolicies(runner.manager, [{ ...transformYouthCenterPolicy(publicRaw),
      contentHash: createYouthCenterPolicyContentHash(publicRaw) }]);
    expect(await applyDecision(id, 'UNCHANGED')).toEqual({ action: 'CREATE', kind: 'CHANGED',
      superseded: { id: before.id, reason: 'PUBLIC_BASE_CHANGED' } });
    const [latest] = await repository.findPendingReviews(runner.manager, [id]);
    expect(latest.contentHash).toBe(before.contentHash);
    expect(latest.baseRawSnapshot).toEqual(publicRaw);
    expect(latest.baseContentHash).toBe(createYouthCenterPolicyContentHash(publicRaw));
    expect((await reviews()).find((row) => row.id === before.id)).toEqual({
      ...before, status: 'SUPERSEDED', supersededReason: 'PUBLIC_BASE_CHANGED', closedAt,
    });
  });

  it('자동 확정 연결에서는 후보 조회와 저장을 거부한다', async () => {
    await expect(repository.findPendingReviews(connection.manager, [])).rejects.toThrow('트랜잭션 관리자');
    await expect(repository.findRejectedHashes(connection.manager, [])).rejects.toThrow('트랜잭션 관리자');
    await expect(service.saveReviewChanges(connection.manager, [], [], closedAt)).rejects.toThrow('트랜잭션 관리자');
  });
});
