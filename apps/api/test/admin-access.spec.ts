import 'reflect-metadata';
import { Controller, Get, HttpException, Logger, Module, Param, Post, Req } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { z } from 'zod';
import { AdminModule } from '../src/modules/admin/admin.module';
import { AdminCookieService } from '../src/modules/admin/services/admin-cookie.service';
import type { AdminRequest } from '../src/modules/admin/guards/admin.guard';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe';
import { configureApplication, createApplication } from '../src/main';
import { testAdminValues } from './helpers/admin';

const access = jest.fn();
const id = '550e8400-e29b-41d4-a716-446655440000';
const privateValue = 'private-error-cookie-password-value';
const adminErrors = [
  [401, 'ADMIN_UNAUTHORIZED', '관리자 인증이 필요합니다.'],
  [403, 'ADMIN_ORIGIN_FORBIDDEN', '허용되지 않은 관리자 요청 출처입니다.'],
  [404, 'REVIEW_NOT_FOUND', '검수 후보를 찾을 수 없습니다.'],
  [409, 'REVIEW_NOT_PENDING', '이미 처리된 검수 후보입니다.'],
  [409, 'REVIEW_CONTENT_CONFLICT', '검수 내용이 변경되었습니다. 다시 조회해 주세요.'],
  [409, 'REVIEW_BASE_CONFLICT', '공개 기준이 변경되었습니다. 다시 조회해 주세요.'],
] as const;

/** 권한 검사 전후의 데이터 접근과 오류 응답만 확인하는 테스트용 관리자 경로 */
@Controller('admin')
class ProtectedController {
  /** 인증을 통과한 뒤에만 UUID 검증과 데이터 접근 실행 */
  @Get('data/:id')
  read(@Param('id', new ZodValidationPipe(z.uuid())) policyId: string, @Req() req: AdminRequest) {
    access(policyId);
    return req.admin;
  }

  /** 출처 확인 후 상태 변경 처리 실행 */
  @Post('data')
  write() { access(); return { ok: true }; }

  /** 로그인과 같은 URL이라도 GET은 인증을 요구 */
  @Get('auth/login')
  loginGet() { access(); return { ok: true }; }

  /** 명세에 정해진 관리자 오류와 임의 오류를 발생 */
  @Get('error/:index')
  error(@Param('index') index: string): never {
    const expected = adminErrors[Number(index)];
    if (expected) throw new HttpException({ code: expected[1], message: privateValue, input: privateValue }, expected[0]);
    const status = Number(index);
    throw new HttpException({ code: 'ADMIN_UNAUTHORIZED', message: privateValue }, status);
  }
}

/** 공개 경로가 관리자 인증과 출처 검사에 영향을 받지 않는지 확인 */
@Controller('public')
class PublicController {
  @Get()
  read() { return { ok: true }; }
}

/** 운영과 같은 관리자 모듈을 사용하는 DB 없는 HTTP 테스트 앱 */
@Module({ imports: [AdminModule.forHttp(testAdminValues)], controllers: [ProtectedController, PublicController] })
class TestHttpModule {}

