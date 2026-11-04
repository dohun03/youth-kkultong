import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loginForAdminTests } from './admin-login.mjs';
import { paceBrowserContext } from './api-pacing.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const baseUrl = process.env.WEB_TEST_URL ?? 'http://localhost:3000';
const credentialsFile = process.env.ADMIN_TEST_CREDENTIALS_FILE;
if (!credentialsFile) throw new Error('ADMIN_TEST_CREDENTIALS_FILE에 로컬 로그인 정보 파일 경로가 필요합니다.');
const credentials = await readFile(credentialsFile, 'utf8');
const username = /^아이디: (.+)$/m.exec(credentials)?.[1];
const password = /^비밀번호: (.+)$/m.exec(credentials)?.[1];
if (!username || !password) throw new Error('로그인 정보 파일 형식을 확인하세요.');
const reviewId = '00000000-0000-4000-8000-000000000035';
const nextId = '00000000-0000-4000-8000-000000000036';
const publicId = '00000000-0000-4000-8000-000000000033';
let browser;
let authenticatedCookies;

before(async () => {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await paceBrowserContext(context);
  try {
    const page = await context.newPage();
    await loginForAdminTests(page, baseUrl, username, password);
    await page.getByRole('heading', { name: '검수 대기', exact: true }).waitFor();
    authenticatedCookies = await context.cookies();
  } finally { await context.close(); }
}, { timeout: 90000 });
after(async () => { await browser?.close(); });

/** 테스트별 인증 문맥을 분리하고 실패 시에도 탭과 연결을 정리 */
async function withPage(run, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await paceBrowserContext(context);
  await context.addCookies(authenticatedCookies);
  const page = await context.newPage();
  try { await run(page, context); }
  finally { await context.close(); }
}

/** API에서 이미 판정된 필드 차이의 응답 값을 테스트 스냅샷으로 준비 */
function field(value, key) {
  const beforeExists = value.base !== null && Object.hasOwn(value.base.raw, key);
  const afterExists = Object.hasOwn(value.target.raw, key);
  return { key, beforeExists, afterExists, before: beforeExists ? value.base.raw[key] : null,
    after: afterExists ? value.target.raw[key] : null };
}

/** 실제 상세 계약의 기준본과 변경본 및 최신 원본 정보를 갖는 응답 준비 */
function fixture() {
  const base = { contentHash: 'a'.repeat(64), raw: { plcyNo: 'detail-external', plcyNm: '기준 정책 A',
    plcyExplnCn: '기준 소개', lclsfNm: '주거', zipCd: '11000', inqCnt: '10',
    unknownRemoved: '삭제될 값', unknownNested: { nested: [1, null, ' 앞 '] } } };
  const target = { contentHash: 'b'.repeat(64), raw: { plcyNo: 'detail-external', plcyNm: '검수 정책 B',
    plcyExplnCn: '변경 소개', lclsfNm: '주거', zipCd: '11000', inqCnt: '20',
    unknownAdded: null, unknownNested: { nested: [null, 1, ' 앞 '] } } };
  const value = {
    review: { id: reviewId, sourcePolicyId: '00000000-0000-4000-8000-000000000034', source: 'youthcenter',
      externalId: 'detail-external', title: target.raw.plcyNm, kind: 'CHANGED', status: 'PENDING',
      contentHash: target.contentHash, baseContentHash: base.contentHash, createdAt: '2026-11-04T05:05:00.000Z',
      closedAt: null, reviewedBy: null, rejectionReason: null, supersededReason: null },
    base, target, currentPublished: { ...structuredClone(base), id: publicId, viewCount: 80 },
    latestSource: { contentHash: target.contentHash, viewCount: 99, lastCollectedAt: '2026-11-04T05:10:00.000Z', missingCount: 0 },
    changedFields: [], latestPendingReviewId: reviewId, canReview: true,
  };
  value.changedFields = ['plcyNm', 'plcyExplnCn', 'unknownAdded', 'unknownRemoved', 'unknownNested'].sort().map((key) => field(value, key));
  return value;
}

