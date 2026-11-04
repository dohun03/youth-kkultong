import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID, scryptSync } from 'node:crypto';

const require = createRequire(import.meta.url);
// 실행 전 npm run build --workspace apps/api로 현재 API 코드를 준비
// DATABASE_URL을 지정하고 node --test test/admin-recovery.live.mjs로 별도 실행
// DB 쓰기는 이번 프로세스가 생성한 임시 스키마 안에서 수행
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
const { transformYouthCenterPolicy } = require('../../api/dist/modules/ingestion/youth-center/youth-center-policy.transform.js');
const { createYouthCenterPolicyContentHash: hash } = require('../../api/dist/modules/ingestion/youth-center/youth-center-policy.hash.js');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const baseUrl = process.env.WEB_TEST_URL ?? 'http://localhost:3000';
const schema = `mvp2_step35_${randomUUID().replaceAll('-', '')}`;
// 실제 관리자 자격을 읽지 않는 합성 계정
const username = 'test-reviewer';
const password = 'test-only-password';
const salt = Buffer.alloc(16, 7);
const values = { ADMIN_USERNAME: username,
  ADMIN_PASSWORD_HASH: `scrypt$16384$8$1$${salt.toString('base64')}$${scryptSync(password, salt, 64).toString('base64')}`,
  ADMIN_AUTH_SECRET: Buffer.alloc(32, 9).toString('base64'), ADMIN_WEB_ORIGIN: new URL(baseUrl).origin };
let admin;
let connection;
let app;
let browser;
let apiOrigin;
let created = false;

/** 별도 PostgreSQL 스키마와 실제 NestJS HTTP 서버 및 브라우저를 준비 */
before(async () => {
  assert.ok(process.env.DATABASE_URL, '격리 테스트용 연결 설정이 필요합니다.');
  Logger.overrideLogger(false);
  const environment = loadEnvironment();
  admin = database.createDataSource(environment).setOptions({ entities: [], migrations: [] });
  await admin.initialize();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  connection = database.createDataSource(environment).setOptions({ schema,
    extra: { options: `-c timezone=Asia/Seoul -c search_path=${schema} -c statement_timeout=5000` } });
  const originalFactory = database.createDataSource;
  // 이번 테스트 프로세스의 API 연결만 격리 스키마로 연결
  database.createDataSource = () => connection;
  try { app = await createApplication(values); } finally { database.createDataSource = originalFactory; }
  await connection.runMigrations();
  await app.listen(0, '127.0.0.1');
  apiOrigin = await app.getUrl();
  browser = await chromium.launch({ headless: true });
}, { timeout: 30000 });

