import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminCredentialsService, parseAdminCredentials } from './services/admin-credentials.service';
import { ADMIN_COOKIE_SETTINGS, AdminCookieService, parseAdminCookieSettings } from './services/admin-cookie.service';
import { AdminGuard } from './guards/admin.guard';
import { AdminAuthController } from './controllers/admin-auth.controller';
import { AdminReviewsController } from './controllers/admin-reviews.controller';
import { AdminSourcePoliciesController } from './controllers/admin-source-policies.controller';
import { PoliciesModule } from '../policies/policies.module';

/** HTTP 전용 관리자 설정 검사 -> 인증 서비스와 전역 권한 검사 등록 */
@Module({ controllers: [AdminAuthController] })
export class AdminModule {
  /** HTTP 앱 생성 시에만 관리자 필수 설정을 확인하고 인증 기능 등록 */
  static forHttp(values: Record<string, unknown>): DynamicModule {
    const credentials = parseAdminCredentials(values);
    const cookie = parseAdminCookieSettings(values);
    return {
      module: AdminModule,
      imports: [PoliciesModule],
      controllers: [AdminReviewsController, AdminSourcePoliciesController],
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
