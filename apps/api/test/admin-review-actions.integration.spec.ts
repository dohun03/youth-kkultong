import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { ReviewActionRequest, ReviewKind } from '@youth-kkultong/shared';
import type { DataSource } from 'typeorm';
import request from 'supertest';
import { loadEnvironment } from '../src/common/environment';
import * as database from '../src/database/data-source';
import { createApplication } from '../src/main';
import { AdminCookieService } from '../src/modules/admin/services/admin-cookie.service';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { PolicyReview } from '../src/modules/policies/entities/policy-review.entity';
import { SourcePolicy } from '../src/modules/policies/entities/source-policy.entity';
import { PolicyRepository } from '../src/modules/policies/repositories/policy.repository';
import { PolicyReviewRepository } from '../src/modules/policies/repositories/policy-review.repository';
import { createYouthCenterPolicyContentHash } from '../src/modules/ingestion/youth-center/youth-center-policy.hash';
import { transformYouthCenterPolicy } from '../src/modules/ingestion/youth-center/youth-center-policy.transform';
import type { YouthCenterRawPolicy } from '../src/modules/ingestion/youth-center/youth-center-response.schema';
import { testAdminValues } from './helpers/admin';
import { clearPolicyTables, createCollectionWriter, seedMigratedPolicies } from './helpers/policy-collection';

const actions = ['approve', 'reject'] as const;
type Action = typeof actions[number];
const origin = testAdminValues.ADMIN_WEB_ORIGIN;

/** 줄바꿈과 중첩 미확인 필드를 포함한 검수 원문 준비 */
function raw(externalId: string, title = '검수할 변경 내용', inqCnt = '10'): YouthCenterRawPolicy {
  return { plcyNo: externalId, plcyNm: title, inqCnt, plcyExplnCn: ' 설명\n ',
    unknown: { nested: [null, false, ' 원문 '] } };
}

