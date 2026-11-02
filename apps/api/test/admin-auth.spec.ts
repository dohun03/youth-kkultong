import 'reflect-metadata';
import { Module, Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { configureApplication } from '../src/main';
import { AdminCookieService } from '../src/modules/admin/services/admin-cookie.service';
import { adminAuthTestModule, testAdminValues } from './helpers/admin';

const origin = testAdminValues.ADMIN_WEB_ORIGIN;
const validLogin = { username: testAdminValues.ADMIN_USERNAME, password: 'test-only-password' };

/** 실제 관리자 모듈을 등록하는 DB 없는 인증 HTTP 테스트 앱 */
@Module({})
class AuthTestModule {}

/** 출처 설정을 바꾸어 실제 인증 컨트롤러와 Guard 및 공통 보호를 시작 */
async function createTestApp(webOrigin = origin): Promise<INestApplication> {
  const app = await NestFactory.create({ module: AuthTestModule,
    imports: [adminAuthTestModule({ ...testAdminValues, ADMIN_WEB_ORIGIN: webOrigin })] }, { logger: false, bodyParser: false });
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  return app;
}

describe('관리자 로그인과 인증 확인 및 로그아웃 HTTP', () => {
  let app: INestApplication;
  let time: number;
  let logs: jest.SpyInstance[];
  beforeEach(async () => {
    time = new Date('2026-11-02T00:00:00Z').getTime();
    jest.spyOn(Date, 'now').mockImplementation(() => time);
    logs = ['log', 'warn', 'error', 'debug', 'verbose'].map((name) =>
      jest.spyOn(Logger.prototype, name as 'log').mockImplementation(() => {}));
    app = await createTestApp();
  });
  afterEach(async () => { try { if (app) await app.close(); } finally { jest.restoreAllMocks(); } });

  it('정상 로그인 -> me -> 로그아웃 후 브라우저 쿠키 삭제로 무인증 상태가 된다', async () => {
    const browser = request.agent(app.getHttpServer());
    const login = await browser.post('/api/v1/admin/auth/login').set('Origin', origin).send(validLogin).expect(200);
    expect(login.body).toEqual({ username: validLogin.username, expiresAt: '2026-11-02T08:00:00.000Z' });
    expect(login.headers['set-cookie'][0]).toMatch(/^youth_admin_auth=.+; Max-Age=28800; Path=\/api\/v1\/admin; HttpOnly; SameSite=Strict$/);
    expect(login.headers['set-cookie'][0]).not.toMatch(/Secure|Domain|password|scrypt/);
    await browser.get('/api/v1/admin/auth/me').expect(200).expect(login.body);
    const logout = await browser.post('/api/v1/admin/auth/logout').set('Origin', origin).send({}).expect(204);
    expect(logout.text).toBe('');
    expect(logout.headers['set-cookie'][0]).toBe('youth_admin_auth=; Max-Age=0; Path=/api/v1/admin; HttpOnly; SameSite=Strict');
    await browser.get('/api/v1/admin/auth/me').expect(401);
    for (const response of [login, logout]) expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(logs.map((spy) => spy.mock.calls))).not.toContain(validLogin.password);
    expect(JSON.stringify(logs.map((spy) => spy.mock.calls))).not.toContain(login.headers['set-cookie'][0]);
  });

  it('HTTPS 출처는 발급과 삭제 모두 Secure를 사용한다', async () => {
    const httpsOrigin = 'https://admin.example';
    const httpsApp = await createTestApp(httpsOrigin);
    try {
      const login = await request(httpsApp.getHttpServer()).post('/api/v1/admin/auth/login').set('Origin', httpsOrigin).send(validLogin).expect(200);
      const logout = await request(httpsApp.getHttpServer()).post('/api/v1/admin/auth/logout').set('Origin', httpsOrigin).send({}).expect(204);
      for (const response of [login, logout]) expect(response.headers['set-cookie'][0]).toContain('; SameSite=Strict; Secure');
    } finally { await httpsApp.close(); }
  });

  it.each([
    { ...validLogin, username: 'unknown' }, { ...validLogin, password: 'wrong' },
    { username: 'unknown', password: 'wrong' }, { ...validLogin, password: ` ${validLogin.password} ` },
  ])('잘못된 자격은 쿠키 없이 동일한 401을 반환한다 (%#)', async (body) => {
    const response = await request(app.getHttpServer()).post('/api/v1/admin/auth/login').set('Origin', origin).send(body).expect(401);
    expect(response.body).toEqual({ code: 'ADMIN_UNAUTHORIZED', message: '관리자 인증이 필요합니다.' });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(logs.map((spy) => spy.mock.calls))).not.toContain(body.password);
  });

  it.each([{}, { ...validLogin, extra: true }, { ...validLogin, password: '' },
    { ...validLogin, password: 'x'.repeat(257) }, { ...validLogin, username: 'has space' },
    { ...validLogin, username: 'x'.repeat(65) }, [], null])
  ('로그인 본문 오류는 400이며 쿠키를 발급하지 않는다 (%#)', async (body) => {
    const response = await request(app.getHttpServer()).post('/api/v1/admin/auth/login').set('Origin', origin)
      .type('json').send(JSON.stringify(body)).expect(400);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it.each(['login', 'logout'])('%s은 Origin이 없거나 다르면 쿠키 없이도 403이다', async (action) => {
    for (const value of [undefined, 'https://attacker.example']) {
      const pending = request(app.getHttpServer()).post(`/api/v1/admin/auth/${action}`).send(action === 'login' ? validLogin : {});
      if (value) pending.set('Origin', value);
      const response = await pending.expect(403);
      expect(response.headers['set-cookie']).toBeUndefined();
    }
  });

  it.each([undefined, 'youth_admin_auth=bad'])('쿠키가 없거나 잘못되어도 로그아웃은 204와 삭제 쿠키를 반환한다 (%#)', async (cookie) => {
    const pending = request(app.getHttpServer()).post('/api/v1/admin/auth/logout').set('Origin', origin).send({});
    if (cookie) pending.set('Cookie', cookie);
    const response = await pending.expect(204);
    expect(response.headers['set-cookie'][0]).toContain('youth_admin_auth=; Max-Age=0');
  });

  it.each([{ extra: true }, [], null])('로그아웃은 빈 JSON 객체 외의 본문을 거부한다 (%#)', async (body) => {
    await request(app.getHttpServer()).post('/api/v1/admin/auth/logout').set('Origin', origin)
      .type('json').send(JSON.stringify(body)).expect(400);
  });

  it('로그아웃의 누락된 본문과 폼 본문도 거부한다', async () => {
    await request(app.getHttpServer()).post('/api/v1/admin/auth/logout').set('Origin', origin).type('json').expect(400);
    await request(app.getHttpServer()).post('/api/v1/admin/auth/logout').set('Origin', origin).type('form').send({}).expect(415);
  });

  it('만료 직전 me는 같은 만료를 반환하고 만료 초부터 거부하며 로그아웃은 가능하다', async () => {
    const login = await request(app.getHttpServer()).post('/api/v1/admin/auth/login').set('Origin', origin).send(validLogin).expect(200);
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    time += 28800 * 1000 - 1;
    await request(app.getHttpServer()).get('/api/v1/admin/auth/me').set('Cookie', cookie).expect(200).expect(login.body);
    time += 1;
    await request(app.getHttpServer()).get('/api/v1/admin/auth/me').set('Cookie', cookie).expect(401);
    await request(app.getHttpServer()).post('/api/v1/admin/auth/logout').set('Cookie', cookie).set('Origin', origin).send({}).expect(204);
  });

  it('쿠키가 없거나 변조되면 me는 401이며 비밀값을 반환하지 않는다', async () => {
    const cookie = app.get(AdminCookieService).issue().cookie.split(';')[0];
    for (const header of [undefined, `${cookie}tampered`]) {
      const pending = request(app.getHttpServer()).get('/api/v1/admin/auth/me');
      if (header) pending.set('Cookie', header);
      const response = await pending.expect(401);
      expect(response.body).toEqual({ code: 'ADMIN_UNAUTHORIZED', message: '관리자 인증이 필요합니다.' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });

  it('로그인 성공과 실패를 함께 5회로 세고 60초 경계에서 다시 허용한다', async () => {
    for (let index = 0; index < 5; index++) {
      await request(app.getHttpServer()).post('/api/v1/admin/auth/login').set('Origin', origin)
        .send(index % 2 ? { ...validLogin, password: 'wrong' } : validLogin).expect(index % 2 ? 401 : 200);
    }
    time += 59001;
    const blocked = await request(app.getHttpServer()).post('/API/V1/ADMIN/AUTH/LOGIN/').set('Origin', origin)
      .set('X-Forwarded-For', '203.0.113.99').send(validLogin).expect(429);
    expect(blocked.headers['retry-after']).toBe('1');
    expect(blocked.headers['cache-control']).toBe('no-store');
    expect(blocked.headers['set-cookie']).toBeUndefined();
    const cookie = app.get(AdminCookieService).issue().cookie.split(';')[0];
    await request(app.getHttpServer()).get('/api/v1/admin/auth/me').set('Cookie', cookie).expect(200);
    time += 999;
    await request(app.getHttpServer()).post('/api/v1/admin/auth/login').set('Origin', origin).send(validLogin).expect(200);
  });

  it('공개 120회 소진 후에도 관리자 me와 로그인은 별도 한도로 허용한다', async () => {
    for (let index = 0; index < 120; index++) await request(app.getHttpServer()).get('/api/v1/unknown').expect(404);
    await request(app.getHttpServer()).get('/api/v1/unknown').expect(429);
    const cookie = app.get(AdminCookieService).issue().cookie.split(';')[0];
    await request(app.getHttpServer()).get('/api/v1/admin/auth/me').set('Cookie', cookie).expect(200);
    await request(app.getHttpServer()).post('/api/v1/admin/auth/login').set('Origin', origin).send(validLogin).expect(200);
  });

  it('관리자 120회 소진 후 공개 요청은 허용하고 관리자 me 및 로그인은 429이다', async () => {
    const cookie = app.get(AdminCookieService).issue().cookie.split(';')[0];
    for (let index = 0; index < 120; index++) await request(app.getHttpServer()).get('/api/v1/admin/auth/me').set('Cookie', cookie).expect(200);
    await request(app.getHttpServer()).get('/api/v1/admin/auth/me').set('Cookie', cookie).expect(429);
    await request(app.getHttpServer()).post('/api/v1/admin/auth/login').set('Origin', origin).send(validLogin).expect(429);
    await request(app.getHttpServer()).get('/api/v1/unknown').expect(404);
  });

  it('CORS 사전 요청은 로그인 한도를 소진하지 않는다', async () => {
    for (let index = 0; index < 6; index++) {
      await request(app.getHttpServer()).options('/api/v1/admin/auth/login').set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST').expect(204);
    }
    await request(app.getHttpServer()).post('/api/v1/admin/auth/login').set('Origin', origin).send(validLogin).expect(200);
  });

  it('로그인은 추가 한도와 함께 관리자 일반 120회에도 한 번 포함한다', async () => {
    const login = await request(app.getHttpServer()).post('/api/v1/admin/auth/login').set('Origin', origin).send(validLogin).expect(200);
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    for (let index = 0; index < 119; index++) await request(app.getHttpServer()).get('/api/v1/admin/auth/me').set('Cookie', cookie).expect(200);
    await request(app.getHttpServer()).get('/api/v1/admin/auth/me').set('Cookie', cookie).expect(429);
  });
});
