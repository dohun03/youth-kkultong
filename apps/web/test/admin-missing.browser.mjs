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
const listPath = /\/api\/v1\/admin\/source-policies\/missing(?:\?.*)?$/;
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

/** 공개본과 대기의 네 조합 및 실제 수집 시각 NULL을 포함한 누락 원본 자료 */
function fixtures() {
  return Array.from({ length: 61 }, (_, index) => ({
    sourcePolicyId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    source: 'youthcenter', externalId: `missing-${index + 1}`, title: `누락 정책 ${String(index + 1).padStart(2, '0')}`,
    policyId: index % 2 === 0 ? `00000000-0000-4000-8001-${String(index + 1).padStart(12, '0')}` : null,
    latestPendingReviewId: index % 4 < 2 ? `00000000-0000-4000-8002-${String(index + 1).padStart(12, '0')}` : null,
    contentHash: 'a'.repeat(64), missingCount: 61 - index,
    lastCollectedAt: index % 3 === 0 ? null : '2026-11-04T05:05:00.000Z',
  }));
}

/** 적용된 필터와 페이지에 맞는 응답을 만들고 실제 전송한 query를 기록 */
function listResponse(url, rows = fixtures()) {
  const query = new URL(url).searchParams;
  const keyword = query.get('keyword') ?? '';
  const selected = rows.filter((row) => row.missingCount >= Number(query.get('minMissingCount'))
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

test('실제 누락 API와 기본 조건 및 미공개 체험 후보의 상세 링크를 확인한다', async () => {
  await withPage(async (page) => {
    const pending = page.waitForResponse(listPath);
    await page.goto(`${baseUrl}/admin/missing`);
    const response = await pending;
    assert.equal(response.status(), 200);
    const query = new URL(response.url()).searchParams;
    assert.equal(query.get('minMissingCount'), '1');
    assert.equal(query.get('page'), '1');
    assert.equal(query.get('limit'), '20');
    const result = await response.json();
    await waitForTitles(page, result.items);
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
    await page.screenshot({ path: '/tmp/mvp2-step34-actual.png', fullPage: true });
    const linked = result.items.find((item) => item.latestPendingReviewId);
    if (linked) {
      const row = page.locator('.admin-review-row').filter({ has: page.getByRole('heading', { name: linked.title, exact: true }) });
      await row.getByRole('link', { name: '검수 대기 보기 →', exact: true }).click();
      await page.waitForURL(`**/admin/reviews/${linked.latestPendingReviewId}`);
      await page.locator('.review-detail-heading').waitFor();
      assert.ok((await page.locator('.review-warning').allTextContents()).some((text) => text.includes(`${linked.missingCount}회 연속`)));
    }
  });
});

test('공개본과 대기의 네 조합을 표시하고 누락 횟수와 NULL 수집 시각을 보존한다', async () => {
  await withPage(async (page) => {
    const rows = fixtures();
    await mockList(page);
    await page.goto(`${baseUrl}/admin/missing`);
    await waitForTitles(page, rows.slice(0, 20));
    for (let i = 0; i < 4; i++) {
      const row = page.locator('.admin-review-row').nth(i);
      assert.ok((await row.textContent()).includes(`${rows[i].missingCount}회`));
      assert.equal(await row.locator('.admin-badge').textContent(), rows[i].policyId ? '공개 중' : '미공개');
      assert.equal(await row.getByRole('link', { name: '공개 정책 보기 →', exact: true }).count(), rows[i].policyId ? 1 : 0);
      assert.equal(await row.getByRole('link', { name: '검수 대기 보기 →', exact: true }).count(), rows[i].latestPendingReviewId ? 1 : 0);
      if (rows[i].policyId) assert.equal(await row.getByRole('link', { name: '공개 정책 보기 →', exact: true }).getAttribute('href'), `/policies/${rows[i].policyId}`);
      if (rows[i].latestPendingReviewId) assert.equal(await row.getByRole('link', { name: '검수 대기 보기 →', exact: true }).getAttribute('href'), `/admin/reviews/${rows[i].latestPendingReviewId}`);
      if (rows[i].lastCollectedAt === null) {
        assert.ok((await row.textContent()).includes('아직 실제 수집 기록 없음'));
        assert.equal(await row.locator('time').count(), 0);
      } else {
        assert.equal(await row.locator('time').getAttribute('datetime'), rows[i].lastCollectedAt);
        assert.ok((await row.locator('time').textContent()).includes('14:05'));
      }
    }
    assert.ok((await page.locator('.admin-review-row').nth(3).textContent()).includes('연결할 공개본과 대기 후보가 없습니다.'));
    assert.equal(await page.getByRole('button', { name: /삭제|비공개|수정/ }).count(), 0);
  });
});

test('제목과 최소 횟수 초안은 제출할 때 함께 적용하고 첫 페이지로 돌아간다', async () => {
  await withPage(async (page) => {
    const rows = fixtures();
    const requests = [];
    await mockList(page, requests);
    await page.goto(`${baseUrl}/admin/missing`);
    await waitForTitles(page, rows.slice(0, 20));
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await waitForTitles(page, rows.slice(20, 40));
    const count = requests.length;
    await page.getByLabel('최소 누락 횟수', { exact: true }).fill('50');
    await page.getByLabel('정책 제목', { exact: true }).fill('  누락 정책 0  ');
    assert.equal(requests.length, count);
    await page.getByRole('button', { name: '검색', exact: true }).click();
    await waitForTitles(page, rows.slice(0, 9));
    assert.equal(requests.at(-1).get('page'), '1');
    assert.equal(requests.at(-1).get('minMissingCount'), '50');
    assert.equal(requests.at(-1).get('keyword'), '누락 정책 0');
    await page.getByRole('button', { name: '조건 초기화', exact: true }).click();
    await waitForTitles(page, rows.slice(0, 20));
    assert.equal(requests.at(-1).get('minMissingCount'), '1');
    assert.equal(await page.getByLabel('최소 누락 횟수', { exact: true }).inputValue(), '1');
  });
});

test('최소 누락 횟수의 빈 값과 0 및 음수와 소수 및 범위 초과는 전송하지 않는다', async () => {
  await withPage(async (page) => {
    const requests = [];
    await mockList(page, requests);
    await page.goto(`${baseUrl}/admin/missing`);
    await waitForTitles(page, fixtures().slice(0, 20));
    const count = requests.length;
    for (const input of ['', '0', '-1', '1.5', '1e2', '2147483648']) {
      await page.getByLabel('최소 누락 횟수', { exact: true }).fill(input);
      await page.getByRole('button', { name: '검색', exact: true }).click();
      await page.locator('#missing-filter-error').waitFor();
      assert.equal(requests.length, count);
      assert.equal(await page.getByLabel('최소 누락 횟수', { exact: true }).getAttribute('aria-invalid'), 'true');
    }
    await page.getByLabel('최소 누락 횟수', { exact: true }).fill('2147483647');
    await page.getByRole('button', { name: '검색', exact: true }).click();
    await page.getByRole('heading', { name: '검색 조건에 맞는 누락 정책이 없습니다.', exact: true }).waitFor();
    assert.equal(requests.at(-1).get('minMissingCount'), '2147483647');
  });
});

test('표시 개수를 바꾸면 적용된 조건을 유지하며 첫 페이지부터 읽는다', async () => {
  await withPage(async (page) => {
    const requests = [];
    await mockList(page, requests);
    await page.goto(`${baseUrl}/admin/missing`);
    await waitForTitles(page, fixtures().slice(0, 20));
    for (const limit of [10, 50, 20]) {
      await page.getByLabel('표시 개수', { exact: true }).selectOption(String(limit));
      await waitForTitles(page, fixtures().slice(0, limit));
      assert.equal(requests.at(-1).get('limit'), String(limit));
      assert.equal(requests.at(-1).get('page'), '1');
    }
  });
});

test('처음과 이전 및 다음과 마지막과 숫자 페이지 이동 후 결과로 초점을 연결한다', async () => {
  await withPage(async (page) => {
    const rows = fixtures();
    const requests = [];
    await mockList(page, requests);
    await page.goto(`${baseUrl}/admin/missing`);
    await waitForTitles(page, rows.slice(0, 20));
    for (const [label, expectedPage] of [['다음', 2], ['마지막', 4], ['이전', 3], ['처음', 1], ['3페이지', 3]]) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await waitForTitles(page, rows.slice((expectedPage - 1) * 20, expectedPage * 20));
      assert.equal(requests.at(-1).get('page'), String(expectedPage));
      await page.waitForFunction(() => document.activeElement?.classList.contains('admin-review-summary'));
    }
  });
});

test('제목의 메타문자를 안전하게 전송하고 검색 빈 결과를 안내한다', async () => {
  await withPage(async (page) => {
    const requests = [];
    const rows = fixtures();
    rows[0].title = '청년 %_ &?';
    await mockList(page, requests, rows);
    await page.goto(`${baseUrl}/admin/missing`);
    await waitForTitles(page, rows.slice(0, 20));
    await page.getByLabel('정책 제목', { exact: true }).fill(rows[0].title);
    await page.getByRole('button', { name: '검색', exact: true }).click();
    await waitForTitles(page, [rows[0]]);
    assert.equal(requests.at(-1).get('keyword'), rows[0].title);
    await page.getByLabel('최소 누락 횟수', { exact: true }).fill('100');
    await page.getByRole('button', { name: '검색', exact: true }).click();
    await page.getByRole('heading', { name: '검색 조건에 맞는 누락 정책이 없습니다.', exact: true }).waitFor();
  });
});

test('누락 원본이 없으면 오류와 구분해 정상 0건을 표시한다', async () => {
  await withPage(async (page) => {
    await mockList(page, [], []);
    await page.goto(`${baseUrl}/admin/missing`);
    await page.getByRole('heading', { name: '누락 정책이 없습니다.', exact: true }).waitFor();
    assert.equal(await page.locator('main [role="alert"]').count(), 0);
    assert.equal(await page.getByRole('navigation', { name: '누락 정책 페이지', exact: true }).count(), 0);
  });
});

test('다시 수집된 원본이 응답에서 빠지면 새로고침 후 누락 목록에서 사라진다', async () => {
  await withPage(async (page) => {
    let rows = fixtures().slice(0, 4);
    await page.route(listPath, (route) => route.fulfill({ json: listResponse(route.request().url(), rows) }));
    await page.goto(`${baseUrl}/admin/missing`);
    await waitForTitles(page, rows);
    rows = rows.slice(1);
    await page.getByRole('button', { name: '새로고침', exact: true }).click();
    await waitForTitles(page, rows);
    assert.equal(await page.getByRole('heading', { name: fixtures()[0].title, exact: true }).count(), 0);
  });
});

for (const failure of ['503', '429', '연결 끊김', '손상 응답', '잘못된 링크', '잘못된 수집 시각', '최소 횟수 미달']) {
  test(`${failure} 응답은 안전한 오류와 같은 조건의 재시도를 제공한다`, async () => {
    await withPage(async (page) => {
      let fail = true;
      await page.route(listPath, (route) => {
        if (!fail) return route.fulfill({ json: listResponse(route.request().url()) });
        if (failure === '연결 끊김') return route.abort('failed');
        if (['잘못된 링크', '잘못된 수집 시각', '최소 횟수 미달'].includes(failure)) {
          const result = listResponse(route.request().url());
          if (failure === '잘못된 링크') result.items[0].policyId = 'javascript:alert(1)';
          if (failure === '잘못된 수집 시각') result.items[0].lastCollectedAt = 'invalid-date';
          if (failure === '최소 횟수 미달') result.items[0].missingCount = 0;
          return route.fulfill({ json: result });
        }
        return route.fulfill({ status: failure === '손상 응답' ? 200 : Number(failure), json: { private: '내부 오류 원문' } });
      });
      await page.goto(`${baseUrl}/admin/missing`);
      await page.getByRole('heading', { name: '목록을 불러오지 못했습니다', exact: true }).waitFor();
      assert.equal(await page.locator('.admin-review-row').count(), 0);
      assert.ok(!(await page.locator('main').textContent()).includes('내부 오류 원문'));
      fail = false;
      await page.getByRole('button', { name: '다시 시도', exact: true }).click();
      await waitForTitles(page, fixtures().slice(0, 20));
    });
  });
}

test('누락 목록의 401은 보호 데이터를 닫고 로그인으로 이동한다', async () => {
  await withPage(async (page) => {
    let expired = false;
    await page.route('**/api/v1/admin/auth/me', (route) => expired ? route.fulfill({ status: 401, json: {} }) : route.continue());
    await page.route(listPath, (route) => { expired = true; return route.fulfill({ status: 401, json: {} }); });
    await page.goto(`${baseUrl}/admin/missing`);
    await page.waitForURL('**/admin/login');
    assert.equal(await page.locator('.admin-review-row').count(), 0);
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
  });
});

test('응답을 기다리는 동안 이전 행을 숨기고 새 결과만 표시한다', async () => {
  await withPage(async (page) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await mockList(page);
    await page.goto(`${baseUrl}/admin/missing`);
    await waitForTitles(page, fixtures().slice(0, 20));
    await page.route(listPath, async (route) => { await gate; await route.fulfill({ json: listResponse(route.request().url()) }); });
    try {
      await page.getByRole('button', { name: '새로고침', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '누락 정책 목록을 불러오고 있습니다.' }).waitFor();
      assert.equal(await page.locator('.admin-review-row').count(), 0);
      release();
      await waitForTitles(page, fixtures().slice(0, 20));
    } finally { release(); }
  });
});

