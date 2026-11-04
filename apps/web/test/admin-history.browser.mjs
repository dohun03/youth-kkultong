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

/** 종료 시각과 처리자 및 사유를 포함한 세 상태의 이력 자료 준비 */
function fixtures() {
  return Array.from({ length: 61 }, (_, index) => {
    const status = ['APPROVED', 'REJECTED', 'SUPERSEDED'][index % 3];
    return { id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      sourcePolicyId: '00000000-0000-4000-8001-000000000001', source: 'youthcenter', externalId: `history-${index + 1}`,
      title: `처리 정책 ${String(index + 1).padStart(2, '0')}`, kind: index % 2 === 0 ? 'NEW' : 'CHANGED', status,
      contentHash: 'a'.repeat(64), baseContentHash: index % 2 === 0 ? null : 'b'.repeat(64),
      createdAt: '2026-11-04T05:00:00.000Z', closedAt: '2026-11-04T07:00:00.000Z',
      reviewedBy: status === 'SUPERSEDED' ? null : 'fixture-reviewer',
      rejectionReason: status === 'REJECTED' ? '조건 보완 필요\n다시 확인해 주세요.' : null,
      supersededReason: status === 'SUPERSEDED' ? 'SOURCE_CHANGED' : null };
  });
}

/** 적용된 필터와 페이지에 맞는 응답을 만들고 실제 전송한 query를 기록 */
function listResponse(url, rows = fixtures()) {
  const query = new URL(url).searchParams;
  const keyword = query.get('keyword') ?? '';
  const selected = rows.filter((row) => (query.get('status') === 'PROCESSED' || row.status === query.get('status'))
    && (!query.get('sourcePolicyId') || row.sourcePolicyId === query.get('sourcePolicyId'))
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
    const actual = [...document.querySelectorAll('.admin-review-title a')].map((element) => element.textContent);
    return document.querySelector('.admin-review-summary') && JSON.stringify(actual) === JSON.stringify(titles);
  }, rows.map((row) => row.title));
}

test('실제 이력 API와 웹 프록시 및 같은 정책의 과거 스냅샷을 연결한다', async () => {
  await withPage(async (page, context) => {
    const result = page.waitForResponse(listPath);
    await page.goto(`${baseUrl}/admin/history`);
    const response = await result;
    assert.equal(response.status(), 200);
    assert.equal(new URL(response.url()).searchParams.get('status'), 'PROCESSED');
    const expected = await response.json();
    await waitForTitles(page, expected.items);
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
    await page.screenshot({ path: '/tmp/mvp2-step33-actual.png', fullPage: true });
    // 실제 DB의 대체 이력에서 최신 후보와 이전 이력을 오가며 같은 원본 조건과 스냅샷 확인
    const old = expected.items.find((item) => item.status === 'SUPERSEDED');
    if (!old) return;
    const api = await context.request.get(`${baseUrl}/api/v1/admin/reviews/${old.id}`);
    assert.equal(api.status(), 200);
    const oldDetail = await api.json();
    await page.locator(`a[href="/admin/reviews/${old.id}"]`).click();
    await page.waitForURL(`**/admin/reviews/${old.id}`);
    await page.locator('.review-detail-heading h3').filter({ hasText: old.title }).waitFor();
    const samePolicyResponse = page.waitForResponse((r) => listPath.test(r.url())
      && new URL(r.url()).searchParams.get('sourcePolicyId') === old.sourcePolicyId);
    await page.getByRole('button', { name: '같은 정책의 처리 이력 보기', exact: true }).click();
    const samePolicy = await (await samePolicyResponse).json();
    assert.ok(samePolicy.items.some((item) => item.id === old.id));
    assert.ok(samePolicy.items.every((item) => item.sourcePolicyId === old.sourcePolicyId && item.status !== 'PENDING'));
    const region = page.getByRole('region', { name: '같은 정책의 처리 이력', exact: true });
    await region.getByText('현재 보고 있는 이력', { exact: true }).waitFor();
    assert.equal(await region.locator('.status-superseded').textContent(), '대체됨');
    assert.equal(await page.getByRole('button', { name: '승인', exact: true }).isDisabled(), true);
    if (oldDetail.latestPendingReviewId) {
      await page.getByRole('link', { name: '최신 검수 대기 후보 보기 →', exact: true }).click();
      await page.getByRole('button', { name: '같은 정책의 처리 이력 보기', exact: true }).click();
      await region.locator(`a[href="/admin/reviews/${old.id}"]`).waitFor();
      const pendingList = page.waitForResponse((r) => listPath.test(r.url()) && new URL(r.url()).searchParams.get('sourcePolicyId') === old.sourcePolicyId);
      await region.getByRole('button', { name: '새로고침', exact: true }).click();
      const same = await (await pendingList).json();
      assert.ok(same.items.every((item) => item.sourcePolicyId === old.sourcePolicyId && item.status !== 'PENDING'));
      await region.locator(`a[href="/admin/reviews/${old.id}"]`).click();
      await page.getByRole('button', { name: '승인', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '승인', exact: true }).isDisabled(), true);
    }
    await page.getByRole('link', { name: '처리 이력 목록으로', exact: true }).click();
    await page.getByRole('heading', { name: '처리 이력', exact: true }).waitFor();
  });
});

