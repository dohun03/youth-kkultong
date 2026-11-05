import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, scryptSync, createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';

// API 빌드와 별도 DATABASE_URL을 준비한 뒤 apps/web에서 node --test test/admin-flow.live.mjs로 실행
const require = createRequire(import.meta.url);
const database = require('../../api/dist/database/data-source.js');
const { loadEnvironment } = require('../../api/dist/common/environment.js');
const { createApplication } = require('../../api/dist/main.js');
const { Logger } = require('@nestjs/common');
const { Policy } = require('../../api/dist/modules/policies/entities/policy.entity.js');
const { SourcePolicy } = require('../../api/dist/modules/policies/entities/source-policy.entity.js');
const { PolicyReview } = require('../../api/dist/modules/policies/entities/policy-review.entity.js');
const { PolicyRepository } = require('../../api/dist/modules/policies/repositories/policy.repository.js');
const { PolicyReviewRepository } = require('../../api/dist/modules/policies/repositories/policy-review.repository.js');
const { PolicyReviewsWriteService } = require('../../api/dist/modules/policies/services/reviews/policy-reviews-write.service.js');
const { PolicyCollectionWriteService } = require('../../api/dist/modules/policies/services/collection/policy-collection-write.service.js');
const { SourcePolicyRepository } = require('../../api/dist/modules/policies/repositories/source-policy.repository.js');
const { transformYouthCenterPolicy: transform } = require('../../api/dist/modules/ingestion/youth-center/youth-center-policy.transform.js');
const { createYouthCenterPolicyContentHash: hash } = require('../../api/dist/modules/ingestion/youth-center/youth-center-policy.hash.js');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const schema = `mvp2_step39_${randomUUID().replaceAll('-', '')}`;
const username = 'live-reviewer';
const password = randomBytes(24).toString('base64url');
const secret = randomBytes(32);
let admin;
let connection;
let app;
let child;
let project;
let browser;
let origin;
let cookies;
let created = false;
const fixtures = {};

/** 실제 Next.js 검증 서버에 사용할 빈 로컬 포트 확보 */
async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

/** 격리 DB에서 검수할 신규 또는 변경 원본과 스냅샷 준비 */
async function prepare(name, kind, missingCount = 0) {
  return connection.transaction(async (manager) => {
    const raw = { plcyNo: `step39-${name}`, plcyNm: `최종 검수 ${name} 변경본`,
      plcyExplnCn: '실제 웹과 API를 연결한 검수 대상', plcySprtCn: '승인할 새 지원 내용',
      inqCnt: '99', aplyPrdSeCd: '0057002', unknown: { text: ' 원문\n ', values: [null, false] } };
    let base = null;
    if (kind === 'CHANGED') {
      const previous = { ...raw, plcyNm: `최종 검수 ${name} 공개본`, plcySprtCn: '승인 전 지원 내용', inqCnt: '11' };
      const id = await new PolicyRepository().saveApprovedPolicy(manager, { ...transform(previous), contentHash: hash(previous) }, null);
      base = await manager.getRepository(Policy).findOneByOrFail({ id });
    }
    const source = await manager.getRepository(SourcePolicy).save({ source: 'youthcenter', externalId: raw.plcyNo,
      title: raw.plcyNm, rawJson: raw, contentHash: hash(raw), viewCount: 99,
      firstCollectedAt: missingCount ? null : new Date(), lastCollectedAt: missingCount ? null : new Date(),
      lastCollectionResult: missingCount ? 'MISSING' : 'NEW', missingCount });
    await new PolicyReviewsWriteService(new PolicyReviewRepository(loadEnvironment()))
      .saveReviewChanges(manager, [], [{ sourcePolicy: source, basePolicy: base }], new Date());
    const review = await manager.getRepository(PolicyReview).findOneByOrFail({ sourcePolicyId: source.id });
    return { raw, base, source, review };
  });
}