/** 대상 후보의 API 응답만 대체해 실제 인증과 상세 화면을 표시 */
async function showDetail(page, value = fixture()) {
  await page.route(`**/api/v1/admin/reviews/${value.review.id}`, (route) => {
    assert.equal(route.request().method(), 'GET');
    return route.fulfill({ json: value });
  });
  await page.goto(`${baseUrl}/admin/reviews/${value.review.id}`);
  await page.getByRole('heading', { name: value.review.title, exact: true }).waitFor();
}

/** 결과 안내까지 실제 키보드 초점이 이어졌는지 확인 */
async function expectFocus(locator) {
  await locator.page().waitForFunction((element) => document.activeElement === element, await locator.elementHandle());
}

/** 처리 완료 후 상세와 이력 목록에서 사용할 결과 준비 */
function closeReview(value, action, reason = null) {
  value.review.status = action === 'approve' ? 'APPROVED' : 'REJECTED';
  value.review.closedAt = '2026-11-04T09:00:00.000Z';
  value.review.reviewedBy = 'fixture-reviewer';
  value.review.rejectionReason = reason;
  value.latestPendingReviewId = null;
  value.canReview = false;
  if (action === 'approve') value.currentPublished = { ...structuredClone(value.target), id: publicId, viewCount: 99 };
}

/** 처리 요청과 재조회 순서를 기록하며 응답 유실 등의 실패를 주입 */
async function processingPage(page, handlePost, handleGet) {
  const value = fixture();
  const calls = [];
  await page.route(`**/api/v1/admin/reviews/${reviewId}`, async (route) => {
    calls.push('GET');
    if (handleGet && await handleGet(route, value, calls)) return;
    await route.fulfill({ json: value });
  });
  await page.route(`**/api/v1/admin/reviews/${reviewId}/*`, async (route) => {
    calls.push('POST');
    await handlePost(route, value, calls);
  });
  await page.goto(`${baseUrl}/admin/reviews/${reviewId}`);
  await page.locator('.review-detail-heading').waitFor();
  return { value, calls };
}

test('키보드로 확인 폼을 열고 취소 및 Escape 후 시작 버튼으로 돌아간다', async () => {
  await withPage(async (page) => {
    await showDetail(page);
    for (const [action, target] of [['승인', '승인 확정'], ['거절', '거절 사유 (필수, 1~1000자)']]) {
      const trigger = page.getByRole('button', { name: action, exact: true });
      await trigger.focus();
      await page.keyboard.press('Enter');
      const input = action === '승인' ? page.getByRole('button', { name: target, exact: true }) : page.getByLabel(target, { exact: true });
      await expectFocus(input);
      await page.keyboard.press('Escape');
      await expectFocus(trigger);
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: '취소', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expectFocus(trigger);
    }
  });
});

test('폼 종류를 전환하면 입력 초점이 바뀌고 빈 거절 사유는 입력으로 초점을 돌린다', async () => {
  await withPage(async (page) => {
    await showDetail(page);
    await page.getByRole('button', { name: '승인', exact: true }).click();
    await page.getByRole('button', { name: '거절', exact: true }).click();
    const input = page.getByLabel('거절 사유 (필수, 1~1000자)', { exact: true });
    await expectFocus(input);
    await page.getByRole('button', { name: '거절 확정', exact: true }).click();
    await expectFocus(input);
    assert.equal(await input.getAttribute('aria-invalid'), 'true');
    assert.ok((await input.getAttribute('aria-describedby')).includes('review-action-error'));
    await page.getByRole('button', { name: '승인', exact: true }).click();
    await expectFocus(page.getByRole('button', { name: '승인 확정', exact: true }));
  });
});

