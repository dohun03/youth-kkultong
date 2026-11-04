import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { AdminReviewDetail, PolicyDetail, PolicySearchResponse } from '@youth-kkultong/shared';
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
import { SourcePolicyRepository } from '../src/modules/policies/repositories/source-policy.repository';
import { createYouthCenterPolicyContentHash } from '../src/modules/ingestion/youth-center/youth-center-policy.hash';
import { transformYouthCenterPolicy } from '../src/modules/ingestion/youth-center/youth-center-policy.transform';
import type { YouthCenterRawPolicy } from '../src/modules/ingestion/youth-center/youth-center-response.schema';
import { testAdminValues } from './helpers/admin';
import { clearPolicyTables, createCollectionWriter, seedMigratedPolicies } from './helpers/policy-collection';

const origin = testAdminValues.ADMIN_WEB_ORIGIN;
const loginBody = { username: testAdminValues.ADMIN_USERNAME, password: 'test-only-password' };
const privateReason = '거절 사유 비노출 검증 문자열';
const dataRoutes = ['reviews', 'detail', 'missing', 'approve', 'reject'] as const;
type DataRoute = typeof dataRoutes[number];

/** 공개된 내용과 구분되는 제목과 분야 및 원문을 갖는 정책 자료 생성 */
function raw(externalId: string, title = '미승인 전용 제목', category = '미승인 전용 분야', views = '99'): YouthCenterRawPolicy {
  return { plcyNo: externalId, plcyNm: title, lclsfNm: category, inqCnt: views,
    plcyExplnCn: `${title}의 원문 비노출 검증 문자열`, plcySprtCn: `${title}의 지원 내용`,
    aplyPrdSeCd: '0057002', aplyYmd: '상시', unknown: { nested: [null, '관리자 전용 원문'] } };
}

