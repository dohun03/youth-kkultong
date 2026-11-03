import { randomUUID } from 'node:crypto';
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
import { PolicyReviewApprovalService } from '../src/modules/policies/services/policy-review-approval.service';
import { clearPolicyTables, createCollectionWriter, seedMigratedPolicies } from './helpers/policy-collection';

/** 원문 공백, 미확인 중첩 필드, 날짜와 자격 조건을 포함한 승인 대상 생성 */
function raw(title = '검수한 변경 내용', inqCnt = '10'): YouthCenterRawPolicy {
  return {
    plcyNo: 'approval-test', plcyNm: title, inqCnt,
    lclsfNm: '일자리', mclsfNm: '취업', plcyExplnCn: ' 설명\n ', plcySprtCn: '지원 내용',
    aplyUrlAddr: 'https://example.com/apply', refUrlAddr1: 'https://example.com/1', refUrlAddr2: '',
    frstRegDt: '2026-03-08 02:30:00', lastMdfcnDt: '2026-11-03 00:30:00',
    aplyPrdSeCd: '0057001', aplyYmd: '20261101 ~ 20261130',
    sprtTrgtMinAge: '19', sprtTrgtMaxAge: '34', jobCd: '0013001,0013010', schoolCd: '0049010',
    zipCd: '11000,11110', addAplyQlfcCndCn: '추가 자격', ptcpPrpTrgtCn: '참여 제한',
    unknown: { nested: [null, false, ' 원문\n ', { inqCnt: '중첩 조회수' }] },
  };
}

