import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { validateEnv } from './common/config/env.schema';
import { PoliciesModule } from './modules/policies/policies.module';

/** 공개 API가 단일 IP에서 허용하는 1분 요청 수다. */
export const PUBLIC_API_RATE_LIMIT_REQUESTS_PER_MINUTE = 60;
/** 공개 API 요청 수를 다시 세기 시작하는 시간이다. */
export const PUBLIC_API_RATE_LIMIT_WINDOW_MS = 60_000;
/** 메모리 기반으로 적용하는 MVP1 공개 API 제한 설정이다. */
export const publicApiThrottlerOptions = {
  errorMessage: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  throttlers: [
    {
      ttl: PUBLIC_API_RATE_LIMIT_WINDOW_MS,
      limit: PUBLIC_API_RATE_LIMIT_REQUESTS_PER_MINUTE,
      blockDuration: PUBLIC_API_RATE_LIMIT_WINDOW_MS,
    },
  ],
} satisfies ThrottlerModuleOptions;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot(publicApiThrottlerOptions),
    PoliciesModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
