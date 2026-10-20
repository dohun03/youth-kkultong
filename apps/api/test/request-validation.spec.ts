import 'reflect-metadata';
import { Body, Controller, Get, HttpException, Logger, Module, Param, Post } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createPolicySearchSchema } from '@youth-kkultong/shared/policy-search.schema';
import type { PolicySearchRequest } from '@youth-kkultong/shared';
import request from 'supertest';
import { CannotExecuteNotConnectedError, QueryFailedError, TypeORMError } from 'typeorm';
import { z } from 'zod';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe';
import { configureApplication } from '../src/main';

// 대표 지역 1개와 제한 없음 취업·학력 코드를 허용하는 HTTP 테스트용 검색 스키마.
const schema = createPolicySearchSchema({
  regionCodes: new Set(['11680']), jobCodes: new Set(['0013010']), schoolCodes: new Set(['0049010']),
});
const secret = 'private-request-and-database-value';

/** 검색 본문·UUID 검증과 오류 응답을 확인하는 테스트용 컨트롤러. */
@Controller('validation')
class ValidationController {
  /** 검증을 통과한 검색 요청을 그대로 응답한다. */
  @Post('search')
  search(@Body(new ZodValidationPipe(schema)) body: PolicySearchRequest): PolicySearchRequest {
    return body;
  }

  /** 형식 검증을 통과한 UUID 경로값을 응답한다. */
  @Get('uuid/:id')
  uuid(@Param('id', new ZodValidationPipe(z.uuid())) id: string): { id: string } {
    return { id };
  }

  /** 지정한 종류의 오류를 발생시켜 공통 오류 응답을 시험한다. */
  @Get('error/:kind')
  fail(@Param('kind') kind: string): never {
    if (kind === 'not-found') throw new HttpException(secret, 404);
    if (kind === 'http-unavailable') throw new HttpException(secret, 503);
    if (kind === 'http-internal') throw new HttpException(secret, 500);
    if (kind === 'rate-limit') throw new HttpException(secret, 429);
    if (kind === 'disconnected') throw new CannotExecuteNotConnectedError();
    if (kind === 'driver-disconnected') throw new TypeORMError('Driver not Connected');
    if (kind === 'pool-closed') throw new Error('Cannot use a pool after calling end on the pool');
    if (kind === 'pool-timeout') throw new Error('timeout exceeded when trying to connect');
    if (kind === 'unexpected') throw new Error(secret);
    const connectionMessages: Record<string, string> = {
      terminated: 'Connection terminated',
      'terminated-unexpectedly': 'Connection terminated unexpectedly',
      'connection-timeout': 'Connection terminated due to connection timeout',
      'client-closed': 'Client was closed and is not queryable',
    };
    if (connectionMessages[kind]) {
      throw new QueryFailedError(`SELECT '${secret}'`, [secret], new Error(connectionMessages[kind]));
    }
    const driverError = Object.assign(new Error(secret), { code: kind });
    throw new QueryFailedError(`SELECT '${secret}'`, [secret], driverError);
  }
}

/** 검증용 컨트롤러만 등록하는 HTTP 통합 테스트 모듈. */
@Module({ controllers: [ValidationController] })
class ValidationModule {}

describe('NestJS 요청 검증·공통 오류 HTTP 통합', () => {
  let app: INestApplication;
  let errorLog: jest.SpyInstance;

  beforeAll(async () => {
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    app = await NestFactory.create(ValidationModule, { logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    try {
      if (app) await app.close();
    } finally {
      errorLog.mockRestore();
    }
  });

  it('검증 파이프가 기본값을 채운 요청을 컨트롤러에 전달한다', async () => {
    await request(app.getHttpServer()).post('/api/v1/validation/search').send({})
      .expect(201).expect({ page: 1, limit: 20, includeClosed: false });
  });

  it('정상 사용자 조건을 변환하거나 누락하지 않는다', async () => {
    const body = {
      page: 2, limit: 50, includeClosed: true, sort: 'recommended',
      conditions: { age: 28, regionCode: '11680', jobCode: '0013010', schoolCode: '0049010' },
    };
    await request(app.getHttpServer()).post('/api/v1/validation/search').send(body)
      .expect(201).expect(body);
  });

  it.each([
    { page: 0 }, { limit: 51 }, { sort: 'invalid' }, { includeClosed: 'false' },
    { conditions: { age: 121 } }, { conditions: { age: '28' } },
    { conditions: { regionCode: '28110' } },
    { conditions: { jobCode: secret } }, { conditions: { schoolCode: secret } },
  ])('잘못된 입력을 공통 400 응답으로 거부한다: %j', async (body) => {
    await request(app.getHttpServer()).post('/api/v1/validation/search').send(body)
      .expect(400).expect({ code: 'BAD_REQUEST', message: '요청값이 올바르지 않습니다.' });
  });

  it('JSON 구문 오류도 공통 400 형식으로 응답한다', async () => {
    await request(app.getHttpServer()).post('/api/v1/validation/search')
      .set('Content-Type', 'application/json').send('{"conditions":')
      .expect(400).expect({ code: 'BAD_REQUEST', message: '요청값이 올바르지 않습니다.' });
  });

  it('UUID 경로값에도 같은 검증 파이프를 재사용한다', async () => {
    const id = '066d6b9d-504a-4be7-87e0-9d9c44df46e1';
    await request(app.getHttpServer()).get(`/api/v1/validation/uuid/${id}`).expect(200).expect({ id });
    await request(app.getHttpServer()).get('/api/v1/validation/uuid/invalid')
      .expect(400).expect({ code: 'BAD_REQUEST', message: '요청값이 올바르지 않습니다.' });
  });

  it.each(['/api/v1/missing', '/api/v1/validation/error/not-found'])(
    '없는 경로·대상은 공통 404 형식이다: %s', async (path) => {
      await request(app.getHttpServer()).get(path)
        .expect(404).expect({ code: 'NOT_FOUND', message: '요청한 대상을 찾을 수 없습니다.' });
    },
  );

  it.each([
    'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', '08006', '53300', '57P01', '57P03',
    'disconnected', 'driver-disconnected', 'http-unavailable', 'terminated', 'terminated-unexpectedly',
    'connection-timeout', 'client-closed', 'pool-closed', 'pool-timeout',
  ])(
    'DB 연결 장애·명시적 서비스 불가는 503으로 응답한다: %s', async (kind) => {
      await request(app.getHttpServer()).get(`/api/v1/validation/error/${kind}`)
        .expect(503).expect({ code: 'SERVICE_UNAVAILABLE', message: 'DB에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.' });
    },
  );

  it.each(['23505', '42601', 'unexpected', 'http-internal'])(
    '그 밖의 내부 오류는 원문 노출 없이 500으로 응답한다: %s', async (kind) => {
      await request(app.getHttpServer()).get(`/api/v1/validation/error/${kind}`)
        .expect(500).expect({ code: 'INTERNAL_SERVER_ERROR', message: '서버 내부 오류가 발생했습니다.' });
    },
  );

  it('다른 HTTP 오류의 상태 코드도 보존한다', async () => {
    await request(app.getHttpServer()).get('/api/v1/validation/error/rate-limit')
      .expect(429).expect({ code: 'TOO_MANY_REQUESTS', message: '요청을 처리할 수 없습니다.' });
  });

  it('오류 로그에 요청·SQL·예외 원문을 남기지 않는다', () => {
    expect(errorLog).toHaveBeenCalled();
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('SELECT');
  });
});
