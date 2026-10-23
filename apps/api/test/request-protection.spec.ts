import 'reflect-metadata';
import { Body, Controller, Get, Logger, Module, Post } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createPolicySearchSchema } from '@youth-kkultong/shared/policy-search.schema';
import type { PolicySearchRequest } from '@youth-kkultong/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import request from 'supertest';
import { configureApplication } from '../src/main';
import { createRequestProtection } from '../src/common/request-protection';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe';

const secret = 'step54-private-key-and-input';
const schema = createPolicySearchSchema({ regionCodes: new Set(), jobCodes: new Set(), schoolCodes: new Set() });

/** DB 없이 공통 설정을 통과하는 HTTP 요청과 예외를 재현한다. */
@Controller()
class ProtectionController {
  /** 검증 후 개인 조건을 응답에 넣지 않고 처리 결과만 반환한다. */
  @Post('policies/search')
  search(@Body(new ZodValidationPipe(schema)) _body: PolicySearchRequest) { return { ok: true }; }

  /** 컨테이너의 생존 확인을 재현한다. */
  @Get('health')
  health() { return { status: 'ok' }; }

  /** 비밀값을 포함한 내부 예외가 고정 문구로 바뀌는지 확인한다. */
  @Get('failure')
  fail(): never { throw new Error(secret); }
}

/** HTTP 보호만 검증하는 최소 애플리케이션. */
@Module({ controllers: [ProtectionController] })
class ProtectionModule {}

describe('공개 API 요청 보호', () => {
  let app: INestApplication;
  let errorLog: jest.SpyInstance;

  beforeEach(async () => {
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    app = await NestFactory.create(ProtectionModule, { logger: false, bodyParser: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
  });
  afterEach(async () => { try { await app.close(); } finally { errorLog.mockRestore(); } });

  it('정상·400·404·500 응답 모두에 보안 헤더와 저장 금지를 적용한다', async () => {
    const responses = [
      await request(app.getHttpServer()).post('/api/v1/policies/search').send({ conditions: { age: 28 }, keyword: secret }).expect(201),
      await request(app.getHttpServer()).post('/api/v1/policies/search').send({ conditions: { age: secret } }).expect(400),
      await request(app.getHttpServer()).get(`/api/v1/missing-${secret}`).expect(404),
      await request(app.getHttpServer()).get('/api/v1/failure').set('Authorization', secret).expect(500),
    ];
    for (const response of responses) {
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['content-security-policy']).toContain("object-src 'none'");
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.text).not.toContain(secret);
    }
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
  });

  it('허용한 출처에만 CORS 헤더를 반환하고 인증정보는 허용하지 않는다', async () => {
    const allowed = await request(app.getHttpServer()).get('/api/v1/health').set('Origin', 'http://localhost:3000').expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();
    for (const origin of ['https://untrusted.example', 'http://localhost:3000.evil.example', 'null']) {
      const blocked = await request(app.getHttpServer()).get('/api/v1/health').set('Origin', origin).expect(200);
      expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
    }
    const preflight = await request(app.getHttpServer()).options('/api/v1/policies/search')
      .set('Origin', 'http://localhost:3000').set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type').expect(204);
    expect(preflight.headers['access-control-allow-methods']).toBe('GET,POST');
    expect(preflight.headers['access-control-allow-headers']).toBe('Content-Type');
    expect(preflight.headers['x-content-type-options']).toBe('nosniff');
  });

  it('JSON 형식·구문·크기·압축 오류를 고정 오류로 거부한다', async () => {
    await request(app.getHttpServer()).post('/api/v1/policies/search').type('form').send({ age: secret }).expect(415);
    await request(app.getHttpServer()).post('/api/v1/policies/search').type('json').send(`{"${secret}":`).expect(400);
    const large = await request(app.getHttpServer()).post('/api/v1/policies/search').send({ keyword: secret.repeat(1000) }).expect(413);
    expect(large.body).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: '요청 본문이 너무 큽니다.' });
    const compressed = await request(app.getHttpServer()).post('/api/v1/policies/search').type('json')
      .set('Content-Encoding', 'gzip').send('{}').expect(415);
    expect(compressed.text).not.toContain(secret);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
  });

  it('120회를 넘으면 전달 헤더를 바꿔도 429이고 생존 확인은 계속된다', async () => {
    for (let index = 0; index < 120; index += 1) {
      await request(app.getHttpServer()).get('/api/v1/missing').expect(404);
    }
    const blocked = await request(app.getHttpServer()).post('/api/v1/policies/search')
      .set('Origin', 'http://localhost:3000')
      .set('X-Forwarded-For', '203.0.113.10').set('X-Real-IP', '203.0.113.11').send({ keyword: secret }).expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.headers['cache-control']).toBe('no-store');
    expect(blocked.headers['x-content-type-options']).toBe('nosniff');
    expect(blocked.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(blocked.text).not.toContain(secret);
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });
});

describe('호출 제한 시간과 주소 상한', () => {
  it('접속별로 세고 1분 뒤 정리하며 주소 상한에서도 기존 제한을 유지한다', () => {
    let time = 0;
    const protect = createRequestProtection(() => time);
    const next = jest.fn();
    const response = { setHeader: jest.fn(), writeHead: jest.fn(), end: jest.fn() };
    const run = (address: string) => protect({ method: 'GET', url: '/api/v1/meta/categories', socket: { remoteAddress: address } } as IncomingMessage,
      response as unknown as ServerResponse, next);
    for (let count = 0; count < 120; count += 1) run('first');
    run('other');
    expect(next).toHaveBeenCalledTimes(121);
    run('first');
    expect(response.writeHead).toHaveBeenLastCalledWith(429, expect.anything());
    for (let index = 2; index < 10_000; index += 1) run(`address-${index}`);
    const accepted = next.mock.calls.length;
    run('overflow');
    run('first');
    expect(next).toHaveBeenCalledTimes(accepted);
    time = 60_000;
    run('overflow');
    run('first');
    expect(next).toHaveBeenCalledTimes(accepted + 2);
  });
});
