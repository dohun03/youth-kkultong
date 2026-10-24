import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { pacedFetch as fetch, paceBrowserContext } from './api-pacing.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = process.env.WEB_TEST_URL ?? 'http://127.0.0.1:3000';
const api = process.env.API_TEST_URL ?? 'http://127.0.0.1:4000';
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/** 각 탐색 시나리오를 별도 탭에서 실행하고 반드시 닫는다. */
async function withPage(run) {
  const context = await browser.newContext();
  await paceBrowserContext(context);
  const page = await context.newPage();
  try { await run(page); } finally { await context.close(); }
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
    assert.equal(await page.locator('#policy-sort').inputValue(), 'popular');
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
      return route.fulfill({ json: { items: [{ id: 'test', title: `요청 ${requests.length}`, category: null, subcategory: null, benefitPreview: '', descriptionPreview: '', applicationStatus: 'UNKNOWN', applicationPeriodText: null, applicationEndDate: null, viewCount: null, score: 0, tags: [] }], pagination: { page: body.page, limit: 20, total: 100, totalPages: 5 }, appliedSort: body.sort ?? (body.conditions ? 'recommended' : 'popular') } });
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
    await page.locator('.pagination [aria-current="page"]').filter({ hasText: '2' }).waitFor();
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
    for (const label of ['지원 내용', '정책 설명']) {
      const more = page.getByRole('button', { name: `${label} 더보기` });
      if (await more.count()) await more.click();
    }
    assert.equal(await page.locator('#benefit-text').textContent(), expected.benefitText?.trim() ? expected.benefitText : '공식 신청처에서 확인해 주세요.');
    assert.equal(await page.locator('#description-text').textContent(), expected.description?.trim() ? expected.description : '공식 신청처에서 확인해 주세요.');
    assert.deepEqual(await page.locator('.detail-eligibility dd').allTextContents(), [expected.ageRangeText, expected.jobConditionText, expected.schoolConditionText].map((value) => value?.trim() ? value : '공식 신청처에서 확인해 주세요.'));
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
    await page.getByRole('button', { name: '지원 내용 더보기' }).click();
    assert.equal(await page.locator('#benefit-text').textContent(), raw);
    assert.equal(await page.locator('#period-text').textContent(), '1차 신청\n2차 신청');
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

test('상세는 원문 미리보기·더보기·접기를 제공하고 지역은 시도별 검색으로 찾아본다', async () => {
  const first = (await search()).items[0];
  const fixture = await (await fetch(`${api}/api/v1/policies/${first.id}`)).json();
  const benefit = '지원 내용 첫 문장\n' + '지원 혜택의 상세 조건입니다. '.repeat(100);
  const qualification = '추가 신청 자격을 확인하세요.\n' + '별도 기준을 충족해야 합니다. '.repeat(100);
  const regions = ['서울특별시 종로구', '서울특별시 강남구', '경기도 수원시 장안구', '경기도 수원시 영통구', '경기도 성남시 분당구', '미확인코드', '부산광역시 중구', '대구광역시 중구', '인천광역시 중구', '대전광역시 중구', '울산광역시 중구'];
  await withPage(async (page) => {
    await page.route(`**/api/v1/policies/${first.id}`, (route) => route.fulfill({ json: {
      ...fixture, benefitText: benefit, extraQualification: qualification, regionText: regions.join(', '),
    } }));
    await page.goto(`${base}/policies/${first.id}`);
    await page.locator('.detail-heading').waitFor();
    assert.ok((await page.locator('#benefit-text').textContent()).length < benefit.length);
    const more = page.getByRole('button', { name: '지원 내용 더보기' });
    assert.equal(await more.getAttribute('aria-expanded'), 'false');
    await more.click();
    assert.equal(await page.locator('#benefit-text').textContent(), benefit);
    await page.getByRole('button', { name: '지원 내용 접기' }).click();
    assert.ok((await page.locator('#benefit-text').textContent()).length < benefit.length);
    assert.ok((await page.locator('#extra-text').textContent()).length < qualification.length);
    await page.getByRole('button', { name: '추가 자격 더보기' }).click();
    assert.equal(await page.locator('#extra-text').textContent(), qualification);
    assert.equal(await page.locator('.detail-region-group[open]').count(), 0);
    assert.equal(await page.locator('.detail-region-group').count(), 3);
    const rows = await page.locator('.detail-region-group').all();
    for (let index = 1; index < rows.length; index += 1) {
      const previous = await rows[index - 1].boundingBox();
      const current = await rows[index].boundingBox();
      assert.ok(current.y >= previous.y + previous.height);
    }
    await page.getByRole('button', { name: '지역 목록 더보기' }).click();
    assert.equal(await page.locator('.detail-region-group').count(), 8);
    await page.locator('.detail-region-group summary').filter({ hasText: '서울특별시' }).click();
    assert.equal(await page.getByText('서울특별시 강남구', { exact: true }).isVisible(), true);
    await page.getByRole('searchbox', { name: '지역 찾기' }).fill('수원');
    assert.deepEqual(await page.locator('.detail-region-group li').allTextContents(), regions.filter((region) => region.includes('수원')));
    assert.equal(await page.locator('.detail-region-group[open]').count(), 1);
    await page.getByRole('searchbox', { name: '지역 찾기' }).fill('없는지역');
    await page.getByText('일치하는 지역이 없습니다. 다른 지역명으로 찾아보세요.').waitFor();
    await page.getByRole('searchbox', { name: '지역 찾기' }).fill('');
    assert.deepEqual((await page.locator('.detail-region-group li').allTextContents()).sort(), [...regions].sort());
    assert.equal(await page.getByText('전국 대상', { exact: true }).count(), 0);
  });
});

test('상세는 전체 폭을 사용하고 소개·혜택 순서, 간결한 신청 영역, 카테고리 배지를 표시한다', async () => {
  const first = (await search()).items[0];
  await withPage(async (page) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(`${base}/policies/${first.id}`);
    await page.locator('.detail-heading').waitFor();
    assert.equal(await page.locator('.detail-sidebar').count(), 0);
    assert.equal(await page.getByText('신청 안내', { exact: true }).count(), 0);
    assert.equal(await page.getByText('신청·참고 링크', { exact: true }).count(), 0);
    const heading = await page.locator('.detail-heading').boundingBox();
    const application = await page.locator('.detail-application').boundingBox();
    const intro = await page.locator('.detail-introduction').boundingBox();
    const benefit = await page.locator('.detail-benefit').boundingBox();
    assert.ok(heading.width >= 1000);
    assert.ok(Math.abs(benefit.width - heading.width) < 2);
    assert.ok(application.y >= heading.y + heading.height);
    assert.ok(intro.y >= application.y + application.height);
    assert.ok(benefit.y >= intro.y + intro.height);
    assert.equal(await page.locator('#description-title').textContent(), '정책 소개');
    assert.equal(await page.locator('#benefit-title').textContent(), '지원 혜택');
    assert.ok(await page.locator('#description-title').evaluate((element) => parseFloat(getComputedStyle(element).fontSize) >= 23));
    assert.notEqual(await page.locator('.detail-introduction').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
    assert.notEqual(await page.locator('.detail-category').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
    assert.equal(await page.locator('#benefit-text').evaluate((element) => getComputedStyle(element).fontSize), '18px');
    await page.setViewportSize({ width: 375, height: 812 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.equal(await page.locator('#benefit-text').evaluate((element) => getComputedStyle(element).fontSize), '17px');
  });
});

test('상세 날짜는 읽기 쉽게 표시하고 설명·복수 기간·유효하지 않은 범위는 보존한다', async () => {
  const first = (await search()).items[0];
  const fixture = await (await fetch(`${api}/api/v1/policies/${first.id}`)).json();
  await withPage(async (page) => {
    let period = '';
    await page.route(`**/api/v1/policies/${first.id}`, (route) => route.fulfill({ json: { ...fixture, applicationPeriodText: period } }));
    for (const [original, expected] of [
      ['20261006 ~ 20261023', '2026.10.06 ~ 2026.10.23'],
      ['2026-10-06~2026-10-23', '2026.10.06 ~ 2026.10.23'],
      ['20261006', '2026.10.06'],
      ['20240229 ~ 20240301', '2024.02.29 ~ 2024.03.01'],
      ['20260229 ~ 20260301', '20260229 ~ 20260301'],
      ['20260230 ~ 20260301', '20260230 ~ 20260301'],
      ['20261023 ~ 20261006', '20261023 ~ 20261006'],
      ['상시 신청', '상시 신청'],
      ['예산 소진 시까지', '예산 소진 시까지'],
      ['20260101 ~ 20260131, 20261006 ~ 20261023', '20260101 ~ 20260131, 20261006 ~ 20261023'],
    ]) {
      period = original;
      await page.goto(`${base}/policies/${first.id}`);
      await page.locator('#period-text').waitFor();
      assert.equal(await page.locator('#period-text').textContent(), expected);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    period = '20261006 ~ 20261023';
    await page.goto(`${base}/policies/${first.id}`);
    await page.locator('#period-text').waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  });
});

test('목록은 짧은 필터와 소개 중심 카드를 표시하며 작은 화면에서도 정보가 겹치지 않는다', async () => {
  const expected = await search();
  await withPage(async (page) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${base}/policies`);
    await expectResult(page, expected);
    const category = await page.locator('#policy-category').boundingBox();
    assert.ok(category.width <= 220);
    const selectStyle = await page.locator('#policy-category').evaluate((element) => {
      const style = getComputedStyle(element);
      return { padding: parseFloat(style.paddingRight), position: style.backgroundPosition, appearance: style.appearance };
    });
    assert.ok(selectStyle.padding >= 40);
    assert.equal(selectStyle.appearance, 'none');
    assert.ok(selectStyle.position.includes('14px'));
    const first = page.locator('.policy-card').first();
    assert.equal(await page.locator('.policy-disclaimer').count(), 0);
    assert.equal(await first.locator('.policy-benefit').count(), 0);
    assert.ok((await first.locator('.policy-description').textContent()).length > 0);
    // 소개는 실제 상세 설명의 앞부분이며 지원 금액의 나열로 대체하지 않는다.
    const detail = await (await fetch(`${api}/api/v1/policies/${expected.items[0].id}`)).json();
    assert.equal(expected.items[0].descriptionPreview, Array.from(detail.description ?? '').slice(0, 200).join(''));
    const main = await first.locator('.policy-card-main').boundingBox();
    const meta = await first.locator('.policy-card-meta').boundingBox();
    assert.ok(meta.x >= main.x + main.width);
    assert.ok((await first.boundingBox()).height < 260);
    await page.setViewportSize({ width: 375, height: 812 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const mobileCard = await first.boundingBox();
    const stats = await first.locator('.policy-card-stats').boundingBox();
    const description = await first.locator('.policy-description').boundingBox();
    assert.ok(stats.y >= description.y + description.height);
    assert.ok(stats.y + stats.height <= mobileCard.y + mobileCard.height);
  });
});

/** 세션 저장과 복원을 확인하는 화면 전용 키다. */
const conditionsStorageKey = 'youth-kkultong:conditions';

test('네 조건을 새로고침·상세 복귀 시 유지하고 해제 후에는 복원하지 않는다', async () => {
  const codes = await (await fetch(`${api}/api/v1/meta/eligibility-codes`)).json();
  const conditions = { age: 28, jobCode: codes.jobCodes[0].code, schoolCode: codes.schoolCodes[0].code, regionCode: '41111' };
  await withPage(async (page) => {
    const requests = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/')) {
        assert.equal(new URL(request.url()).search, '');
        if (request.url().endsWith('/policies/search')) requests.push(request.postDataJSON());
        else assert.equal(request.postData(), null);
      }
    });
    await page.goto(`${base}/policies`);
    await page.locator('#policy-age').fill('28');
    await page.selectOption('#jobCode', conditions.jobCode);
    await page.selectOption('#schoolCode', conditions.schoolCode);
    await page.selectOption('#region-0', '41000');
    await page.selectOption('#region-1', '41110');
    await page.selectOption('#region-2', conditions.regionCode);
    const expected = await search({ conditions });
    await expectResult(page, expected);
    assert.deepEqual(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), conditionsStorageKey), conditions);
    for (const returnBy of ['reload', 'link', 'back']) {
      requests.length = 0;
      if (returnBy === 'reload') await page.reload();
      else {
        await page.locator('.policy-card').first().click();
        await page.locator('.policy-detail').waitFor();
        if (returnBy === 'back') await page.goBack();
        else await page.getByRole('link', { name: /목록/ }).click();
      }
      await expectResult(page, expected);
      assert.equal(await page.locator('#policy-age').inputValue(), '28');
      assert.equal(await page.locator('#jobCode').inputValue(), conditions.jobCode);
      assert.equal(await page.locator('#schoolCode').inputValue(), conditions.schoolCode);
      assert.equal(await page.locator('#region-2').inputValue(), conditions.regionCode);
      assert.ok(requests.length > 0);
      assert.ok(requests.every((body) => JSON.stringify(body.conditions) === JSON.stringify(conditions)));
      assert.equal(new URL(page.url()).search, '');
      assert.equal(await page.evaluate(() => localStorage.length), 0);
    }
    // 독립된 탭의 세션에는 조건을 가져오지 않는다.
    const other = await page.context().newPage();
    try {
      await other.goto(`${base}/policies`);
      await expectResult(other, await search());
      assert.equal(await other.locator('#policy-age').inputValue(), '');
    } finally { await other.close(); }
    await page.getByRole('button', { name: '나이 지우기' }).click();
    await page.selectOption('#jobCode', '');
    await page.selectOption('#schoolCode', '');
    await page.selectOption('#region-0', '');
    await expectResult(page, await search());
    assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), conditionsStorageKey), null);
    await page.reload();
    await expectResult(page, await search());
    assert.equal(await page.locator('#policy-age').inputValue(), '');
  });
});

test('손상된 자료·미확인 코드를 제거하고 네 조건만 저장한다', async () => {
  for (const stored of ['{broken', 'null', '[]', JSON.stringify({ age: 121, jobCode: 'invalid', schoolCode: {}, regionCode: 'x' }), JSON.stringify({ age: 28, jobCode: '9999999', schoolCode: '9999999', regionCode: '99999', category: '추가값', page: 9 })]) {
    await withPage(async (page) => {
      await page.addInitScript(({ key, stored }) => sessionStorage.setItem(key, stored), { key: conditionsStorageKey, stored });
      const requests = [];
      page.on('request', (request) => { if (request.url().endsWith('/policies/search')) requests.push(request.postDataJSON()); });
      await page.goto(`${base}/policies`);
      const validAge = stored.includes('28');
      await expectResult(page, await search(validAge ? { conditions: { age: 28 } } : {}));
      assert.ok(requests.every((body) => validAge ? JSON.stringify(body.conditions) === '{"age":28}' : body.conditions === undefined));
      assert.deepEqual(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), conditionsStorageKey), validAge ? { age: 28 } : null);
    });
  }
});

test('저장소 읽기·쓰기가 차단돼도 조건 입력·검색·해제를 계속한다', async () => {
  await withPage(async (page) => {
    await page.addInitScript(() => {
      for (const method of ['getItem', 'setItem', 'removeItem']) Storage.prototype[method] = () => { throw new DOMException('blocked', 'SecurityError'); };
    });
    await page.goto(`${base}/policies`);
    await expectResult(page, await search());
    await page.locator('#policy-age').fill('28');
    await expectResult(page, await search({ conditions: { age: 28 } }));
    await page.getByRole('button', { name: '나이 지우기' }).click();
    await expectResult(page, await search());
  });
});

test('복원 중 메타 조회 실패 시 코드를 전송하지 않고 보관하며 재시도로 복구한다', async () => {
  await withPage(async (page) => {
    await page.addInitScript((key) => sessionStorage.setItem(key, JSON.stringify({ regionCode: '41111' })), conditionsStorageKey);
    let calls = 0;
    const requests = [];
    await page.route('**/meta/regions', (route) => ++calls === 1 ? route.fulfill({ status: 503, json: {} }) : route.continue());
    page.on('request', (request) => { if (request.url().endsWith('/policies/search')) requests.push(request.postDataJSON()); });
    await page.goto(`${base}/policies`);
    await page.getByRole('button', { name: '지역 다시 시도' }).waitFor();
    await expectResult(page, await search());
    assert.equal(requests[0].conditions, undefined);
    assert.deepEqual(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), conditionsStorageKey), { regionCode: '41111' });
    await page.getByRole('button', { name: '지역 다시 시도' }).click();
    await expectResult(page, await search({ conditions: { regionCode: '41111' } }));
    assert.equal(await page.locator('#region-2').inputValue(), '41111');
  });
});

test('분야·마감 포함·수동 정렬을 새로고침과 상세 복귀 후 유지하고 페이지는 1로 복원한다', async () => {
  const categories = await (await fetch(`${api}/api/v1/meta/categories`)).json();
  const category = categories[0];
  const expected = await search({ category, includeClosed: true, sort: 'newest' });
  await withPage(async (page) => {
    await page.goto(`${base}/policies`);
    await page.selectOption('#policy-category', category);
    await page.getByLabel('마감 포함').check();
    await page.selectOption('#policy-sort', 'newest');
    await expectResult(page, expected);
    if (expected.pagination.totalPages > 1) {
      await page.getByRole('button', { name: '다음', exact: true }).click();
      await expectResult(page, await search({ category, includeClosed: true, sort: 'newest', page: 2 }));
    }
    const requests = [];
    page.on('request', (request) => { if (request.url().endsWith('/policies/search')) requests.push(request.postDataJSON()); });
    for (const action of ['reload', 'detail']) {
      requests.length = 0;
      if (action === 'reload') await page.reload();
      else {
        await page.locator('.policy-card').first().click();
        await page.getByRole('link', { name: '목록으로 돌아가기' }).click();
      }
      await expectResult(page, expected);
      assert.equal(await page.locator('#policy-category').inputValue(), category);
      assert.equal(await page.getByLabel('마감 포함').isChecked(), true);
      assert.equal(await page.locator('#policy-sort').inputValue(), 'newest');
      assert.ok(requests.length > 0);
      assert.ok(requests.every((body) => body.category === category && body.includeClosed === true && body.sort === 'newest' && body.page === 1));
      assert.deepEqual(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), conditionsStorageKey), { category, includeClosed: true, sort: 'newest' });
      assert.equal(new URL(page.url()).search, '');
    }
    await page.selectOption('#policy-category', '');
    await page.getByLabel('마감 포함').uncheck();
    await page.reload();
    await expectResult(page, await search({ sort: 'newest' }));
    assert.equal(await page.locator('#policy-category').inputValue(), '');
    assert.equal(await page.getByLabel('마감 포함').isChecked(), false);
  });
});

test('복원한 맞춤순은 유효 조건이 없으면 인기순으로 정리하고 다른 수동 정렬은 유지한다', async () => {
  for (const stored of [{ sort: 'recommended' }, { sort: 'recommended', regionCode: '99999' }, { sort: 'recommended', age: 28 }, { sort: 'popular', age: 28 }, { sort: 'deadline' }, { sort: 'newest' }, { sort: 'invalid', includeClosed: 'false', category: 1, page: 3 }]) {
    await withPage(async (page) => {
      await page.addInitScript(({ key, stored }) => sessionStorage.setItem(key, JSON.stringify(stored)), { key: conditionsStorageKey, stored });
      const requests = [];
      page.on('request', (request) => { if (request.url().endsWith('/policies/search')) requests.push(request.postDataJSON()); });
      await page.goto(`${base}/policies`);
      const sort = stored.sort === 'invalid' ? undefined : stored.sort === 'recommended' && !stored.age ? 'popular' : stored.sort;
      await expectResult(page, await search({ ...(sort ? { sort } : {}), ...(stored.age ? { conditions: { age: stored.age } } : {}) }));
      assert.equal(await page.locator('#policy-sort').inputValue(), sort ?? 'popular');
      assert.ok(requests.every((body) => body.sort === sort && body.page === 1 && body.includeClosed === false && !body.category));
      const saved = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), conditionsStorageKey);
      assert.deepEqual(saved, sort ? { sort, ...(stored.age ? { age: stored.age } : {}) } : null);
    });
  }
});

test('자동 정렬은 저장하지 않고 복원한 조건 유무로 결정하며 메타 지연 중 맞춤순을 지우지 않는다', async () => {
  await withPage(async (page) => {
    await page.goto(`${base}/policies`);
    await page.locator('#policy-age').fill('28');
    await expectResult(page, await search({ conditions: { age: 28 } }));
    await page.reload();
    await expectResult(page, await search({ conditions: { age: 28 } }));
    assert.equal(await page.locator('#policy-sort').inputValue(), 'recommended');
    assert.deepEqual(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), conditionsStorageKey), { age: 28 });
  });
  await withPage(async (page) => {
    await page.addInitScript((key) => sessionStorage.setItem(key, JSON.stringify({ regionCode: '41111', sort: 'recommended' })), conditionsStorageKey);
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    await page.route('**/meta/regions', async (route) => { await pending; await route.continue(); });
    const requests = [];
    page.on('request', (request) => { if (request.url().endsWith('/policies/search')) requests.push(request.postDataJSON()); });
    await page.goto(`${base}/policies`);
    await page.getByText('지역 선택지를 불러오는 중입니다.').waitFor();
    assert.equal(requests.length, 0);
    release();
    await expectResult(page, await search({ conditions: { regionCode: '41111' }, sort: 'recommended' }));
    assert.ok(requests.every((body) => body.sort === 'recommended' && body.conditions?.regionCode === '41111'));
    assert.equal(await page.locator('#policy-sort').inputValue(), 'recommended');
  });
});

test('복원한 분야를 메타 API로 확인하고 조회 실패 시 보관한 뒤 재시도로 복원한다', async () => {
  const categories = await (await fetch(`${api}/api/v1/meta/categories`)).json();
  for (const category of [categories[0], '존재하지 않는 분야']) {
    await withPage(async (page) => {
      await page.addInitScript(({ key, category }) => sessionStorage.setItem(key, JSON.stringify({ category })), { key: conditionsStorageKey, category });
      let calls = 0;
      await page.route('**/meta/categories', (route) => ++calls === 1 ? route.fulfill({ status: 503, json: {} }) : route.continue());
      await page.goto(`${base}/policies`);
      await page.getByRole('button', { name: '분야 다시 시도' }).waitFor();
      await expectResult(page, await search());
      assert.deepEqual(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), conditionsStorageKey), { category });
      await page.getByRole('button', { name: '분야 다시 시도' }).click();
      const valid = categories.includes(category);
      await expectResult(page, await search(valid ? { category } : {}));
      await page.locator('#policy-category:not([disabled])').waitFor();
      assert.equal(await page.locator('#policy-category').inputValue(), valid ? category : '');
      assert.deepEqual(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), conditionsStorageKey), valid ? { category } : null);
    });
  }
});

test('표시 개수 10·20·50은 실제 응답·페이지 이동·세션 복원에 반영되고 총 건수와 상단 페이지 조작을 구분한다', async () => {
  await withPage(async (page) => {
    await page.goto(`${base}/policies`);
    await expectResult(page, await search());
    for (const limit of [10, 50, 20]) {
      await page.selectOption('#policy-limit', String(limit));
      const expected = await search({ limit });
      await expectResult(page, expected);
      assert.equal(await page.locator('.policy-card').count(), expected.items.length);
      assert.equal(await page.locator('.result-total strong').textContent(), expected.pagination.total.toLocaleString('ko-KR'));
      assert.doesNotMatch(await page.locator('.list-summary').textContent(), /맞춤순|인기순/);
      assert.equal(await page.locator('.pagination').evaluate((nav) => Boolean(nav.compareDocumentPosition(document.querySelector('.policy-list')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
      await page.getByRole('button', { name: '다음', exact: true }).click();
      await expectResult(page, await search({ limit, page: 2 }));
      await page.reload();
      await expectResult(page, expected);
      assert.equal(await page.locator('#policy-limit').inputValue(), String(limit));
    }
    await page.locator('#policy-age').fill('28');
    await page.selectOption('#policy-sort', 'newest');
    await page.selectOption('#policy-limit', '50');
    await expectResult(page, await search({ limit: 50, sort: 'newest', conditions: { age: 28 } }));
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await expectResult(page, await search({ page: 2, limit: 50, sort: 'newest', conditions: { age: 28 } }));
    await page.selectOption('#policy-limit', '10');
    await expectResult(page, await search({ limit: 10, sort: 'newest', conditions: { age: 28 } }));
  });
});

test('손상된 표시 개수 저장값은 기본 20개로 복원한다', async () => {
  for (const limit of [0, 100, '50', null]) {
    await withPage(async (page) => {
      await page.addInitScript(({ key, limit }) => sessionStorage.setItem(key, JSON.stringify({ limit })), { key: conditionsStorageKey, limit });
      await page.goto(`${base}/policies`);
      await expectResult(page, await search());
      assert.equal(await page.locator('#policy-limit').inputValue(), '20');
    });
  }
});

test('느린 페이지 이동 중 카드·버튼·높이를 유지하고 완료 후 교체하며 중복 클릭을 막는다', async () => {
  await withPage(async (page) => {
    const first = await search();
    const second = await search({ page: 2 });
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    await page.route('**/policies/search', async (route) => {
      const body = route.request().postDataJSON();
      if (body.page === 2) await pending;
      await route.fulfill({ json: body.page === 2 ? second : first });
    });
    await page.goto(`${base}/policies`);
    await expectResult(page, first);
    await page.locator('.policy-list').evaluate((list) => { window.previousList = list; });
    const initialHeight = await page.locator('.policy-list').evaluate((list) => list.clientHeight);
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await page.locator('[aria-label="정책 목록"][aria-busy="true"]').waitFor();
    assert.equal(await page.locator('.policy-list').evaluate((list) => list === window.previousList), true);
    assert.equal(await page.locator('.policy-list').evaluate((list) => list.clientHeight), initialHeight);
    assert.deepEqual(await page.locator('.policy-list h2').allTextContents(), first.items.map((item) => item.title));
    assert.equal(await page.getByRole('button', { name: '다음', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('.loading-message').count(), 0);
    release();
    await expectResult(page, second);
    assert.equal(await page.locator('.pagination [aria-current="page"]').textContent(), '2');
    assert.equal(await page.locator('.result-page,.policy-disclaimer,.filter-heading p').count(), 0);
    const sizes = await page.locator('.result-total').evaluate((total) => [getComputedStyle(total).fontSize, getComputedStyle(total.querySelector('strong')).fontSize]);
    assert.equal(sizes[0], sizes[1]);
  });
});

test('제목 검색은 제출 시에만 적용하고 조건·페이지·세션과 함께 동작한다', async () => {
  await withPage(async (page) => {
    const requests = [];
    page.on('request', (request) => { if (request.url().endsWith('/policies/search')) requests.push(request.postDataJSON()); });
    await page.goto(`${base}/policies`);
    await expectResult(page, await search());
    const previous = requests.length;
    await page.getByLabel('정책명 검색', { exact: true }).fill('  청년  ');
    assert.equal(requests.length, previous);
    await page.getByRole('button', { name: '검색', exact: true }).click();
    const expected = await search({ keyword: '청년' });
    await expectResult(page, expected);
    assert.equal(requests.at(-1).keyword, '청년');
    assert.equal(requests.at(-1).page, 1);
    assert.equal(await page.locator('#policy-sort').inputValue(), 'popular');
    assert.equal(await page.locator('#policy-sort option[value="recommended"]').isDisabled(), true);
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await expectResult(page, await search({ keyword: '청년', page: 2 }));
    await page.reload();
    await expectResult(page, expected);
    assert.equal(await page.getByLabel('정책명 검색', { exact: true }).inputValue(), '청년');
    await page.locator('#policy-age').fill('28');
    await page.selectOption('#policy-limit', '10');
    await page.selectOption('#policy-sort', 'newest');
    await expectResult(page, await search({ keyword: '청년', conditions: { age: 28 }, limit: 10, sort: 'newest' }));
    await page.getByLabel('정책명 검색', { exact: true }).fill('찾을수없는정책제목123');
    await page.getByLabel('정책명 검색', { exact: true }).press('Enter');
    await page.getByRole('heading', { name: '표시할 정책이 없습니다' }).waitFor();
    await page.getByRole('button', { name: '검색 지우기' }).click();
    await expectResult(page, await search({ conditions: { age: 28 }, limit: 10, sort: 'newest' }));
    assert.equal(requests.at(-1).keyword, undefined);
    assert.equal(new URL(page.url()).search, '');
    assert.equal(await page.evaluate(() => localStorage.length), 0);
  });
});

test('한글 조합 Enter는 검색하지 않고 오류 재시도에도 적용 검색어를 유지한다', async () => {
  await withPage(async (page) => {
    let fail = false;
    const requests = [];
    await page.route('**/policies/search', (route) => {
      const body = route.request().postDataJSON(); requests.push(body);
      if (body.keyword && !fail) { fail = true; return route.fulfill({ status: 503, json: {} }); }
      return route.continue();
    });
    await page.goto(`${base}/policies`);
    await expectResult(page, await search());
    const input = page.getByLabel('정책명 검색', { exact: true });
    await input.fill('주거');
    const count = requests.length;
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 });
    assert.equal(requests.length, count);
    await input.press('Enter');
    await page.getByRole('button', { name: '다시 시도', exact: true }).click();
    await expectResult(page, await search({ keyword: '주거' }));
    assert.equal(requests.at(-1).keyword, '주거');
    assert.equal(await input.getAttribute('maxlength'), '100');
  });
});

test('분야 선택지·복수 분야 검색·원문 표시·이전 세션을 같은 기준으로 정리한다', async () => {
  const categories = await (await fetch(`${api}/api/v1/meta/categories`)).json();
  assert.equal(categories.length, new Set(categories).size);
  assert.ok(categories.every((name) => !name.includes(',')));
  assert.ok(categories.includes('금융･복지･문화'));
  const expected = await search({ category: '일자리', includeClosed: true, limit: 50 });
  assert.ok(expected.pagination.total > 0);
  assert.ok(expected.items.every((item) => item.category.split(',').map((name) => name.trim()).includes('일자리')));
  for (const [stored, restored] of [['일자리,일자리', '일자리'], ['일자리,교육', '']]) {
    await withPage(async (page) => {
      await page.addInitScript(({ key, stored }) => sessionStorage.setItem(key, JSON.stringify({ category: stored })), { key: conditionsStorageKey, stored });
      await page.goto(`${base}/policies`);
      await expectResult(page, await search(restored ? { category: restored } : {}));
      assert.equal(await page.locator('#policy-category').inputValue(), restored);
    });
  }
  await withPage(async (page) => {
    const fixture = { ...(await search()).items[0], category: '일자리,교육,일자리' };
    await page.route('**/policies/search', (route) => route.fulfill({ json: { ...(expected), items: [fixture] } }));
    await page.goto(`${base}/policies`);
    await page.locator('.policy-category-badge').waitFor();
    assert.equal(await page.locator('.policy-category-badge').textContent(), '일자리 · 교육');
    await page.route(`**/api/v1/policies/${fixture.id}`, async (route) => {
      const result = await route.fetch(); const detail = await result.json();
      await route.fulfill({ json: { ...detail, category: '일자리,교육,일자리' } });
    });
    await page.locator('.policy-card-link').click();
    await page.locator('.detail-category').waitFor();
    assert.ok((await page.locator('.detail-category').textContent()).startsWith('일자리 · 교육'));
  });
});

test('실제 정책으로 기본 목록→조건·맞춤순→상세→신청 링크 새 탭까지 연결된다', async () => {
  const expected = await search({ conditions: { age: 28 } });
  assert.equal(expected.appliedSort, 'recommended');
  assert.ok(expected.items.length > 0);
  assert.ok(expected.items.some((item) => item.tags.includes('AGE_MATCH')));
  let chosen;
  let applicationLink;
  // 실제 첫 페이지에서 신청 링크가 있는 정책을 선택한다. 운영 데이터는 수정하지 않는다.
  for (const item of expected.items) {
    const response = await fetch(`${api}/api/v1/policies/${item.id}`);
    assert.equal(response.status, 200);
    const detail = await response.json();
    applicationLink = detail.links.find((link) => link.label === '신청');
    if (applicationLink) { chosen = item; break; }
  }
  assert.ok(chosen && applicationLink, '맞춤 첫 페이지에 실제 신청 링크가 있는 정책이 필요합니다.');
  await withPage(async (page) => {
    await page.goto(base);
    await page.locator('.policy-card').first().waitFor();
    assert.equal(new URL(page.url()).pathname, '/policies');
    await page.getByLabel('만 나이').fill('28');
    await expectResult(page, expected);
    assert.equal(await page.locator('#policy-sort').inputValue(), 'recommended');
    const selected = page.locator(`.policy-card-link[href="/policies/${chosen.id}"]`);
    await selected.click();
    await page.waitForURL(`**/policies/${chosen.id}`);
    await page.locator('.detail-heading h1').waitFor();
    assert.equal(await page.locator('h1').textContent(), chosen.title);
    const link = page.locator('.detail-links a').filter({ hasText: '신청' }).first();
    assert.equal(await link.getAttribute('href'), applicationLink.url);
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.match(await link.getAttribute('rel'), /noopener/);
    assert.match(await link.getAttribute('rel'), /noreferrer/);
    const target = new URL(applicationLink.url).href;
    // 클릭과 새 탭 생성은 실제로 실행하고 외부 신청 시스템의 응답만 테스트 페이지로 대체한다.
    await page.context().route((url) => url.href === target, (route) => route.fulfill({
      contentType: 'text/html', body: '<html lang="ko"><title>신청 링크 도착 확인</title></html>',
    }));
    const opened = page.context().waitForEvent('page');
    await link.click();
    const popup = await opened;
    await popup.waitForLoadState();
    assert.equal(popup.url(), target);
    assert.equal(await popup.evaluate(() => window.opener), null);
  });
});
