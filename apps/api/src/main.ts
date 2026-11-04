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

/** API 경로 접두사·공통 오류 필터·종료 신호 처리를 설정한다. */
export function configureApplication(app: INestApplication, origins: string[] = ['http://localhost:3000', 'http://127.0.0.1:3000']): void {
  // 파서와 라우터보다 먼저 등록해 잘못된 본문·없는 경로에도 보호를 적용한다.
  app.useSecurityHeaders({ strictTransportSecurity: false });
  app.enableCors({ origin: origins, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'], credentials: false });
  app.use(createRequestProtection());
  // 현재 Express 어댑터의 본문 파서를 사용하며, 다른 어댑터로 바뀌면 기동 단계에서 알린다.
  const adapter = app.getHttpAdapter();
  if (!adapter.useBodyParser) throw new Error('JSON 본문 파서를 제공하는 HTTP 어댑터가 필요합니다.');
  adapter.useBodyParser('json', false, {
    limit: '16kb', inflate: false,
    // 빈 입력도 {}로 바꾸는 JSON 파서에 대비해 실제 본문이 있었는지만 기록
    verify: (request: AdminRequest, _response: unknown, bytes: Buffer) => { request.hasJsonBody = bytes.length > 0; },
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
}

/** DB 연결을 포함한 NestJS 앱을 생성하고 API 공통 설정을 적용 */
export async function createApplication(httpValues: Record<string, unknown> = loadEnvironmentValues()): Promise<INestApplication> {
  // DB 연결 전에 HTTP 전용 자격과 자동 수집 설정을 확인하고 모듈을 추가
  const httpModule = { module: AppModule, imports: [AdminModule.forHttp(httpValues), IngestionScheduleModule.forHttp(httpValues)] };
  const app = await NestFactory.create(httpModule, { abortOnError: false, bodyParser: false });
  try {
    configureApplication(app, app.get<Environment>(ENVIRONMENT).API_CORS_ORIGINS);
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

/** API 서버를 4000번 포트로 시작하고, 시작 실패 시 앱 자원을 정리한다. */
async function bootstrap(): Promise<void> {
  const app = await createApplication();
  try {
    await app.listen(4000, '0.0.0.0');
  } catch (error) {
    await app.close();
    throw error;
  }
}

// 이 파일을 직접 실행할 때만 API 서버를 시작한다.
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
