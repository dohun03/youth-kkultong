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
const listPath = /\/api\/v1\/admin\/reviews(?:\?.*)?$/;
let browser;
let authenticatedCookies;

/** 실제 관리자 로그인으로 받은 쿠키를 이후 화면 검증에서 재사용 */
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

/** 테스트별 쿠키 및 저장소와 화면 크기를 분리하고 종료 시 브라우저 문맥 정리 */
async function withPage(run, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await paceBrowserContext(context);
  await context.addCookies(authenticatedCookies);
  const page = await context.newPage();
  try { await run(page, context); }
  finally { await context.close(); }
}

/** 공용 검수 목록 계약에 맞는 신규와 변경 후보 61건 준비 */
function fixtures() {
  return Array.from({ length: 61 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    sourcePolicyId: '00000000-0000-4000-8001-000000000001', source: 'youthcenter', externalId: `external-${index + 1}`,
    title: `청년 검수 정책 ${String(index + 1).padStart(2, '0')}`, kind: index % 2 === 0 ? 'NEW' : 'CHANGED', status: 'PENDING',
    contentHash: 'a'.repeat(64), baseContentHash: index % 2 === 0 ? null : 'b'.repeat(64),
    createdAt: '2026-11-04T05:05:00.000Z', closedAt: null,
    reviewedBy: null, rejectionReason: null, supersededReason: null,
  }));
}

/** 적용된 필터와 페이지에 맞는 응답을 만들고 실제 전송한 query를 기록 */
function listResponse(url, rows = fixtures()) {
  const query = new URL(url).searchParams;
  const keyword = query.get('keyword') ?? '';
  const selected = rows.filter((row) => (!query.get('kind') || row.kind === query.get('kind'))
    && row.title.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()));
  const page = Number(query.get('page'));
  const limit = Number(query.get('limit'));
  return { items: selected.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total: selected.length, totalPages: Math.ceil(selected.length / limit) } };
}

/** 목록 응답만 대체하고 실제 Next.js 화면과 관리자 인증 및 요청 처리를 유지 */
async function mockList(page, requests = [], rows = fixtures()) {
  await page.route(listPath, (route) => {
    const url = route.request().url();
    requests.push(new URL(url).searchParams);
    assert.equal(route.request().method(), 'GET');
    return route.fulfill({ json: listResponse(url, rows) });
  });
}

/** 이전 화면의 행과 새 결과를 혼동하지 않도록 표시된 제목 전체를 확인 */
async function waitForTitles(page, rows) {
  await page.waitForFunction((titles) => {
    const actual = [...document.querySelectorAll('.admin-review-title h3')].map((element) => element.textContent);
    return document.querySelector('.admin-review-summary') && JSON.stringify(actual) === JSON.stringify(titles);
  }, rows.map((row) => row.title));
}