/** 실제 관리자 Guard와 PostgreSQL을 연결해 승인 및 거절의 HTTP 계약 검증 */
describe('관리자 검수 승인과 거절 HTTP API', () => {
  const schema = `mvp2_step26_${randomUUID().replaceAll('-', '')}`;
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
    // 요청 제한 미들웨어가 보관할 시계도 사례마다 조절하는 시각을 참조하도록 연결
    const originalNow = Date.now;
    Date.now = () => requestTime;
    try { app = await createApplication(testAdminValues); } finally {
      Date.now = originalNow;
      factory.mockRestore();
    }
    await connection.runMigrations();
    await app.listen(0, '127.0.0.1');
  });

  beforeEach(async () => {
    await clearPolicyTables(connection);
    // 매 사례의 호출 제한과 인증 쿠키가 같은 시각을 사용하도록 준비
    requestTime += 60001;
    jest.spyOn(Date, 'now').mockImplementation(() => requestTime);
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

  /** 실제 수집 저장 서비스로 원본과 후보 및 공개 조회수를 확정 */
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

  /** 공개 기준본 유무에 맞춰 신규 또는 변경 대기를 만들고 화면의 두 해시 준비 */
  async function seed(kind: ReviewKind = 'NEW') {
    const externalId = randomUUID();
    if (kind === 'CHANGED') await seedMigratedPolicies(connection, [raw(externalId, '이전 공개 내용')]);
    await collect([raw(externalId)]);
    const review = await connection.getRepository(PolicyReview).findOneByOrFail({ status: 'PENDING' });
    const body: ReviewActionRequest = { contentHash: review.contentHash, baseContentHash: review.baseContentHash };
    return { review, body, externalId };
  }

  /** 승인에는 두 해시, 거절에는 두 해시와 사유를 보내는 정상 요청 조립 */
  function bodyFor(action: Action, body: ReviewActionRequest) {
    return action === 'approve' ? body : { ...body, reason: '지원 내용 확인 필요' };
  }

  /** JSON 본문과 쿠키 및 출처를 지정해 실제 상태 변경 요청 */
  function post(id: string, action: Action, body: unknown, options: { cookie?: string | null; origin?: string | null } = {}) {
    const pending = request(app.getHttpServer()).post(`/api/v1/admin/reviews/${id}/${action}`).type('json');
    const cookieHeader = options.cookie === undefined ? cookie : options.cookie;
    const originHeader = options.origin === undefined ? origin : options.origin;
    if (cookieHeader !== null) pending.set('Cookie', cookieHeader);
    if (originHeader !== null) pending.set('Origin', originHeader);
    return body === undefined ? pending : pending.send(JSON.stringify(body));
  }

  /** 세 테이블의 전체 행을 정렬 조회해 요청 전후의 변경 여부 확인 */
  async function state() {
    return {
      sources: await connection.getRepository(SourcePolicy).find({ order: { id: 'ASC' } }),
      reviews: await connection.getRepository(PolicyReview).find({ order: { id: 'ASC' } }),
      policies: await connection.getRepository(Policy).find({ order: { id: 'ASC' } }),
    };
  }

  it.each([
    ['NEW', '99', 99], ['CHANGED', '99', 99], ['NEW', '', null], ['CHANGED', '', null],
  ] as const)('%s 상세에서 받은 해시로 승인하면 200과 최신 조회수 %s를 유지한 공개 결과를 반환한다', async (kind, inqCnt, viewCount) => {
    const { review, externalId } = await seed(kind);
    const screen = await request(app.getHttpServer()).get(`/api/v1/admin/reviews/${review.id}`).set('Cookie', cookie).expect(200);
    await collect([raw(externalId, undefined, inqCnt)]);
    const before = await state();
    const response = await post(review.id, 'approve', {
      contentHash: screen.body.review.contentHash, baseContentHash: screen.body.review.baseContentHash,
    }).expect(200);
    const after = await state();
    expect(response.body).toEqual({ id: review.id, status: 'APPROVED', policyId: after.policies[0].id,
      closedAt: after.reviews[0].closedAt!.toISOString() });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(after.sources).toEqual(before.sources);
    expect(after.policies).toHaveLength(1);
    expect(after.policies[0]).toMatchObject({ rawJson: review.rawSnapshot, contentHash: review.contentHash, viewCount });
    if (kind === 'CHANGED') expect(after.policies[0].id).toBe(before.policies[0].id);
    expect(after.reviews[0]).toMatchObject({ status: 'APPROVED', reviewedBy: testAdminValues.ADMIN_USERNAME });
    const detail = await request(app.getHttpServer()).get(`/api/v1/admin/reviews/${review.id}`).set('Cookie', cookie).expect(200);
    expect(detail.body).toMatchObject({ canReview: false, review: { status: 'APPROVED' }, currentPublished: { id: response.body.policyId } });
  });

  it.each(['NEW', 'CHANGED'] as const)('%s 거절은 200과 공개 UUID 또는 NULL을 반환하고 원본 및 공개 행을 보존한다', async (kind) => {
    const { review, body } = await seed(kind);
    const before = await state();
    const response = await post(review.id, 'reject', { ...body, reason: ' \t거절 사유\n  원문\n ' }).expect(200);
    const after = await state();
    expect(response.body).toEqual({ id: review.id, status: 'REJECTED', policyId: before.policies[0]?.id ?? null,
      closedAt: after.reviews[0].closedAt!.toISOString() });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(after.sources).toEqual(before.sources);
    expect(after.policies).toEqual(before.policies);
    expect(after.reviews).toEqual([{ ...review, status: 'REJECTED', reviewedBy: testAdminValues.ADMIN_USERNAME,
      rejectionReason: '거절 사유\n  원문', closedAt: new Date(response.body.closedAt) }]);
  });

  it.each(['가', '가'.repeat(1000), '<script>사유</script>\n  둘째 줄'])('거절 사유의 길이 경계와 HTML 및 내부 공백을 텍스트로 보존한다: %#', async (reason) => {
    const { review, body } = await seed();
    await post(review.id, 'reject', { ...body, reason: ` \t${reason}\n ` }).expect(200);
    expect((await state()).reviews[0].rejectionReason).toBe(reason);
  });

  for (const action of actions) {
    describe(action, () => {
      it.each(['없음', '변조', '만료', '중복'] as const)('인증 쿠키 %s는 401이며 후보 존재 확인 전에 거부한다', async (scenario) => {
        const { body } = await seed();
        const before = await state();
        const access = jest.spyOn(app.get(PolicyReviewRepository), 'findReviewForUpdate');
        let invalidCookie: string | null = null;
        if (scenario === '변조') invalidCookie = `${cookie}tampered`;
        if (scenario === '만료') { invalidCookie = cookie; requestTime += 28800000; }
        if (scenario === '중복') invalidCookie = `${cookie}; ${cookie}`;
        // 없는 후보와 잘못된 UUID도 동일하게 인증 오류를 반환
        for (const id of [randomUUID(), 'not-a-uuid']) {
          const response = await post(id, action, bodyFor(action, body), { cookie: invalidCookie }).expect(401);
          expect(response.body).toEqual({ code: 'ADMIN_UNAUTHORIZED', message: '관리자 인증이 필요합니다.' });
          expect(response.headers['cache-control']).toBe('no-store');
        }
        expect(access).not.toHaveBeenCalled();
        expect(await state()).toEqual(before);
      });

      it('Origin 누락과 불일치는 403이며 업무 데이터를 읽거나 변경하지 않는다', async () => {
        const { review, body } = await seed();
        const before = await state();
        const access = jest.spyOn(app.get(PolicyReviewRepository), 'findReviewForUpdate');
        for (const value of [null, 'https://attacker.example', `${origin}/`, 'http://api:4000']) {
          const response = await post(review.id, action, bodyFor(action, body), { origin: value }).expect(403);
          expect(response.body).toEqual({ code: 'ADMIN_ORIGIN_FORBIDDEN', message: '허용되지 않은 관리자 요청 출처입니다.' });
          expect(response.headers['cache-control']).toBe('no-store');
        }
        expect(access).not.toHaveBeenCalled();
        expect(await state()).toEqual(before);
      });

      it.each(['본문 누락', 'NULL', '배열', '빈 객체', '기준 해시 누락', '잘못된 해시', '원문 추가', '처리자 추가'] as const)(
        '%s는 400이며 처리 서비스에 전달하지 않는다', async (scenario) => {
          const { review, body } = await seed();
          const valid = bodyFor(action, body);
          const invalid: Record<typeof scenario, unknown> = {
            '본문 누락': undefined, NULL: null, '배열': [], '빈 객체': {},
            '기준 해시 누락': { contentHash: body.contentHash, ...(action === 'reject' ? { reason: '사유' } : {}) },
            '잘못된 해시': { ...valid, contentHash: 'A'.repeat(64) },
            '원문 추가': { ...valid, raw: { plcyNm: '임의 편집' } },
            '처리자 추가': { ...valid, reviewedBy: 'forged-admin' },
          };
          const before = await state();
          const access = jest.spyOn(app.get(PolicyReviewRepository), 'findReviewForUpdate');
          const response = await post(review.id, action, invalid[scenario]).expect(400);
          expect(response.body).toEqual({ code: 'BAD_REQUEST', message: '요청값이 올바르지 않습니다.' });
          expect(response.headers['cache-control']).toBe('no-store');
          expect(access).not.toHaveBeenCalled();
          expect(await state()).toEqual(before);
        },
      );

      it('잘못된 UUID는 400이고 없는 후보는 404이며 전체 행을 보존한다', async () => {
        const { body } = await seed();
        const before = await state();
        await post('not-a-uuid', action, bodyFor(action, body)).expect(400);
        const missing = await post(randomUUID(), action, bodyFor(action, body)).expect(404);
        expect(missing.body).toEqual({ code: 'REVIEW_NOT_FOUND', message: '검수 후보를 찾을 수 없습니다.' });
        expect(missing.headers['cache-control']).toBe('no-store');
        expect(await state()).toEqual(before);
      });

      it.each(['화면 변경본', '화면 기준본', '최신 원본', '공개 기준 해시', '공개 UUID', '신규 공개본'] as const)(
        '%s 충돌은 고정된 409 응답이며 업무 데이터는 이전 상태를 유지한다', async (scenario) => {
          const { review, body, externalId } = await seed(scenario === '신규 공개본' ? 'NEW' : 'CHANGED');
          if (scenario === '화면 변경본') body.contentHash = '0'.repeat(64);
          if (scenario === '화면 기준본') body.baseContentHash = null;
          if (scenario === '최신 원본') await connection.getRepository(SourcePolicy).update(review.sourcePolicyId, { contentHash: '0'.repeat(64) });
          // 공개 기준 방어 경로는 테스트 스키마의 행을 직접 변경해 재현
          if (scenario === '공개 기준 해시') await connection.getRepository(Policy).update(review.basePolicyId!, { contentHash: '0'.repeat(64) });
          if (scenario === '공개 UUID') await connection.query(`UPDATE "${schema}".policies SET external_id = $1 WHERE id = $2`, ['old-base', review.basePolicyId]);
          if (scenario === '공개 UUID' || scenario === '신규 공개본') {
            const published = raw(externalId, '이전 공개 내용');
            await new PolicyRepository().upsertPolicies(connection.manager, [{
              ...transformYouthCenterPolicy(published), contentHash: createYouthCenterPolicyContentHash(published),
            }]);
          }
          const before = await state();
          const response = await post(review.id, action, bodyFor(action, body)).expect(409);
          expect(response.body).toEqual(scenario === '화면 변경본' || scenario === '최신 원본'
            ? { code: 'REVIEW_CONTENT_CONFLICT', message: '검수 내용이 변경되었습니다. 다시 조회해 주세요.' }
            : { code: 'REVIEW_BASE_CONFLICT', message: '공개 기준이 변경되었습니다. 다시 조회해 주세요.' });
          expect(response.headers['cache-control']).toBe('no-store');
          expect(await state()).toEqual(before);
        },
      );

      it('대체된 오래된 화면은 409이며 최신 대기를 변경하지 않는다', async () => {
        const { review, body, externalId } = await seed();
        await collect([raw(externalId, '새로운 변경 내용')]);
        const before = await state();
        const response = await post(review.id, action, bodyFor(action, body)).expect(409);
        expect(response.body).toEqual({ code: 'REVIEW_NOT_PENDING', message: '이미 처리된 검수 후보입니다.' });
        expect(await state()).toEqual(before);
      });

      it('같은 처리와 반대 처리의 중복 요청은 모두 409이며 확정 이력을 보존한다', async () => {
        const { review, body } = await seed();
        await post(review.id, action, bodyFor(action, body)).expect(200);
        const before = await state();
        for (const repeated of actions) {
          const response = await post(review.id, repeated, bodyFor(repeated, body)).expect(409);
          expect(response.body).toEqual({ code: 'REVIEW_NOT_PENDING', message: '이미 처리된 검수 후보입니다.' });
          expect(await state()).toEqual(before);
        }
      });

      it('JSON 외 형식과 압축 본문은 415, 본문 상한 초과는 413, 깨진 JSON은 400이다', async () => {
        const { review, body } = await seed();
        const before = await state();
        const url = `/api/v1/admin/reviews/${review.id}/${action}`;
        const access = jest.spyOn(app.get(PolicyReviewRepository), 'findReviewForUpdate');
        await request(app.getHttpServer()).post(url).set('Cookie', cookie).set('Origin', origin).type('form').send(bodyFor(action, body)).expect(415);
        await request(app.getHttpServer()).post(url).set('Cookie', cookie).set('Origin', origin).type('json')
          .set('Content-Encoding', 'gzip').send(gzipSync(JSON.stringify(bodyFor(action, body)))).expect(415);
        const oversized = await post(review.id, action, { ...bodyFor(action, body), reason: 'x'.repeat(17000) }).expect(413);
        expect(oversized.headers['cache-control']).toBe('no-store');
        await request(app.getHttpServer()).post(url).set('Cookie', cookie).set('Origin', origin).type('json').send('{"contentHash":').expect(400);
        expect(access).not.toHaveBeenCalled();
        expect(await state()).toEqual(before);
      });

      it('DB 기록 실패는 전체 롤백과 안전한 500 응답으로 처리한다', async () => {
        const { review, body } = await seed('CHANGED');
        const before = await state();
        jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
        const blocked = action === 'approve' ? 'APPROVED' : 'REJECTED';
        await connection.query(`ALTER TABLE "${schema}".policy_reviews ADD CONSTRAINT test_action_failure CHECK (status <> '${blocked}')`);
        try {
          const response = await post(review.id, action, bodyFor(action, body)).expect(500);
          expect(response.body).toEqual({ code: 'INTERNAL_SERVER_ERROR', message: '서버 내부 오류가 발생했습니다.' });
          expect(response.headers['cache-control']).toBe('no-store');
          expect(await state()).toEqual(before);
        } finally {
          await connection.query(`ALTER TABLE "${schema}".policy_reviews DROP CONSTRAINT test_action_failure`);
        }
      });

      it('DB 연결 오류도 내부 원문 없이 기존 503 계약을 유지한다', async () => {
        const { review, body } = await seed();
        const before = await state();
        jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
        jest.spyOn(app.get(PolicyReviewRepository), 'findReviewForUpdate').mockRejectedValueOnce(
          Object.assign(new Error('검증용 접속 비밀값'), { code: 'ECONNRESET' }),
        );
        const response = await post(review.id, action, bodyFor(action, body)).expect(503);
        expect(response.body).toEqual({ code: 'SERVICE_UNAVAILABLE', message: 'DB에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.' });
        expect(await state()).toEqual(before);
      });
    });
  }

  it.each([undefined, null, '', ' \n\t\u3000', '가'.repeat(1001), 1, ['사유'], { text: '사유' }])(
    '잘못된 거절 사유는 400이며 후보를 종료하지 않는다: %#', async (reason) => {
      const { review, body } = await seed();
      const before = await state();
      const response = await post(review.id, 'reject', { ...body, reason }).expect(400);
      expect(response.body).toEqual({ code: 'BAD_REQUEST', message: '요청값이 올바르지 않습니다.' });
      expect(await state()).toEqual(before);
    },
  );

  it('승인에 사유를 추가하면 400이며 요청자가 공개 내용을 편집할 수 없다', async () => {
    const { review, body } = await seed();
    const before = await state();
    await post(review.id, 'approve', { ...body, reason: '승인에는 없는 사유' }).expect(400);
    expect(await state()).toEqual(before);
  });

  it('일반 관리자 호출 한도를 소진하면 승인과 거절도 429이며 업무 데이터를 변경하지 않는다', async () => {
    const { review, body } = await seed();
    const before = await state();
    for (let index = 0; index < 120; index++) {
      await request(app.getHttpServer()).get('/api/v1/admin/auth/me').set('Cookie', cookie).expect(200);
    }
    for (const action of actions) {
      const response = await post(review.id, action, bodyFor(action, body)).expect(429);
      expect(response.body.code).toBe('TOO_MANY_REQUESTS');
      expect(response.headers['retry-after']).toBe('60');
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(await state()).toEqual(before);
  });

  it.each(actions)('%s 응답과 로그에 인증값과 요청 원문 및 사유를 남기지 않는다', async (action) => {
    const { review, body } = await seed();
    const privateReason = '로그에 남기면 안 되는 거절 사유';
    const logs = ['log', 'warn', 'error', 'debug', 'verbose'].map((name) =>
      jest.spyOn(Logger.prototype, name as 'log').mockImplementation(() => {}));
    const response = await post(review.id, action, action === 'approve' ? body : { ...body, reason: privateReason }).expect(200);
    const output = JSON.stringify({ response: response.body, logs: logs.map((spy) => spy.mock.calls) });
    for (const secret of [cookie, privateReason, review.rawSnapshot.plcyExplnCn,
      testAdminValues.ADMIN_PASSWORD_HASH, testAdminValues.ADMIN_AUTH_SECRET]) {
      expect(output).not.toContain(secret);
    }
  });
});