/** 실제 수집과 검수를 거쳐 공개 데이터 분리 및 관리자 전체 경로의 보호를 검증 */
describe('공개 데이터 분리와 관리자 API 전체 경로 계약', () => {
  const schema = `mvp2_step28_${randomUUID().replaceAll('-', '')}`;
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
      extra: { options: `-c timezone=Asia/Seoul -c search_path=${schema} -c statement_timeout=5000` } });
    const factory = jest.spyOn(database, 'createDataSource').mockReturnValue(connection);
    const originalNow = Date.now;
    // 실제 미들웨어가 참조하는 시계도 각 테스트에서 조절하는 시각으로 고정
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

  /** 정상 전체 수집을 기존 저장 서비스로 반영하고 대기 후보를 원문과 함께 준비 */
  async function collect(values: YouthCenterRawPolicy[]) {
    const runner = connection.createQueryRunner();
    try {
      await createCollectionWriter(loadEnvironment()).saveCollection(runner, 'youthcenter', values.map((value) => ({
        ...transformYouthCenterPolicy(value), contentHash: createYouthCenterPolicyContentHash(value),
      })), new Date());
    } finally {
      try { if (runner.isTransactionActive) await runner.rollbackTransaction(); }
      finally { await runner.release(); }
    }
  }

  /** 검수 상세가 제공한 두 해시만 승인과 거절 본문에 사용 */
  async function action(review: PolicyReview, kind: 'approve' | 'reject') {
    const detail = await request(app.getHttpServer()).get(`/api/v1/admin/reviews/${review.id}`).set('Cookie', cookie).expect(200);
    const screen: AdminReviewDetail = detail.body;
    return request(app.getHttpServer()).post(`/api/v1/admin/reviews/${review.id}/${kind}`)
      .set('Cookie', cookie).set('Origin', origin).send({
        contentHash: screen.review.contentHash, baseContentHash: screen.review.baseContentHash,
        ...(kind === 'reject' ? { reason: privateReason } : {}),
      }).expect(200);
  }

  /** 공개 검색과 상세 및 분야를 HTTP로 읽고 비교에 필요한 순서만 고정 */
  async function publicState() {
    const search = await request(app.getHttpServer()).post('/api/v1/policies/search').send({ includeClosed: true, limit: 50 }).expect(200);
    const body: PolicySearchResponse = search.body;
    body.items.sort((left, right) => left.id.localeCompare(right.id));
    const details: PolicyDetail[] = [];
    for (const item of body.items) {
      const response = await request(app.getHttpServer()).get(`/api/v1/policies/${item.id}`).expect(200);
      details.push(response.body);
    }
    const categories = await request(app.getHttpServer()).get('/api/v1/meta/categories').expect(200);
    return { search: body, details, categories: categories.body as string[] };
  }

  /** 업무 테이블의 행 전체를 정렬 조회해 거부된 요청의 무변경 확인 */
  async function state() {
    return Promise.all([Policy, SourcePolicy, PolicyReview].map((entity) =>
      connection.getRepository(entity).find({ order: { id: 'ASC' } })));
  }

  /** 실제 관리자 데이터 경로마다 같은 헤더와 입력으로 요청을 조립 */
  function dataRequest(route: DataRoute, id: string, auth: string | null = cookie) {
    const paths = { reviews: '/admin/reviews', detail: `/admin/reviews/${id}`,
      missing: '/admin/source-policies/missing', approve: `/admin/reviews/${id}/approve`, reject: `/admin/reviews/${id}/reject` };
    const post = route === 'approve' || route === 'reject';
    const http = request(app.getHttpServer());
    const pending = post ? http.post(`/api/v1${paths[route]}`).set('Origin', origin).send({
      contentHash: 'a'.repeat(64), baseContentHash: null, ...(route === 'reject' ? { reason: privateReason } : {}),
    }) : http.get(`/api/v1${paths[route]}`);
    if (auth !== null) pending.set('Cookie', auth);
    return pending;
  }

  it.each([
    ['NEW', 'PENDING'], ['NEW', 'REJECTED'], ['NEW', 'MISSING'],
    ['CHANGED', 'PENDING'], ['CHANGED', 'REJECTED'], ['CHANGED', 'MISSING'],
  ] as const)('%s의 %s 내용은 공개 검색과 상세 및 분야에 섞이지 않고 기존 공개본을 유지한다', async (kind, status) => {
    const stable = raw('stable', '유지할 공개 제목', '유지할 공개 분야', '10');
    const base = raw('target', '기존 공개 제목', '기존 공개 분야', '10');
    await seedMigratedPolicies(connection, kind === 'CHANGED' ? [stable, base] : [stable]);
    const before = await publicState();
    const value = raw('target');
    await collect([stable, value]);
    const review = await connection.getRepository(PolicyReview).findOneByOrFail({ status: 'PENDING' });
    if (status === 'REJECTED') await action(review, 'reject');
    if (status === 'MISSING') await collect([stable]);
    const after = await publicState();
    const expected = structuredClone(before);
    // 공개 본문은 승인본을 유지하고 조회수만 최신 수집값을 반영
    if (kind === 'CHANGED') {
      expected.search.items.find(({ title }) => title === base.plcyNm)!.viewCount = 99;
      expected.details.find(({ externalId }) => externalId === 'target')!.viewCount = 99;
    }
    expect(after).toEqual(expected);
    expect(JSON.stringify(after)).not.toContain(value.plcyNm);
    expect(JSON.stringify(after)).not.toContain(value.lclsfNm);
    const targetSearch = await request(app.getHttpServer()).post('/api/v1/policies/search')
      .send({ keyword: value.plcyNm, includeClosed: true }).expect(200);
    expect(targetSearch.body.items).toEqual([]);
    const categorySearch = await request(app.getHttpServer()).post('/api/v1/policies/search')
      .send({ category: value.lclsfNm, includeClosed: true }).expect(200);
    expect(categorySearch.body.items).toEqual([]);
    // 원본과 검수 UUID를 알아도 공개 상세로 미승인 자료를 조회할 수 없음
    for (const id of [review.id, review.sourcePolicyId]) {
      await request(app.getHttpServer()).get(`/api/v1/policies/${id}`).expect(404);
    }
    const detail = await request(app.getHttpServer()).get(`/api/v1/admin/reviews/${review.id}`).set('Cookie', cookie).expect(200);
    expect(detail.body.target.raw).toEqual(value);
    expect(detail.body.review.status).toBe(status === 'REJECTED' ? 'REJECTED' : 'PENDING');
    if (status === 'MISSING') {
      expect(detail.body).toMatchObject({ canReview: true, latestSource: { missingCount: 1 } });
      const missing = await request(app.getHttpServer()).get('/api/v1/admin/source-policies/missing').set('Cookie', cookie).expect(200);
      expect(missing.body.items).toEqual([expect.objectContaining({ sourcePolicyId: review.sourcePolicyId,
        policyId: review.basePolicyId, latestPendingReviewId: review.id, missingCount: 1 })]);
    }
  });

  it('미승인 신규는 승인 COMMIT 뒤에만 공개되고 누락 이후에도 공개 계약을 유지한다', async () => {
    const value = raw('new-approved');
    await collect([value]);
    const review = await connection.getRepository(PolicyReview).findOneByOrFail({ status: 'PENDING' });
    expect((await publicState()).search.items).toEqual([]);
    // 공개 저장까지 끝났지만 승인 COMMIT 전인 시점에 별도 HTTP 연결로 조회
    const reviews = app.get(PolicyReviewRepository);
    const approve = reviews.approvePendingReview.bind(reviews);
    jest.spyOn(reviews, 'approvePendingReview').mockImplementationOnce(async (...args) => {
      await approve(...args);
      expect(await publicState()).toEqual({ search: { items: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0 }, appliedSort: 'popular' }, details: [], categories: [] });
    });
    const response = await action(review, 'approve');
    const published = await publicState();
    expect(published.categories).toEqual([value.lclsfNm]);
    expect(published.search.items).toEqual([{ id: response.body.policyId, title: value.plcyNm, category: value.lclsfNm,
      subcategory: null, descriptionPreview: value.plcyExplnCn, benefitPreview: value.plcySprtCn,
      applicationStatus: 'ALWAYS_OPEN', applicationPeriodText: '상시', applicationEndDate: null,
      viewCount: 99, score: 0, tags: [] }]);
    expect(published.details[0]).toEqual({ ...published.search.items[0], source: 'youthcenter', externalId: value.plcyNo,
      description: value.plcyExplnCn, benefitText: value.plcySprtCn, ageRangeText: null, jobConditionText: null,
      schoolConditionText: null, regionText: null, extraQualification: null, participationRestriction: null, links: [] });
    await collect([]);
    expect(await publicState()).toEqual(published);
  });

  it('변경 승인의 확정 전에는 기존 공개본을 읽고 확정 뒤에는 같은 UUID의 승인본을 읽는다', async () => {
    const base = raw('changed-approved', '승인 전 공개 제목', '승인 전 공개 분야');
    await seedMigratedPolicies(connection, [base]);
    await collect([raw('changed-approved')]);
    const review = await connection.getRepository(PolicyReview).findOneByOrFail({ status: 'PENDING' });
    const before = await publicState();
    const reviews = app.get(PolicyReviewRepository);
    const approve = reviews.approvePendingReview.bind(reviews);
    jest.spyOn(reviews, 'approvePendingReview').mockImplementationOnce(async (...args) => {
      await approve(...args);
      expect(await publicState()).toEqual(before);
    });
    const result = await action(review, 'approve');
    const after = await publicState();
    expect(result.body.policyId).toBe(review.basePolicyId);
    expect(after.search.items).toEqual([expect.objectContaining({ id: review.basePolicyId, title: raw('changed-approved').plcyNm })]);
    expect(after.categories).toEqual([raw('changed-approved').lclsfNm]);
    expect(after.details[0].description).toBe(raw('changed-approved').plcyExplnCn);
  });

  describe.each([...dataRoutes, 'me'] as const)('%s 경로의 인증 선검사', (route) => {
    it.each(['없음', '변조', '만료', '중복'] as const)('%s 쿠키는 잘못된 입력 검사와 DB 조회 전에 401이다', async (scenario) => {
      let auth: string | null = cookie;
      if (scenario === '없음') auth = null;
      if (scenario === '변조') auth += 'tampered';
      if (scenario === '만료') requestTime += 28800000;
      if (scenario === '중복') auth = `${cookie}; ${cookie}`;
      const queries = jest.spyOn(connection, 'createQueryRunner');
      const pending = route === 'me'
        ? request(app.getHttpServer()).get('/api/v1/admin/auth/me')
        : dataRequest(route, 'invalid-uuid', auth);
      if (route === 'me' && auth !== null) pending.set('Cookie', auth);
      const response = await pending.expect(401);
      expect(response.body).toEqual({ code: 'ADMIN_UNAUTHORIZED', message: '관리자 인증이 필요합니다.' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(queries).not.toHaveBeenCalled();
    });
  });

  it.each(['login', 'logout', 'approve', 'reject'] as const)('%s은 잘못된 Origin과 전달 헤더 위조를 데이터 접근 전에 거부한다', async (route) => {
    await collect([raw('origin')]);
    const review = await connection.getRepository(PolicyReview).findOneByOrFail({ status: 'PENDING' });
    const before = await state();
    const queries = jest.spyOn(connection, 'createQueryRunner');
    for (const source of [undefined, 'https://attacker.example', 'http://api:4000', `${origin}/`]) {
      const path = route === 'login' || route === 'logout' ? `auth/${route}` : `reviews/${review.id}/${route}`;
      const pending = request(app.getHttpServer()).post(`/api/v1/admin/${path}`).set('Cookie', cookie)
        .set('X-Forwarded-Origin', origin).set('X-Forwarded-Host', 'localhost:3000')
        .send(route === 'login' ? loginBody : {});
      if (source !== undefined) pending.set('Origin', source);
      const response = await pending.expect(403);
      expect(response.body).toEqual({ code: 'ADMIN_ORIGIN_FORBIDDEN', message: '허용되지 않은 관리자 요청 출처입니다.' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(queries).not.toHaveBeenCalled();
    queries.mockRestore();
    expect(await state()).toEqual(before);
  });

  describe.each(dataRoutes)('%s 경로의 오류와 로그 보호', (route) => {
    it.each([500, 503])('%s 오류는 안전한 고정 응답이며 로그에 요청 및 DB 오류 원문을 남기지 않는다', async (status) => {
      await collect([raw('private-error')]);
      const review = await connection.getRepository(PolicyReview).findOneByOrFail({ status: 'PENDING' });
      const before = await state();
      const logs = ['log', 'warn', 'error', 'debug', 'verbose'].map((name) =>
        jest.spyOn(Logger.prototype, name as 'log').mockImplementation(() => {}));
      const error = Object.assign(new Error(JSON.stringify({ cookie, privateReason, raw: review.rawSnapshot,
        password: loginBody.password, secret: testAdminValues.ADMIN_AUTH_SECRET })), status === 503 ? { code: 'ECONNRESET' } : {});
      const reviews = app.get(PolicyReviewRepository);
      if (route === 'reviews') jest.spyOn(reviews, 'findReviewList').mockRejectedValueOnce(error);
      else if (route === 'detail') jest.spyOn(reviews, 'findReviewDetail').mockRejectedValueOnce(error);
      else if (route === 'missing') jest.spyOn(app.get(SourcePolicyRepository), 'findMissingPolicies').mockRejectedValueOnce(error);
      else jest.spyOn(reviews, 'findReviewForUpdate').mockRejectedValueOnce(error);
      const response = await dataRequest(route, review.id).expect(status);
      expect(response.body).toEqual(status === 500
        ? { code: 'INTERNAL_SERVER_ERROR', message: '서버 내부 오류가 발생했습니다.' }
        : { code: 'SERVICE_UNAVAILABLE', message: 'DB에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.' });
      expect(response.headers['cache-control']).toBe('no-store');
      const output = JSON.stringify({ body: response.body, logs: logs.map((spy) => spy.mock.calls) });
      for (const secret of [cookie, privateReason, review.rawSnapshot.plcyExplnCn,
        loginBody.password, testAdminValues.ADMIN_AUTH_SECRET]) expect(output).not.toContain(secret);
      expect(await state()).toEqual(before);
    });
  });

  it('모든 관리자 정상 경로의 로그에 인증값과 원문 및 거절 사유를 남기지 않는다', async () => {
    await collect([raw('private-approve'), raw('private-reject')]);
    const rows = await connection.getRepository(PolicyReview).find({ order: { id: 'ASC' } });
    await collect([]);
    const logs = ['log', 'warn', 'error', 'debug', 'verbose'].map((name) =>
      jest.spyOn(Logger.prototype, name as 'log').mockImplementation(() => {}));
    const login = await request(app.getHttpServer()).post('/api/v1/admin/auth/login').set('Origin', origin).send(loginBody).expect(200);
    cookie = login.headers['set-cookie'][0].split(';')[0];
    await request(app.getHttpServer()).get('/api/v1/admin/auth/me').set('Cookie', cookie).expect(200);
    for (const path of ['/reviews', '/source-policies/missing', `/reviews/${rows[0].id}`]) {
      const response = await request(app.getHttpServer()).get(`/api/v1/admin${path}`).set('Cookie', cookie).expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    await action(rows[0], 'approve');
    await action(rows[1], 'reject');
    const history = await request(app.getHttpServer()).get('/api/v1/admin/reviews?status=PROCESSED').set('Cookie', cookie).expect(200);
    expect(history.body.items).toHaveLength(2);
    expect(history.body.items.find((item: { status: string }) => item.status === 'REJECTED').rejectionReason).toBe(privateReason);
    await request(app.getHttpServer()).post('/api/v1/admin/auth/logout').set('Cookie', cookie).set('Origin', origin).send({}).expect(204);
    const output = JSON.stringify(logs.map((spy) => spy.mock.calls));
    for (const secret of [cookie, cookie.split('=')[1], loginBody.password, privateReason,
      testAdminValues.ADMIN_AUTH_SECRET, testAdminValues.ADMIN_PASSWORD_HASH,
      ...rows.map((row) => row.rawSnapshot.plcyExplnCn)]) expect(output).not.toContain(secret);
  });
});
