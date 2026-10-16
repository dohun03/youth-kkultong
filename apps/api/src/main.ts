import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/** 실제 서버와 통합 테스트가 같은 API 접두사·종료 설정을 사용한다. */
export async function createApplication(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { abortOnError: false });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApplication();
  try {
    await app.listen(4000, '0.0.0.0');
  } catch (error) {
    await app.close();
    throw error;
  }
}

// 테스트에서 애플리케이션을 가져올 때는 서버를 자동으로 시작하지 않는다.
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
