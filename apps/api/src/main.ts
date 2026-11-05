import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { ENVIRONMENT, loadEnvironmentValues } from './common/environment';
import type { Environment } from './common/environment';
import { createRequestProtection } from './common/request-protection';
import { AdminModule } from './modules/admin/admin.module';
import type { AdminRequest } from './modules/admin/guards/admin.guard';
import { IngestionScheduleModule } from './modules/ingestion/ingestion-schedule.module';

/** API 경로 접두사, 보안, CORS, 본문 파서, 오류 필터 등 설정 */
export function configureApplication(
  app: INestApplication,
  origins: string[] = ['http://localhost:3000', 'http://127.0.0.1:3000']
): void {
  // 보안 헤더 설정 (HSTS는 비활성화)
  app.useSecurityHeaders({ strictTransportSecurity: false });

  // CORS 설정 (허용 도메인, 메서드 지정)
  app.enableCors({
    origin: origins,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: false
  });

  // 요청 보호 미들웨어 적용
  app.use(createRequestProtection());

  // 현재 Express 어댑터의 본문 파서를 사용
  const adapter = app.getHttpAdapter();
  if (!adapter.useBodyParser) throw new Error('JSON 본문 파서를 제공하는 HTTP 어댑터가 필요합니다.');
  adapter.useBodyParser('json', false, {
    limit: '16kb', inflate: false,
    // 빈 입력도 {}로 바꾸는 JSON 파서에 대비해 실제 본문이 있었는지만 기록
    verify: (request: AdminRequest, _response: unknown, bytes: Buffer) => { request.hasJsonBody = bytes.length > 0; },
  });

  // 전역 API 경로
  app.setGlobalPrefix('api/v1');
  // 전역 예외처리 필터
  app.useGlobalFilters(new ApiExceptionFilter());
  // 외부 연결을 순차적으로 안전하게 정리 후 앱 종료
  app.enableShutdownHooks();
}

/** NestJS 앱을 생성하고, API 공통 설정을 적용 */
export async function createApplication(httpValues: Record<string, unknown> = loadEnvironmentValues()): Promise<INestApplication> {
  // 사용할 모듈들 정의 (기본 모듈 + Admin, Ingestion 모듈)
  const httpModule = {
    module: AppModule,
    imports: [
      AdminModule.forHttp(httpValues),
      IngestionScheduleModule.forHttp(httpValues)
    ]
  };
  // NestJS 앱 생성 (bodyParser는 위에서 수동으로 설정하므로 false 처리)
  const app = await NestFactory.create(httpModule, { abortOnError: false, bodyParser: false });

  try {
    // 환경변수에서 가져온 CORS 주소와 함께 공통 설정 적용
    configureApplication(app, app.get<Environment>(ENVIRONMENT).API_CORS_ORIGINS);
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

/** API 서버를 4000번 포트로 시작, 실패 시 앱 자원을 정리 */
async function bootstrap(): Promise<void> {
  const app = await createApplication();
  try {
    await app.listen(4000, '0.0.0.0');
  } catch (error) {
    await app.close();
    throw error;
  }
}

// 이 파일을 터미널에서 직접 실행할 때만 서버 구동 시작
if (require.main === module) {
  void bootstrap().catch((error: unknown) => {
    Logger.error(
      'API 서버를 시작하지 못했습니다.',
      error instanceof Error ? error.stack : String(error),
      'Bootstrap',
    );
    process.exitCode = 1;
  });
}