for (const action of ['approve', 'reject']) {
  test(`${action} 응답을 잃어도 상태를 확인하고 결과 안내에 초점을 연결하며 POST는 한 번만 보낸다`, async () => {
    await withPage(async (page) => {
      const { calls } = await processingPage(page, async (route, value) => {
        closeReview(value, action, action === 'reject' ? '<img src=x onerror="window.injected=true">\n사유 원문' : null);
        await route.abort('failed');
      });
      await page.getByRole('button', { name: action === 'approve' ? '승인' : '거절', exact: true }).click();
      if (action === 'reject') await page.getByLabel('거절 사유 (필수, 1~1000자)', { exact: true }).fill('사유 원문');
      await page.getByRole('button', { name: action === 'approve' ? '승인 확정' : '거절 확정', exact: true }).focus();
      await page.keyboard.press('Enter');
      await page.getByText(`처리가 끝난 검수 이력입니다. 상태: ${action === 'approve' ? '승인됨' : '거절됨'}`, { exact: true }).waitFor();
      await expectFocus(page.locator('.admin-review-detail > [role="status"]'));
      assert.deepEqual(calls, ['GET', 'POST', 'GET']);
      assert.equal(await page.getByRole('button', { name: '승인', exact: true }).isDisabled(), true);
      assert.equal(await page.locator('.review-notices img').count(), 0);
      assert.equal(await page.evaluate(() => window.injected === true), false);
    });
  });
}

