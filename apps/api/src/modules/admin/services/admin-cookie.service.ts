import { UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { TextDecoder } from 'node:util';
import type { AdminIdentity } from '@youth-kkultong/shared';

const COOKIE_NAME = 'youth_admin_auth';
const LIFETIME_SECONDS = 28800;
export const ADMIN_COOKIE_SETTINGS = Symbol('ADMIN_COOKIE_SETTINGS');

/** 쿠키 서명에 사용할 키, 관리자 웹 출처, Secure 속성 */
export interface AdminCookieSettings { secret: Buffer; origin: string; secure: boolean }

/** 쿠키 생성에 사용할 설정 반환 */
export function parseAdminCookieSettings(values: Record<string, unknown>): AdminCookieSettings {
  // secret 생성
  const encodedSecret = values.ADMIN_AUTH_SECRET;
  if (typeof encodedSecret !== 'string') throw new Error('ADMIN_AUTH_SECRET 설정이 필요합니다.');
  const secret = Buffer.from(encodedSecret, 'base64');
  if (secret.length < 32 || secret.toString('base64') !== encodedSecret) {
    throw new Error('ADMIN_AUTH_SECRET은 32바이트 이상의 base64 키여야 합니다.');
  }

  // 정확한 웹 출처(origin) 하나를 확인하고 HTTPS일 때 Secure 속성을 적용
  const origin = values.ADMIN_WEB_ORIGIN === undefined ? 'http://localhost:3000' : values.ADMIN_WEB_ORIGIN;
  try {
    if (typeof origin !== 'string') throw new Error();
    const url = new URL(origin);
    const secure = url.protocol === 'https:';
    if (url.origin !== origin || origin.includes('*')
      || (!secure && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
      throw new Error();
    }

    // 생성한 설정 반환
    return { secret, origin, secure };
  } catch {
    throw new Error('ADMIN_WEB_ORIGIN은 경로 없는 HTTPS 출처 또는 로컬 HTTP 출처여야 합니다.');
  }
}

/** 인증 쿠키 발급 -> 서명과 만료 검증 -> 로그아웃용 삭제 쿠키 생성 */
export class AdminCookieService {
  private readonly attributes: string;

  constructor(
    private readonly username: string,
    private readonly settings: AdminCookieSettings
  ) {
    // 발급과 삭제에 같은 Path 및 보안 속성을 사용
    this.attributes = `; Path=/api/v1/admin; HttpOnly; SameSite=Strict${settings.secure ? '; Secure' : ''}`;
  }

  /** 8시간 유효한 인증 쿠키 생성 */
  issue(): { cookie: string; identity: AdminIdentity } {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + LIFETIME_SECONDS;
    const payload = Buffer.from(JSON.stringify({ sub: this.username, iat, exp })).toString('base64url');
    // 인코딩한 payload 전체에 서명해 내용 변경을 탐지
    const signature = createHmac('sha256', this.settings.secret).update(payload).digest('base64url');
    return {
      cookie: `${COOKIE_NAME}=${payload}.${signature}; Max-Age=${LIFETIME_SECONDS}${this.attributes}`,
      identity: { username: this.username, expiresAt: new Date(exp * 1000).toISOString() },
    };
  }

  /** 쿠키 식별 후 인증 정보 반환 */
  verify(value: unknown): AdminIdentity {
    try {
      // 1. 길이와 두 조각의 base64url 형식을 확인
      if (typeof value !== 'string' || value.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
        throw new Error();
      }
      const [payload, signature] = value.split('.');
      const receivedSignature = Buffer.from(signature, 'base64url');
      const expectedSignature = createHmac('sha256', this.settings.secret).update(payload).digest();

      // 2. 같은 길이의 서명을 비교한 뒤에만 payload 내용을 해석
      if (receivedSignature.length !== expectedSignature.length
        || receivedSignature.toString('base64url') !== signature
        || !timingSafeEqual(receivedSignature, expectedSignature)) throw new Error();
      const bytes = Buffer.from(payload, 'base64url');
      if (bytes.toString('base64url') !== payload) throw new Error();
      const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));

      // 3. payload에 정해진 세 필드만 있고 관리자 식별자가 같은지 확인
      if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error();
      const fields = data as Record<string, unknown>;
      if (Object.keys(fields).length !== 3 || fields.sub !== this.username
        || typeof fields.iat !== 'number' || !Number.isSafeInteger(fields.iat)
        || typeof fields.exp !== 'number' || !Number.isSafeInteger(fields.exp)) throw new Error();

      // 4. 발급 전이거나 만료된 쿠키는 거부하고 유효 기간이 정확히 8시간인지 확인
      const now = Math.floor(Date.now() / 1000);
      if (fields.iat > now || now >= fields.exp || fields.exp - fields.iat !== LIFETIME_SECONDS) throw new Error();

      return { username: this.username, expiresAt: new Date(fields.exp * 1000).toISOString() };
    } catch {
      // 형식 오류와 변조 및 만료를 동일한 인증 오류로 처리
      throw new UnauthorizedException({ code: 'ADMIN_UNAUTHORIZED', message: '관리자 인증이 필요합니다.' });
    }
  }

  /** 쿠키 삭제 */
  clear(): string {
    return `${COOKIE_NAME}=; Max-Age=0${this.attributes}`;
  }
}
