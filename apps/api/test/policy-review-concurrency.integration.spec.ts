import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { DataSource, QueryRunner } from 'typeorm';
import type { ReviewActionRequest } from '@youth-kkultong/shared';
import { loadEnvironment } from '../src/common/environment';
import { createDataSource } from '../src/database/data-source';
import { createYouthCenterPolicyContentHash } from '../src/modules/ingestion/youth-center/youth-center-policy.hash';
import { transformYouthCenterPolicy } from '../src/modules/ingestion/youth-center/youth-center-policy.transform';
import type { YouthCenterRawPolicy } from '../src/modules/ingestion/youth-center/youth-center-response.schema';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { PolicyReview } from '../src/modules/policies/entities/policy-review.entity';
import { SourcePolicy } from '../src/modules/policies/entities/source-policy.entity';
import { PolicyRepository } from '../src/modules/policies/repositories/policy.repository';
import { PolicyReviewRepository } from '../src/modules/policies/repositories/policy-review.repository';
import { PolicyReviewApprovalService } from '../src/modules/policies/services/reviews/policy-review-approval.service';
import { PolicyReviewRejectionService } from '../src/modules/policies/services/reviews/policy-review-rejection.service';
import { clearPolicyTables, createCollectionWriter, seedMigratedPolicies } from './helpers/policy-collection';

/** 같은 외부 ID의 본문과 조회수를 바꿔 수집 및 검수 경쟁 자료를 생성 */
function raw(title = '후보 B', inqCnt = '10'): YouthCenterRawPolicy {
  return { plcyNo: 'concurrent-review', plcyNm: title, inqCnt, plcyExplnCn: ` ${title}\n`,
    unknown: { nested: [null, ' 원문 '] } };
}

/** 두 검수 해시를 고정한 요청 또는 같은 원본에 대한 다음 수집 저장 */
type Action = { kind: 'approve' | 'reject'; review: PolicyReview }
  | { kind: 'collect'; value: YouthCenterRawPolicy };

/** 고정 시간 대기 대신 제한 시간 안에 실제 DB 상태가 관찰될 때까지 확인 */
async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error('제한 시간 안에 트랜잭션의 확정 대기 또는 실제 원본 잠금 대기를 확인하지 못했습니다.');
}

