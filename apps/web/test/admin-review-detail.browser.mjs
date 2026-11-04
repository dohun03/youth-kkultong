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
const reviewId = '00000000-0000-4000-8000-000000000031';
const nextId = '00000000-0000-4000-8000-000000000032';
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

test('기준본과 변경본 및 최신 조회수를 분리하고 변경 항목만 한국어 이름으로 표시한다', async () => {
  await withPage(async (page) => {
    const value = fixture();
    await showDetail(page, value);
    assert.equal(await page.locator('.review-field').count(), 5);
    const title = page.locator('[data-field="plcyNm"]');
    assert.ok((await title.locator('h4').textContent()).includes('정책 제목'));
    assert.deepEqual(await title.locator('pre').allTextContents(), ['기준 정책 A', '검수 정책 B']);
    assert.ok((await page.locator('.review-facts').textContent()).includes('99회'));
    assert.ok((await page.locator('.review-current').textContent()).includes('80회'));
    assert.equal(await page.locator('[data-field="inqCnt"]').count(), 0);
    assert.equal(await page.locator('[data-field="zipCd"]').count(), 0);
    await page.getByLabel('전체 항목 보기', { exact: true }).check();
    assert.equal(await page.locator('[data-field="zipCd"]').count(), 1);
    assert.equal(await page.locator('[data-field="zipCd"] .review-change-kind').textContent(), '동일');
    assert.equal(await page.locator('[data-field="inqCnt"]').count(), 0);
    await page.getByLabel('전체 항목 보기', { exact: true }).uncheck();
    assert.equal(await page.locator('.review-field').count(), 5);
    await page.screenshot({ path: '/tmp/mvp2-step31-comparison.png', fullPage: true });
  });
});

test('추가 NULL과 삭제된 필드 및 객체와 배열 순서 차이를 보존한다', async () => {
  await withPage(async (page) => {
    const value = fixture();
    await showDetail(page, value);
    await page.getByRole('heading', { name: '기타 변경 항목', exact: true }).waitFor();
    assert.deepEqual(await page.locator('[data-field="unknownAdded"] .review-value-empty').allTextContents(), ['필드 없음', 'NULL']);
    assert.equal(await page.locator('[data-field="unknownAdded"] .review-change-kind').textContent(), '추가');
    assert.equal(await page.locator('[data-field="unknownRemoved"] .review-change-kind').textContent(), '삭제');
    assert.equal(await page.locator('[data-field="unknownRemoved"] .review-value-empty').textContent(), '필드 없음');
    assert.deepEqual(await page.locator('[data-field="unknownNested"] pre').allTextContents(), [
      JSON.stringify(value.base.raw.unknownNested, null, 2), JSON.stringify(value.target.raw.unknownNested, null, 2),
    ]);
  });
});

test('빈 문자열과 공백 및 줄바꿈과 숫자/문자열의 자료형 차이를 숨기지 않는다', async () => {
  await withPage(async (page) => {
    const value = fixture();
    value.base.raw.plcyExplnCn = '';
    value.target.raw.plcyExplnCn = ' 앞 \n뒤  ';
    value.base.raw.spaces = ' \t';
    value.target.raw.spaces = ' \t\n';
    value.base.raw.typed = 1;
    value.target.raw.typed = '1';
    value.changedFields.push(field(value, 'spaces'), field(value, 'typed'));
    await showDetail(page, value);
    assert.equal(await page.locator('[data-field="plcyExplnCn"] .review-value-empty').textContent(), '빈 문자열 ("")');
    assert.equal(await page.locator('[data-field="plcyExplnCn"] pre').textContent(), value.target.raw.plcyExplnCn);
    assert.deepEqual(await page.locator('[data-field="spaces"] pre').allTextContents(), ['" \\t"', '" \\t\\n"']);
    assert.deepEqual(await page.locator('[data-field="typed"] .review-value-type').allTextContents(), ['숫자', '문자열']);
  });
});