test('세 종료 상태와 한국 처리 시각 및 거절과 대체 사유를 구분하고 서버 순서를 유지한다', async () => {
  await withPage(async (page) => {
    const rows = fixtures().reverse();
    await mockList(page, [], rows);
    await page.goto(`${baseUrl}/admin/history`);
    await waitForTitles(page, rows.slice(0, 20));
    const all = page.locator('.admin-review-row');
    assert.equal(await all.count(), 20);
    for (let index = 0; index < 3; index++) {
      const item = rows[index];
      const row = all.nth(index);
      assert.equal(await row.locator('time').getAttribute('datetime'), item.closedAt);
      assert.ok((await row.locator('time').textContent()).includes('16:00'));
      assert.ok((await row.textContent()).includes(item.status === 'SUPERSEDED' ? '시스템 자동 대체' : 'fixture-reviewer'));
      if (item.status === 'SUPERSEDED') {
        assert.ok((await row.textContent()).includes('대체 사유'));
        assert.ok(!(await row.textContent()).includes('거절 사유'));
      }
      if (item.status === 'REJECTED') assert.equal(await row.locator('.admin-history-reason dd').textContent(), item.rejectionReason);
    }
  });
});

test('상태와 표시 개수 변경은 첫 페이지로 돌아가고 제목 검색과 초기화가 동작한다', async () => {
  await withPage(async (page) => {
    const requests = [];
    await mockList(page, requests);
    await page.goto(`${baseUrl}/admin/history`);
    await waitForTitles(page, fixtures().slice(0, 20));
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await waitForTitles(page, fixtures().slice(20, 40));
    for (const status of ['REJECTED', 'SUPERSEDED', 'APPROVED']) {
      await page.getByLabel('처리 상태', { exact: true }).selectOption(status);
      await waitForTitles(page, fixtures().filter((row) => row.status === status).slice(0, 20));
      assert.equal(requests.at(-1).get('page'), '1');
      assert.equal(requests.at(-1).get('status'), status);
    }
    for (const limit of [10, 50, 20]) {
      await page.getByLabel('표시 개수', { exact: true }).selectOption(String(limit));
      await waitForTitles(page, fixtures().filter((row) => row.status === 'APPROVED').slice(0, limit));
      assert.equal(requests.at(-1).get('limit'), String(limit));
      assert.equal(requests.at(-1).get('page'), '1');
    }
    const count = requests.length;
    await page.getByLabel('정책 제목', { exact: true }).fill('  처리 정책 01  ');
    assert.equal(requests.length, count);
    await page.getByRole('button', { name: '검색', exact: true }).click();
    await waitForTitles(page, [fixtures()[0]]);
    assert.equal(requests.at(-1).get('keyword'), '처리 정책 01');
    assert.equal(requests.at(-1).get('status'), 'APPROVED');
    await page.getByRole('button', { name: '조건 초기화', exact: true }).click();
    await waitForTitles(page, fixtures().slice(0, 20));
    assert.equal(requests.at(-1).get('status'), 'PROCESSED');
  });
});

