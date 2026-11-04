/** 실제 로그인 한도를 유지하며 브라우저 테스트의 인증 쿠키 준비 */
export async function loginForAdminTests(page, baseUrl, username, password) {
  await page.goto(`${baseUrl}/admin/login`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.getByLabel('아이디', { exact: true }).fill(username);
      await page.getByLabel('비밀번호', { exact: true }).fill(password);
    } catch { throw new Error('관리자 로그인 입력에 실패했습니다.'); }
    const pending = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/admin/auth/login'
      && response.request().method() === 'POST');
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    const response = await pending;
    if (response.status() === 200) { await page.waitForURL('**/admin/reviews'); return; }
    if (response.status() !== 429 || attempt > 0) throw new Error('테스트 준비 로그인을 완료하지 못했습니다.');
    const seconds = Number(response.headers()['retry-after']);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) throw new Error('로그인 재시도 시각을 확인하지 못했습니다.');
    // 인증 제한을 바꾸지 않고 서버가 안내한 창이 끝난 후 유효한 테스트 계정으로 한 번만 재시도
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }
}
