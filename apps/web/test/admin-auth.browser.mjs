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
let browser;
let authenticatedCookies;

/** 비밀번호 입력 실패 시 브라우저 도구의 원문 로그 대신 안전한 오류 전달 */
async function fillLogin(page, inputPassword = password) {
  try {
    await page.getByLabel('아이디', { exact: true }).fill(username);
    await page.getByLabel('비밀번호', { exact: true }).fill(inputPassword);
  } catch { throw new Error('관리자 로그인 입력에 실패했습니다.'); }
}

/** 실제 인증 확인 후 보호 화면이 보일 때까지 대기 */
async function waitForProtected(page) {
  await page.waitForURL('**/admin/reviews');
  await page.getByRole('heading', { name: '정책 검수 관리' }).waitFor();
}

/** 테스트별로 쿠키와 브라우저 저장소를 분리하고 종료 시 정리 */
async function withPage(authenticated, run, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await paceBrowserContext(context);
  if (authenticated) await context.addCookies(authenticatedCookies);
  const page = await context.newPage();
  try { await run(page, context); }
  finally { await context.close(); }
}

before(async () => {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await paceBrowserContext(context);
  try {
    // 실제 로그인 화면으로 받은 쿠키를 이후 보호 화면 테스트에 재사용해 로그인 한도를 유지
    const page = await context.newPage();
    await loginForAdminTests(page, baseUrl, username, password);
    await page.getByRole('heading', { name: '검수 대기', exact: true }).waitFor();
    authenticatedCookies = await context.cookies();
    assert.ok(authenticatedCookies.some((cookie) => cookie.name === 'youth_admin_auth'));
  } finally { await context.close(); }
}, { timeout: 90000 });
after(async () => { await browser?.close(); });

test('무인증 관리자 진입은 로그인으로 이동하며 입력 레이블과 비밀번호 마스킹을 제공한다', async () => {
  await withPage(false, async (page) => {
    await page.goto(`${baseUrl}/admin/reviews`);
    await page.waitForURL('**/admin/login');
    await page.getByRole('heading', { name: '관리자 로그인' }).waitFor();
    assert.equal(await page.getByLabel('아이디', { exact: true }).getAttribute('autocomplete'), 'username');
    assert.equal(await page.getByLabel('비밀번호', { exact: true }).getAttribute('type'), 'password');
    assert.equal(await page.getByRole('heading', { name: '정책 검수 관리' }).count(), 0);
    await page.screenshot({ path: '/tmp/mvp2-step29-login.png', fullPage: true });
  });
});

test('로그인 입력 중 창과 탭 및 뒤로 가기 복귀는 폼과 입력값을 유지한다', async () => {
  await withPage(false, async (page) => {
    let checks = 0;
    await page.route('**/api/v1/admin/auth/me', (route) => {
      checks++;
      return route.fulfill({ status: 401, json: {} });
    });
    await page.goto(`${baseUrl}/admin/login`);
    await page.getByRole('heading', { name: '관리자 로그인', exact: true }).waitFor();
    // 실제 비밀번호 대신 합성 초안을 사용해 실패 보고에도 인증값이 포함되지 않도록 준비
    await page.getByLabel('아이디', { exact: true }).fill('focus-draft-user');
    await page.getByLabel('비밀번호', { exact: true }).fill('focus-draft-password');
    await page.evaluate(() => { window.loginFormBeforeFocus = document.querySelector('.admin-login form'); });
    const initialChecks = checks;
    for (const event of ['focus', 'visibilitychange', 'pageshow']) {
      const result = await page.evaluate(async (name) => {
        if (name === 'visibilitychange') document.dispatchEvent(new Event(name));
        else if (name === 'pageshow') window.dispatchEvent(new PageTransitionEvent(name, { persisted: true }));
        else window.dispatchEvent(new Event(name));
        // 이벤트 처리와 React 렌더링이 끝난 뒤 같은 DOM과 합성 입력이 유지되는지 확인
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {
          sameForm: document.querySelector('.admin-login form') === window.loginFormBeforeFocus,
          usernameKept: document.querySelector('#admin-username')?.value === 'focus-draft-user',
          passwordKept: document.querySelector('#admin-password')?.value === 'focus-draft-password',
          checking: document.querySelector('main')?.textContent.includes('관리자 인증을 확인하고 있습니다.'),
        };
      }, event);
      assert.deepEqual(result, { sameForm: true, usernameKept: true, passwordKept: true, checking: false }, `${event} 복귀 후 로그인 폼 유지`);
      assert.equal(checks, initialChecks, `${event} 복귀 시 로그인 화면의 추가 인증 조회 없음`);
    }
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
  });
});