/** 서로 다른 PostgreSQL 연결의 검수 및 수집 경쟁과 종료 이력 보존을 검증 */
describe('동시 검수와 수집 저장의 원본 우선 잠금', () => {
  const schema = `mvp2_step27_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource;
  let observer: DataSource;
  const workers: DataSource[] = [];
  let schemaCreated = false;

  beforeAll(async () => {
    const environment = loadEnvironment();
    admin = createDataSource(environment).setOptions({ entities: [], migrations: [] });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    observer = createDataSource(environment).setOptions({ schema,
      extra: { options: `-c timezone=Asia/Seoul -c search_path=${schema}` } });
    await observer.initialize();
    await observer.runMigrations();
    // 요청마다 별도 풀을 사용하고 DB의 제한 시간으로 잠금 실패 시에도 연결을 정리
    for (let index = 0; index < 2; index += 1) {
      const worker = createDataSource(environment).setOptions({ schema,
        extra: { max: 1, options: `-c timezone=Asia/Seoul -c search_path=${schema} -c lock_timeout=5000 -c statement_timeout=8000` } });
      workers.push(worker);
      await worker.initialize();
    }
  });

  beforeEach(async () => clearPolicyTables(observer));
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    try {
      await Promise.all(workers.filter((worker) => worker.isInitialized).map((worker) => worker.destroy()));
    } finally {
      try { if (observer?.isInitialized) await observer.destroy(); } finally {
        try { if (schemaCreated && admin?.isInitialized) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
        finally { if (admin?.isInitialized) await admin.destroy(); }
      }
    }
  });

  /** 화면에서 확인한 후보의 변경본과 공개 기준본 해시를 추출 */
  function request(review: PolicyReview): ReviewActionRequest {
    return { contentHash: review.contentHash, baseContentHash: review.baseContentHash };
  }

  /** 기존 수집 서비스를 사용해 전달한 원문 한 건의 전체 수집을 저장 */
  async function collect(value: YouthCenterRawPolicy, runner?: QueryRunner) {
    const active = runner ?? observer.createQueryRunner();
    try {
      return await createCollectionWriter(loadEnvironment()).saveCollection(active, 'youthcenter', [{
        ...transformYouthCenterPolicy(value), contentHash: createYouthCenterPolicyContentHash(value),
      }], new Date());
    } finally {
      if (!runner) {
        try { if (active.isTransactionActive) await active.rollbackTransaction(); }
        finally { await active.release(); }
      }
    }
  }

  /** 신규 또는 변경 후보를 실제 수집 저장 경로로 준비 */
  async function seed(kind: 'NEW' | 'CHANGED') {
    if (kind === 'CHANGED') await seedMigratedPolicies(observer, [raw('공개 A')]);
    await collect(raw());
    return observer.getRepository(PolicyReview).findOneByOrFail({ status: 'PENDING' });
  }

  /** 다른 연결에서 확정된 원본과 후보 및 공개 행 전체를 정렬 조회 */
  async function state() {
    return {
      sources: await observer.getRepository(SourcePolicy).find({ order: { id: 'ASC' } }),
      reviews: await observer.getRepository(PolicyReview).find({ order: { id: 'ASC' } }),
      policies: await observer.getRepository(Policy).find({ order: { id: 'ASC' } }),
    };
  }

  /** 지정한 요청을 실행. 검수 서비스에는 미리 확보한 독립 연결을 전달 */
  function execute(action: Action, index: number, runner: QueryRunner) {
    if (action.kind === 'collect') return collect(action.value, runner);
    const worker = workers[index];
    const reviews = new PolicyReviewRepository(loadEnvironment());
    jest.spyOn(worker, 'createQueryRunner').mockReturnValueOnce(runner);
    if (action.kind === 'approve') {
      return new PolicyReviewApprovalService(worker, reviews, new PolicyRepository())
        .approve(action.review.id, request(action.review), `reviewer-${index}`);
    }
    return new PolicyReviewRejectionService(worker, reviews)
      .reject(action.review.id, { ...request(action.review), reason: '검수 거절 사유' }, `reviewer-${index}`);
  }

  /** 첫 요청의 COMMIT 직전에 두 번째 요청이 원본 행에서 실제로 막히는 경쟁을 재현 */
  async function compete(first: Action, second: Action) {
    const runners: QueryRunner[] = [];
    const statements: string[][] = [[], []];
    const pending: Promise<PromiseSettledResult<unknown>>[] = [];
    let openCommit!: () => void;
    const commitGate = new Promise<void>((resolve) => { openCommit = resolve; });
    let commitReached = false;
    const before = await state();
    try {
      const pids: number[] = [];
      for (let index = 0; index < workers.length; index += 1) {
        const runner = workers[index].createQueryRunner();
        runners.push(runner);
        await runner.connect();
        pids.push((await runner.query('SELECT pg_backend_pid() AS pid'))[0].pid);
        const query = runner.query.bind(runner);
        jest.spyOn(runner, 'query').mockImplementation((...args: Parameters<QueryRunner['query']>) => {
          statements[index].push(args[0]);
          return query(...args);
        });
      }
      expect(pids[0]).not.toBe(pids[1]);

      // 실제 쓰기와 잠금은 그대로 실행하고 첫 요청의 확정 시점만 제어
      const commit = runners[0].commitTransaction.bind(runners[0]);
      jest.spyOn(runners[0], 'commitTransaction').mockImplementationOnce(async () => {
        commitReached = true;
        await commitGate;
        await commit();
      });
      pending.push(Promise.allSettled([execute(first, 0, runners[0])]).then(([result]) => result));
      await waitUntil(async () => commitReached);
      pending.push(Promise.allSettled([execute(second, 1, runners[1])]).then(([result]) => result));

      // 짧게 기다린 뒤 성공했다고 추측하지 않고 DB의 대기 연결과 차단 연결을 직접 확인
      await waitUntil(async () => {
        const [activity] = await observer.query(`SELECT query, wait_event_type,
          $1::int = ANY(pg_blocking_pids(pid)) AS blocked_by_first
          FROM pg_stat_activity WHERE pid = $2`, pids);
        return activity?.blocked_by_first === true && activity.wait_event_type === 'Lock'
          && activity.query.includes('source_policies') && activity.query.includes('FOR UPDATE');
      });
      const waitingLocks = statements[1].filter((sql) => sql.includes('FOR UPDATE'));
      expect(waitingLocks).toHaveLength(1);
      expect(waitingLocks[0]).toContain('"source_policies"');
      // 확정 전에는 일반 조회가 잠금에 막히지 않고 이전 공개본과 이력을 계속 제공
      expect(await state()).toEqual(before);

      openCommit();
      const results = await Promise.all(pending);
      expect(results[0].status).toBe('fulfilled');
      for (const sql of statements) {
        expect(sql).toContain('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
        const locks = sql.filter((query) => query.includes('FOR UPDATE'));
        expect(locks[0]).toContain('"source_policies"');
      }
      // 검수 요청은 원본 이후 후보와 현재 공개본을 차례로 다시 읽고 잠금
      for (const [index, action] of [first, second].entries()) {
        if (action.kind === 'collect') continue;
        const locks = statements[index].filter((sql) => sql.includes('FOR UPDATE'));
        expect(locks).toHaveLength(3);
        expect(locks[1]).toContain('"policy_reviews"');
        expect(locks[2]).toContain('"policies"');
        expect(runners[index].isReleased).toBe(true);
      }
      expect(statements[0].at(-1)).toBe('COMMIT');
      expect(statements[1].at(-1)).toBe(results[1].status === 'fulfilled' ? 'COMMIT' : 'ROLLBACK');
      return results;
    } finally {
      // 중간 검증이 실패해도 첫 확정을 풀고 두 요청이 끝난 뒤 모든 연결을 반환
      openCommit();
      await Promise.all(pending);
      for (const runner of runners) {
        try { if (runner.isTransactionActive) await runner.rollbackTransaction(); }
        finally { if (!runner.isReleased) await runner.release(); }
      }
    }
  }

  /** 종료된 후보로 두 처리 요청을 다시 보내도 행 전체가 그대로인지 확인 */
  async function expectClosedRetries(review: PolicyReview) {
    const before = await state();
    const reviews = new PolicyReviewRepository(loadEnvironment());
    await expect(new PolicyReviewApprovalService(observer, reviews, new PolicyRepository())
      .approve(review.id, request(review), 'retry-reviewer'))
      .rejects.toMatchObject({ status: 409, response: { code: 'REVIEW_NOT_PENDING' } });
    await expect(new PolicyReviewRejectionService(observer, reviews)
      .reject(review.id, { ...request(review), reason: '재요청 사유' }, 'retry-reviewer'))
      .rejects.toMatchObject({ status: 409, response: { code: 'REVIEW_NOT_PENDING' } });
    expect(await state()).toEqual(before);
  }

  describe.each(['NEW', 'CHANGED'] as const)('%s 후보', (kind) => {
    it.each([
      ['approve', 'approve'], ['approve', 'reject'], ['reject', 'approve'],
    ] as const)('%s 확정이 앞선 동시 %s 요청은 409로 끝나고 이력을 보존한다', async (first, second) => {
      const review = await seed(kind);
      const before = await state();
      const results = await compete({ kind: first, review }, { kind: second, review });
      expect(results[1]).toMatchObject({ status: 'rejected', reason: {
        status: 409, response: { code: 'REVIEW_NOT_PENDING' },
      } });
      const after = await state();
      expect(after.sources).toEqual(before.sources);
      expect(after.reviews).toEqual([{ ...review,
        status: first === 'approve' ? 'APPROVED' : 'REJECTED', reviewedBy: 'reviewer-0', closedAt: expect.any(Date),
        rejectionReason: first === 'reject' ? '검수 거절 사유' : null,
      }]);
      if (first === 'approve') {
        expect(after.policies).toHaveLength(1);
        expect(after.policies[0]).toMatchObject({ title: raw().plcyNm, contentHash: review.contentHash,
          rawJson: review.rawSnapshot, viewCount: 10 });
        if (kind === 'CHANGED') expect(after.policies[0].id).toBe(before.policies[0].id);
      } else expect(after.policies).toEqual(before.policies);

      await expectClosedRetries(review);
      const closed = (await state()).reviews;
      await collect(raw(undefined, '99'));
      expect((await state()).reviews).toEqual(closed);
      expect((await state()).policies).toHaveLength(first === 'approve' || kind === 'CHANGED' ? 1 : 0);
    });

    it.each(['동일 본문', '새 본문'] as const)('수집의 %s 저장이 먼저 확정되면 승인은 최신 상태를 다시 확인한다', async (scenario) => {
      const review = await seed(kind);
      const value = raw(scenario === '동일 본문' ? undefined : '최신 C', '99');
      const results = await compete({ kind: 'collect', value }, { kind: 'approve', review });
      const after = await state();
      expect(after.sources[0]).toMatchObject({ title: value.plcyNm, viewCount: 99,
        contentHash: createYouthCenterPolicyContentHash(value), rawJson: value });
      if (scenario === '동일 본문') {
        expect(results[1]).toMatchObject({ status: 'fulfilled', value: { status: 'APPROVED' } });
        expect(after.reviews).toHaveLength(1);
        expect(after.policies[0]).toMatchObject({ contentHash: review.contentHash, viewCount: 99, rawJson: review.rawSnapshot });
      } else {
        expect(results[1]).toMatchObject({ status: 'rejected', reason: {
          status: 409, response: { code: 'REVIEW_NOT_PENDING' },
        } });
        expect(after.reviews).toHaveLength(2);
        expect(after.reviews.find(({ id }) => id === review.id)).toEqual({ ...review,
          status: 'SUPERSEDED', supersededReason: 'SOURCE_CHANGED', closedAt: expect.any(Date) });
        expect(after.reviews.filter(({ status }) => status === 'PENDING')).toEqual([expect.objectContaining({
          contentHash: createYouthCenterPolicyContentHash(value), rawSnapshot: value,
          basePolicyId: review.basePolicyId, baseContentHash: review.baseContentHash,
        })]);
        expect(after.policies).toHaveLength(kind === 'CHANGED' ? 1 : 0);
        if (kind === 'CHANGED') expect(after.policies[0]).toMatchObject({ title: '공개 A', id: review.basePolicyId, viewCount: 99 });
        await expectClosedRetries(review);
      }
    });

    it.each(['동일 본문', '새 본문'] as const)('승인이 먼저 확정되면 후속 %s 수집이 승인 결과를 기준으로 후보를 조정한다', async (scenario) => {
      const review = await seed(kind);
      const value = raw(scenario === '동일 본문' ? undefined : '최신 C', '99');
      const results = await compete({ kind: 'approve', review }, { kind: 'collect', value });
      expect(results[1]).toMatchObject({ status: 'fulfilled', value: {
        counts: { UNCHANGED: scenario === '동일 본문' ? 1 : 0, CHANGED: scenario === '새 본문' ? 1 : 0 },
        reviewCreatedCount: scenario === '새 본문' ? 1 : 0, reviewSupersededCount: 0,
      } });
      const after = await state();
      expect(after.sources[0]).toMatchObject({ rawJson: value, viewCount: 99 });
      expect(after.policies).toHaveLength(1);
      expect(after.policies[0]).toMatchObject({ contentHash: review.contentHash, rawJson: review.rawSnapshot, viewCount: 99 });
      if (kind === 'CHANGED') expect(after.policies[0].id).toBe(review.basePolicyId);
      const closed = after.reviews.find(({ id }) => id === review.id)!;
      expect(closed).toMatchObject({ status: 'APPROVED', reviewedBy: 'reviewer-0' });
      const pendingReviews = after.reviews.filter(({ status }) => status === 'PENDING');
      expect(pendingReviews).toHaveLength(scenario === '새 본문' ? 1 : 0);
      if (scenario === '새 본문') expect(pendingReviews[0]).toMatchObject({ kind: 'CHANGED',
        basePolicyId: after.policies[0].id, baseContentHash: review.contentHash, baseRawSnapshot: review.rawSnapshot,
        contentHash: createYouthCenterPolicyContentHash(value), rawSnapshot: value });
      await expectClosedRetries(review);
      await collect(value);
      expect((await state()).reviews).toEqual(after.reviews);
    });
  });

  it.each(['공개 해시 변경', '같은 해시의 공개 UUID 변경', '신규 후보의 공개본 생성', '공개본이 원본과 일치'] as const)(
    '%s 방어 경로는 오래된 승인을 거부하고 다음 동일 수집에서 대기를 조정한다', async (scenario) => {
      const review = await seed(scenario === '신규 후보의 공개본 생성' ? 'NEW' : 'CHANGED');
      const policies = new PolicyRepository();
      // 운영 데이터와 분리된 스키마에서만 공개 기준의 직접 변경을 재현
      await observer.transaction(async (manager) => {
        if (scenario === '같은 해시의 공개 UUID 변경') {
          // 과거 기준 행은 외래키로 보존하고 같은 출처와 외부 ID에 새 UUID의 공개본을 구성
          await manager.query(`UPDATE "${schema}".policies SET external_id = $1 WHERE id = $2`, ['old-base', review.basePolicyId]);
          await policies.saveApprovedPolicy(manager, {
            ...transformYouthCenterPolicy(raw('공개 A')), contentHash: review.baseContentHash!,
          }, null);
        } else {
          const value = raw(scenario === '공개본이 원본과 일치' ? undefined : '변경된 공개 C');
          await policies.saveApprovedPolicy(manager, {
            ...transformYouthCenterPolicy(value), contentHash: createYouthCenterPolicyContentHash(value),
          }, review.basePolicyId);
        }
      });
      const before = await state();
      const currentPublic = before.policies.find(({ externalId }) => externalId === raw().plcyNo)!;
      if (scenario === '같은 해시의 공개 UUID 변경') {
        expect(currentPublic.id).not.toBe(review.basePolicyId);
        expect(currentPublic.contentHash).toBe(review.baseContentHash);
      }
      const service = new PolicyReviewApprovalService(observer, new PolicyReviewRepository(loadEnvironment()), policies);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await expect(service.approve(review.id, request(review), 'stale-reviewer'))
          .rejects.toMatchObject({ status: 409, response: { code: 'REVIEW_BASE_CONFLICT' } });
        expect(await state()).toEqual(before);
      }
      const matchesPublic = scenario === '공개본이 원본과 일치';
      expect(await collect(raw(undefined, '99'))).toMatchObject({ counts: { UNCHANGED: 1 },
        reviewSupersededCount: 1, reviewCreatedCount: matchesPublic ? 0 : 1 });
      const after = await state();
      expect(after.policies).toEqual(before.policies.map((policy) => policy.id === currentPublic.id
        ? { ...policy, viewCount: 99, updatedAt: expect.any(Date) } : policy));
      expect(after.reviews.find(({ id }) => id === review.id)).toEqual({ ...review, status: 'SUPERSEDED',
        supersededReason: matchesPublic ? 'MATCHES_PUBLIC' : 'PUBLIC_BASE_CHANGED', closedAt: expect.any(Date) });
      const pendingReviews = after.reviews.filter(({ status }) => status === 'PENDING');
      expect(pendingReviews).toHaveLength(matchesPublic ? 0 : 1);
      if (!matchesPublic) expect(pendingReviews[0]).toMatchObject({ kind: 'CHANGED',
        contentHash: review.contentHash, basePolicyId: currentPublic.id,
        baseContentHash: currentPublic.contentHash, baseRawSnapshot: currentPublic.rawJson });
      await expectClosedRetries(review);
      await collect(raw(undefined, '100'));
      expect((await state()).reviews).toEqual(after.reviews);
      if (!matchesPublic) {
        await service.approve(pendingReviews[0].id, request(pendingReviews[0]), 'fresh-reviewer');
        expect((await state()).policies.find(({ id }) => id === currentPublic.id)).toMatchObject({ id: currentPublic.id,
          contentHash: review.contentHash, viewCount: 100 });
      }
    },
  );
});
