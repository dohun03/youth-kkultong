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

/** API 계약에 맞는 카드를 준비하고 각 테스트에서 확인할 필드만 덮어쓴다. */
function makePolicy(overrides = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    title: '청년 지원 정책',
    category: '주거',
    subcategory: '주거비 지원',
    benefitPreview: '매월 주거비를 지원합니다.',
    applicationStatus: 'OPEN',
    applicationPeriodText: '2026-01-01 ~ 2026-12-31',
    applicationEndDate: '2026-12-31',
    viewCount: 1234,
    score: 0,
    tags: [],
    ...overrides,
  };
}

/** 목록 조회만 대체해 실제 Next.js 화면에서 카드 표시를 확인한다. */
async function showPolicies(page, items) {
  await page.route('**/api/v1/policies/search', (route) => route.fulfill({ json: {
    ...emptyResponse,
    items,
    pagination: { page: 1, limit: 20, total: items.length, totalPages: 1 },
  } }));
  await page.goto(`${baseUrl}/policies`);
  await page.locator('.policy-card').first().waitFor();
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
    assert.equal(await page.locator('.policy-card').count(), 20);
    assert.equal(await page.locator('.policy-disclaimer').count(), 20);
    assert.equal(await page.locator('.tag-match').count(), 0);
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
      items: [makePolicy({ title, benefitPreview: '' })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    } }));
    await page.goto(`${baseUrl}/policies`);
    await page.locator('.policy-list h2').waitFor();
    assert.equal(await page.locator('.policy-list h2').textContent(), title);
    assert.ok(await page.locator('.policy-benefit').textContent());
    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  });
});

test('분야·중분류·신청기간·조회수와 신청 상태 6종을 한국어로 표시한다', async () => {
  await withPage(async (page) => {
    const states = [
      ['ALWAYS_OPEN', '상시'], ['UPCOMING', '접수 예정'], ['OPEN', '신청 가능'],
      ['CLOSING_SOON', '마감 임박'], ['CLOSED', '마감'], ['UNKNOWN', '확인 필요'],
    ];
    await showPolicies(page, states.map(([applicationStatus], index) => makePolicy({ id: String(index), applicationStatus })));
    assert.deepEqual(await page.locator('.application-status').allTextContents(), states.map(([, label]) => label));
    const card = page.locator('.policy-card').first();
    assert.match(await card.locator('.policy-category').textContent(), /주거 · 주거비 지원/);
    assert.deepEqual(await card.locator('dd').allTextContents(), ['2026-01-01 ~ 2026-12-31', '1,234회']);
    assert.equal(await page.locator('.policy-disclaimer').count(), states.length);
  });
});

test('일치·확인 태그 9종은 API 판정대로 표시하고 자격 확정이나 점수를 강조하지 않는다', async () => {
  await withPage(async (page) => {
    const tags = ['AGE_MATCH', 'JOB_MATCH', 'SCHOOL_MATCH', 'REGION_RELATED', 'EXTRA_REVIEW', 'AGE_REVIEW', 'JOB_REVIEW', 'SCHOOL_REVIEW', 'REGION_REVIEW'];
    await showPolicies(page, [makePolicy({ tags, score: 3.5 })]);
    assert.deepEqual(await page.locator('.policy-tags li').allTextContents(), [
      '나이 기준 부합', '취업 상태 부합', '학력 기준 부합', '지역 관련', '추가 조건 확인',
      '나이 확인 필요', '취업 확인 필요', '학력 확인 필요', '지역 확인 필요',
    ]);
    assert.equal(await page.locator('.tag-match').count(), 4);
    assert.equal(await page.locator('.tag-review').count(), 5);
    assert.doesNotMatch(await page.locator('.policy-card').textContent(), /3\.5점|자격 충족|신청 자격 확정/);
  });
});

test('빈 혜택·분야·기간·조회수에는 확인 문구를, 조회수 0에는 0회를 표시한다', async () => {
  await withPage(async (page) => {
    await showPolicies(page, [
      makePolicy({ benefitPreview: ' \n ', category: null, subcategory: null, applicationStatus: 'UNKNOWN', applicationPeriodText: null, applicationEndDate: null, viewCount: null }),
      makePolicy({ id: 'second', applicationPeriodText: null, viewCount: 0 }),
      makePolicy({ id: 'third', applicationStatus: 'ALWAYS_OPEN', applicationPeriodText: null, applicationEndDate: null }),
    ]);
    const cards = page.locator('.policy-card');
    assert.equal(await cards.nth(0).locator('.policy-benefit').textContent(), '지원 내용은 공식 신청처에서 확인해 주세요.');
    assert.equal(await cards.nth(0).locator('.policy-category').textContent(), '분야 확인 필요');
    assert.deepEqual(await cards.nth(0).locator('dd').allTextContents(), ['신청기간 확인 필요', '확인 필요']);
    assert.deepEqual(await cards.nth(1).locator('dd').allTextContents(), ['신청 마감 2026-12-31', '0회']);
    assert.equal(await cards.nth(2).locator('dd').first().textContent(), '상시 신청');
    assert.equal(await page.locator('.policy-tags').count(), 0);
  });
});

test('복수 신청기간 원문은 확인 필요 상태와 함께 보존한다', async () => {
  await withPage(async (page) => {
    const raw = '1차: 2026.01.01~01.31\n2차: 예산 소진 시까지';
    await showPolicies(page, [makePolicy({ applicationStatus: 'UNKNOWN', applicationPeriodText: raw, applicationEndDate: null })]);
    assert.equal(await page.locator('.application-status').textContent(), '확인 필요');
    assert.equal(await page.locator('.policy-facts dd').first().textContent(), raw);
  });
});

test('지원 요약의 HTML·공백을 정리하고 이모지를 손상 없이 120자로 줄인다', async () => {
  await withPage(async (page) => {
    await showPolicies(page, [
      makePolicy({ benefitPreview: '<style>숨길 스타일</style><script>window.injected=true</script><p>매월&nbsp;  20만원</p>\n 지원' }),
      makePolicy({ id: 'long', benefitPreview: '🍯'.repeat(150) }),
    ]);
    const summaries = await page.locator('.policy-benefit').allTextContents();
    assert.equal(summaries[0], '매월 20만원 지원');
    assert.equal(summaries[1], '🍯'.repeat(119) + '…');
    assert.equal(Array.from(summaries[1]).length, 120);
    assert.equal(await page.evaluate(() => window.injected), undefined);
  });
});

test('긴 분야·기간·태그가 모바일 너비를 넘지 않고 키보드로 상세 경로를 선택한다', async () => {
  await withPage(async (page) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const policy = makePolicy({
      title: '긴 정책 제목'.repeat(15), category: '긴분야'.repeat(50),
      applicationStatus: 'CLOSING_SOON', applicationPeriodText: '긴 신청기간 안내'.repeat(30),
      tags: ['AGE_MATCH', 'JOB_MATCH', 'EXTRA_REVIEW', 'REGION_REVIEW'],
    });
    await showPolicies(page, [policy]);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const link = page.locator('.policy-card-link');
    assert.equal(await link.getAttribute('href'), `/policies/${policy.id}`);
    await link.focus();
    assert.equal(await link.evaluate((element) => element === document.activeElement), true);
    // 상세 본문은 Step 51에서 구현한다. 여기서는 카드 선택 후 실제 이동 경로까지 확인한다.
    await Promise.all([page.waitForURL(`**/policies/${policy.id}`), page.keyboard.press('Enter')]);
  });
});