/** 실제 수집으로 만든 후보를 승인하고 PostgreSQL의 확정 및 롤백 결과 검증 */
describe('검수 승인과 공개 반영 트랜잭션', () => {
  const schema = `mvp2_step24_${randomUUID().replaceAll('-', '')}`;
  const actor = 'review-admin';
  let admin: DataSource;
  let connection: DataSource;
  let policies: PolicyRepository;
  let reviews: PolicyReviewRepository;
  let service: PolicyReviewApprovalService;
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
    policies = new PolicyRepository();
    reviews = new PolicyReviewRepository(environment);
    service = new PolicyReviewApprovalService(connection, reviews, policies);
  });

  beforeEach(async () => clearPolicyTables(connection));
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    try { if (connection?.isInitialized) await connection.destroy(); } finally {
      try { if (schemaCreated && admin?.isInitialized) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
      finally { if (admin?.isInitialized) await admin.destroy(); }
    }
  });

  /** 기존 수집 저장 경로로 원본과 후보 및 공개 조회수를 함께 확정 */
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

  /** 신규 또는 변경 후보를 만들고 화면에서 보낼 두 해시 준비 */
  async function seed(kind: 'NEW' | 'CHANGED' = 'NEW') {
    if (kind === 'CHANGED') await seedMigratedPolicies(connection, [raw('이전 공개 내용')]);
    await collect([raw()]);
    const review = await connection.getRepository(PolicyReview).findOneByOrFail({ status: 'PENDING' });
    const request: ReviewActionRequest = { contentHash: review.contentHash, baseContentHash: review.baseContentHash };
    return { review, request };
  }

  /** 오류 전후 세 테이블의 모든 행을 비교해 부분 저장과 이력 변경 확인 */
  async function state() {
    return {
      sources: await connection.getRepository(SourcePolicy).find({ order: { id: 'ASC' } }),
      reviews: await connection.getRepository(PolicyReview).find({ order: { id: 'ASC' } }),
      policies: await connection.getRepository(Policy).find({ order: { id: 'ASC' } }),
    };
  }

  it.each([
    ['NEW', '99', 99], ['CHANGED', '99', 99], ['NEW', '', null], ['CHANGED', '', null],
  ] as const)('%s 승인은 스냅샷 본문과 최신 조회수 %s를 함께 확정한다', async (kind, inqCnt, expectedViews) => {
    const { review, request } = await seed(kind);
    // 후보 생성 뒤 조회수만 갱신하면 같은 후보를 유지하면서 최신 원문 조회수만 달라짐
    await collect([raw(undefined, inqCnt)]);
    const before = await state();
    const result = await service.approve(review.id, request, actor);
    const after = await state();
    const published = after.policies[0];
    const { sourceRegisteredAt, sourceModifiedAt, ...expected } = transformYouthCenterPolicy(raw());
    expect(after.policies).toHaveLength(1);
    expect(published).toMatchObject({ ...expected, contentHash: review.contentHash, viewCount: expectedViews });
    expect(published.rawJson).toEqual(review.rawSnapshot);
    expect(published.rawJson.inqCnt).toBe('10');
    expect(before.sources[0].rawJson.inqCnt).toBe(inqCnt);
    expect(after.sources).toEqual(before.sources);
    expect(result).toEqual({ id: review.id, status: 'APPROVED', policyId: published.id,
      closedAt: after.reviews[0].closedAt!.toISOString() });
    expect(after.reviews).toEqual([{ ...review, status: 'APPROVED', reviewedBy: actor, closedAt: new Date(result.closedAt) }]);
    if (kind === 'CHANGED') {
      expect(published.id).toBe(before.policies[0].id);
      expect(published.createdAt).toEqual(before.policies[0].createdAt);
    }
    expect(await connection.query(`SELECT to_char(source_registered_at, 'YYYY-MM-DD HH24:MI:SS') AS registered,
      to_char(source_modified_at, 'YYYY-MM-DD HH24:MI:SS') AS modified FROM "${schema}".policies`))
      .toEqual([{ registered: sourceRegisteredAt, modified: sourceModifiedAt }]);
  });

  it.each(['NEW', 'CHANGED'] as const)('%s 공개 저장 뒤 승인 기록이 DB 제약에 실패하면 전체 취소한다', async (kind) => {
    const { review, request } = await seed(kind);
    const before = await state();
    // 테스트 스키마에서만 승인 UPDATE를 막아 공개 저장 이후의 실제 DB 실패 재현
    await connection.query(`ALTER TABLE "${schema}".policy_reviews ADD CONSTRAINT test_approval_failure CHECK (status <> 'APPROVED')`);
    const save = policies.saveApprovedPolicy.bind(policies);
    jest.spyOn(policies, 'saveApprovedPolicy').mockImplementationOnce(async (manager, policy, baseId) => {
      const id = await save(manager, policy, baseId);
      expect(await manager.getRepository(Policy).findOneByOrFail({ id })).toMatchObject({ title: raw().plcyNm });
      // 다른 연결에서는 확정 전의 기존 공개 상태만 관찰됨
      expect((await state()).policies).toEqual(before.policies);
      return id;
    });
    try {
      await expect(service.approve(review.id, request, actor)).rejects.toMatchObject({ driverError: { code: '23514' } });
      expect(await state()).toEqual(before);
    } finally {
      await connection.query(`ALTER TABLE "${schema}".policy_reviews DROP CONSTRAINT test_approval_failure`);
    }
    // 실패한 연결이 반환되고 같은 후보를 정상 재처리할 수 있는지도 확인
    expect(await service.approve(review.id, request, actor)).toMatchObject({ status: 'APPROVED' });
  });

  it('공개 저장 실패는 대기 후보와 원본 및 공개 행을 보존한다', async () => {
    const { review, request } = await seed('CHANGED');
    const before = await state();
    await connection.query(`ALTER TABLE "${schema}".policies ADD CONSTRAINT test_public_failure CHECK (title <> '검수한 변경 내용')`);
    try {
      await expect(service.approve(review.id, request, actor)).rejects.toMatchObject({ driverError: { code: '23514' } });
      expect(await state()).toEqual(before);
    } finally {
      await connection.query(`ALTER TABLE "${schema}".policies DROP CONSTRAINT test_public_failure`);
    }
  });

  it('최신 원본이 누락 상태여도 마지막 정상 스냅샷을 승인한다', async () => {
    const { review, request } = await seed();
    await collect([]);
    const before = await state();
    expect(before.sources[0].missingCount).toBe(1);
    await service.approve(review.id, request, actor);
    expect((await state()).sources).toEqual(before.sources);
    expect((await state()).policies[0].rawJson).toEqual(review.rawSnapshot);
  });

  it('없는 후보는 404이며 업무 데이터를 변경하지 않는다', async () => {
    const { request } = await seed();
    const before = await state();
    await expect(service.approve(randomUUID(), request, actor)).rejects.toMatchObject({
      status: 404, response: { code: 'REVIEW_NOT_FOUND' },
    });
    expect(await state()).toEqual(before);
  });

  it.each(['화면 변경본', '화면 기준본', '최신 원본', '공개 기준본', '신규 공개본'] as const)(
    '%s 충돌은 409이며 공개 저장과 후보 변경이 없다', async (scenario) => {
      const { review, request } = await seed(scenario === '신규 공개본' ? 'NEW' : 'CHANGED');
      if (scenario === '화면 변경본') request.contentHash = '0'.repeat(64);
      if (scenario === '화면 기준본') request.baseContentHash = null;
      if (scenario === '최신 원본') await connection.getRepository(SourcePolicy).update(review.sourcePolicyId, { contentHash: '0'.repeat(64) });
      // 방어 경로를 격리 스키마의 공개 행 변경으로 구성
      if (scenario === '공개 기준본') await connection.getRepository(Policy).update(review.basePolicyId!, { contentHash: '0'.repeat(64) });
      if (scenario === '신규 공개본') await connection.transaction((manager) => policies.saveApprovedPolicy(manager, {
        ...transformYouthCenterPolicy(raw('다른 공개 내용')), contentHash: createYouthCenterPolicyContentHash(raw('다른 공개 내용')),
      }, null));
      const before = await state();
      await expect(service.approve(review.id, request, actor)).rejects.toMatchObject({ status: 409, response: {
        code: scenario === '화면 변경본' || scenario === '최신 원본' ? 'REVIEW_CONTENT_CONFLICT' : 'REVIEW_BASE_CONFLICT',
      } });
      expect(await state()).toEqual(before);
    },
  );

  it.each(['APPROVED', 'REJECTED', 'SUPERSEDED'] as const)('이미 %s인 후보는 409이며 과거 내용을 보존한다', async (status) => {
    const { review, request } = await seed();
    if (status === 'APPROVED') await service.approve(review.id, request, actor);
    else await connection.getRepository(PolicyReview).update(review.id, {
      status, closedAt: new Date(), reviewedBy: status === 'REJECTED' ? actor : null,
      rejectionReason: status === 'REJECTED' ? '기존 사유' : null,
      supersededReason: status === 'SUPERSEDED' ? 'SOURCE_CHANGED' : null,
    });
    const before = await state();
    await expect(service.approve(review.id, request, actor)).rejects.toMatchObject({ status: 409, response: { code: 'REVIEW_NOT_PENDING' } });
    expect(await state()).toEqual(before);
  });

  it.each([
    ['해시 불일치', '스냅샷의 내용과 해시가 일치하지 않습니다.'],
    ['필수 필드 누락', '스냅샷의 원본 정책 형식이 올바르지 않습니다.'],
    ['변환 오류', '변환에 실패했습니다'],
    ['정책 식별자 불일치', '스냅샷과 원본의 출처 또는 외부 ID가 다릅니다.'],
  ] as const)(
    '스냅샷 %s는 내부 오류로 중단하고 전체 상태를 보존한다', async (scenario, message) => {
      const { review, request } = await seed('CHANGED');
      const damaged = raw();
      if (scenario === '해시 불일치') damaged.plcyNm = '손상된 내용';
      if (scenario === '필수 필드 누락') delete (damaged as Record<string, unknown>).plcyNm;
      if (scenario === '변환 오류') damaged.frstRegDt = '잘못된 날짜';
      if (scenario === '정책 식별자 불일치') damaged.plcyNo = '다른 정책';
      const rehash = scenario === '변환 오류' || scenario === '정책 식별자 불일치';
      const hash = rehash ? createYouthCenterPolicyContentHash(damaged) : review.contentHash;
      // 스냅샷 컬럼은 ORM 수정 금지이므로 손상 재현에만 매개변수 SQL 사용
      await connection.query(`UPDATE "${schema}".policy_reviews SET raw_snapshot = $1::jsonb, content_hash = $2 WHERE id = $3`,
        [JSON.stringify(damaged), hash, review.id]);
      if (rehash) {
        request.contentHash = hash;
        await connection.getRepository(SourcePolicy).update(review.sourcePolicyId, { contentHash: hash });
      }
      const before = await state();
      await expect(service.approve(review.id, request, actor)).rejects.toThrow(message);
      expect(await state()).toEqual(before);
      expect((await state()).reviews[0].status).toBe('PENDING');
    },
  );

  it('READ COMMITTED 전용 연결에서 원본, 후보, 공개본 순서로 잠그고 연결을 반환한다', async () => {
    const { review, request } = await seed('CHANGED');
    const create = connection.createQueryRunner.bind(connection);
    let approvalRunner: QueryRunner | undefined;
    const statements: string[] = [];
    jest.spyOn(connection, 'createQueryRunner').mockImplementationOnce((mode) => {
      approvalRunner = create(mode);
      const query = approvalRunner.query.bind(approvalRunner);
      jest.spyOn(approvalRunner, 'query').mockImplementation((...args: Parameters<QueryRunner['query']>) => {
        statements.push(args[0]);
        return query(...args);
      });
      return approvalRunner;
    });
    await service.approve(review.id, request, actor);
    expect(statements.some((sql) => sql === 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED')).toBe(true);
    const locks = statements.filter((sql) => sql.includes('FOR UPDATE'));
    expect(locks).toHaveLength(3);
    expect(locks[0]).toContain('"source_policies"');
    expect(locks[1]).toContain('"policy_reviews"');
    expect(locks[2]).toContain('"policies"');
    expect(statements.findIndex((sql) => sql.includes('"policy_reviews"'))).toBeLessThan(statements.indexOf(locks[0]));
    expect(statements.at(-1)).toBe('COMMIT');
    expect(approvalRunner?.isReleased).toBe(true);
  });

  it('트랜잭션 밖의 잠금 조회와 승인 기록을 거부한다', async () => {
    await expect(reviews.findReviewForUpdate(connection.manager, randomUUID())).rejects.toThrow('트랜잭션 관리자');
    await expect(reviews.approvePendingReview(connection.manager, randomUUID(), actor, new Date())).rejects.toThrow('트랜잭션 관리자');
  });
});
