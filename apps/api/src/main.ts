import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';

/** API 경로 접두사·공통 오류 필터·종료 신호 처리를 설정한다. */
export function configureApplication(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
}

/** DB 연결을 포함한 NestJS 앱을 생성하고 API 공통 설정을 적용한다. */
export async function createApplication(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { abortOnError: false });
  configureApplication(app);
  return app;
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