/** 실패하더라도 테스트 브라우저와 연결 및 이번에 만든 스키마만 정리 */
after(async () => {
  try { await browser?.close(); } finally {
    try { await app?.close(); } finally {
      try { if (connection?.isInitialized) await connection.destroy(); } finally {
        try { if (created && admin?.isInitialized) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
        finally { if (admin?.isInitialized) await admin.destroy(); }
      }
    }
  }
});

/** 해당 테스트의 해시가 일치하는 원본과 검수 후보 및 선택적인 공개 기준본 준비 */
async function seed(action) {
  const environment = loadEnvironment();
  const policies = new PolicyRepository();
  const writer = new PolicyReviewsWriteService(new PolicyReviewRepository(environment));
  return connection.transaction(async (manager) => {
    const raw = { plcyNo: `live-${action}`, plcyNm: `응답 유실 ${action} 검증`, inqCnt: '33',
      plcyExplnCn: '격리된 실제 API와 DB로 확인하는 원문', plcySprtCn: '변경된 지원 내용' };
    let base = null;
    if (action === 'reject') {
      const original = { ...raw, plcySprtCn: '기존 공개 지원 내용' };
      const id = await policies.saveApprovedPolicy(manager, { ...transformYouthCenterPolicy(original), contentHash: hash(original) }, null);
      base = await manager.getRepository(Policy).findOneByOrFail({ id });
    }
    const source = await manager.getRepository(SourcePolicy).save({ source: 'youthcenter', externalId: raw.plcyNo,
      title: raw.plcyNm, rawJson: raw, contentHash: hash(raw), viewCount: 33, firstCollectedAt: new Date(), lastCollectedAt: new Date(),
      lastCollectionResult: action === 'reject' ? 'MISSING' : 'NEW', missingCount: action === 'reject' ? 3 : 0 });
    await writer.saveReviewChanges(manager, [], [{ sourcePolicy: source, basePolicy: base }], new Date());
    const review = await manager.getRepository(PolicyReview).findOneByOrFail({ sourcePolicyId: source.id, status: 'PENDING' });
    return { source, review, base };
  });
}

for (const action of ['approve', 'reject']) {
  test(`실제 ${action} COMMIT 후 응답만 끊어도 UI가 GET으로 확정 결과를 확인한다`, async () => {
    const fixture = await seed(action);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    let posts = 0;
    let detailGets = 0;
    try {
      // 실제 Next.js 화면의 요청을 격리된 실제 HTTP 서버로 전달하고 처리 응답만 유실
      await context.route('**/api/v1/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const target = `${apiOrigin}${url.pathname}${url.search}`;
        if (url.pathname === `/api/v1/admin/reviews/${fixture.review.id}`) detailGets++;
        const response = await route.fetch({ url: target, headers: { ...request.headers(), origin: new URL(baseUrl).origin } });
        if (url.pathname === `/api/v1/admin/reviews/${fixture.review.id}/${action}`) {
          posts++;
          assert.equal(response.status(), 200);
          // 200 응답은 서버의 실제 COMMIT 후 반환되므로 여기서만 전송을 끊음
          await route.abort('failed');
        } else await route.fulfill({ response });
      });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/admin/login`);
      try {
        await page.getByLabel('아이디', { exact: true }).fill(username);
        await page.getByLabel('비밀번호', { exact: true }).fill(password);
      } catch { throw new Error('합성 계정 로그인 입력 실패'); }
      await page.getByRole('button', { name: '로그인', exact: true }).click();
      await page.waitForURL('**/admin/reviews');
      await page.goto(`${baseUrl}/admin/reviews/${fixture.review.id}`);
      await page.locator('.review-detail-heading').waitFor();
      if (action === 'reject') await page.getByText(/최근 정상 수집에서 3회 연속/).waitFor();
      await page.getByRole('button', { name: action === 'approve' ? '승인' : '거절', exact: true }).click();
      const reason = '<script>텍스트 거절 사유</script>\n지원 조건 확인 필요';
      if (action === 'reject') await page.getByLabel('거절 사유 (필수, 1~1000자)', { exact: true }).fill(reason);
      await page.getByRole('button', { name: action === 'approve' ? '승인 확정' : '거절 확정', exact: true }).click();
      await page.getByText(`처리가 끝난 검수 이력입니다. 상태: ${action === 'approve' ? '승인됨' : '거절됨'}`, { exact: true }).waitFor();
      const notice = page.locator('.admin-review-detail > [role="status"]');
      await notice.waitFor();
      await page.waitForFunction((element) => document.activeElement === element, await notice.elementHandle());
      assert.equal(posts, 1);
      assert.equal(detailGets, 2);
      const stored = await connection.getRepository(PolicyReview).findOneByOrFail({ id: fixture.review.id });
      assert.equal(stored.status, action === 'approve' ? 'APPROVED' : 'REJECTED');
      assert.equal(stored.reviewedBy, username);
      assert.ok(stored.closedAt);
      const published = await connection.getRepository(Policy).findOneByOrFail({ source: 'youthcenter', externalId: fixture.source.externalId });
      if (action === 'approve') {
        assert.equal(published.contentHash, fixture.review.contentHash);
        assert.deepEqual(published.rawJson, fixture.review.rawSnapshot);
      } else {
        assert.deepEqual(published, fixture.base);
        assert.equal(stored.rejectionReason, reason);
        assert.equal(await page.locator('.review-notices pre').textContent(), reason);
        assert.equal(await page.locator('.review-notices script').count(), 0);
      }
      await page.getByRole('button', { name: '같은 정책의 처리 이력 보기', exact: true }).click();
      await page.getByText('현재 보고 있는 이력', { exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
      await page.screenshot({ path: `/tmp/mvp2-step35-live-${action}.png`, fullPage: true });
    } finally { await context.close(); }
  }, { timeout: 45000 });
}
