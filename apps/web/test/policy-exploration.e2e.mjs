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
