import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import * as database from '../src/database/data-source';
import { loadEnvironment } from '../src/common/environment';
import { createApplication } from '../src/main';
import { AdminCookieService } from '../src/modules/admin/services/admin-cookie.service';
import { testAdminValues } from './helpers/admin';

const loginBody = { username: testAdminValues.ADMIN_USERNAME, password: 'test-only-password' };

/** 사용 중인 개발 서버와 충돌하지 않도록 임시 웹 포트 확보 */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

describe('실제 Next.js 프로덕션 프록시를 통한 관리자 인증', () => {
  const schema = `admin_proxy_test_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource;
  let connection: DataSource;
  let schemaCreated = false;
  let api: INestApplication;
  let child: ChildProcess;
  let webOrigin: string;
  let apiOrigin: string;
  let project: string | undefined;
  let output = '';
  let time = Date.now();
  const arrivals: { path: string; origin: string | undefined; hasCookie: boolean }[] = [];
  const sensitiveTokens: string[] = [];
  let logs: jest.SpyInstance[] = [];

  beforeAll(async () => {
    jest.spyOn(Date, 'now').mockImplementation(() => time);
    logs = ['log', 'warn', 'error', 'debug', 'verbose'].map((name) => jest.spyOn(Logger.prototype, name as 'log').mockImplementation(() => {}));
    const port = await freePort();
    webOrigin = `http://127.0.0.1:${port}`;
    // 빈 DB에서도 독립 실행되도록 이 프록시 테스트만 사용하는 스키마 준비
    const environment = loadEnvironment();
    admin = database.createDataSource(environment).setOptions({ entities: [], migrations: [] });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    connection = database.createDataSource(environment).setOptions({ schema,
      extra: { options: `-c timezone=Asia/Seoul -c search_path=${schema}` } });
    const factory = jest.spyOn(database, 'createDataSource').mockReturnValue(connection);
    try { api = await createApplication({ ...testAdminValues, ADMIN_WEB_ORIGIN: webOrigin }); }
    finally { factory.mockRestore(); }
    await connection.runMigrations();
    // API에서 관찰한 원래 출처와 쿠키 존재 여부만 기록 (비밀번호와 쿠키 원문은 기록하지 않음)
    api.use((req: IncomingMessage, _res: unknown, next: () => void) => {
      arrivals.push({ path: req.url ?? '', origin: req.headers.origin, hasCookie: Boolean(req.headers.cookie?.includes('youth_admin_auth=')) });
      next();
    });
    await api.listen(0, '127.0.0.1');
    apiOrigin = `http://127.0.0.1:${(api.getHttpServer().address() as AddressInfo).port}`;
    const env = { ...process.env };
    // 웹 빌드에는 API 주소만 필요하므로 DB 접속 정보와 인증 비밀값을 전달하지 않음
    for (const key of Object.keys(env)) if (/PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL/.test(key)) delete env[key];
    child = spawn(process.execPath, [join(__dirname, 'fixtures/admin-proxy.cjs')], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...env, NODE_OPTIONS: '', API_INTERNAL_URL: apiOrigin,
        PROXY_TEST_PORT: String(port), NEXT_TELEMETRY_DISABLED: '1' },
    });
    child.stdout!.on('data', (chunk) => { output += String(chunk); });
    child.stderr!.on('data', (chunk) => { output += String(chunk); });
    await new Promise<void>((resolve, reject) => {
      child.on('message', (message: { event: string; path?: string }) => {
        if (message.event === 'PROJECT') project = message.path;
        if (message.event === 'READY') resolve();
      });
      child.once('error', reject);
      child.once('exit', () => reject(new Error(`Next.js 프록시 시작 실패: ${output}`)));
    });
  }, 180000);

  beforeEach(() => { time += 60000; arrivals.length = 0; });
  afterAll(async () => {
    try {
      if (child && child.exitCode === null && child.signalCode === null) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => { child.kill('SIGKILL'); }, 10000);
          child.once('exit', () => { clearTimeout(timeout); resolve(); });
          child.kill('SIGTERM');
        });
      }
    } finally {
      try {
        // 빌드 중 강제 종료된 경우에도 이번 테스트의 임시 프로젝트만 정리
        const prefix = resolve(__dirname, '../../web/.next/admin-proxy-test-');
        if (project?.startsWith(prefix)) await rm(project, { recursive: true, force: true, maxRetries: 3 });
      } finally {
        try { if (api) await api.close(); }
        finally {
          try { if (connection?.isInitialized) await connection.destroy(); }
          finally {
            try { if (schemaCreated && admin?.isInitialized) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
            finally {
              try { if (admin?.isInitialized) await admin.destroy(); }
              finally { jest.restoreAllMocks(); }
            }
          }
        }
      }
    }
  }, 20000);

  it('원래 Origin과 Set-Cookie를 보존하고 브라우저 쿠키로 me 및 로그아웃이 동작한다', async () => {
    const browser = request.agent(webOrigin);
    const login = await browser.post('/api/v1/admin/auth/login').set('Origin', webOrigin).send(loginBody).expect(200);
    const header = login.headers['set-cookie'][0];
    expect(header).toBe(api.get(AdminCookieService).issue().cookie);
    sensitiveTokens.push(header.split(';')[0].split('=')[1]);
    expect(header).toMatch(/; Max-Age=28800; Path=\/api\/v1\/admin; HttpOnly; SameSite=Strict$/);
    expect(header).not.toMatch(/Domain|Secure/);
    expect(login.body.username).toBe(loginBody.username);
    expect(arrivals.at(-1)).toEqual({ path: '/api/v1/admin/auth/login', origin: webOrigin, hasCookie: false });
    await browser.get('/api/v1/admin/auth/me').expect(200).expect(login.body);
    expect(arrivals.at(-1)?.hasCookie).toBe(true);
    // 쿠키의 Path 속성에 따라 공개 API 요청에는 관리자 쿠키가 전달되지 않는지 확인
    await browser.get('/api/v1/health').expect(200);
    expect(arrivals.at(-1)?.hasCookie).toBe(false);
    const logout = await browser.post('/api/v1/admin/auth/logout').set('Origin', webOrigin).send({}).expect(204);
    expect(logout.headers['set-cookie'][0]).toBe('youth_admin_auth=; Max-Age=0; Path=/api/v1/admin; HttpOnly; SameSite=Strict');
    await browser.get('/api/v1/admin/auth/me').expect(401);
    for (const response of [login, logout]) expect(response.headers['cache-control']).toBe('no-store');
  });

  it.each([undefined, 'https://attacker.example', 'internal'])('Origin을 보충하거나 내부 주소로 바꾸어 통과시키지 않는다 (%#)', async (value) => {
    const origin = value === 'internal' ? apiOrigin : value;
    const pending = request(webOrigin).post('/api/v1/admin/auth/login').send(loginBody);
    if (origin) pending.set('Origin', origin);
    await pending.expect(403).expect({ code: 'ADMIN_ORIGIN_FORBIDDEN', message: '허용되지 않은 관리자 요청 출처입니다.' });
    expect(arrivals.at(-1)?.origin).toBe(origin);
  });

  it('잘못된 자격과 쿠키 변조 및 만료가 프록시에서도 같은 401이다', async () => {
    await request(webOrigin).post('/api/v1/admin/auth/login').set('Origin', webOrigin)
      .send({ ...loginBody, password: 'wrong-proxy-password' }).expect(401);
    const cookie = api.get(AdminCookieService).issue().cookie.split(';')[0];
    sensitiveTokens.push(cookie.split('=')[1]);
    await request(webOrigin).get('/api/v1/admin/auth/me').set('Cookie', `${cookie}tampered`).expect(401);
    time += 28800 * 1000;
    await request(webOrigin).get('/api/v1/admin/auth/me').set('Cookie', cookie).expect(401);
    await request(webOrigin).post('/api/v1/admin/auth/logout').set('Origin', webOrigin).send({}).expect(204);
  });

  it('JSON 전용과 구문 및 본문 크기와 압축 거부를 보존한다', async () => {
    await request(webOrigin).post('/api/v1/admin/auth/login').set('Origin', webOrigin).type('form').send(loginBody).expect(415);
    await request(webOrigin).post('/api/v1/admin/auth/login').set('Origin', webOrigin).type('json').send('{').expect(400);
    await request(webOrigin).post('/api/v1/admin/auth/login').set('Origin', webOrigin).send({ password: 'x'.repeat(17000) }).expect(413);
    await request(webOrigin).post('/api/v1/admin/auth/logout').set('Origin', webOrigin).type('json')
      .set('Content-Encoding', 'gzip').send('{}').expect(415);
    await request(webOrigin).post('/api/v1/admin/auth/logout').set('Origin', webOrigin).type('json').expect(400);
  });

  it('로그인 추가 제한과 Retry-After를 그대로 전달한다', async () => {
    for (let index = 0; index < 5; index++) {
      await request(webOrigin).post('/api/v1/admin/auth/login').set('Origin', webOrigin)
        .send({ ...loginBody, password: 'wrong-proxy-password' }).expect(401);
    }
    const response = await request(webOrigin).post('/api/v1/admin/auth/login').set('Origin', webOrigin).send(loginBody).expect(429);
    expect(response.headers['retry-after']).toBe('60');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('기존 공개 검색 응답과 JSON 및 보안 헤더를 유지한다', async () => {
    const direct = await request(api.getHttpServer()).post('/api/v1/policies/search').send({}).expect(200);
    const proxied = await request(webOrigin).post('/api/v1/policies/search').send({}).expect(200);
    expect(proxied.body).toEqual(direct.body);
    expect(proxied.headers['x-content-type-options']).toBe('nosniff');
    expect(proxied.headers['cache-control']).toBe('no-store');
    await request(webOrigin).post('/api/v1/policies/search').type('form').send({}).expect(415);
    await request(webOrigin).post('/api/v1/policies/search').send({ conditions: { age: -1 } }).expect(400);
    await request(webOrigin).post('/api/v1/policies/search').send({ keyword: 'x'.repeat(17000) }).expect(413);
    await request(webOrigin).post('/api/v1/policies/search').type('json').set('Content-Encoding', 'gzip').send('{}').expect(415);
    const cors = await request(webOrigin).get('/api/v1/health').set('Origin', 'http://localhost:3000').expect(200);
    expect(cors.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(cors.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('공개 한도가 소진돼도 웹을 통한 인증 me는 별도 한도를 사용한다', async () => {
    for (let index = 0; index < 120; index++) await request(webOrigin).get('/api/v1/not-found').expect(404);
    await request(webOrigin).get('/api/v1/not-found').expect(429);
    const cookie = api.get(AdminCookieService).issue().cookie.split(';')[0];
    sensitiveTokens.push(cookie.split('=')[1]);
    await request(webOrigin).get('/api/v1/admin/auth/me').set('Cookie', cookie).expect(200);
  });

  it('웹과 API 로그에 비밀번호와 해시 및 서명 키와 쿠키를 남기지 않는다', () => {
    const combined = output + JSON.stringify(logs.map((spy) => spy.mock.calls));
    for (const value of [loginBody.password, 'wrong-proxy-password', testAdminValues.ADMIN_PASSWORD_HASH,
      testAdminValues.ADMIN_AUTH_SECRET, ...sensitiveTokens]) expect(combined).not.toContain(value);
  });
});