test('처음과 이전 및 다음과 마지막과 숫자 페이지를 이동하고 결과로 초점을 연결한다', async () => {
  await withPage(async (page) => {
    const rows = fixtures();
    const requests = [];
    await mockList(page, requests);
    await page.goto(`${baseUrl}/admin/history`);
    await waitForTitles(page, rows.slice(0, 20));
    for (const [label, expectedPage] of [['다음', 2], ['마지막', 4], ['이전', 3], ['처음', 1], ['3페이지', 3]]) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await waitForTitles(page, rows.slice((expectedPage - 1) * 20, expectedPage * 20));
      assert.equal(requests.at(-1).get('page'), String(expectedPage));
      await page.waitForFunction(() => document.activeElement?.classList.contains('admin-review-summary'));
    }
  });
});

test('메타문자 제목을 안전하게 전송하고 필터 빈 결과를 안내한다', async () => {
  await withPage(async (page) => {
    const requests = [];
    const rows = fixtures();
    const keyword = '청년 %_ &?';
    rows[0].title = keyword;
    await mockList(page, requests, rows);
    await page.goto(`${baseUrl}/admin/history`);
    await waitForTitles(page, rows.slice(0, 20));
    await page.getByLabel('정책 제목', { exact: true }).fill(keyword);
    await page.getByRole('button', { name: '검색', exact: true }).click();
    await waitForTitles(page, [rows[0]]);
    assert.equal(requests.at(-1).get('keyword'), keyword);
    await page.getByLabel('처리 상태', { exact: true }).selectOption('SUPERSEDED');
    await page.getByRole('heading', { name: '검색 조건에 맞는 처리 이력이 없습니다.', exact: true }).waitFor();
  });
});

test('이력이 없으면 정상 빈 결과를 표시한다', async () => {
  await withPage(async (page) => {
    await mockList(page, [], []);
    await page.goto(`${baseUrl}/admin/history`);
    await page.getByRole('heading', { name: '처리 이력이 없습니다.', exact: true }).waitFor();
    assert.equal(await page.locator('main [role="alert"]').count(), 0);
    assert.equal(await page.getByRole('navigation', { name: '처리 이력 페이지', exact: true }).count(), 0);
  });
});

for (const failure of ['503', '429', '연결 끊김', '손상 응답', '대기 상태 섞임']) {
  test(`${failure} 이력 응답은 빈 결과로 표시하지 않고 재시도를 제공한다`, async () => {
    await withPage(async (page) => {
      let fail = true;
      await page.route(listPath, (route) => {
        if (!fail) return route.fulfill({ json: listResponse(route.request().url()) });
        if (failure === '연결 끊김') return route.abort('failed');
        if (failure === '대기 상태 섞임') {
          const result = listResponse(route.request().url());
          result.items[0].status = 'PENDING';
          return route.fulfill({ json: result });
        }
        return route.fulfill({ status: failure === '손상 응답' ? 200 : Number(failure), json: { private: '내부 오류 원문' } });
      });
      await page.goto(`${baseUrl}/admin/history`);
      await page.getByRole('heading', { name: '목록을 불러오지 못했습니다', exact: true }).waitFor();
      assert.equal(await page.locator('.admin-review-row').count(), 0);
      assert.ok(!(await page.locator('main').textContent()).includes('내부 오류 원문'));
      fail = false;
      await page.getByRole('button', { name: '다시 시도', exact: true }).click();
      await waitForTitles(page, fixtures().slice(0, 20));
    });
  });
}

