import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = process.env.WEB_TEST_URL ?? 'http://127.0.0.1:3000';
const api = process.env.API_TEST_URL ?? 'http://127.0.0.1:4000';
let browser;
let list;
let detail;
before(async () => {
  browser = await chromium.launch({ headless: true });
  list = await (await fetch(`${api}/api/v1/policies/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  detail = await (await fetch(`${api}/api/v1/policies/${list.items[0].id}`)).json();
});
after(async () => { await browser?.close(); });

/** 테스트마다 브라우저 세션을 분리하고 키보드·화면 결과를 함께 확인한다. */
async function withPage(run) {
  const page = await browser.newPage();
  try { await run(page); } finally { await page.close(); }
}

/** 화면이 갱신된 뒤 실제 초점이 목표 요소에 도달했는지 확인한다. */
async function expectFocus(page, selector) {
  await page.waitForFunction((selector) => document.activeElement === document.querySelector(selector), selector);
}

test('키보드 본문 건너뛰기·입력 레이블·필터 입력 초점을 유지한다', async () => {
  await withPage(async (page) => {
    await page.goto(`${base}/policies`);
    await page.locator('.policy-card').first().waitFor();
    await page.keyboard.press('Tab');
    await expectFocus(page, '.skip-link');
    await page.keyboard.press('Enter');
    await expectFocus(page, '#main-content');
    assert.equal(await page.locator('html').getAttribute('lang'), 'ko');
    assert.deepEqual(await page.locator('input, select').evaluateAll((fields) => fields.filter((field) => !field.labels?.length).map((field) => field.id)), []);
    await page.locator('#policy-age').focus();
    await page.keyboard.type('28');
    await page.locator('.list-summary').filter({ hasText: '맞춤순' }).waitFor();
    await expectFocus(page, '#policy-age');
    await page.keyboard.press('Tab');
    await expectFocus(page, '.age-clear-button');
    await page.keyboard.press('Enter');
    await page.locator('.list-summary').filter({ hasText: '인기순' }).waitFor();
  });
});

test('페이지 이동 실패·재시도·성공 후 초점을 오류 제목과 결과 요약으로 이어준다', async () => {
  await withPage(async (page) => {
    let failed = false;
    await page.route('**/policies/search', (route) => {
      const { page: number } = route.request().postDataJSON();
      if (number === 2 && !failed) { failed = true; return route.fulfill({ status: 503, json: {} }); }
      return route.fulfill({ json: { ...list, pagination: { ...list.pagination, page: number } } });
    });
    await page.goto(`${base}/policies`);
    const next = page.getByRole('button', { name: '다음', exact: true });
    await next.focus();
    await page.keyboard.press('Enter');
    await expectFocus(page, '#error-title');
    await page.getByRole('button', { name: '다시 시도', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expectFocus(page, '.list-summary');
    assert.match(await page.locator('.list-summary').textContent(), /2 \/ /);
    await page.getByRole('button', { name: '이전', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expectFocus(page, '.list-summary');
    assert.match(await page.locator('.list-summary').textContent(), /1 \/ /);
  });
});

test('느린 목록은 상태 안내를 제공하고 빈 결과에는 조건 조정 방법을 표시한다', async () => {
  await withPage(async (page) => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    await page.route('**/policies/search', async (route) => {
      await pending;
      await route.fulfill({ json: { ...list, items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } } });
    });
    await page.goto(`${base}/policies`);
    await page.getByRole('status').filter({ hasText: '정책 목록을 불러오는 중입니다.' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: '표시할 정책이 없습니다' }).count(), 0);
    release();
    await page.getByRole('heading', { name: '표시할 정책이 없습니다' }).waitFor();
    await page.locator('#policy-age').fill('28');
    await page.getByText('분야나 입력 조건을 줄이거나 마감 포함을 선택해 다시 찾아보세요.').waitFor();
    assert.equal(await page.getByRole('navigation', { name: '정책 목록 페이지' }).count(), 0);
  });
});

test('상세 지연·오류·재시도·불명확한 기간·링크 없음과 키보드 펼침을 안내한다', async () => {
  await withPage(async (page) => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    let calls = 0;
    await page.route(`**/api/v1/policies/${detail.id}`, async (route) => {
      if (++calls === 1) { await pending; return route.fulfill({ status: 503, json: {} }); }
      if (calls === 2) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: { ...detail, applicationStatus: 'UNKNOWN', applicationPeriodText: '접수일은 기관 공지 참고', applicationEndDate: null, links: [], description: '긴 정책 설명입니다.\n'.repeat(30), regionText: '서울특별시 강남구, 경기도 수원시' } });
    });
    await page.goto(`${base}/policies/${detail.id}`);
    await page.getByRole('status').filter({ hasText: '정책 상세를 불러오는 중입니다.' }).waitFor();
    assert.equal(await page.locator('h1').count(), 1);
    release();
    await page.getByRole('button', { name: '다시 시도' }).focus();
    await page.keyboard.press('Enter');
    await expectFocus(page, '.empty-state h1');
    await page.getByRole('button', { name: '다시 시도' }).focus();
    await page.keyboard.press('Enter');
    await expectFocus(page, '.detail-heading h1');
    assert.match(await page.locator('.detail-period-help').textContent(), /공식 신청처/);
    assert.match(await page.locator('.detail-no-links').textContent(), /제공된 신청·참고 링크가 없습니다/);
    const more = page.getByRole('button', { name: '정책 설명 더보기' });
    await more.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.getByRole('button', { name: '정책 설명 접기' }).getAttribute('aria-expanded'), 'true');
    const summary = page.locator('.detail-region-group summary').first();
    await summary.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.detail-region-group').first().getAttribute('open'), '');
  });
});

test('320px·640px에서 필터·상세가 넘치지 않고 주요 조작 영역을 확보한다', async () => {
  await withPage(async (page) => {
    for (const width of [320, 640]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/policies`);
      await page.locator('.policy-card').first().waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      for (const selector of ['#policy-category', '#policy-age', '#policy-sort', '.closed-filter', '.age-clear-button']) {
        assert.ok((await page.locator(selector).boundingBox()).height >= 44, selector);
      }
      if (width === 320) await page.screenshot({ path: '/tmp/youth-step53-list-mobile.png', fullPage: false });
      await page.goto(`${base}/policies/${detail.id}`);
      await page.locator('.detail-heading h1').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      if (width === 320) await page.screenshot({ path: '/tmp/youth-step53-detail-mobile.png', fullPage: false });
    }
  });
});
