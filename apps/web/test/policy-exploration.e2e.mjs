import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = process.env.WEB_TEST_URL ?? 'http://127.0.0.1:3000';
const api = process.env.API_TEST_URL ?? 'http://127.0.0.1:4000';
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/** 각 탐색 시나리오를 별도 탭에서 실행하고 반드시 닫는다. */
async function withPage(run) {
  const page = await browser.newPage();
  try { await run(page); } finally { await page.close(); }
}

/** 실제 API의 기대 응답을 읽되 조건 원문은 출력하거나 저장하지 않는다. */
async function search(body = {}) {
  const response = await fetch(`${api}/api/v1/policies/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  return response.json();
}

/** React의 결과 반영까지 기다려 실제 API와 제목·순서를 비교한다. */
async function expectResult(page, result) {
  await page.waitForFunction((titles) => JSON.stringify(Array.from(document.querySelectorAll('.policy-list h2'), (item) => item.textContent)) === JSON.stringify(titles), result.items.map((item) => item.title));
  await page.locator('.list-summary').waitFor();
  assert.ok((await page.locator('.list-summary').textContent()).includes(result.pagination.total.toLocaleString('ko-KR')));
}

test('공식 취업·학력 선택·복수 조건·해제가 실제 API 결과와 일치한다', async () => {
  const codes = await (await fetch(`${api}/api/v1/meta/eligibility-codes`)).json();
  await withPage(async (page) => {
    await page.goto(`${base}/policies`);
    await page.locator('#jobCode:not([disabled])').waitFor();
    assert.deepEqual(await page.locator('#jobCode option').allTextContents(), ['선택 안 함', ...codes.jobCodes.map((item) => item.label)]);
    assert.deepEqual(await page.locator('#schoolCode option').allTextContents(), ['선택 안 함', ...codes.schoolCodes.map((item) => item.label)]);
    const jobCode = codes.jobCodes[0].code;
    const schoolCode = codes.schoolCodes[0].code;
    await page.selectOption('#jobCode', jobCode);
    await expectResult(page, await search({ conditions: { jobCode } }));
    await page.selectOption('#schoolCode', schoolCode);
    const expected = await search({ conditions: { jobCode, schoolCode } });
    await expectResult(page, expected);
    const tags = expected.items.flatMap((item) => item.tags);
    assert.equal(await page.getByText('취업 상태 부합', { exact: true }).count(), tags.filter((tag) => tag === 'JOB_MATCH').length);
    assert.equal(await page.getByText('학력 기준 부합', { exact: true }).count(), tags.filter((tag) => tag === 'SCHOOL_MATCH').length);
    await page.selectOption('#jobCode', '');
    await expectResult(page, await search({ conditions: { schoolCode } }));
    await page.selectOption('#schoolCode', '');
    await expectResult(page, await search());
    assert.match(await page.locator('.list-summary').textContent(), /인기순/);
    assert.equal(new URL(page.url()).search, '');
    assert.deepEqual(await page.evaluate(() => [sessionStorage.length, localStorage.length]), [0, 0]);
  });
});

test('자격 선택지 실패·재시도와 미확인 코드 전송 방어', async () => {
  const codes = await (await fetch(`${api}/api/v1/meta/eligibility-codes`)).json();
  await withPage(async (page) => {
    let calls = 0;
    const requests = [];
    page.on('request', (request) => { if (request.url().endsWith('/policies/search')) requests.push(request.postDataJSON()); });
    await page.route('**/meta/eligibility-codes', (route) => ++calls === 1 ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: codes }));
    await page.goto(`${base}/policies`);
    await page.getByRole('button', { name: '취업·학력 다시 시도' }).waitFor();
    await expectResult(page, await search());
    assert.equal(await page.locator('#jobCode').isDisabled(), true);
    await page.getByRole('button', { name: '취업·학력 다시 시도' }).click();
    await page.locator('#jobCode:not([disabled])').waitFor();
    await page.locator('#jobCode').evaluate((select) => { select.add(new Option('미확인', 'invalid')); select.value = 'invalid'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.equal(requests.length, 1);
    await page.selectOption('#jobCode', codes.jobCodes[0].code);
    await expectResult(page, await search({ conditions: { jobCode: codes.jobCodes[0].code } }));
  });
});

test('현행 부모 관계로 시·도·시·구를 선택하고 해제해도 지역 불일치 정책을 제외하지 않는다', async () => {
  const regions = await (await fetch(`${api}/api/v1/meta/regions`)).json();
  const initial = await search();
  await withPage(async (page) => {
    await page.goto(`${base}/policies`);
    await page.locator('#region-0:not([disabled])').waitFor();
    assert.deepEqual(await page.locator('#region-0 option').evaluateAll((options) => options.slice(1).map((item) => item.value)), regions.filter((item) => item.parentCode === null).map((item) => item.code));
    await page.selectOption('#region-0', '41000');
    await page.selectOption('#region-1', '41110');
    assert.deepEqual(await page.locator('#region-2 option').evaluateAll((options) => options.slice(1).map((item) => item.value)), regions.filter((item) => item.parentCode === '41110').map((item) => item.code));
    await page.selectOption('#region-2', '41111');
    const expected = await search({ conditions: { regionCode: '41111' } });
    await expectResult(page, expected);
    assert.equal(expected.pagination.total, initial.pagination.total);
    assert.ok(expected.items.some((item) => item.tags.includes('REGION_RELATED') && item.score === 0.5));
    assert.equal(await page.getByText('지역 관련', { exact: true }).count(), expected.items.filter((item) => item.tags.includes('REGION_RELATED')).length);
    await page.selectOption('#region-0', '11000');
    await expectResult(page, await search({ conditions: { regionCode: '11000' } }));
    assert.equal(await page.locator('#region-2').count(), 0);
    await page.selectOption('#region-0', '');
    await expectResult(page, initial);
    assert.equal(await page.locator('#region-1').count(), 0);
  });
});

test('지역 조회 실패 시 다른 탐색을 유지하고 재시도로 현행 선택지만 복구한다', async () => {
  const regions = await (await fetch(`${api}/api/v1/meta/regions`)).json();
  await withPage(async (page) => {
    let calls = 0;
    await page.route('**/meta/regions', (route) => ++calls === 1 ? route.fulfill({ status: 500, json: {} }) : route.fulfill({ json: regions }));
    await page.goto(`${base}/policies`);
    await page.getByRole('button', { name: '지역 다시 시도' }).waitFor();
    await expectResult(page, await search());
    await page.getByRole('button', { name: '지역 다시 시도' }).click();
    await page.locator('#region-0:not([disabled])').waitFor();
    assert.equal(await page.locator('#region-0 option').count(), regions.filter((item) => item.parentCode === null).length + 1);
  });
});

test('네 정렬은 실제 응답 순서와 적용값을 표시하고 수동 정렬은 조건 변경에도 유지한다', async () => {
  await withPage(async (page) => {
    await page.goto(`${base}/policies`);
    await expectResult(page, await search());
    assert.equal(await page.locator('#policy-sort').inputValue(), 'popular');
    assert.equal(await page.locator('#policy-sort option[value="recommended"]').isDisabled(), true);
    await page.locator('#policy-age').fill('28');
    await expectResult(page, await search({ conditions: { age: 28 } }));
    assert.equal(await page.locator('#policy-sort').inputValue(), 'recommended');
    for (const sort of ['deadline', 'newest', 'popular', 'recommended']) {
      await page.selectOption('#policy-sort', sort);
      await expectResult(page, await search({ conditions: { age: 28 }, sort }));
      assert.equal(await page.locator('#policy-sort').inputValue(), sort);
    }
    await page.getByRole('button', { name: '나이 지우기' }).click();
    await expectResult(page, await search({ sort: 'popular' }));
    assert.equal(await page.locator('#policy-sort').inputValue(), 'popular');
    assert.equal(await page.locator('#policy-sort option[value="recommended"]').isDisabled(), true);
    await page.selectOption('#policy-sort', 'newest');
    await expectResult(page, await search({ sort: 'newest' }));
    await page.locator('#policy-age').fill('28');
    await expectResult(page, await search({ sort: 'newest', conditions: { age: 28 } }));
    await page.getByRole('button', { name: '나이 지우기' }).click();
    await expectResult(page, await search({ sort: 'newest' }));
    assert.equal(await page.locator('#policy-sort').inputValue(), 'newest');
  });
});

test('실제 첫·다음·이전·마지막 페이지의 순서·중복·경계를 검증한다', async () => {
  await withPage(async (page) => {
    const first = await search();
    await page.goto(`${base}/policies`);
    await expectResult(page, first);
    const nav = page.getByRole('navigation', { name: '정책 목록 페이지' });
    assert.equal(await nav.getByRole('button', { name: '이전', exact: true }).isDisabled(), true);
    await nav.getByRole('button', { name: '다음', exact: true }).click();
    const second = await search({ page: 2 });
    await expectResult(page, second);
    assert.equal(await nav.locator('[aria-current="page"]').textContent(), '2');
    assert.equal(first.items.filter((item) => second.items.some((other) => other.id === item.id)).length, 0);
    await nav.getByRole('button', { name: '이전', exact: true }).click();
    await expectResult(page, first);
    await nav.getByRole('button', { name: '마지막', exact: true }).click();
    await expectResult(page, await search({ page: first.pagination.totalPages }));
    assert.equal(await nav.getByRole('button', { name: '다음', exact: true }).isDisabled(), true);
    assert.equal(await nav.getByRole('button', { name: '마지막', exact: true }).isDisabled(), true);
    await nav.getByRole('button', { name: '처음', exact: true }).click();
    await expectResult(page, first);
  });
});

test('페이지 이동은 모든 조건·정렬을 유지하고 각 필터 변경은 1페이지로 돌아간다', async () => {
  await withPage(async (page) => {
    const requests = [];
    await page.route('**/api/v1/policies/search', (route) => {
      const body = route.request().postDataJSON(); requests.push(body);
      return route.fulfill({ json: { items: [{ id: 'test', title: `요청 ${requests.length}`, category: null, subcategory: null, benefitPreview: '', applicationStatus: 'UNKNOWN', applicationPeriodText: null, applicationEndDate: null, viewCount: null, score: 0, tags: [] }], pagination: { page: body.page, limit: 20, total: 100, totalPages: 5 }, appliedSort: body.sort ?? (body.conditions ? 'recommended' : 'popular') } });
    });
    await page.goto(`${base}/policies`);
    await page.locator('.policy-card').waitFor();
    const change = async (action) => {
      const response = page.waitForResponse('**/policies/search');
      await action(); await response; await page.locator('.policy-card').waitFor();
    };
    const next = () => change(() => page.getByRole('button', { name: '다음', exact: true }).click());
    await change(() => page.locator('#policy-age').fill('28'));
    await change(() => page.selectOption('#jobCode', '0013001'));
    await change(() => page.selectOption('#schoolCode', '0049001'));
    await change(() => page.selectOption('#region-0', '11000'));
    await change(() => page.selectOption('#policy-sort', 'newest'));
    await next();
    assert.deepEqual(requests.at(-1), { page: 2, limit: 20, includeClosed: false, sort: 'newest', conditions: { age: 28, jobCode: '0013001', schoolCode: '0049001', regionCode: '11000' } });
    for (const action of [
      () => page.selectOption('#policy-category', '주거'),
      () => page.getByLabel('마감 포함').check(),
      () => page.locator('#policy-age').fill('29'),
      () => page.selectOption('#jobCode', ''),
      () => page.selectOption('#schoolCode', ''),
      () => page.selectOption('#region-0', ''),
      () => page.selectOption('#policy-sort', 'deadline'),
    ]) {
      await change(action);
      assert.equal(requests.at(-1).page, 1);
      await next();
      assert.equal(requests.at(-1).page, 2);
    }
  });
});

test('빈 결과에는 페이지 이동이 없고 한 페이지는 양끝 이동을 비활성화한다', async () => {
  for (const total of [0, 1]) {
    await withPage(async (page) => {
      await page.route('**/policies/search', (route) => route.fulfill({ json: { items: [], pagination: { page: 1, limit: 20, total, totalPages: total }, appliedSort: 'popular' } }));
      await page.goto(`${base}/policies`);
      await page.locator('#empty-title').waitFor();
      const nav = page.getByRole('navigation', { name: '정책 목록 페이지' });
      if (total === 0) assert.equal(await nav.count(), 0);
      else for (const name of ['처음', '이전', '다음', '마지막']) assert.equal(await nav.getByRole('button', { name, exact: true }).isDisabled(), true);
    });
  }
});

test('2페이지 오류 후 재시도는 요청한 페이지를 유지한다', async () => {
  const fixture = await search();
  await withPage(async (page) => {
    let failed = false;
    const requested = [];
    await page.route('**/policies/search', (route) => {
      const body = route.request().postDataJSON(); requested.push(body.page);
      if (body.page === 2 && !failed) { failed = true; return route.fulfill({ status: 503, json: {} }); }
      return route.fulfill({ json: { ...fixture, pagination: { ...fixture.pagination, page: body.page } } });
    });
    await page.goto(`${base}/policies`);
    await page.locator('.policy-card').first().waitFor();
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await page.getByRole('button', { name: '다시 시도', exact: true }).click();
    await page.locator('.list-summary').filter({ hasText: '2 /' }).waitFor();
    assert.deepEqual(requested, [1, 2, 2]);
  });
});

test('실제 목록 카드에서 상세로 이동해 원문과 자격·기간·공식 링크를 표시한다', async () => {
  const first = (await search()).items[0];
  const expected = await (await fetch(`${api}/api/v1/policies/${first.id}`)).json();
  await withPage(async (page) => {
    await page.goto(`${base}/policies`);
    await page.locator('.policy-card-link').first().click();
    await page.waitForURL(`**/policies/${first.id}`);
    await page.locator('.detail-heading h1').waitFor();
    assert.equal(await page.locator('h1').textContent(), expected.title);
    assert.equal(await page.locator('#benefit-title + p').textContent(), expected.benefitText?.trim() ? expected.benefitText : '공식 신청처에서 확인해 주세요.');
    assert.equal(await page.locator('#description-title + p').textContent(), expected.description?.trim() ? expected.description : '공식 신청처에서 확인해 주세요.');
    assert.deepEqual(await page.locator('.policy-facts dd').allTextContents(), [expected.ageRangeText, expected.jobConditionText, expected.schoolConditionText, expected.regionText].map((value) => value?.trim() ? value : '공식 신청처에서 확인해 주세요.'));
    assert.equal(await page.getByText('최종 신청 자격 및 접수 여부는 공식 신청처에서 확인하세요.', { exact: true }).count(), 1);
    assert.equal(await page.locator('.detail-links a').count(), expected.links.length);
    await page.getByRole('link', { name: '목록으로 돌아가기' }).click();
    await page.waitForURL(`${base}/policies`);
    await page.locator('.policy-card').first().waitFor();
  });
});

test('없는 정책과 UUID 오류는 통신 오류와 구분해 안내한다', async () => {
  await withPage(async (page) => {
    for (const id of ['00000000-0000-4000-8000-000000000000', 'invalid-id']) {
      await page.goto(`${base}/policies/${id}`);
      await page.getByRole('heading', { name: '정책을 찾을 수 없습니다' }).waitFor();
      assert.equal(await page.getByRole('button', { name: '다시 시도', exact: true }).count(), 0);
    }
  });
});

test('상세의 긴 원문·줄바꿈·링크 없음·악성 링크를 모바일에서도 안전하게 표시한다', async () => {
  const first = (await search()).items[0];
  const fixture = await (await fetch(`${api}/api/v1/policies/${first.id}`)).json();
  await withPage(async (page) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const raw = '<script>window.injected=true</script>\n' + '긴 원문 설명'.repeat(80);
    await page.route(`**/api/v1/policies/${first.id}`, (route) => route.fulfill({ json: {
      ...fixture, benefitText: raw, description: raw, applicationPeriodText: '1차 신청\n2차 신청',
      links: [{ label: '신청', url: 'javascript:alert(1)' }, { label: '참고', url: 'data:text/html,unsafe' }],
    } }));
    await page.goto(`${base}/policies/${first.id}`);
    await page.getByText('링크 없음', { exact: true }).waitFor();
    assert.equal(await page.locator('#benefit-title + p').textContent(), raw);
    assert.equal(await page.locator('#period-title + p').textContent(), '1차 신청\n2차 신청');
    assert.equal(await page.locator('.detail-links a').count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  });
});

test('신청·참고 링크를 opener 없이 새 탭으로 열며 실제 외부 네트워크는 호출하지 않는다', async () => {
  const first = (await search()).items[0];
  const fixture = await (await fetch(`${api}/api/v1/policies/${first.id}`)).json();
  await withPage(async (page) => {
    await page.route(`**/api/v1/policies/${first.id}`, (route) => route.fulfill({ json: {
      ...fixture, links: [{ label: '신청', url: 'https://example.org/apply' }, { label: '참고', url: 'http://example.org/info' }],
    } }));
    await page.context().route('**://example.org/**', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>공식 신청처 테스트</h1>' }));
    await page.goto(`${base}/policies/${first.id}`);
    const link = page.locator('.detail-links a').first();
    await link.waitFor();
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    const opened = page.context().waitForEvent('page');
    await link.click();
    const popup = await opened;
    await popup.waitForLoadState('domcontentloaded');
    assert.equal(popup.url(), 'https://example.org/apply');
    assert.equal(await popup.evaluate(() => window.opener), null);
    await popup.close();
  });
});

test('상세 HTTP 오류·깨진 JSON·연결 실패·시간 초과를 안내하고 재시도한다', async () => {
  const first = (await search()).items[0];
  const fixture = await (await fetch(`${api}/api/v1/policies/${first.id}`)).json();
  for (const failure of [500, 503, 'json', 'network', 'timeout']) {
    await withPage(async (page) => {
      if (failure === 'timeout') await page.clock.install();
      let calls = 0;
      await page.route(`**/api/v1/policies/${first.id}`, (route) => {
        if (++calls > 1) return route.fulfill({ json: fixture });
        if (failure === 'timeout') return;
        if (failure === 'network') return route.abort('failed');
        if (failure === 'json') return route.fulfill({ contentType: 'application/json', body: '{' });
        return route.fulfill({ status: failure, json: { message: '비공개 상세 오류' } });
      });
      const request = page.waitForRequest(`**/api/v1/policies/${first.id}`);
      await page.goto(`${base}/policies/${first.id}`);
      await request;
      if (failure === 'timeout') await page.clock.fastForward(15_001);
      await page.getByRole('button', { name: '다시 시도', exact: true }).click();
      await page.locator('.detail-heading h1').waitFor();
      assert.equal(await page.locator('h1').textContent(), fixture.title);
      assert.equal(await page.getByText('비공개 상세 오류').count(), 0);
    });
  }
});