test('건수가 감소해 페이지가 비면 첫 페이지로 돌아갈 수 있다', async () => {
  await withPage(async (page) => {
    let rows = fixtures();
    await page.route(listPath, (route) => route.fulfill({ json: listResponse(route.request().url(), rows) }));
    await page.goto(`${baseUrl}/admin/missing`);
    await waitForTitles(page, rows.slice(0, 20));
    rows = rows.slice(0, 3);
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await page.getByRole('heading', { name: '현재 페이지에 누락 정책이 없습니다.', exact: true }).waitFor();
    await page.getByRole('button', { name: '첫 페이지로', exact: true }).click();
    await waitForTitles(page, rows);
  });
});

test('모바일에서 긴 제목과 HTML을 텍스트로 표시하고 키보드 검색을 지원한다', async () => {
  await withPage(async (page) => {
    const row = fixtures()[3];
    row.title = '<img src=x onerror="window.injected=true">' + '긴제목'.repeat(30);
    row.externalId = '긴외부ID'.repeat(40);
    await mockList(page, [], [row]);
    await page.goto(`${baseUrl}/admin/missing`);
    await waitForTitles(page, [row]);
    assert.equal(await page.locator('.admin-missing img').count(), 0);
    assert.equal(await page.evaluate(() => window.injected === true), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByLabel('정책 제목', { exact: true }).fill('긴제목');
    await page.keyboard.press('Enter');
    await waitForTitles(page, [row]);
    await page.screenshot({ path: '/tmp/mvp2-step34-mobile.png', fullPage: true });
  }, { width: 390, height: 844 });
});

test('이전 검색의 늦은 응답은 최신 누락 목록을 덮어쓰지 않는다', async () => {
  await withPage(async (page) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route(listPath, async (route) => {
      if (new URL(route.request().url()).searchParams.get('keyword') === '누락 정책 01') await gate;
      try { await route.fulfill({ json: listResponse(route.request().url()) }); } catch { /* 취소된 이전 요청의 응답을 정리 */ }
    });
    try {
      await page.goto(`${baseUrl}/admin/missing`);
      await waitForTitles(page, fixtures().slice(0, 20));
      await page.getByLabel('정책 제목', { exact: true }).fill('누락 정책 01');
      const oldRequest = page.waitForRequest((request) => listPath.test(request.url()) && new URL(request.url()).searchParams.get('keyword') === '누락 정책 01');
      await page.getByRole('button', { name: '검색', exact: true }).click();
      await oldRequest;
      await page.getByLabel('정책 제목', { exact: true }).fill('누락 정책 02');
      await page.getByRole('button', { name: '검색', exact: true }).click();
      await waitForTitles(page, [fixtures()[1]]);
      release();
      await page.getByRole('button', { name: '새로고침', exact: true }).click();
      await waitForTitles(page, [fixtures()[1]]);
    } finally { release(); }
  });
});