test('보호 화면은 창 복귀 시 인증을 다시 확인하고 다른 탭의 로그아웃을 반영한다', async () => {
  await withPage(true, async (page) => {
    await page.goto(`${baseUrl}/admin/reviews`);
    await waitForProtected(page);
    await page.route('**/api/v1/admin/auth/me', (route) => route.fulfill({ status: 401, json: {} }));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForURL('**/admin/login');
    await page.getByRole('heading', { name: '관리자 로그인', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: '정책 검수 관리' }).count(), 0);
  });
});

test('실제 로그인과 새로고침 및 공통 메뉴와 로그아웃이 동작하고 브라우저 저장소를 사용하지 않는다', async () => {
  await withPage(false, async (page, context) => {
    const unexpected = [];
    // 목록 메뉴 이동만으로 검수 상세 API를 호출하지 않는지 확인
    page.on('request', (request) => {
      if (/\/api\/v1\/admin\/reviews\//.test(request.url())) unexpected.push(request.url());
    });
    await page.goto(`${baseUrl}/admin/login`);
    await fillLogin(page);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await waitForProtected(page);
    await page.reload();
    await page.getByRole('heading', { name: '정책 검수 관리' }).waitFor();
    const cookie = (await context.cookies()).find((cookie) => cookie.name === 'youth_admin_auth');
    assert.ok(cookie?.httpOnly);
    assert.equal(cookie?.path, '/api/v1/admin');
    assert.equal(cookie?.sameSite, 'Strict');
    assert.equal(await page.evaluate(() => document.cookie.includes('youth_admin_auth')), false);
    const stored = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }));
    assert.deepEqual(stored, { local: 0, session: 0 });
    await page.getByRole('link', { name: '처리 이력', exact: true }).click();
    await page.getByRole('heading', { name: '처리 이력', exact: true }).waitFor();
    await page.getByRole('link', { name: '누락 정책', exact: true }).click();
    await page.getByRole('heading', { name: '누락 정책', exact: true }).waitFor();
    await page.getByRole('link', { name: '검수 대기', exact: true }).click();
    await waitForProtected(page);
    assert.equal(unexpected.length, 0);
    await page.screenshot({ path: '/tmp/mvp2-step29-reviews.png', fullPage: true });
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await page.waitForURL('**/admin/login');
    await page.getByRole('heading', { name: '관리자 로그인' }).waitFor();
    assert.equal((await context.cookies()).some((cookie) => cookie.name === 'youth_admin_auth'), false);
    await page.goto(`${baseUrl}/admin/reviews`);
    await page.waitForURL('**/admin/login');
  });
});

test('이미 인증된 관리자는 /admin과 로그인 화면에서 검수 대기로 이동한다', async () => {
  await withPage(true, async (page) => {
    await page.goto(`${baseUrl}/admin`);
    await waitForProtected(page);
    await page.goto(`${baseUrl}/admin/login`);
    await waitForProtected(page);
  });
});

test('잘못된 비밀번호를 안내하고 비밀번호 입력을 지운다', async () => {
  await withPage(false, async (page) => {
    await page.goto(`${baseUrl}/admin/login`);
    await fillLogin(page, 'incorrect-test-password');
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '아이디 또는 비밀번호를 확인해 주세요.' }).waitFor();
    assert.equal(await page.getByLabel('비밀번호', { exact: true }).inputValue(), '');
  });
});

