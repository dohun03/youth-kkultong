import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminCredentialsService, parseAdminCredentials } from './admin-credentials';
import { ADMIN_COOKIE_SETTINGS, AdminCookieService, parseAdminCookieSettings } from './admin-cookie';
import { AdminGuard } from './admin.guard';

/** HTTP 전용 관리자 설정 검사 -> 인증 서비스와 전역 권한 검사 등록 */
@Module({})
export class AdminModule {
  /** HTTP 앱 생성 시에만 관리자 필수 설정을 확인하고 인증 기능 등록 */
  static forHttp(values: Record<string, unknown>): DynamicModule {
    const credentials = parseAdminCredentials(values);
    const cookie = parseAdminCookieSettings(values);
    return {
      module: AdminModule,
      providers: [
        { provide: AdminCredentialsService, useValue: new AdminCredentialsService(credentials) },
        { provide: AdminCookieService, useValue: new AdminCookieService(credentials.username, cookie) },
        { provide: ADMIN_COOKIE_SETTINGS, useValue: cookie },
        { provide: APP_GUARD, useClass: AdminGuard },
      ],
      exports: [AdminCredentialsService, AdminCookieService, ADMIN_COOKIE_SETTINGS],
    };
  }
}
