import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import type { ReviewKind } from '@youth-kkultong/shared';
import { loadEnvironment } from '../src/common/environment';
import { createDataSource } from '../src/database/data-source';
import { createYouthCenterPolicyContentHash } from '../src/modules/ingestion/youth-center/youth-center-policy.hash';
import { transformYouthCenterPolicy } from '../src/modules/ingestion/youth-center/youth-center-policy.transform';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { PolicyReview } from '../src/modules/policies/entities/policy-review.entity';
import { SourcePolicy } from '../src/modules/policies/entities/source-policy.entity';
import { PolicyRepository } from '../src/modules/policies/repositories/policy.repository';
import { PolicyReviewRepository } from '../src/modules/policies/repositories/policy-review.repository';
import { PolicyReviewApprovalService } from '../src/modules/policies/services/reviews/policy-review-approval.service';
import { PolicyReviewRejectionService } from '../src/modules/policies/services/reviews/policy-review-rejection.service';
import { clearPolicyTables, createCollectionWriter, seedMigratedPolicies } from './helpers/policy-collection';

/** 검수 재시도의 전체 취소와 재확인을 실제 PostgreSQL에서 검증 */
describe.each(['approve', 'reject'] as const)('검수 %s의 DB 충돌 재시도', (action) => {
  const schema = `mvp2_step38_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource;
  let connection: DataSource;
  let reviews: PolicyReviewRepository;
  let approval: PolicyReviewApprovalService;
  let rejection: PolicyReviewRejectionService;
  let schemaCreated = false;

  beforeAll(async () => {
    const environment = loadEnvironment();
    admin = createDataSource(environment).setOptions({ entities: [], migrations: [] });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    connection = createDataSource(environment).setOptions({ schema,
      extra: { options: `-c timezone=Asia/Seoul -c search_path=${schema}` } });
    await connection.initialize();
    await connection.runMigrations();
    reviews = new PolicyReviewRepository(environment);
    approval = new PolicyReviewApprovalService(connection, reviews, new PolicyRepository());
    rejection = new PolicyReviewRejectionService(connection, reviews);
  });

  beforeEach(async () => clearPolicyTables(connection));
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    try { if (connection?.isInitialized) await connection.destroy(); }
    finally {
      try { if (schemaCreated && admin?.isInitialized) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
      finally { if (admin?.isInitialized) await admin.destroy(); }
    }
  });

  /** 실제 수집 저장으로 신규 또는 변경 대기를 생성 */
  async function seed(kind: ReviewKind = 'CHANGED') {
    const base = { plcyNo: 'retry-review', plcyNm: '기존 공개 내용', inqCnt: '10' };
    const raw = { ...base, plcyNm: '승인 또는 거절할 내용', inqCnt: '99' };
    if (kind === 'CHANGED') await seedMigratedPolicies(connection, [base]);
    const runner = connection.createQueryRunner();
    try {
      await createCollectionWriter(loadEnvironment()).saveCollection(runner, 'youthcenter', [{
        ...transformYouthCenterPolicy(raw), contentHash: createYouthCenterPolicyContentHash(raw),
      }], new Date());
    } finally { await runner.release(); }
    return connection.getRepository(PolicyReview).findOneByOrFail({ status: 'PENDING' });
  }

  /** 실제 서비스에 화면의 두 해시와 처리자를 전달 */
  function processReview(review: PolicyReview) {
    const request = { contentHash: review.contentHash, baseContentHash: review.baseContentHash };
    return action === 'approve'
      ? approval.approve(review.id, request, 'retry-reviewer')
      : rejection.reject(review.id, { ...request, reason: '재시도 검증 사유' }, 'retry-reviewer');
  }

  /** 확정된 전체 행을 별도 연결로 읽어 부분 저장이나 중복 처리 여부 확인 */
  async function state() {
    return {
      sources: await connection.getRepository(SourcePolicy).find({ order: { id: 'ASC' } }),
      reviews: await connection.getRepository(PolicyReview).find({ order: { id: 'ASC' } }),
      policies: await connection.getRepository(Policy).find({ order: { id: 'ASC' } }),
    };
  }

  /** 검수 기록 UPDATE 뒤 PostgreSQL 오류를 발생시켜 앞선 공개 저장까지 취소 */
  function failAfterWrite(code: '40P01' | '40001' | '23514', failures = 1) {
    let attempts = 0;
    const transactionIds: string[] = [];
    /** 실제 DB가 반환한 오류 코드로 트랜잭션을 중단하고 시도 횟수 기록 */
    async function fail(manager: EntityManager) {
      attempts += 1;
      transactionIds.push((await manager.query('SELECT txid_current()::text AS id'))[0].id);
      if (attempts <= failures) {
        // 오류 코드는 이 테스트의 고정 목록에서만 전달
        await manager.query(`DO $$ BEGIN RAISE EXCEPTION USING ERRCODE='${code}', MESSAGE='검증용 DB 충돌'; END $$`);
      }
    }
    if (action === 'approve') {
      const write = reviews.approvePendingReview.bind(reviews);
      jest.spyOn(reviews, 'approvePendingReview').mockImplementation(async (...args) => {
        await write(...args);
        await fail(args[0]);
      });
    } else {
      const write = reviews.rejectPendingReview.bind(reviews);
      jest.spyOn(reviews, 'rejectPendingReview').mockImplementation(async (...args) => {
        await write(...args);
        await fail(args[0]);
      });
    }
    return { attempts: () => attempts, transactionIds };
  }

  it.each([
    ['NEW', '40P01'], ['NEW', '40001'], ['CHANGED', '40P01'], ['CHANGED', '40001'],
  ] as const)('%s의 첫 %s는 전체 취소 후 새 트랜잭션에서 한 번만 확정한다', async (kind, code) => {
    const review = await seed(kind);
    const before = await state();
    const failure = failAfterWrite(code);
    const read = reviews.findReviewForUpdate.bind(reviews);
    let reads = 0;
    jest.spyOn(reviews, 'findReviewForUpdate').mockImplementation(async (...args) => {
      if (++reads === 2) expect(await state()).toEqual(before);
      return read(...args);
    });
    const result = await processReview(review);
    expect(failure.attempts()).toBe(2);
    expect(new Set(failure.transactionIds).size).toBe(2);
    expect(reads).toBe(2);
    const after = await state();
    expect(after.sources).toEqual(before.sources);
    expect(after.reviews).toHaveLength(1);
    expect(after.reviews[0]).toMatchObject({ id: review.id, status: action === 'approve' ? 'APPROVED' : 'REJECTED',
      reviewedBy: 'retry-reviewer', closedAt: new Date(result.closedAt) });
    if (action === 'approve') {
      expect(after.policies).toHaveLength(1);
      expect(after.policies[0]).toMatchObject({ id: result.policyId, title: '승인 또는 거절할 내용', viewCount: 99 });
      if (kind === 'CHANGED') expect(result.policyId).toBe(before.policies[0].id);
    } else expect(after.policies).toEqual(before.policies);
  });

  it.each(['40P01', '40001'] as const)('%s가 계속되면 두 번만 시도하고 전체 행을 보존한다', async (code) => {
    const review = await seed();
    const before = await state();
    const failure = failAfterWrite(code, 2);
    await expect(processReview(review)).rejects.toMatchObject({ driverError: { code } });
    expect(failure.attempts()).toBe(2);
    expect(await state()).toEqual(before);
  });

  it('재시도 전에 원본이 바뀌면 공통 검수를 다시 수행해 409로 중단한다', async () => {
    const review = await seed();
    const before = await state();
    const failure = failAfterWrite('40001');
    const read = reviews.findReviewForUpdate.bind(reviews);
    let reads = 0;
    jest.spyOn(reviews, 'findReviewForUpdate').mockImplementation(async (...args) => {
      if (++reads === 2) {
        expect(await state()).toEqual(before);
        const rawJson = { plcyNo: 'retry-review', plcyNm: '재시도 전 최신 원본', inqCnt: '100' };
        await connection.query(`UPDATE "${schema}".source_policies
          SET title=$1,raw_json=$2::jsonb,content_hash=$3,view_count=100 WHERE id=$4`,
        [rawJson.plcyNm, JSON.stringify(rawJson), createYouthCenterPolicyContentHash(rawJson), review.sourcePolicyId]);
      }
      return read(...args);
    });
    await expect(processReview(review)).rejects.toMatchObject({ status: 409 });
    expect(reads).toBe(2);
    expect(failure.attempts()).toBe(1);
    const after = await state();
    expect(after.policies).toEqual(before.policies);
    expect(after.reviews).toEqual(before.reviews);
    expect(after.sources[0].title).toBe('재시도 전 최신 원본');
  });

  it('CHECK 위반은 재시도하지 않고 공개 저장과 검수 기록을 취소한다', async () => {
    const review = await seed();
    const before = await state();
    const failure = failAfterWrite('23514');
    await expect(processReview(review)).rejects.toMatchObject({ driverError: { code: '23514' } });
    expect(failure.attempts()).toBe(1);
    expect(await state()).toEqual(before);
  });

  it('COMMIT 뒤 응답 유실은 확정 상태를 유지하고 자동 재시도하지 않는다', async () => {
    const review = await seed();
    const runner = connection.createQueryRunner();
    const commit = runner.commitTransaction.bind(runner);
    jest.spyOn(runner, 'commitTransaction').mockImplementationOnce(async () => {
      await commit();
      throw Object.assign(new Error('검증용 COMMIT 응답 유실'), { code: 'ECONNRESET' });
    });
    const create = jest.spyOn(connection, 'createQueryRunner').mockReturnValueOnce(runner);
    try {
      await expect(processReview(review)).rejects.toMatchObject({ code: 'ECONNRESET' });
      expect(create).toHaveBeenCalledTimes(1);
      expect(runner.isReleased).toBe(true);
    } finally { create.mockRestore(); }
    expect(await connection.getRepository(PolicyReview).findOneByOrFail({ id: review.id }))
      .toMatchObject({ status: action === 'approve' ? 'APPROVED' : 'REJECTED' });
  });
});
