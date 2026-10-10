import { MODULE_METADATA } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://kkultong:kkultong_local@localhost:5432/youth_kkultong';
process.env.WEB_ORIGIN = 'http://localhost:3001';
process.env.API_ORIGIN = 'http://localhost:3000';
process.env.HIDE_DAYS = '30';
process.env.MAX_HOUSEHOLD_SIZE = '8';

const {
  AppModule,
  PUBLIC_API_RATE_LIMIT_REQUESTS_PER_MINUTE,
  PUBLIC_API_RATE_LIMIT_WINDOW_MS,
  publicApiThrottlerOptions,
  shouldSkipPublicApiRateLimit,
} = require('./app.module') as typeof import('./app.module');

describe('AppModule 공개 API 요청 제한', () => {
  it('1분 60회 제한을 전역 ThrottlerGuard로 적용한다', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as Array<{
      module?: unknown;
      providers?: Array<{ useValue?: unknown }>;
    }>;
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AppModule) as Array<{
      provide: unknown;
      useClass: unknown;
    }>;
    const throttlerImport = imports.find((importedModule) => importedModule.module === ThrottlerModule);

    expect(PUBLIC_API_RATE_LIMIT_REQUESTS_PER_MINUTE).toBe(60);
    expect(PUBLIC_API_RATE_LIMIT_WINDOW_MS).toBe(60_000);
    expect(throttlerImport?.providers).toContainEqual(
      expect.objectContaining({ useValue: publicApiThrottlerOptions }),
    );
    expect(providers).toContainEqual({ provide: APP_GUARD, useClass: ThrottlerGuard });
  });

  it('부하 측정 우회는 test 환경에서 명시적으로 켠 경우에만 허용한다', () => {
    expect(shouldSkipPublicApiRateLimit({ NODE_ENV: 'test', LOAD_TEST_SKIP_RATE_LIMIT: 'true' }))
      .toBe(true);
    expect(shouldSkipPublicApiRateLimit({ NODE_ENV: 'production', LOAD_TEST_SKIP_RATE_LIMIT: 'true' }))
      .toBe(false);
    expect(shouldSkipPublicApiRateLimit({ NODE_ENV: 'test', LOAD_TEST_SKIP_RATE_LIMIT: 'false' }))
      .toBe(false);
  });
});