test('실제 인증과 웹 프록시로 받은 DB 목록 및 기본 query와 브라우저 저장소 비사용을 확인한다', async () => {
  await withPage(async (page, context) => {
    const response = page.waitForResponse(listPath);
    await page.goto(`${baseUrl}/admin/reviews`);
    const result = await response;
    assert.equal(result.status(), 200);
    const expected = await result.json();
    const query = new URL(result.url()).searchParams;
    assert.equal(query.get('status'), 'PENDING');
    assert.equal(query.get('page'), '1');
    assert.equal(query.get('limit'), '20');
    await waitForTitles(page, expected.items);
    assert.ok((await page.locator('.admin-review-summary').textContent()).includes(`${expected.pagination.total.toLocaleString('ko-KR')}건`));
    if (expected.pagination.total === 0) await page.getByRole('heading', { name: '검수 대기 정책이 없습니다.', exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
    assert.ok((await context.cookies()).some((cookie) => cookie.name === 'youth_admin_auth' && cookie.httpOnly));
    await page.screenshot({ path: '/tmp/mvp2-step30-actual.png', fullPage: true });
  });
});

test('제목과 외부 ID 및 신규/변경과 한국 등록 시각을 서버 순서대로 표시한다', async () => {
  await withPage(async (page) => {
    const rows = fixtures().reverse();
    await mockList(page, [], rows);
    await page.goto(`${baseUrl}/admin/reviews`);
    await waitForTitles(page, rows.slice(0, 20));
    assert.equal(await page.locator('.admin-review-row').count(), 20);
    const first = page.locator('.admin-review-row').first();
    assert.ok((await first.textContent()).includes(rows[0].externalId));
    assert.equal(await first.locator('.admin-review-kind').textContent(), '신규');
    assert.equal(await page.locator('.admin-review-kind').nth(1).textContent(), '변경');
    assert.equal(await first.locator('time').getAttribute('datetime'), rows[0].createdAt);
    assert.ok((await first.locator('time').textContent()).includes('14:05'));
    assert.equal(await page.getByRole('button', { name: '처음', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '이전', exact: true }).isDisabled(), true);
    await page.screenshot({ path: '/tmp/mvp2-step30-reviews.png', fullPage: true });
  });
});

test('처음·이전·다음·마지막과 숫자 페이지 이동이 정확하며 결과 안내로 초점을 연결한다', async () => {
  await withPage(async (page) => {
    const rows = fixtures();
    const requests = [];
    await mockList(page, requests);
    await page.goto(`${baseUrl}/admin/reviews`);
    await waitForTitles(page, rows.slice(0, 20));
    for (const [label, expectedPage] of [['다음', 2], ['마지막', 4], ['이전', 3], ['처음', 1], ['3페이지', 3]]) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await waitForTitles(page, rows.slice((expectedPage - 1) * 20, expectedPage * 20));
      assert.equal(requests.at(-1).get('page'), String(expectedPage));
      assert.equal(await page.locator('.admin-pagination [aria-current="page"]').textContent(), String(expectedPage));
      await page.waitForFunction(() => document.activeElement?.classList.contains('admin-review-summary'));
    }
  });
});

test('검색 초안은 전송하지 않고 제출 시 공백 제거와 1페이지 적용 및 조건 초기화가 동작한다', async () => {
  await withPage(async (page) => {
    const requests = [];
    await mockList(page, requests);
    await page.goto(`${baseUrl}/admin/reviews`);
    await waitForTitles(page, fixtures().slice(0, 20));
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await waitForTitles(page, fixtures().slice(20, 40));
    const before = requests.length;
    await page.getByLabel('정책 제목', { exact: true }).fill('  청년 검수 정책 01  ');
    assert.equal(requests.length, before);
    await page.getByRole('button', { name: '검색', exact: true }).click();
    await waitForTitles(page, fixtures().slice(0, 1));
    assert.equal(requests.at(-1).get('keyword'), '청년 검수 정책 01');
    assert.equal(requests.at(-1).get('page'), '1');
    await page.getByRole('button', { name: '조건 초기화', exact: true }).click();
    await waitForTitles(page, fixtures().slice(0, 20));
    assert.equal(requests.at(-1).has('keyword'), false);
    assert.equal(await page.getByLabel('정책 제목', { exact: true }).inputValue(), '');
  });
});

test('종류와 10/20/50개 변경은 1페이지로 돌아가며 다른 적용 조건을 유지한다', async () => {
  await withPage(async (page) => {
    const requests = [];
    const changed = fixtures().filter((row) => row.kind === 'CHANGED');
    await mockList(page, requests);
    await page.goto(`${baseUrl}/admin/reviews`);
    await waitForTitles(page, fixtures().slice(0, 20));
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await waitForTitles(page, fixtures().slice(20, 40));
    await page.getByLabel('종류', { exact: true }).selectOption('CHANGED');
    await waitForTitles(page, changed.slice(0, 20));
    assert.equal(requests.at(-1).get('page'), '1');
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await waitForTitles(page, changed.slice(20));
    for (const limit of [10, 50, 20]) {
      await page.getByLabel('표시 개수', { exact: true }).selectOption(String(limit));
      await waitForTitles(page, changed.slice(0, limit));
      assert.equal(requests.at(-1).get('limit'), String(limit));
      assert.equal(requests.at(-1).get('page'), '1');
      assert.equal(requests.at(-1).get('kind'), 'CHANGED');
    }
  });
});

test('한글과 %, _, &, ?가 들어간 검색어를 query 문자열에 안전하게 담는다', async () => {
  await withPage(async (page) => {
    const requests = [];
    await mockList(page, requests);
    await page.goto(`${baseUrl}/admin/reviews`);
    await waitForTitles(page, fixtures().slice(0, 20));
    const keyword = '청년 %_ & ? 지원';
    await page.getByLabel('정책 제목', { exact: true }).fill(keyword);
    await page.getByRole('button', { name: '검색', exact: true }).click();
    await page.getByRole('heading', { name: '검색 조건에 맞는 검수 대기 정책이 없습니다.', exact: true }).waitFor();
    assert.equal(requests.at(-1).get('keyword'), keyword);
    assert.equal(requests.at(-1).get('status'), 'PENDING');
    assert.deepEqual([...requests.at(-1).keys()].sort(), ['keyword', 'limit', 'page', 'status']);
  });
});

test('빈 DB는 정상 0건 안내를 표시하고 오류 및 페이지 버튼을 표시하지 않는다', async () => {
  await withPage(async (page) => {
    await mockList(page, [], []);
    await page.goto(`${baseUrl}/admin/reviews`);
    await page.getByRole('heading', { name: '검수 대기 정책이 없습니다.', exact: true }).waitFor();
    assert.equal(await page.locator('main [role="alert"]').count(), 0);
    assert.equal(await page.getByRole('navigation', { name: '검수 대기 페이지' }).count(), 0);
    assert.ok((await page.locator('.admin-review-summary').textContent()).includes('0건'));
  });
});

test('조회 중 로딩을 표시하고 결과가 도착하기 전까지 이전 행을 노출하지 않는다', async () => {
  await withPage(async (page) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route(listPath, async (route) => { await gate; await route.fulfill({ json: listResponse(route.request().url()) }); });
    try {
      await page.goto(`${baseUrl}/admin/reviews`);
      await page.getByRole('status').filter({ hasText: '검수 대기 목록을 불러오고 있습니다.' }).waitFor();
      assert.equal(await page.locator('.admin-review-row').count(), 0);
      assert.equal(await page.getByRole('button', { name: '새로고침', exact: true }).isDisabled(), true);
      release();
      await waitForTitles(page, fixtures().slice(0, 20));
    } finally { release(); }
  });
});