test('인증 서버 오류를 로그인 실패로 단정하지 않고 재시도한다', async () => {
  await withPage(false, async (page) => {
    await page.route('**/api/v1/admin/auth/me', (route) => route.fulfill({ status: 503, json: {} }));
    await page.goto(`${baseUrl}/admin/reviews`);
    await page.getByRole('alert').filter({ hasText: '인증 상태를 확인하지 못했습니다.' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: '정책 검수 관리' }).count(), 0);
    await page.unroute('**/api/v1/admin/auth/me');
    await page.getByRole('button', { name: '다시 시도', exact: true }).click();
    await page.waitForURL('**/admin/login');
    await page.getByRole('heading', { name: '관리자 로그인' }).waitFor();
  });
});

test('401 응답이면 기존 보호 화면을 감추고 로그인으로 이동한다', async () => {
  await withPage(true, async (page) => {
    await page.goto(`${baseUrl}/admin/reviews`);
    await waitForProtected(page);
    await page.route('**/api/v1/admin/auth/me', (route) => route.fulfill({ status: 401, json: {} }));
    await page.getByRole('link', { name: '처리 이력', exact: true }).click();
    await page.waitForURL('**/admin/login');
    await page.getByRole('heading', { name: '관리자 로그인' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: '정책 검수 관리' }).count(), 0);
  });
});

test('만료 시각이 되면 화면과 관리자 정보를 지우고 재로그인을 안내한다', async () => {
  await withPage(true, async (page) => {
    let first = true;
    await page.route('**/api/v1/admin/auth/me', async (route) => {
      if (!first) { await route.fulfill({ status: 401, json: {} }); return; }
      first = false;
      await route.fulfill({ status: 200, json: { username, expiresAt: new Date(Date.now() + 2500).toISOString() } });
    });
    await page.goto(`${baseUrl}/admin/reviews`);
    await waitForProtected(page);
    await page.waitForURL('**/admin/login');
    await page.getByRole('status').filter({ hasText: '로그인이 만료되었습니다.' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: '정책 검수 관리' }).count(), 0);
  });
});

test('로그인 요청 중 제출을 중복 실행하지 않으며 429 안내를 제공한다', async () => {
  await withPage(false, async (page) => {
    let requests = 0;
    await page.route('**/api/v1/admin/auth/login', async (route) => {
      requests++;
      await new Promise((resolve) => setTimeout(resolve, 200));
      await route.fulfill({ status: 429, json: {} });
    });
    await page.goto(`${baseUrl}/admin/login`);
    await fillLogin(page);
    await page.locator('form').evaluate((form) => { form.requestSubmit(); form.requestSubmit(); });
    await page.getByRole('alert').filter({ hasText: '로그인 시도가 많습니다.' }).waitFor();
    assert.equal(requests, 1);
    assert.equal(await page.getByLabel('비밀번호', { exact: true }).inputValue(), '');
  });
});

test('좁은 화면에서도 메뉴와 로그아웃을 사용할 수 있고 가로 넘침이 없다', async () => {
  await withPage(true, async (page) => {
    await page.goto(`${baseUrl}/admin/reviews`);
    await waitForProtected(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('link', { name: '처리 이력', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: '처리 이력', exact: true }).waitFor();
    await page.screenshot({ path: '/tmp/mvp2-step29-mobile.png', fullPage: true });
    assert.equal(await page.getByRole('button', { name: '로그아웃', exact: true }).isVisible(), true);
  }, { width: 390, height: 844 });
});

test('기존 공개 정책 목록도 실제 API에서 정상 조회된다', async () => {
  await withPage(false, async (page) => {
    await page.goto(`${baseUrl}/policies`);
    await page.locator('.policy-card').first().waitFor();
    assert.equal(await page.locator('.policy-card').count(), 20);
    assert.equal(await page.locator('main [role="alert"]').count(), 0);
  });
});