test('이력 조회의 401은 보호 데이터를 닫고 로그인으로 이동한다', async () => {
  await withPage(async (page) => {
    let expired = false;
    await page.route('**/api/v1/admin/auth/me', (route) => expired ? route.fulfill({ status: 401, json: {} }) : route.continue());
    await page.route(listPath, (route) => { expired = true; return route.fulfill({ status: 401, json: {} }); });
    await page.goto(`${baseUrl}/admin/history`);
    await page.waitForURL('**/admin/login');
    assert.equal(await page.locator('.admin-review-row').count(), 0);
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
  });
});

test('모바일에서 긴 거절 사유와 HTML을 텍스트로 표시하고 키보드 검색을 지원한다', async () => {
  await withPage(async (page) => {
    const row = fixtures()[1];
    row.title = '<img src=x onerror="window.injected=true">긴 제목';
    row.rejectionReason = '<script>window.injected=true</script>\n' + '긴사유'.repeat(300);
    row.externalId = '긴외부ID'.repeat(40);
    await mockList(page, [], [row]);
    await page.goto(`${baseUrl}/admin/history`);
    await waitForTitles(page, [row]);
    assert.equal(await page.locator('.admin-history img, .admin-history script').count(), 0);
    assert.equal(await page.locator('.admin-history-reason dd').textContent(), row.rejectionReason);
    assert.equal(await page.evaluate(() => window.injected === true), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByLabel('정책 제목', { exact: true }).fill(row.title);
    await page.keyboard.press('Enter');
    await waitForTitles(page, [row]);
    await page.screenshot({ path: '/tmp/mvp2-step33-mobile.png', fullPage: true });
  }, { width: 390, height: 844 });
});

test('이력 로딩 중에는 이전 행을 숨기고 새 필터 결과만 표시한다', async () => {
  await withPage(async (page) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await mockList(page);
    await page.goto(`${baseUrl}/admin/history`);
    await waitForTitles(page, fixtures().slice(0, 20));
    await page.route(listPath, async (route) => { await gate; await route.fulfill({ json: listResponse(route.request().url()) }); });
    try {
      await page.getByLabel('처리 상태', { exact: true }).selectOption('REJECTED');
      await page.getByRole('status').filter({ hasText: '처리 이력 목록을 불러오고 있습니다.' }).waitFor();
      assert.equal(await page.locator('.admin-review-row').count(), 0);
      release();
      await waitForTitles(page, fixtures().filter((row) => row.status === 'REJECTED').slice(0, 20));
    } finally { release(); }
  });
});

test('조회 도중 건수가 줄어 페이지가 비면 첫 페이지로 복귀한다', async () => {
  await withPage(async (page) => {
    let rows = fixtures();
    await page.route(listPath, (route) => route.fulfill({ json: listResponse(route.request().url(), rows) }));
    await page.goto(`${baseUrl}/admin/history`);
    await waitForTitles(page, rows.slice(0, 20));
    rows = rows.slice(0, 3);
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await page.getByRole('heading', { name: '현재 페이지에 처리 이력이 없습니다.', exact: true }).waitFor();
    await page.getByRole('button', { name: '첫 페이지로', exact: true }).click();
    await waitForTitles(page, rows);
  });
});

for (const [reason, label] of [
  ['SOURCE_CHANGED', '더 최근의 원본이 수집됨'], ['PUBLIC_BASE_CHANGED', '공개 기준본이 변경됨'],
  ['MATCHES_PUBLIC', '최신 원본이 공개본과 같아짐'], ['PREVIOUSLY_REJECTED', '이미 거절된 내용과 같아짐'],
]) {
  test(`${reason} 시스템 대체는 관리자 거절과 구분한다`, async () => {
    await withPage(async (page) => {
      const row = fixtures()[2];
      row.supersededReason = reason;
      await mockList(page, [], [row]);
      await page.goto(`${baseUrl}/admin/history`);
      await waitForTitles(page, [row]);
      assert.equal(await page.locator('.admin-history-reason dd').textContent(), label);
      assert.ok((await page.locator('.admin-review-meta').textContent()).includes('시스템 자동 대체'));
      assert.equal(await page.getByText('거절 사유', { exact: true }).count(), 0);
    });
  });
}