describe('관리자 서버 권한 및 Origin HTTP 검사', () => {
  let app: INestApplication;
  let cookie: string;
  let errorLog: jest.SpyInstance;
  beforeAll(async () => {
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    app = await NestFactory.create(TestHttpModule, { logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    cookie = app.get(AdminCookieService).issue().cookie.split(';')[0];
  });
  beforeEach(() => { access.mockClear(); });
  afterAll(async () => { try { if (app) await app.close(); } finally { errorLog.mockRestore(); } });

  it('쿠키가 없으면 UUID 검증과 데이터 접근 전에 401을 반환한다', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/data/invalid-uuid').expect(401)
      .expect({ code: 'ADMIN_UNAUTHORIZED', message: '관리자 인증이 필요합니다.' });
    expect(access).not.toHaveBeenCalled();
  });

  it.each(['youth_admin_auth=invalid', 'youth_admin_auth=', 'other=abc', 'prefix_youth_admin_auth=abc'])
  ('잘못된 쿠키로 데이터에 접근할 수 없다 (%#)', async (header) => {
    await request(app.getHttpServer()).get(`/api/v1/admin/data/${id}`).set('Cookie', header).expect(401);
    expect(access).not.toHaveBeenCalled();
  });

  it('같은 이름의 쿠키가 중복되면 거부한다', async () => {
    await request(app.getHttpServer()).get(`/api/v1/admin/data/${id}`).set('Cookie', `${cookie}; ${cookie}`).expect(401);
    expect(access).not.toHaveBeenCalled();
  });

  it.each([`/api/v1/admin/data/${id}`, `/API/V1/ADMIN/data/${id}/`])
  ('인증된 GET은 Origin 없이 접근하고 관리자 정보를 전달한다 (%#)', async (path) => {
    const response = await request(app.getHttpServer()).get(path).set('Cookie', `other=value; ${cookie}`).expect(200);
    expect(response.body.username).toBe(testAdminValues.ADMIN_USERNAME);
    expect(access).toHaveBeenCalledWith(id);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('인증 후에는 잘못된 UUID를 기존 400으로 처리한다', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/data/invalid').set('Cookie', cookie).expect(400)
      .expect({ code: 'BAD_REQUEST', message: '요청값이 올바르지 않습니다.' });
    expect(access).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'https://attacker.example', 'http://localhost:3000/', 'http://127.0.0.1:3000', 'null'])
  ('인증된 POST도 Origin이 누락되거나 다르면 403이다 (%#)', async (origin) => {
    const pending = request(app.getHttpServer()).post('/api/v1/admin/data').set('Cookie', cookie).send({});
    if (origin !== undefined) pending.set('Origin', origin);
    await pending.expect(403).expect({ code: 'ADMIN_ORIGIN_FORBIDDEN', message: '허용되지 않은 관리자 요청 출처입니다.' });
    expect(access).not.toHaveBeenCalled();
  });

  it('쿠키 없는 상태 변경은 인증 오류로 처리한다', async () => {
    await request(app.getHttpServer()).post('/api/v1/admin/data').set('Origin', testAdminValues.ADMIN_WEB_ORIGIN).send({}).expect(401);
    expect(access).not.toHaveBeenCalled();
  });

  it('쿠키와 정확한 Origin이 있으면 상태 변경을 실행한다', async () => {
    await request(app.getHttpServer()).post('/api/v1/admin/data').set('Cookie', cookie)
      .set('Origin', testAdminValues.ADMIN_WEB_ORIGIN).send({}).expect(201);
    expect(access).toHaveBeenCalledTimes(1);
  });

  it('로그인 POST는 쿠키 없이 정확한 Origin으로만 접근한다', async () => {
    await request(app.getHttpServer()).post('/api/v1/admin/auth/login').send({}).expect(403);
    await request(app.getHttpServer()).post('/api/v1/admin/auth/login').set('Origin', testAdminValues.ADMIN_WEB_ORIGIN)
      .send({ username: testAdminValues.ADMIN_USERNAME, password: 'test-only-password' }).expect(200);
    await request(app.getHttpServer()).get('/api/v1/admin/auth/login').expect(401);
    expect(access).not.toHaveBeenCalled();
  });

  it('전달 헤더로 Origin 누락을 보충할 수 없다', async () => {
    await request(app.getHttpServer()).post('/api/v1/admin/data').set('Cookie', cookie)
      .set('X-Forwarded-Host', 'localhost:3000').set('Referer', 'http://localhost:3000/admin').send({}).expect(403);
    expect(access).not.toHaveBeenCalled();
  });

  it('관리자 POST도 JSON 전용과 본문 크기 제한을 적용한다', async () => {
    await request(app.getHttpServer()).post('/api/v1/admin/data').set('Content-Type', 'text/plain').send('text').expect(415);
    await request(app.getHttpServer()).post('/api/v1/admin/data').send({ large: 'x'.repeat(17000) }).expect(413);
    expect(access).not.toHaveBeenCalled();
  });

  it.each(adminErrors.map((value, index) => [index, ...value] as const))
  ('관리자 업무 코드 %s를 보존하고 원문 대신 안전한 메시지를 반환한다', async (index, status, code, message) => {
    const response = await request(app.getHttpServer()).get(`/api/v1/admin/error/${index}`).set('Cookie', cookie).expect(status);
    expect(response.body).toEqual({ code, message });
    expect(JSON.stringify(response.body)).not.toContain(privateValue);
  });

  it.each([[400, 'BAD_REQUEST'], [500, 'INTERNAL_SERVER_ERROR'], [503, 'SERVICE_UNAVAILABLE']])
  ('상태 %s와 맞지 않는 관리자 코드는 버리고 기존 공통 코드를 유지한다', async (status, code) => {
    const response = await request(app.getHttpServer()).get(`/api/v1/admin/error/${status}`).set('Cookie', cookie).expect(status as number);
    expect(response.body.code).toBe(code);
    expect(JSON.stringify(response.body)).not.toContain(privateValue);
  });

  it('공개 GET은 관리자 인증 없이 기존 보안 헤더와 CORS를 유지한다', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/public').set('Origin', 'http://localhost:3000').expect(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });
});

describe('HTTP 전용 관리자 설정의 조기 검증', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH', 'ADMIN_AUTH_SECRET', 'ADMIN_WEB_ORIGIN'])
  ('잘못된 %s 설정이면 Nest 및 DB 초기화 전에 실패한다', async (name) => {
    const create = jest.spyOn(NestFactory, 'create');
    await expect(createApplication({ ...testAdminValues, [name]: '' })).rejects.toThrow(name);
    expect(create).not.toHaveBeenCalled();
  });

  it('누락된 관리자 자격으로 HTTP 앱을 만들 수 없다', async () => {
    const create = jest.spyOn(NestFactory, 'create');
    await expect(createApplication({})).rejects.toThrow('ADMIN_USERNAME');
    expect(create).not.toHaveBeenCalled();
  });
});
