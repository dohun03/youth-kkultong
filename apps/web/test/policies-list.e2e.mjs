import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

// 기존 브라우저 검증 도구의 경로를 받을 수 있어 제품 의존성을 추가하지 않는다.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const baseUrl = process.env.WEB_TEST_URL ?? 'http://127.0.0.1:3000';
const apiUrl = process.env.API_TEST_URL ?? 'http://127.0.0.1:4000';
const emptyResponse = {
  items: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  appliedSort: 'popular',
};
let browser;

before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/** 테스트마다 브라우저 탭을 분리하고 실패하더라도 반드시 닫는다. */
async function withPage(run) {
  const page = await browser.newPage();
  try { await run(page); } finally { await page.close(); }
}

test('실제 DB의 기본 검색 첫 20건·순서·페이지 정보가 루트 이동 후 표시된다', async () => {
  const response = await fetch(`${apiUrl}/api/v1/policies/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(response.status, 200);
  const expected = await response.json();
  assert.equal(expected.appliedSort, 'popular');
  assert.equal(expected.items.length, 20);
  assert.ok(expected.items.every((item) => item.applicationStatus !== 'CLOSED' && item.score === 0));

  await withPage(async (page) => {
    const requested = page.waitForRequest('**/api/v1/policies/search');
    await page.goto(baseUrl);
    const request = await requested;
    assert.equal(request.method(), 'POST');
    assert.deepEqual(request.postDataJSON(), { page: 1, limit: 20, includeClosed: false });
    await page.locator('.policy-list li').first().waitFor();
    assert.equal(new URL(page.url()).pathname, '/policies');
    assert.deepEqual(await page.locator('.policy-list h2').allTextContents(), expected.items.map((item) => item.title));
    const summary = await page.locator('.list-summary').textContent();
    assert.ok(summary.includes(expected.pagination.total.toLocaleString('ko-KR')));
    assert.ok(summary.includes(`1 / ${expected.pagination.totalPages}페이지`));
    assert.ok(summary.includes('인기순'));
    assert.equal(await page.locator('main [role="alert"]').count(), 0);
  });
});

test('응답 대기 중에는 로딩, 정상 0건에는 빈 결과를 표시한다', async () => {
  await withPage(async (page) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route('**/api/v1/policies/search', async (route) => {
      await gate;
      await route.fulfill({ json: emptyResponse });
    });
    await page.goto(`${baseUrl}/policies`);
    await page.getByText('정책 목록을 불러오는 중입니다.').waitFor();
    assert.equal(await page.locator('#empty-title').count(), 0);
    release();
    await page.getByText('표시할 정책이 없습니다').waitFor();
    assert.match(await page.locator('.list-summary').textContent(), /총 0건/);
    assert.doesNotMatch(await page.locator('.list-summary').textContent(), /페이지/);
    assert.equal(await page.locator('main [role="alert"]').count(), 0);
  });
});

for (const status of [400, 500, 503]) {
  test(`HTTP ${status}는 빈 결과와 구분하고 내부 오류를 노출하지 않는다`, async () => {
    await withPage(async (page) => {
      await page.route('**/api/v1/policies/search', (route) => route.fulfill({ status, json: { message: '비공개 서버 오류' } }));
      await page.goto(`${baseUrl}/policies`);
      await page.locator('main [role="alert"]').waitFor();
      assert.equal(await page.locator('#empty-title').count(), 0);
      assert.equal(await page.getByText('비공개 서버 오류').count(), 0);
    });
  });
}

test('연결 실패 후 다시 시도하면 기본 요청으로 정상 결과를 표시한다', async () => {
  await withPage(async (page) => {
    let calls = 0;
    await page.route('**/api/v1/policies/search', (route) => {
      calls += 1;
      return calls === 1 ? route.abort('failed') : route.fulfill({ json: emptyResponse });
    });
    await page.goto(`${baseUrl}/policies`);
    await page.getByRole('button', { name: '다시 시도' }).click();
    await page.locator('#empty-title').waitFor();
    assert.equal(calls, 2);
    assert.equal(await page.locator('main [role="alert"]').count(), 0);
  });
});

test('해석할 수 없는 JSON 응답도 오류로 안내한다', async () => {
  await withPage(async (page) => {
    await page.route('**/api/v1/policies/search', (route) => route.fulfill({ contentType: 'application/json', body: '{' }));
    await page.goto(`${baseUrl}/policies`);
    await page.locator('main [role="alert"]').waitFor();
  });
});

test('15초 동안 응답이 없으면 로딩을 끝내고 재시도를 제공한다', async () => {
  await withPage(async (page) => {
    await page.clock.install();
    const request = page.waitForRequest('**/api/v1/policies/search');
    await page.route('**/api/v1/policies/search', () => {});
    await page.goto(`${baseUrl}/policies`);
    await request;
    await page.clock.fastForward(15_001);
    await page.getByRole('button', { name: '다시 시도' }).waitFor();
    assert.equal(await page.getByText('정책 목록을 불러오는 중입니다.').count(), 0);
  });
});

test('모바일에서 긴 제목과 빈 지원 내용을 표시하고 HTML 원문은 실행하지 않는다', async () => {
  await withPage(async (page) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const title = '<script>window.injected=true</script>' + '긴정책제목'.repeat(50);
    await page.route('**/api/v1/policies/search', (route) => route.fulfill({ json: {
      ...emptyResponse,
      items: [{ id: 'test-policy', title, benefitPreview: '' }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    } }));
    await page.goto(`${baseUrl}/policies`);
    await page.locator('.policy-list h2').waitFor();
    assert.equal(await page.locator('.policy-list h2').textContent(), title);
    assert.ok(await page.locator('.policy-list p').textContent());
    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  });
});
