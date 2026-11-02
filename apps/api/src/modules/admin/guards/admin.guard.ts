import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import type { AdminIdentity } from '@youth-kkultong/shared';
import { ADMIN_COOKIE_SETTINGS, AdminCookieService } from '../services/admin-cookie.service';
import type { AdminCookieSettings } from '../services/admin-cookie.service';

/** 인증을 마친 관리자 정보를 컨트롤러에 전달하는 HTTP 요청 */
export interface AdminRequest extends IncomingMessage {
  route?: { path: string };
  admin?: AdminIdentity;
  hasJsonBody?: boolean;
}

/** 관리자 요청의 쿠키 인증 -> 상태 변경 요청의 Origin 확인 -> 컨트롤러 실행 허용 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @Inject(AdminCookieService) private readonly cookies: AdminCookieService,
    @Inject(ADMIN_COOKIE_SETTINGS) private readonly settings: AdminCookieSettings,
  ) {}

  /** 관리자 데이터 접근 전에 인증하고 로그인 및 로그아웃은 Origin을 검사 */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    // 실제 매칭된 라우트 기준으로 판단해 대소문자나 끝 슬래시가 달라도 같은 보호를 적용
    const path = request.route?.path ?? request.url?.split('?')[0] ?? '';
    if (path !== '/api/v1/admin' && !path.startsWith('/api/v1/admin/')) return true;

    // 로그인과 로그아웃 POST는 쿠키 없이도 처리하고 그 외 요청은 인증 정보를 확인
    const isAuthPost = request.method === 'POST'
      && ['/api/v1/admin/auth/login', '/api/v1/admin/auth/logout'].includes(path);
    if (!isAuthPost) {
      const matches = request.headers.cookie?.split(';').map((part) => part.trim())
        .filter((part) => part.startsWith('youth_admin_auth=')) ?? [];
      // 같은 이름의 쿠키가 여러 개면 어느 값을 신뢰할지 모호하므로 인증 실패로 처리
      const token = matches.length === 1 ? matches[0].slice('youth_admin_auth='.length) : undefined;
      request.admin = this.cookies.verify(token);
    }

    // 상태 변경 요청은 웹 출처가 설정과 정확히 일치해야 실행
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method ?? '') && request.headers.origin !== this.settings.origin) {
      throw new ForbiddenException({ code: 'ADMIN_ORIGIN_FORBIDDEN', message: '허용되지 않은 관리자 요청 출처입니다.' });
    }
    return true;
  }
}
