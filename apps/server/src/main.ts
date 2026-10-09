import { type INestApplication } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { NestFactory } from '@nestjs/core';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppModule } from './app.module';
import { validateEnv } from './common/config/env.schema';
import { HttpErrorFilter } from './common/errors/http-error.filter';

export const PUBLIC_API_PREFIX = 'api/v1';

const ALLOWED_CORS_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const ALLOWED_CORS_HEADERS = ['Content-Type'];
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
} as const;

type PublicApiApplication = Pick<
  INestApplication,
  'enableCors' | 'setGlobalPrefix' | 'use' | 'useGlobalFilters'
>;

/** 허용된 웹 앱만 브라우저에서 공개 API를 호출할 수 있게 한다. */
export function createCorsOptions(webOrigin: string): CorsOptions {
  return {
    origin: (requestOrigin, callback) => {
      // Origin 헤더가 없는 서버 간 호출은 CORS 정책의 대상이 아니므로 허용한다.
      callback(null, requestOrigin === undefined || requestOrigin === webOrigin);
    },
    methods: ALLOWED_CORS_METHODS,
    allowedHeaders: ALLOWED_CORS_HEADERS,
    maxAge: 600,
  };
}

/** MVP1 공개 API에 필요한 공통 HTTP 안전장치를 적용한다. */
export function configurePublicApi(app: PublicApiApplication, webOrigin: string): void {
  app.setGlobalPrefix(PUBLIC_API_PREFIX);
  app.enableCors(createCorsOptions(webOrigin));
  app.use(addSecurityHeaders);
  app.useGlobalFilters(new HttpErrorFilter());

  // 검색 조건에는 소득 등 민감한 값이 포함될 수 있어 request body를 기록하는 HTTP logger를 등록하지 않는다.
}

function addSecurityHeaders(
  _request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader(name, value);
  }

  next();
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const env = validateEnv(process.env);

  configurePublicApi(app, env.WEB_ORIGIN);
  await app.listen(process.env.PORT ?? 3000);
}

if (require.main === module) {
  void bootstrap();
}