/** 별도 DB와 실제 NestJS 및 실제 Next.js 프로덕션 프록시를 연결하고 화면으로 로그인 */
before(async () => {
  assert.ok(process.env.DATABASE_URL, '별도 검증 DB 연결 설정이 필요합니다.');
  Logger.overrideLogger(false);
  const environment = loadEnvironment();
  admin = database.createDataSource(environment).setOptions({ entities: [], migrations: [] });
  await admin.initialize();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  connection = database.createDataSource(environment).setOptions({ schema,
    extra: { options: `-c timezone=Asia/Seoul -c search_path=${schema}` } });
  origin = `http://127.0.0.1:${await freePort()}`;
  const salt = randomBytes(16);
  const original = database.createDataSource;
  database.createDataSource = () => connection;
  try {
    app = await createApplication({ ADMIN_USERNAME: username,
      ADMIN_PASSWORD_HASH: `scrypt$16384$8$1$${salt.toString('base64')}$${scryptSync(password, salt, 64).toString('base64')}`,
      ADMIN_AUTH_SECRET: secret.toString('base64'), ADMIN_WEB_ORIGIN: origin, POLICY_SCHEDULE_ENABLED: 'false' });
  } finally { database.createDataSource = original; }
  await connection.runMigrations();
  for (const [name, kind, missing] of [['changed', 'CHANGED', 0], ['new', 'NEW', 0],
    ['rejected', 'CHANGED', 3], ['unpublished', 'NEW', 2], ['conflict', 'CHANGED', 0]]) {
    fixtures[name] = await prepare(name, kind, missing);
  }
  await app.listen(0, '127.0.0.1');
  const env = { ...process.env };
  // 빌드와 웹에는 실제 DB 접속 정보나 관리자 비밀값을 전달하지 않음
  for (const key of Object.keys(env)) if (/PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL/.test(key)) delete env[key];
  child = spawn(process.execPath, [resolve('../api/test/fixtures/admin-proxy.cjs')], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...env, NODE_OPTIONS: '',
      API_INTERNAL_URL: await app.getUrl(), PROXY_TEST_PORT: new URL(origin).port, NEXT_TELEMETRY_DISABLED: '1' },
  });
  // 서버 오류 원문을 결과에 섞지 않고 시작 여부만 확인
  child.stdout.resume();
  child.stderr.resume();
  await new Promise((resolve, reject) => {
    child.on('message', (message) => {
      if (message.event === 'PROJECT') project = message.path;
      if (message.event === 'READY') resolve();
    });
    child.once('error', () => reject(new Error('검증용 웹 프로세스 실행 실패')));
    child.once('exit', () => reject(new Error('검증용 웹 준비 전 종료')));
  });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/admin/login`);
    try {
      await page.getByLabel('아이디', { exact: true }).fill(username);
      await page.getByLabel('비밀번호', { exact: true }).fill(password);
    } catch { throw new Error('검증용 관리자 입력 실패'); }
    const response = page.waitForResponse((r) => r.url().endsWith('/admin/auth/login'));
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    assert.equal((await response).status(), 200);
    await page.waitForURL('**/admin/reviews');
    cookies = await context.cookies();
    assert.ok(cookies.some((cookie) => cookie.name === 'youth_admin_auth' && cookie.httpOnly));
  } finally { await context.close(); }
}, { timeout: 180000 });

/** 실패 시에도 이번 브라우저, 웹 서버, API와 스키마를 순서대로 정리 */
after(async () => {
  const errors = [];
  try { await browser?.close(); } catch (error) { errors.push(error); }
  try {
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => {
        const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
        child.once('exit', () => { clearTimeout(timeout); resolve(); });
        child.kill('SIGTERM');
      });
    }
  } catch (error) { errors.push(error); }
  try {
    if (project?.startsWith(resolve('.next/admin-proxy-test-'))) await rm(project, { recursive: true, force: true, maxRetries: 3 });
  } catch (error) { errors.push(error); }
  try { await app?.close(); } catch (error) { errors.push(error); }
  try { if (connection?.isInitialized) await connection.destroy(); } catch (error) { errors.push(error); }
  try { if (created && admin?.isInitialized) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } catch (error) { errors.push(error); }
  try { if (admin?.isInitialized) await admin.destroy(); } catch (error) { errors.push(error); }
  assert.equal(errors.length, 0, '검증용 자원 정리 실패');
});

/** 매 시나리오를 독립된 인증 문맥으로 실행하고 저장소와 화면 너비 확인 */
async function withPage(run, width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  await context.addCookies(cookies);
  const page = await context.newPage();
  try {
    await run(page, context);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
  } finally { await context.close(); }
}

/** 실제 검수 상세를 표시한 뒤 처리 버튼을 사용할 수 있을 때까지 대기 */
async function detail(page, fixture) {
  await page.goto(`${origin}/admin/reviews/${fixture.review.id}`);
  await page.getByRole('heading', { name: fixture.raw.plcyNm, exact: true }).waitFor();
  await page.getByRole('button', { name: '승인', exact: true }).waitFor();
}

test('실제 동일 출처 승인으로 신규가 공개되고 변경본은 기존 공개 UUID와 최신 조회수를 유지한다', async () => {
  await withPage(async (page, context) => {
    for (const name of ['changed', 'new']) {
      const fixture = fixtures[name];
      const before = await context.request.post(`${origin}/api/v1/policies/search`, { data: { includeClosed: true } });
      const beforeItems = (await before.json()).items;
      assert.ok(!beforeItems.some((item) => item.title === fixture.raw.plcyNm));
      await detail(page, fixture);
      const difference = page.locator('[data-field="plcySprtCn"] pre');
      if (name === 'changed') assert.deepEqual(await difference.allTextContents(), ['승인 전 지원 내용', '승인할 새 지원 내용']);
      await page.getByRole('button', { name: '승인', exact: true }).click();
      const processed = page.waitForResponse((r) => r.url().endsWith(`/${fixture.review.id}/approve`));
      await page.getByRole('button', { name: '승인 확정', exact: true }).click();
      const response = await processed;
      assert.equal(response.status(), 200);
      await page.getByText('처리가 끝난 검수 이력입니다. 상태: 승인됨', { exact: true }).waitFor();
      // 처리 뒤 화면이 재조회되므로 응답 본문 대신 실제 확정된 공개 행으로 ID와 내용 확인
      const stored = await connection.getRepository(Policy).findOneByOrFail({ source: 'youthcenter', externalId: fixture.raw.plcyNo });
      if (fixture.base) assert.equal(stored.id, fixture.base.id);
      assert.equal(stored.viewCount, 99);
      assert.equal(stored.contentHash, fixture.review.contentHash);
      assert.deepEqual(stored.rawJson, fixture.review.rawSnapshot);
      await page.goto(`${origin}/policies/${stored.id}`);
      await page.getByRole('heading', { name: fixture.raw.plcyNm, exact: true }).waitFor();
      await page.getByText('승인할 새 지원 내용', { exact: true }).waitFor();
    }
    await page.screenshot({ path: '/tmp/mvp2-step39-live-public.png', fullPage: true });
  });
}, { timeout: 45000 });

test('실제 거절은 공개본을 보존하고 처리 이력과 미공개 누락 후보 및 NULL 수집 시각을 연결한다', async () => {
  await withPage(async (page, context) => {
    const fixture = fixtures.rejected;
    await detail(page, fixture);
    await page.getByText(/최근 정상 수집에서 3회 연속/).waitFor();
    await page.getByRole('button', { name: '거절', exact: true }).click();
    const reason = '<script>검수 사유</script>\n조건 확인 필요';
    await page.getByLabel('거절 사유 (필수, 1~1000자)', { exact: true }).fill(reason);
    const processed = page.waitForResponse((r) => r.url().endsWith(`/${fixture.review.id}/reject`));
    await page.getByRole('button', { name: '거절 확정', exact: true }).click();
    assert.equal((await processed).status(), 200);
    await page.getByText('처리가 끝난 검수 이력입니다. 상태: 거절됨', { exact: true }).waitFor();
    assert.equal(await page.locator('.review-notices pre').textContent(), reason);
    assert.equal(await page.locator('.review-notices script').count(), 0);
    assert.deepEqual(await connection.getRepository(Policy).findOneByOrFail({ id: fixture.base.id }), fixture.base);
    const publicResponse = await context.request.get(`${origin}/api/v1/policies/${fixture.base.id}`);
    assert.equal((await publicResponse.json()).title, fixture.base.title);
    await page.getByRole('link', { name: '처리 이력', exact: true }).click();
    await page.locator(`a[href="/admin/reviews/${fixture.review.id}"]`).waitFor();
    await page.getByRole('link', { name: '누락 정책', exact: true }).click();
    const row = page.locator('.admin-review-row').filter({ hasText: fixtures.unpublished.raw.plcyNm });
    await row.waitFor();
    assert.ok((await row.textContent()).includes('아직 실제 수집 기록 없음'));
    await row.getByRole('link', { name: '검수 대기 보기 →', exact: true }).click();
    await page.waitForURL(`**/admin/reviews/${fixtures.unpublished.review.id}`);
    await page.getByText(/최근 정상 수집에서 2회 연속/).waitFor();
    await page.screenshot({ path: '/tmp/mvp2-step39-live-missing.png', fullPage: true });
  }, 320);
}, { timeout: 45000 });

test('화면을 연 뒤 실제 재수집으로 후보가 교체되면 승인 409와 최신 후보 안내를 제공한다', async () => {
  await withPage(async (page) => {
    const fixture = fixtures.conflict;
    await detail(page, fixture);
    const raw = { ...fixture.raw, plcyNm: '재수집된 최신 후보 C' };
    const environment = loadEnvironment();
    const reviews = new PolicyReviewRepository(environment);
    const writer = new PolicyCollectionWriteService(new SourcePolicyRepository(environment), new PolicyRepository(), reviews,
      new PolicyReviewsWriteService(reviews), environment);
    const runner = connection.createQueryRunner();
    try { await writer.saveCollection(runner, 'youthcenter', [{ ...transform(raw), contentHash: hash(raw) }], new Date()); }
    finally { await runner.release(); }
    await page.getByRole('button', { name: '승인', exact: true }).click();
    const response = page.waitForResponse((r) => r.url().endsWith(`/${fixture.review.id}/approve`));
    await page.getByRole('button', { name: '승인 확정', exact: true }).click();
    assert.equal((await response).status(), 409);
    await page.getByText('새 후보나 현재 상태로 대체된 검수 이력입니다.', { exact: true }).waitFor();
    await page.getByRole('status').filter({ hasText: '후보의 내용 또는 처리 상태가 변경되었습니다.' }).waitFor();
    await page.getByRole('link', { name: '최신 검수 대기 후보 보기 →', exact: true }).click();
    await page.getByRole('heading', { name: raw.plcyNm, exact: true }).waitFor();
    assert.equal(await connection.getRepository(PolicyReview).countBy({ sourcePolicyId: fixture.source.id, status: 'PENDING' }), 1);
    const published = await connection.getRepository(Policy).findOneByOrFail({ id: fixture.base.id });
    assert.deepEqual({ ...published }, { ...fixture.base, viewCount: 99, updatedAt: published.updatedAt });
    await page.screenshot({ path: '/tmp/mvp2-step39-live-conflict.png', fullPage: true });
  });
}, { timeout: 45000 });

test('서명은 유효하지만 만료된 실제 쿠키는 API 401과 로그인 복귀로 처리한다', async () => {
  await withPage(async (page, context) => {
    await page.goto(`${origin}/admin/reviews`);
    await page.getByRole('heading', { name: '검수 대기', exact: true }).waitFor();
    const exp = Math.floor(Date.now() / 1000) - 1;
    const payload = Buffer.from(JSON.stringify({ sub: username, iat: exp - 28800, exp })).toString('base64url');
    const signature = createHmac('sha256', secret).update(payload).digest('base64url');
    await context.addCookies(cookies.map((cookie) => cookie.name === 'youth_admin_auth'
      ? { ...cookie, value: `${payload}.${signature}` } : cookie));
    const denied = page.waitForResponse((r) => r.url().endsWith('/admin/auth/me') && r.status() === 401);
    await page.reload();
    await denied;
    await page.waitForURL('**/admin/login');
    assert.equal(await page.getByRole('heading', { name: '정책 검수 관리', exact: true }).count(), 0);
  });
}, { timeout: 30000 });

test('목록 연결 실패는 안내 후 같은 실제 API로 재시도하며 모바일 화면을 유지한다', async () => {
  await withPage(async (page) => {
    await page.route('**/api/v1/admin/source-policies/missing?*', (route) => route.abort('failed'));
    await page.goto(`${origin}/admin/missing`);
    await page.getByRole('button', { name: '다시 시도', exact: true }).waitFor();
    await page.unroute('**/api/v1/admin/source-policies/missing?*');
    const recovered = page.waitForResponse((r) => r.url().includes('/admin/source-policies/missing?') && r.status() === 200);
    await page.getByRole('button', { name: '다시 시도', exact: true }).click();
    await recovered;
    await page.locator('.admin-review-summary').waitFor();
    assert.ok(await page.locator('.admin-review-row').count() > 0);
  });
}, { timeout: 30000 });