test('처리 후 재조회 실패는 오류에 초점을 연결하고 GET 재시도로 확정 결과를 확인한다', async () => {
  await withPage(async (page) => {
    let recovered = false;
    const { calls } = await processingPage(page, async (route, value) => {
      closeReview(value, 'approve');
      await route.abort('failed');
    }, async (route, _value, calls) => {
      if (calls.length > 1 && !recovered) { await route.fulfill({ status: 503, json: {} }); return true; }
      return false;
    });
    await page.getByRole('button', { name: '승인', exact: true }).click();
    await page.getByRole('button', { name: '승인 확정', exact: true }).click();
    const error = page.getByRole('heading', { name: '상세를 불러오지 못했습니다', exact: true });
    await error.waitFor();
    await expectFocus(error);
    recovered = true;
    await page.getByRole('button', { name: '다시 시도', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByText('처리가 끝난 검수 이력입니다. 상태: 승인됨', { exact: true }).waitFor();
    await expectFocus(page.locator('.admin-review-detail > [role="status"]'));
    assert.deepEqual(calls, ['GET', 'POST', 'GET', 'GET']);
  });
});

test('처리 요청의 401은 상세를 다시 요청하지 않고 로그인으로 복귀한다', async () => {
  await withPage(async (page) => {
    let expired = false;
    await page.route('**/api/v1/admin/auth/me', (route) => expired ? route.fulfill({ status: 401, json: {} }) : route.continue());
    const { calls } = await processingPage(page, async (route) => { expired = true; await route.fulfill({ status: 401, json: {} }); });
    await page.getByRole('button', { name: '거절', exact: true }).click();
    await page.getByLabel('거절 사유 (필수, 1~1000자)', { exact: true }).fill('만료 전 사유 초안');
    await page.getByRole('button', { name: '거절 확정', exact: true }).click();
    await page.waitForURL('**/admin/login');
    assert.deepEqual(calls, ['GET', 'POST']);
    assert.equal(await page.locator('.review-field').count(), 0);
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
    assert.ok(!(await page.locator('main').textContent()).includes('만료 전 사유 초안'));
  });
});

test('승인 응답 유실 뒤 상세의 401도 로그인으로 이동하고 POST를 반복하지 않는다', async () => {
  await withPage(async (page) => {
    let expired = false;
    await page.route('**/api/v1/admin/auth/me', (route) => expired ? route.fulfill({ status: 401, json: {} }) : route.continue());
    const { calls } = await processingPage(page, async (route) => { await route.abort('failed'); }, async (route, _value, calls) => {
      if (calls.length > 1) { expired = true; await route.fulfill({ status: 401, json: {} }); return true; }
      return false;
    });
    await page.getByRole('button', { name: '승인', exact: true }).click();
    await page.getByRole('button', { name: '승인 확정', exact: true }).click();
    await page.waitForURL('**/admin/login');
    assert.deepEqual(calls, ['GET', 'POST', 'GET']);
    assert.equal(await page.locator('.review-actions').count(), 0);
  });
});

for (const committed of [false, true]) {
  test(`15초 응답 제한 이후 GET으로 ${committed ? '확정된 승인 결과' : '대기 상태'}를 확인하고 자동 재전송하지 않는다`, async () => {
    await withPage(async (page) => {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const { calls } = await processingPage(page, async (route, value) => {
        if (committed) closeReview(value, 'approve');
        await gate;
        try { await route.fulfill({ json: {} }); } catch { /* 이미 취소된 전송을 정리 */ }
      });
      try {
        await page.clock.install();
        await page.getByRole('button', { name: '승인', exact: true }).click();
        await page.getByRole('button', { name: '승인 확정', exact: true }).click();
        await page.getByText('처리 중입니다. 완료 후 상세 상태를 다시 확인합니다.', { exact: true }).waitFor();
        await page.clock.fastForward(15010);
        await page.getByRole('status').filter({ hasText: '응답을 확인하지 못했습니다.' }).waitFor();
        await page.locator('.review-detail-heading').waitFor();
        assert.deepEqual(calls, ['GET', 'POST', 'GET']);
        assert.equal(await page.locator('.review-detail-badges .admin-badge').textContent(), committed ? '승인됨' : '검수 대기');
        assert.equal(await page.getByRole('form', { name: '승인 확인', exact: true }).count(), 0);
      } finally { release(); }
    });
  });
}

test('409로 대체된 후보를 갱신하고 최신 후보 링크에서 다시 비교한다', async () => {
  await withPage(async (page) => {
    const latest = fixture();
    latest.review.id = nextId;
    latest.review.title = '최신 후보 C';
    latest.target.raw.plcyNm = latest.review.title;
    latest.latestPendingReviewId = nextId;
    await page.route(`**/api/v1/admin/reviews/${nextId}`, (route) => route.fulfill({ json: latest }));
    const { calls } = await processingPage(page, async (route, value) => {
      value.review.status = 'SUPERSEDED'; value.review.closedAt = '2026-11-04T09:00:00Z'; value.review.supersededReason = 'SOURCE_CHANGED';
      value.latestPendingReviewId = nextId; value.latestSource.contentHash = 'c'.repeat(64); value.canReview = false;
      await route.fulfill({ status: 409, json: { code: 'REVIEW_NOT_PENDING' } });
    });
    await page.getByRole('button', { name: '승인', exact: true }).click();
    await page.getByRole('button', { name: '승인 확정', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '후보의 내용 또는 처리 상태가 변경되었습니다.' }).waitFor();
    await expectFocus(page.locator('.admin-review-detail > [role="status"]'));
    const latestLink = page.getByRole('link', { name: '최신 검수 대기 후보 보기 →', exact: true });
    await latestLink.focus(); await page.keyboard.press('Enter');
    await page.waitForURL(`**/admin/reviews/${nextId}`);
    await page.locator('.review-detail-heading h3').filter({ hasText: '최신 후보 C' }).waitFor();
    assert.deepEqual(calls, ['GET', 'POST', 'GET']);
    assert.equal(await page.getByRole('button', { name: '승인', exact: true }).isEnabled(), true);
  });
});

for (const route of ['reviews', 'history', 'missing']) {
  test(`${route} 본문 건너뛰기와 입력 레이블 및 접근성 연결 ID를 확인한다`, async () => {
    await withPage(async (page) => {
      await page.goto(`${baseUrl}/admin/${route}`);
      await page.locator('.admin-review-summary').waitFor();
      await page.keyboard.press('Tab');
      await expectFocus(page.locator('.skip-link'));
      await page.keyboard.press('Enter');
      await expectFocus(page.locator('#main-content'));
      assert.deepEqual(await page.locator('main input, main select').evaluateAll((elements) => elements.filter((e) => !e.labels?.length).map((e) => e.id)), []);
      assert.equal(await page.locator('h1').count(), 1);
    });
  });
}

test('접힌 이력과 거절 폼의 ARIA 속성이 실제 요소를 가리키고 입력 초점이 보인다', async () => {
  await withPage(async (page) => {
    await showDetail(page);
    await page.getByRole('button', { name: '거절', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expectFocus(page.getByLabel('거절 사유 (필수, 1~1000자)', { exact: true }));
    const missingIds = await page.locator('main [aria-controls], main [aria-describedby], main [aria-labelledby]').evaluateAll((elements) => elements.flatMap((element) =>
      ['aria-controls', 'aria-describedby', 'aria-labelledby'].flatMap((attribute) => (element.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean)
        .filter((id) => !document.getElementById(id)))));
    assert.deepEqual(missingIds, []);
    assert.ok(await page.locator('#review-reason').evaluate((e) => getComputedStyle(e).outlineStyle !== 'none'));
    await page.keyboard.press('Escape');
    const button = page.getByRole('button', { name: '같은 정책의 처리 이력 보기', exact: true });
    await button.focus(); await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: '같은 정책의 처리 이력', exact: true }).waitFor();
    await page.keyboard.press('Enter');
    await expectFocus(page.getByRole('button', { name: '같은 정책의 처리 이력 보기', exact: true }));
  });
});

for (const width of [320, 390]) {
  test(`${width}px 비교와 확인 폼에서 긴 원문과 위험한 URL을 안전하게 표시한다`, async () => {
    await withPage(async (page) => {
      const value = fixture();
      value.review.title = '긴 정책 제목'.repeat(30);
      value.target.raw.plcySprtCn = ' 긴 원문😀\n'.repeat(300);
      value.target.raw.aplyUrlAddr = 'javascript:alert(1)';
      value.target.raw.refUrlAddr1 = 'HTTPS://example.com/policy';
      value.target.raw.refUrlAddr2 = 'https:\n//example.com';
      for (const key of ['plcySprtCn', 'aplyUrlAddr', 'refUrlAddr1', 'refUrlAddr2']) value.changedFields.push(field(value, key));
      await showDetail(page, value);
      const [left, right] = await page.locator('[data-field="plcyNm"] .review-value-columns > section').all();
      assert.ok((await right.boundingBox()).y >= (await left.boundingBox()).y + (await left.boundingBox()).height);
      assert.equal(await page.getByRole('link', { name: '신청 URL 변경본 링크 열기', exact: true }).count(), 0);
      assert.equal(await page.getByRole('link', { name: '참고 URL 2 변경본 링크 열기', exact: true }).count(), 0);
      const valid = page.getByRole('link', { name: '참고 URL 1 변경본 링크 열기', exact: true });
      assert.equal(await valid.getAttribute('rel'), 'noopener noreferrer');
      await page.getByRole('button', { name: '지원 내용 변경본 더보기', exact: true }).focus(); await page.keyboard.press('Enter');
      await page.getByRole('button', { name: '거절', exact: true }).focus(); await page.keyboard.press('Enter');
      const input = page.getByLabel('거절 사유 (필수, 1~1000자)', { exact: true });
      await input.fill('<script>원문으로 표시</script>\n' + '긴 사유'.repeat(150));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '같은 정책의 처리 이력 보기', exact: true }).focus();
      await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: '같은 정책의 처리 이력', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `/tmp/mvp2-step35-mobile-${width}.png`, fullPage: true });
    }, { width, height: 844 });
  });
}

test('로그인 화면에서도 본문 건너뛰기로 실제 초점을 옮긴다', async () => {
  await withPage(async (page, context) => {
    await context.clearCookies();
    await page.goto(`${baseUrl}/admin/login`);
    await page.getByRole('heading', { name: '관리자 로그인', exact: true }).waitFor();
    await page.keyboard.press('Tab');
    await expectFocus(page.locator('.skip-link'));
    await page.keyboard.press('Enter');
    await expectFocus(page.locator('#main-content'));
  });
});