for (const failure of ['503', '429', '연결 끊김', '손상 응답']) {
  test(`${failure} 상황을 빈 목록으로 처리하지 않고 같은 조건으로 재시도한다`, async () => {
    await withPage(async (page) => {
      let fail = true;
      await page.route(listPath, (route) => {
        if (!fail) return route.fulfill({ json: listResponse(route.request().url()) });
        if (failure === '연결 끊김') return route.abort('failed');
        return route.fulfill({ status: failure === '손상 응답' ? 200 : Number(failure), json: { message: '표시하면 안 되는 내부 오류 원문' } });
      });
      await page.goto(`${baseUrl}/admin/reviews`);
      await page.getByRole('heading', { name: '목록을 불러오지 못했습니다', exact: true }).waitFor();
      assert.equal(await page.locator('.admin-review-row').count(), 0);
      assert.ok(!(await page.locator('main').textContent()).includes('표시하면 안 되는 내부 오류 원문'));
      if (failure === '429') assert.ok((await page.locator('main [role="alert"]').textContent()).includes('요청이 많습니다.'));
      fail = false;
      await page.getByRole('button', { name: '다시 시도', exact: true }).click();
      await waitForTitles(page, fixtures().slice(0, 20));
      await page.waitForFunction(() => document.activeElement?.classList.contains('admin-review-summary'));
    });
  });
}