test('긴 원문은 원래 공백과 줄바꿈 및 유니코드를 유지한 채 더보기와 접기로 확인한다', async () => {
  await withPage(async (page) => {
    const value = fixture();
    value.target.raw.plcySprtCn = ' 원문😀 \n'.repeat(100) + '마지막 공백  ';
    value.changedFields.push(field(value, 'plcySprtCn'));
    await showDetail(page, value);
    const row = page.locator('[data-field="plcySprtCn"]');
    assert.ok((await row.locator('pre').textContent()).endsWith('…'));
    const expand = page.getByRole('button', { name: '지원 내용 변경본 더보기', exact: true });
    await expand.click();
    assert.equal(await row.locator('pre').textContent(), value.target.raw.plcySprtCn);
    assert.equal(await page.getByRole('button', { name: '지원 내용 변경본 접기', exact: true }).getAttribute('aria-expanded'), 'true');
    await page.getByRole('button', { name: '지원 내용 변경본 접기', exact: true }).click();
    assert.ok((await row.locator('pre').textContent()).endsWith('…'));
  });
});

test('신규는 기준본 없음과 모든 항목 추가를 표시하고 승인 확인을 취소하면 전송하지 않는다', async () => {
  await withPage(async (page) => {
    const value = fixture();
    value.base = null;
    value.currentPublished = null;
    value.review.kind = 'NEW';
    value.review.baseContentHash = null;
    value.changedFields = Object.keys(value.target.raw).filter((key) => key !== 'inqCnt').map((key) => field(value, key));
    let posts = 0;
    page.on('request', (request) => { if (request.method() === 'POST' && /\/admin\/reviews\//.test(request.url())) posts++; });
    await showDetail(page, value);
    await page.getByText('아직 공개된 정책이 없습니다', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '승인', exact: true }).isEnabled(), true);
    assert.ok((await page.locator('.review-change-kind').allTextContents()).every((text) => text === '추가'));
    await page.getByRole('button', { name: '승인', exact: true }).click();
    await page.getByRole('form', { name: '승인 확인', exact: true }).waitFor();
    await page.getByRole('button', { name: '취소', exact: true }).click();
    assert.equal(await page.getByRole('form', { name: '승인 확인', exact: true }).count(), 0);
    assert.equal(posts, 0);
  });
});

test('신규 승인 이력은 당시 기준본 없음과 현재 공개본을 별도로 표시한다', async () => {
  await withPage(async (page) => {
    const value = fixture();
    value.base = null;
    value.review.kind = 'NEW';
    value.review.baseContentHash = null;
    value.review.status = 'APPROVED';
    value.review.closedAt = '2026-11-04T06:00:00.000Z';
    value.review.reviewedBy = 'fixture-reviewer';
    value.currentPublished = { ...structuredClone(value.target), id: publicId, viewCount: 99 };
    value.canReview = false;
    value.latestPendingReviewId = null;
    value.changedFields = Object.keys(value.target.raw).filter((key) => key !== 'inqCnt').map((key) => field(value, key));
    await showDetail(page, value);
    await page.getByText('후보 생성 당시 공개 기준본', { exact: true }).waitFor();
    await page.getByText('아직 공개된 정책이 없습니다', { exact: true }).waitFor();
    assert.equal(await page.locator('.review-detail-badges .admin-badge').textContent(), '승인됨');
    assert.equal(await page.getByRole('button', { name: '승인', exact: true }).isDisabled(), true);
    await page.locator('.review-current-snapshot summary').click();
    assert.ok((await page.locator('.review-current-snapshot').textContent()).includes(value.target.raw.plcyNm));
  });
});

test('최신 원본이 달라진 과거 후보는 당시 스냅샷을 유지하고 최신 대기 후보로 연결한다', async () => {
  await withPage(async (page) => {
    const old = fixture();
    old.canReview = false;
    old.latestSource.contentHash = 'c'.repeat(64);
    old.latestPendingReviewId = nextId;
    const latest = fixture();
    latest.review.id = nextId;
    latest.review.title = '최신 후보 C';
    latest.target.raw.plcyNm = latest.review.title;
    latest.latestPendingReviewId = nextId;
    await page.route(`**/api/v1/admin/reviews/${nextId}`, (route) => route.fulfill({ json: latest }));
    await showDetail(page, old);
    await page.getByText('이후 수집된 원본 내용이 달라졌습니다. 이 후보는 최신 원본과 다릅니다.', { exact: true }).waitFor();
    assert.deepEqual(await page.locator('[data-field="plcyNm"] pre').allTextContents(), ['기준 정책 A', '검수 정책 B']);
    assert.equal(await page.getByRole('button', { name: '승인', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '거절', exact: true }).isDisabled(), true);
    await page.getByRole('link', { name: '최신 검수 대기 후보 보기 →', exact: true }).click();
    await page.getByRole('heading', { name: '최신 후보 C', exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, `/admin/reviews/${nextId}`);
  });
});

test('현재 공개본이 바뀌어도 기준본을 바꾸지 않고 현재 공개 원문과 링크를 별도로 제공한다', async () => {
  await withPage(async (page) => {
    const value = fixture();
    value.canReview = false;
    value.currentPublished.contentHash = 'c'.repeat(64);
    value.currentPublished.raw.plcyNm = '현재 공개 D';
    await showDetail(page, value);
    await page.getByText('검수 당시와 현재 공개본이 달라졌습니다. 아래 현재 공개본을 확인해 주세요.', { exact: true }).waitFor();
    assert.deepEqual(await page.locator('[data-field="plcyNm"] pre').allTextContents(), ['기준 정책 A', '검수 정책 B']);
    await page.locator('.review-current-snapshot summary').click();
    assert.ok((await page.locator('.review-current-snapshot').textContent()).includes('현재 공개 D'));
    assert.equal(await page.getByRole('link', { name: '현재 공개 정책 보기 →', exact: true }).getAttribute('href'), `/policies/${publicId}`);
    assert.equal(await page.getByRole('button', { name: '승인', exact: true }).isDisabled(), true);
  });
});

test('공개 해시가 같아도 서버의 canReview=false를 따르고 누락만으로는 검수를 차단하지 않는다', async () => {
  await withPage(async (page) => {
    const value = fixture();
    value.canReview = false;
    value.currentPublished.id = nextId;
    await showDetail(page, value);
    await page.getByText('현재 원본 또는 공개 기준이 이 후보와 일치하지 않습니다. 최신 상태를 다시 확인해 주세요.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '거절', exact: true }).isDisabled(), true);
  });
  await withPage(async (page) => {
    const value = fixture();
    value.latestSource.missingCount = 3;
    value.latestSource.lastCollectedAt = null;
    value.latestSource.viewCount = null;
    await showDetail(page, value);
    assert.ok((await page.locator('.review-warning').textContent()).includes('최근 정상 수집에서 3회 연속 확인되지 않았습니다.'));
    assert.ok((await page.locator('.review-facts').textContent()).includes('아직 실제 수집 기록 없음'));
    assert.ok((await page.locator('.review-facts').textContent()).includes('확인되지 않음'));
    assert.equal(await page.getByRole('button', { name: '승인', exact: true }).isEnabled(), true);
  });
});

for (const [status, label] of [['APPROVED', '승인됨'], ['REJECTED', '거절됨'], ['SUPERSEDED', '대체됨']]) {
  test(`${status} 이력은 당시 내용과 종료 상태를 표시하고 처리 버튼을 비활성화한다`, async () => {
    await withPage(async (page) => {
      const value = fixture();
      value.review.status = status;
      value.review.closedAt = '2026-11-04T06:00:00.000Z';
      value.review.reviewedBy = status === 'SUPERSEDED' ? null : 'fixture-reviewer';
      value.review.rejectionReason = status === 'REJECTED' ? '<script>거절 사유</script>\n 사유 원문 ' : null;
      value.review.supersededReason = status === 'SUPERSEDED' ? 'SOURCE_CHANGED' : null;
      value.canReview = false;
      value.latestPendingReviewId = null;
      await showDetail(page, value);
      assert.equal(await page.locator('.review-detail-badges .admin-badge').textContent(), label);
      assert.equal(await page.getByRole('button', { name: '승인', exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: '거절', exact: true }).isDisabled(), true);
      if (status === 'REJECTED') assert.equal(await page.locator('.review-notices pre').textContent(), value.review.rejectionReason);
      if (status === 'SUPERSEDED') assert.equal(await page.getByText('거절 사유', { exact: true }).count(), 0);
      assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
    });
  });
}

test('실제 API에 없는 UUID는 후보 없음 안내를 표시한다', async () => {
  await withPage(async (page) => {
    const id = crypto.randomUUID();
    const response = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/admin/reviews/${id}`);
    await page.goto(`${baseUrl}/admin/reviews/${id}`);
    assert.equal((await response).status(), 404);
    await page.getByRole('heading', { name: '검수 후보가 없습니다', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '승인', exact: true }).count(), 0);
  });
});

for (const failure of ['503', '429', '연결 끊김', '손상 응답']) {
  test(`${failure} 상세 조회는 원문 없는 오류와 재시도를 제공한다`, async () => {
    await withPage(async (page) => {
      let fail = true;
      await page.route(`**/api/v1/admin/reviews/${reviewId}`, (route) => {
        if (!fail) return route.fulfill({ json: fixture() });
        if (failure === '연결 끊김') return route.abort('failed');
        return route.fulfill({ status: failure === '손상 응답' ? 200 : Number(failure), json: { private: '비공개 내부 오류' } });
      });
      await page.goto(`${baseUrl}/admin/reviews/${reviewId}`);
      await page.getByRole('heading', { name: '상세를 불러오지 못했습니다', exact: true }).waitFor();
      assert.equal(await page.locator('.review-field').count(), 0);
      assert.ok(!(await page.locator('main').textContent()).includes('비공개 내부 오류'));
      fail = false;
      await page.getByRole('button', { name: '다시 시도', exact: true }).click();
      await page.getByRole('heading', { name: fixture().review.title, exact: true }).waitFor();
    });
  });
}

test('상세 API의 401은 보호 데이터를 표시하지 않고 로그인으로 이동한다', async () => {
  await withPage(async (page) => {
    let expired = false;
    await page.route('**/api/v1/admin/auth/me', (route) => expired ? route.fulfill({ status: 401, json: {} }) : route.continue());
    await page.route(`**/api/v1/admin/reviews/${reviewId}`, (route) => { expired = true; return route.fulfill({ status: 401, json: {} }); });
    await page.goto(`${baseUrl}/admin/reviews/${reviewId}`);
    await page.waitForURL('**/admin/login');
    await page.getByRole('heading', { name: '관리자 로그인', exact: true }).waitFor();
    assert.equal(await page.locator('.review-field').count(), 0);
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
  });
});

test('상세 조회 중에는 로딩을 표시하고 이전 후보 내용을 노출하지 않는다', async () => {
  await withPage(async (page) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route(`**/api/v1/admin/reviews/${reviewId}`, async (route) => { await gate; await route.fulfill({ json: fixture() }); });
    try {
      await page.goto(`${baseUrl}/admin/reviews/${reviewId}`);
      await page.getByRole('status').filter({ hasText: '검수 상세를 불러오고 있습니다.' }).waitFor();
      assert.equal(await page.locator('.review-field').count(), 0);
      release();
      await page.getByRole('heading', { name: fixture().review.title, exact: true }).waitFor();
    } finally { release(); }
  });
});

test('원문의 HTML과 특수 키를 텍스트로 표시하고 HTTP(S) 링크만 연다', async () => {
  await withPage(async (page) => {
    const value = fixture();
    value.target.raw.plcyExplnCn = '<img src=x onerror="window.injected=true">';
    value.target.raw.aplyUrlAddr = 'javascript:alert(1)';
    value.target.raw.refUrlAddr1 = 'https://example.com/policy?x=1&y=2';
    value.target.raw.refUrlAddr2 = 'data:text/html,<script>alert(1)</script>';
    value.target.raw = { ...value.target.raw, ...JSON.parse('{"__proto__":{"text":"특수 키 원문"}}') };
    for (const key of ['aplyUrlAddr', 'refUrlAddr1', 'refUrlAddr2', '__proto__']) value.changedFields.push(field(value, key));
    await showDetail(page, value);
    assert.equal(await page.locator('.review-field img').count(), 0);
    assert.equal(await page.evaluate(() => window.injected === true), false);
    assert.equal(await page.getByRole('link', { name: '신청 URL 변경본 링크 열기', exact: true }).count(), 0);
    assert.equal(await page.getByRole('link', { name: '참고 URL 2 변경본 링크 열기', exact: true }).count(), 0);
    const link = page.getByRole('link', { name: '참고 URL 1 변경본 링크 열기', exact: true });
    assert.equal(await link.getAttribute('href'), value.target.raw.refUrlAddr1);
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    assert.ok((await page.locator('[data-field="__proto__"]').textContent()).includes('특수 키 원문'));
  });
});

test('좁은 화면에서는 기준본과 변경본을 위아래로 표시하고 긴 원문이 가로로 넘치지 않는다', async () => {
  await withPage(async (page) => {
    const value = fixture();
    value.target.raw.plcyExplnCn = '긴원문'.repeat(300);
    value.review.externalId = '긴외부ID'.repeat(40);
    await showDetail(page, value);
    const [before, after] = await page.locator('[data-field="plcyNm"] .review-value-columns > section').all();
    const beforeBox = await before.boundingBox();
    const afterBox = await after.boundingBox();
    assert.ok(afterBox.y >= beforeBox.y + beforeBox.height);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const toggle = page.getByLabel('전체 항목 보기', { exact: true });
    await toggle.focus();
    await page.keyboard.press('Space');
    assert.equal(await toggle.isChecked(), true);
    await page.screenshot({ path: '/tmp/mvp2-step31-mobile.png', fullPage: true });
  }, { width: 390, height: 844 });
});

/** 처리 응답과 상세 재조회 순서를 기록하고 확정된 서버 상태를 재현 */
async function actionScenario(page, value, handlePost) {
  const calls = [];
  await page.route(`**/api/v1/admin/reviews/${value.review.id}`, (route) => {
    calls.push({ method: 'GET' });
    return route.fulfill({ json: value });
  });
  // 실제 DB에 쓰지 않고 처리 요청 본문과 응답 이후 재조회 흐름을 검증
  await page.route(`**/api/v1/admin/reviews/${value.review.id}/*`, async (route) => {
    assert.equal(route.request().method(), 'POST');
    calls.push({ method: 'POST', path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    await handlePost(route, value);
  });
  await page.goto(`${baseUrl}/admin/reviews/${value.review.id}`);
  await page.getByRole('heading', { name: value.review.title, exact: true }).waitFor();
  return calls;
}

/** 승인과 거절 후 상세에서 반환할 확정 상태를 구성 */
function closeReview(value, status, reason = null) {
  value.review.status = status;
  value.review.reviewedBy = 'fixture-reviewer';
  value.review.closedAt = '2026-11-04T07:00:00.000Z';
  value.review.rejectionReason = reason;
  value.canReview = false;
  value.latestPendingReviewId = null;
  if (status === 'APPROVED') value.currentPublished = { ...structuredClone(value.target), id: publicId, viewCount: 99 };
}

for (const kind of ['CHANGED', 'NEW']) {
  test(`${kind} 승인은 확인 후 두 해시를 전송하고 상세를 다시 조회한다`, async () => {
    await withPage(async (page) => {
      const value = fixture();
      if (kind === 'NEW') { value.review.kind = kind; value.base = null; value.currentPublished = null; value.review.baseContentHash = null; }
      const calls = await actionScenario(page, value, async (route, current) => {
        closeReview(current, 'APPROVED');
        await route.fulfill({ json: { reviewId, status: 'APPROVED', policyId: publicId, closedAt: current.review.closedAt } });
      });
      await page.getByRole('button', { name: '승인', exact: true }).click();
      assert.equal(calls.length, 1);
      await page.getByRole('button', { name: '승인 확정', exact: true }).click();
      await page.getByText('처리가 끝난 검수 이력입니다. 상태: 승인됨', { exact: true }).waitFor();
      assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST', 'GET']);
      assert.deepEqual(calls[1].body, { contentHash: 'b'.repeat(64), baseContentHash: kind === 'NEW' ? null : 'a'.repeat(64) });
      assert.ok(calls[1].path.endsWith('/approve'));
      assert.ok((await page.locator('.review-facts').textContent()).includes('fixture-reviewer'));
      assert.ok((await page.locator('.review-facts').textContent()).includes('2026. 11. 04. 16:00'));
      await page.locator('.review-current-snapshot summary').click();
      assert.ok((await page.locator('.review-current-snapshot').textContent()).includes('검수 정책 B'));
      assert.equal(await page.getByRole('button', { name: '거절', exact: true }).isDisabled(), true);
    });
  });
}

test('거절 사유의 공백과 1001자는 제출하지 않고 1000자 사유를 정리해 전송한다', async () => {
  await withPage(async (page) => {
    const value = fixture();
    const originalPublic = structuredClone(value.currentPublished);
    const prefix = '<img src=x onerror="window.injected=true">\n';
    const reason = prefix + '사'.repeat(1000 - prefix.length);
    assert.equal(reason.length, 1000);
    const calls = await actionScenario(page, value, async (route, current) => {
      closeReview(current, 'REJECTED', route.request().postDataJSON().reason);
      await route.fulfill({ json: { reviewId, status: 'REJECTED', policyId: publicId, closedAt: current.review.closedAt } });
    });
    await page.getByRole('button', { name: '거절', exact: true }).click();
    const input = page.getByLabel('거절 사유 (필수, 1~1000자)', { exact: true });
    for (const invalid of ['', ' \n\t ', '사'.repeat(1001)]) {
      await input.fill(invalid);
      await page.getByRole('button', { name: '거절 확정', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: '1~1000자' }).waitFor();
      assert.equal(calls.length, 1);
    }
    await input.fill(`  ${reason} \n`);
    await page.getByRole('button', { name: '거절 확정', exact: true }).click();
    await page.getByText('처리가 끝난 검수 이력입니다. 상태: 거절됨', { exact: true }).waitFor();
    assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST', 'GET']);
    assert.deepEqual(calls[1].body, { contentHash: 'b'.repeat(64), baseContentHash: 'a'.repeat(64), reason });
    assert.ok(calls[1].path.endsWith('/reject'));
    assert.equal(await page.locator('.review-notices pre').textContent(), reason);
    assert.equal(await page.locator('.review-notices img').count(), 0);
    assert.equal(await page.evaluate(() => window.injected === true), false);
    assert.deepEqual(value.currentPublished, originalPublic);
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
  });
});

test('처리 중 연속 제출은 한 번만 전송하고 확인 폼과 새로고침을 잠근다', async () => {
  await withPage(async (page) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const calls = await actionScenario(page, fixture(), async (route, value) => {
      await gate;
      closeReview(value, 'APPROVED');
      await route.fulfill({ json: {} });
    });
    try {
      await page.getByRole('button', { name: '승인', exact: true }).click();
      await page.getByRole('form', { name: '승인 확인', exact: true }).evaluate((form) => { form.requestSubmit(); form.requestSubmit(); });
      await page.getByRole('status').filter({ hasText: '처리 중입니다.' }).waitFor();
      for (const name of ['승인', '거절', '승인 확정', '취소', '새로고침']) {
        assert.equal(await page.getByRole('button', { name, exact: true }).isDisabled(), true);
      }
      assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
      release();
      await page.getByText('처리가 끝난 검수 이력입니다. 상태: 승인됨', { exact: true }).waitFor();
      assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
    } finally { release(); }
  });
});

for (const code of ['REVIEW_NOT_PENDING', 'REVIEW_CONTENT_CONFLICT', 'REVIEW_BASE_CONFLICT']) {
  test(`${code} 충돌은 상세를 갱신하고 변경 사실을 안내한다`, async () => {
    await withPage(async (page) => {
      const calls = await actionScenario(page, fixture(), async (route, value) => {
        if (code === 'REVIEW_NOT_PENDING') closeReview(value, 'REJECTED', '다른 요청에서 처리됨');
        else { value.canReview = false; value.latestSource.contentHash = 'c'.repeat(64); }
        await route.fulfill({ status: 409, json: { code, message: '내부 원문을 노출하지 않음' } });
      });
      await page.getByRole('button', { name: '승인', exact: true }).click();
      await page.getByRole('button', { name: '승인 확정', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '후보의 내용 또는 처리 상태가 변경되었습니다.' }).waitFor();
      await page.getByRole('heading', { name: fixture().review.title, exact: true }).waitFor();
      assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST', 'GET']);
      assert.equal(await page.getByRole('button', { name: '승인', exact: true }).isDisabled(), true);
      assert.ok(!(await page.locator('main').textContent()).includes('내부 원문을 노출하지 않음'));
    });
  });
}

for (const failure of ['500', '503', '연결 끊김', '승인 후 연결 끊김']) {
  test(`${failure} 처리는 POST를 반복하지 않고 상세에서 확정 여부를 확인한다`, async () => {
    await withPage(async (page) => {
      const calls = await actionScenario(page, fixture(), async (route, value) => {
        if (failure === '승인 후 연결 끊김') closeReview(value, 'APPROVED');
        if (failure.includes('연결 끊김')) await route.abort('failed');
        else await route.fulfill({ status: Number(failure), json: { private: 'DB 내부 오류' } });
      });
      await page.getByRole('button', { name: '승인', exact: true }).click();
      await page.getByRole('button', { name: '승인 확정', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '상태와 처리 정보를 먼저 확인해 주세요.' }).waitFor();
      await page.getByRole('heading', { name: fixture().review.title, exact: true }).waitFor();
      assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST', 'GET']);
      assert.equal(await page.locator('.review-detail-badges .admin-badge').textContent(), failure === '승인 후 연결 끊김' ? '승인됨' : '검수 대기');
      assert.equal(await page.getByRole('form', { name: '승인 확인', exact: true }).count(), 0);
      assert.ok(!(await page.locator('main').textContent()).includes('DB 내부 오류'));
    });
  });
}

test('처리 후 상세 조회까지 실패하면 오류와 GET 재시도만 제공한다', async () => {
  await withPage(async (page) => {
    const value = fixture();
    const calls = await actionScenario(page, value, async (route, current) => {
      closeReview(current, 'APPROVED');
      await route.abort('failed');
    });
    let recovered = false;
    await page.route(`**/api/v1/admin/reviews/${reviewId}`, (route) => {
      calls.push({ method: 'GET' });
      return route.fulfill(recovered ? { json: value } : { status: 503, json: {} });
    });
    await page.getByRole('button', { name: '승인', exact: true }).click();
    await page.getByRole('button', { name: '승인 확정', exact: true }).click();
    await page.getByRole('heading', { name: '상세를 불러오지 못했습니다', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '승인', exact: true }).count(), 0);
    recovered = true;
    await page.getByRole('button', { name: '다시 시도', exact: true }).click();
    await page.getByText('처리가 끝난 검수 이력입니다. 상태: 승인됨', { exact: true }).waitFor();
    assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST', 'GET', 'GET']);
  });
});

test('처리 요청의 401은 로그인으로 이동하고 보호 데이터를 닫는다', async () => {
  await withPage(async (page) => {
    let expired = false;
    await page.route('**/api/v1/admin/auth/me', (route) => expired ? route.fulfill({ status: 401, json: {} }) : route.continue());
    const calls = await actionScenario(page, fixture(), async (route) => {
      expired = true;
      await route.fulfill({ status: 401, json: {} });
    });
    await page.getByRole('button', { name: '거절', exact: true }).click();
    await page.getByLabel('거절 사유 (필수, 1~1000자)', { exact: true }).fill('검토 결과 거절');
    await page.getByRole('button', { name: '거절 확정', exact: true }).click();
    await page.waitForURL('**/admin/login');
    assert.equal(await page.locator('.review-field').count(), 0);
    assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
  });
});

test('모바일 신규 거절은 기준 해시 null을 보내고 공개본 없음과 사유를 표시한다', async () => {
  await withPage(async (page) => {
    const value = fixture();
    value.review.kind = 'NEW';
    value.base = null;
    value.currentPublished = null;
    value.review.baseContentHash = null;
    const calls = await actionScenario(page, value, async (route, current) => {
      closeReview(current, 'REJECTED', route.request().postDataJSON().reason);
      await route.fulfill({ json: { reviewId, status: 'REJECTED', policyId: null, closedAt: current.review.closedAt } });
    });
    await page.getByRole('button', { name: '거절', exact: true }).click();
    const input = page.getByLabel('거절 사유 (필수, 1~1000자)', { exact: true });
    await input.fill('신청 조건 확인 필요');
    assert.equal(await input.evaluate((element) => element === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: '/tmp/mvp2-step32-mobile.png', fullPage: true });
    await page.getByRole('button', { name: '거절 확정', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByText('처리가 끝난 검수 이력입니다. 상태: 거절됨', { exact: true }).waitFor();
    assert.deepEqual(calls[1].body, { contentHash: 'b'.repeat(64), baseContentHash: null, reason: '신청 조건 확인 필요' });
    await page.getByText('현재 공개된 정책이 없습니다.', { exact: true }).waitFor();
    assert.equal(await page.locator('.review-notices pre').textContent(), '신청 조건 확인 필요');
  }, { width: 390, height: 844 });
});

for (const status of [400, 403, 404, 429]) {
  test(`처리 ${status} 응답은 상세 확인 후 새 확인 폼에서만 재시도할 수 있다`, async () => {
    await withPage(async (page) => {
      const calls = await actionScenario(page, fixture(), (route) => route.fulfill({ status, json: { message: '노출하면 안 되는 오류 원문' } }));
      await page.getByRole('button', { name: '승인', exact: true }).click();
      await page.getByRole('button', { name: '승인 확정', exact: true }).click();
      await page.getByRole('heading', { name: fixture().review.title, exact: true }).waitFor();
      await page.getByRole('status').filter({ hasText: status === 429 ? '요청이 많아' : status === 403 ? '요청 출처를' : status === 404 ? '검수 후보를 찾을 수 없습니다.' : '입력값을 확인' }).waitFor();
      assert.equal(await page.getByRole('form', { name: '승인 확인', exact: true }).count(), 0);
      assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST', 'GET']);
      assert.ok(!(await page.locator('main').textContent()).includes('노출하면 안 되는 오류 원문'));
    });
  });
}
