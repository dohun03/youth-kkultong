import { randomUUID } from 'node:crypto';
import type { DataSource, QueryRunner } from 'typeorm';
import type { RejectReviewRequest, ReviewKind } from '@youth-kkultong/shared';
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

/** 원문과 미확인 필드를 보존할 수집 정책 생성 */
function raw(title = '거절할 변경 내용', inqCnt = '10'): YouthCenterRawPolicy {
  return { plcyNo: 'rejection-test', plcyNm: title, inqCnt,
    plcyExplnCn: ' 설명\n ', unknown: { nested: [null, false, ' 원문 '] } };
}

/** 실제 PostgreSQL에서 거절 이력의 원자성과 원본 및 공개 데이터 보존 검증 */
describe('검수 거절과 이력 저장 트랜잭션', () => {
  const schema = `mvp2_step25_${randomUUID().replaceAll('-', '')}`;
  const actor = 'review-admin';
  let admin: DataSource;
  let connection: DataSource;
  let reviews: PolicyReviewRepository;
  let service: PolicyReviewRejectionService;
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
    service = new PolicyReviewRejectionService(connection, reviews);
  });

  beforeEach(async () => clearPolicyTables(connection));
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    try { if (connection?.isInitialized) await connection.destroy(); } finally {
      try { if (schemaCreated && admin?.isInitialized) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
      finally { if (admin?.isInitialized) await admin.destroy(); }
    }
  });

  /** 기존 수집 저장 서비스로 원본과 후보 및 공개 조회수 확정 */
  async function collect(values: YouthCenterRawPolicy[]): Promise<void> {
    const runner = connection.createQueryRunner();
    try {
      await runner.connect();
      await createCollectionWriter(loadEnvironment()).saveCollection(runner, 'youthcenter', values.map((value) => ({
        ...transformYouthCenterPolicy(value), contentHash: createYouthCenterPolicyContentHash(value),
      })), new Date());
    } finally {
      try { if (runner.isTransactionActive) await runner.rollbackTransaction(); }
      finally { await runner.release(); }
    }
  }

  /** 신규 또는 변경 후보와 화면이 보낸 거절 요청 준비 */
  async function seed(kind: ReviewKind = 'NEW') {
    if (kind === 'CHANGED') await seedMigratedPolicies(connection, [raw('이전 공개 내용')]);
    await collect([raw()]);
    const review = await connection.getRepository(PolicyReview).findOneByOrFail({ status: 'PENDING' });
    const request: RejectReviewRequest = {
      contentHash: review.contentHash, baseContentHash: review.baseContentHash, reason: '지원 내용 확인 필요',
    };
    return { review, request };
  }

  /** 전체 행을 읽어 원문과 조회수, 시각, 과거 이력의 불변 여부 비교 */
  async function state() {
    return {
      sources: await connection.getRepository(SourcePolicy).find({ order: { id: 'ASC' } }),
      reviews: await connection.getRepository(PolicyReview).find({ order: { id: 'ASC' } }),
      policies: await connection.getRepository(Policy).find({ order: { id: 'ASC' } }),
    };
  }

  it.each(['NEW', 'CHANGED'] as const)('%s 거절은 후보 처리 정보만 저장하고 공개 UUID 또는 NULL을 반환한다', async (kind) => {
    const { review, request } = await seed(kind);
    await collect([raw(undefined, '99')]);
    const before = await state();
    const requestBefore = structuredClone(request);
    const result = await service.reject(review.id, request, actor);
    const after = await state();
    expect(result).toEqual({ id: review.id, status: 'REJECTED', policyId: before.policies[0]?.id ?? null,
      closedAt: after.reviews[0].closedAt!.toISOString() });
    expect(after.sources).toEqual(before.sources);
    expect(after.policies).toEqual(before.policies);
    expect(after.reviews).toEqual([{ ...review, status: 'REJECTED', reviewedBy: actor,
      rejectionReason: request.reason, closedAt: new Date(result.closedAt) }]);
    expect(request).toEqual(requestBefore);
  });

  it.each(['가', '가'.repeat(1000), '<script>텍스트</script>\n  둘째 줄'])(
    '사유의 앞뒤 공백만 제거하고 길이 경계와 내부 원문을 보존한다: %#', async (reason) => {
      const { review, request } = await seed();
      await service.reject(review.id, { ...request, reason: ` \t${reason}\n ` }, actor);
      expect((await state()).reviews[0].rejectionReason).toBe(reason);
    },
  );

  it.each([undefined, null, '', ' \t\n\u3000', '가'.repeat(1001), 1, ['사유'], { text: '사유' }])(
    '잘못된 사유는 400이며 DB 트랜잭션을 열지 않는다: %#', async (reason) => {
      const { review, request } = await seed();
      const before = await state();
      const create = jest.spyOn(connection, 'createQueryRunner');
      await expect(service.reject(review.id, { ...request, reason } as RejectReviewRequest, actor))
        .rejects.toMatchObject({ status: 400, message: '요청값이 올바르지 않습니다.' });
      expect(create).not.toHaveBeenCalled();
      expect(await state()).toEqual(before);
    },
  );

  it('거절 요청의 해시 형식과 추가 필드도 공용 입력 규칙으로 검증한다', async () => {
    const { review, request } = await seed();
    const before = await state();
    for (const invalid of [
      { ...request, contentHash: 'A'.repeat(64) },
      { contentHash: request.contentHash, reason: request.reason },
      { ...request, status: 'REJECTED' },
    ]) {
      await expect(service.reject(review.id, invalid as RejectReviewRequest, actor)).rejects.toMatchObject({ status: 400 });
    }
    expect(await state()).toEqual(before);
  });

  it('누락 상태여도 마지막 정상 원본과 기준이 일치하면 거절할 수 있다', async () => {
    const { review, request } = await seed('CHANGED');
    await collect([]);
    const before = await state();
    expect(before.sources[0].missingCount).toBe(1);
    await service.reject(review.id, request, actor);
    const after = await state();
    expect(after.sources).toEqual(before.sources);
    expect(after.policies).toEqual(before.policies);
    expect(after.reviews[0].status).toBe('REJECTED');
  });

  it('없는 후보는 404이며 전체 행을 보존한다', async () => {
    const { request } = await seed();
    const before = await state();
    await expect(service.reject(randomUUID(), request, actor)).rejects.toMatchObject({
      status: 404, response: { code: 'REVIEW_NOT_FOUND' },
    });
    expect(await state()).toEqual(before);
  });

  it.each(['화면 변경본', '화면 기준본', '최신 원본', '공개 기준 해시', '공개 UUID', '신규 공개본'] as const)(
    '%s 충돌은 409이며 이력과 원본 및 공개본을 변경하지 않는다', async (scenario) => {
      const { review, request } = await seed(scenario === '신규 공개본' ? 'NEW' : 'CHANGED');
      if (scenario === '화면 변경본') request.contentHash = '0'.repeat(64);
      if (scenario === '화면 기준본') request.baseContentHash = null;
      if (scenario === '최신 원본') await connection.getRepository(SourcePolicy).update(review.sourcePolicyId, { contentHash: '0'.repeat(64) });
      // 공개 기준 충돌의 방어 경로는 테스트 스키마의 공개 행 변경으로만 재현
      if (scenario === '공개 기준 해시') await connection.getRepository(Policy).update(review.basePolicyId!, { contentHash: '0'.repeat(64) });
      if (scenario === '공개 UUID') {
        // 과거 기준 행을 남기되 식별자를 옮겨 FK를 보존하고 같은 해시의 다른 공개 UUID 생성
        await connection.query(`UPDATE "${schema}".policies SET external_id = $1 WHERE id = $2`, ['old-base', review.basePolicyId]);
      }
      if (scenario === '신규 공개본' || scenario === '공개 UUID') {
        const base = raw('이전 공개 내용');
        await new PolicyRepository().upsertPolicies(connection.manager, [{
          ...transformYouthCenterPolicy(base), contentHash: createYouthCenterPolicyContentHash(base),
        }]);
      }
      const before = await state();
      await expect(service.reject(review.id, request, actor)).rejects.toMatchObject({ status: 409, response: {
        code: scenario === '화면 변경본' || scenario === '최신 원본' ? 'REVIEW_CONTENT_CONFLICT' : 'REVIEW_BASE_CONFLICT',
      } });
      expect(await state()).toEqual(before);
    },
  );

  it.each(['APPROVED', 'REJECTED', 'SUPERSEDED'] as const)('종료된 %s 후보의 재처리는 409이며 이력을 보존한다', async (status) => {
    const { review, request } = await seed();
    if (status === 'APPROVED') {
      await new PolicyReviewApprovalService(connection, reviews, new PolicyRepository()).approve(review.id, {
        contentHash: request.contentHash, baseContentHash: request.baseContentHash,
      }, actor);
    } else if (status === 'REJECTED') await service.reject(review.id, request, actor);
    else await collect([raw('새로운 변경 내용')]);
    const before = await state();
    await expect(service.reject(review.id, { ...request, reason: '이력을 덮어쓸 사유' }, 'another-admin'))
      .rejects.toMatchObject({ status: 409, response: { code: 'REVIEW_NOT_PENDING' } });
    expect(await state()).toEqual(before);
  });

  it.each(['NEW', 'CHANGED'] as const)('%s 거절본을 반복 수집하거나 다른 내용 뒤 재수집해도 거절 이력을 유지한다', async (kind) => {
    const { review, request } = await seed(kind);
    await service.reject(review.id, request, actor);
    const rejected = await connection.getRepository(PolicyReview).findOneByOrFail({ id: review.id });
    await collect([raw(undefined, '99')]);
    expect(await reviews.findReviewList(connection.manager, { status: 'PENDING' })).toEqual({ rows: [], total: 0 });
    await collect([raw('다른 변경 내용')]);
    await collect([raw(undefined, '100')]);
    expect(await reviews.findReviewList(connection.manager, { status: 'PENDING' })).toEqual({ rows: [], total: 0 });
    expect(await connection.getRepository(PolicyReview).findOneByOrFail({ id: review.id })).toEqual(rejected);
  });

  it('거절 기록의 DB 제약 실패는 전체 취소하며 같은 후보를 다시 처리할 수 있다', async () => {
    const { review, request } = await seed('CHANGED');
    const before = await state();
    await connection.query(`ALTER TABLE "${schema}".policy_reviews ADD CONSTRAINT test_rejection_failure CHECK (status <> 'REJECTED')`);
    try {
      await expect(service.reject(review.id, request, actor)).rejects.toMatchObject({ driverError: { code: '23514' } });
      expect(await state()).toEqual(before);
    } finally {
      await connection.query(`ALTER TABLE "${schema}".policy_reviews DROP CONSTRAINT test_rejection_failure`);
    }
    expect(await service.reject(review.id, request, actor)).toMatchObject({ status: 'REJECTED' });
  });

  it('거절 UPDATE 직후의 오류도 상태와 처리 정보를 모두 롤백한다', async () => {
    const { review, request } = await seed();
    const before = await state();
    const reject = reviews.rejectPendingReview.bind(reviews);
    jest.spyOn(reviews, 'rejectPendingReview').mockImplementationOnce(async (...args) => {
      await reject(...args);
      expect(await args[0].getRepository(PolicyReview).findOneByOrFail({ id: review.id })).toMatchObject({ status: 'REJECTED' });
      throw new Error('검증용 처리 중단');
    });
    await expect(service.reject(review.id, request, actor)).rejects.toThrow('검증용 처리 중단');
    expect(await state()).toEqual(before);
  });

  it('READ COMMITTED에서 원본, 후보, 공개본 순서로 잠그고 후보만 갱신한 뒤 연결을 반환한다', async () => {
    const { review, request } = await seed('CHANGED');
    const create = connection.createQueryRunner.bind(connection);
    let rejectionRunner: QueryRunner | undefined;
    const statements: string[] = [];
    jest.spyOn(connection, 'createQueryRunner').mockImplementationOnce((mode) => {
      rejectionRunner = create(mode);
      const query = rejectionRunner.query.bind(rejectionRunner);
      jest.spyOn(rejectionRunner, 'query').mockImplementation((...args: Parameters<QueryRunner['query']>) => {
        statements.push(args[0]);
        return query(...args);
      });
      return rejectionRunner;
    });
    await service.reject(review.id, request, actor);
    expect(statements).toContain('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    const locks = statements.filter((sql) => sql.includes('FOR UPDATE'));
    expect(locks).toHaveLength(3);
    expect(locks[0]).toContain('"source_policies"');
    expect(locks[1]).toContain('"policy_reviews"');
    expect(locks[2]).toContain('"policies"');
    const writes = statements.filter((sql) => /^(UPDATE|INSERT|DELETE)/.test(sql));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('"policy_reviews"');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(rejectionRunner?.isReleased).toBe(true);
  });

  it('트랜잭션 밖의 거절 기록을 거부하고 종료 후보의 직접 재처리도 차단한다', async () => {
    const { review, request } = await seed();
    await expect(reviews.rejectPendingReview(connection.manager, review.id, actor, request.reason, new Date()))
      .rejects.toThrow('트랜잭션 관리자');
    await service.reject(review.id, request, actor);
    const before = await state();
    await expect(connection.transaction((manager) => reviews.rejectPendingReview(manager, review.id, actor, '다른 사유', new Date())))
      .rejects.toThrow('거절할 검수 후보가 없거나 이미 종료되었습니다.');
    expect(await state()).toEqual(before);
  });
});