test('목록의 401은 이전 행을 지우고 로그인으로 이동하며 관리자 데이터를 저장소에 남기지 않는다', async () => {
  await withPage(async (page) => {
    let expired = false;
    await page.route('**/api/v1/admin/auth/me', (route) => expired ? route.fulfill({ status: 401, json: {} }) : route.continue());
    await page.route(listPath, (route) => expired ? route.fulfill({ status: 401, json: {} }) : route.fulfill({ json: listResponse(route.request().url()) }));
    await page.goto(`${baseUrl}/admin/reviews`);
    await waitForTitles(page, fixtures().slice(0, 20));
    expired = true;
    await page.getByRole('button', { name: '새로고침', exact: true }).click();
    await page.waitForURL('**/admin/login');
    await page.getByRole('heading', { name: '관리자 로그인', exact: true }).waitFor();
    assert.equal(await page.locator('.admin-review-row').count(), 0);
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
  });
});

test('이전 검색의 늦은 응답은 최신 검색 결과를 덮어쓰지 않는다', async () => {
  await withPage(async (page) => {
    let oldRoute;
    let oldArrived;
    const oldReady = new Promise((resolve) => { oldArrived = resolve; });
    await page.route(listPath, (route) => {
      const keyword = new URL(route.request().url()).searchParams.get('keyword');
      if (keyword === '이전') { oldRoute = route; oldArrived(); return; }
      return route.fulfill({ json: listResponse(route.request().url(), keyword === '최신' ? [{ ...fixtures()[0], title: '최신 결과' }] : fixtures()) });
    });
    await page.goto(`${baseUrl}/admin/reviews`);
    await waitForTitles(page, fixtures().slice(0, 20));
    await page.getByLabel('정책 제목', { exact: true }).fill('이전');
    await page.getByRole('button', { name: '검색', exact: true }).click();
    await oldReady;
    await page.getByLabel('정책 제목', { exact: true }).fill('최신');
    await page.getByRole('button', { name: '검색', exact: true }).click();
    await waitForTitles(page, [{ title: '최신 결과' }]);
    await oldRoute.fulfill({ json: { items: [{ ...fixtures()[0], title: '이전 결과' }], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } } }).catch(() => {});
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await page.locator('.admin-review-title h3').allTextContents(), ['최신 결과']);
  });
});

test('선택한 후보 UUID의 상세 경로로 키보드 이동하고 목록으로 복귀할 수 있다', async () => {
  await withPage(async (page) => {
    await mockList(page);
    await page.goto(`${baseUrl}/admin/reviews`);
    await waitForTitles(page, fixtures().slice(0, 20));
    const link = page.getByRole('link', { name: fixtures()[0].title, exact: true });
    assert.equal(await link.getAttribute('href'), `/admin/reviews/${fixtures()[0].id}`);
    await link.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(`**/admin/reviews/${fixtures()[0].id}`);
    await page.getByRole('heading', { name: '검수 상세', exact: true }).waitFor();
    assert.ok((await page.locator('.admin-review-id').textContent()).includes(fixtures()[0].id));
    await page.getByRole('link', { name: '← 검수 대기 목록으로', exact: true }).click();
    await waitForTitles(page, fixtures().slice(0, 20));
  });
});

test('좁은 화면에서 긴 제목과 외부 ID 및 HTML을 안전한 텍스트로 표시하고 가로 넘침이 없다', async () => {
  await withPage(async (page) => {
    const title = '<img src=x onerror="window.injected=true"> 긴 제목 '.repeat(8);
    const rows = [{ ...fixtures()[0], title, externalId: '외부식별자'.repeat(60) }];
    await mockList(page, [], rows);
    await page.goto(`${baseUrl}/admin/reviews`);
    await waitForTitles(page, rows);
    assert.equal(await page.locator('.admin-review-title img').count(), 0);
    assert.equal(await page.evaluate(() => window.injected === true), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.getByLabel('표시 개수', { exact: true }).isVisible(), true);
    assert.equal(await page.getByRole('button', { name: '다음', exact: true }).isDisabled(), true);
    await page.screenshot({ path: '/tmp/mvp2-step30-mobile.png', fullPage: true });
  }, { width: 390, height: 844 });
});
