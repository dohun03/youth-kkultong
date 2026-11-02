import { createHmac } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { AdminCookieService, parseAdminCookieSettings } from '../src/modules/admin/services/admin-cookie.service';
import { parseEnvironment } from '../src/common/environment';

const secret = Buffer.alloc(32, 17);
const now = Math.floor(new Date('2026-11-02T00:00:00Z').getTime() / 1000);
const validPayload = { sub: 'reviewer', iat: now, exp: now + 28800 };

/** 서비스와 독립적으로 테스트용 payload에 서명해 검증 경계를 준비 */
function sign(data: unknown): string {
  return signBytes(Buffer.from(JSON.stringify(data)));
}

/** JSON 형식 및 UTF-8 오류도 유효한 서명으로 검증하기 위한 테스트 도구 */
function signBytes(bytes: Buffer): string {
  const encoded = bytes.toString('base64url');
  return `${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`;
}

describe('관리자 쿠키 설정', () => {
  it('32바이트 이상 표준 base64 키와 기본 로컬 출처를 허용한다', () => {
    expect(parseAdminCookieSettings({ ADMIN_AUTH_SECRET: secret.toString('base64') }))
      .toEqual({ secret, origin: 'http://localhost:3000', secure: false });
    expect(parseAdminCookieSettings({ ADMIN_AUTH_SECRET: Buffer.alloc(64).toString('base64') }).secret.length).toBe(64);
  });

  it.each([undefined, null, 42, '', 'raw-secret', Buffer.alloc(31).toString('base64'),
    secret.toString('base64') + '\n', secret.toString('base64').replace(/=+$/, ''),
    secret.toString('base64').slice(0, -2) + 'F='])('누락되거나 형식이 다른 키를 값 노출 없이 거부한다 (%#)', (key) => {
    expect(() => parseAdminCookieSettings({ ADMIN_AUTH_SECRET: key })).toThrow(/ADMIN_AUTH_SECRET/);
    try { parseAdminCookieSettings({ ADMIN_AUTH_SECRET: key }); }
    catch (error) { expect((error as Error).message).not.toContain('raw-secret'); }
  });

  it.each(['development', 'production', 'test'])('NODE_ENV=%s와 관계없이 출처 스킴으로 Secure를 정한다', (env) => {
    for (const [origin, secure] of [['https://admin.example', true], ['http://localhost:3000', false], ['http://127.0.0.1:3000', false]] as const) {
      expect(parseAdminCookieSettings({ ADMIN_AUTH_SECRET: secret.toString('base64'), ADMIN_WEB_ORIGIN: origin, NODE_ENV: env }))
        .toEqual({ secret, origin, secure });
    }
  });

  it.each(['', null, 12, 'http://admin.example', 'http://localhost.evil:3000', 'http://[::1]:3000',
    'https://admin.example/', 'https://admin.example/path', 'https://admin.example?x=1', 'https://admin.example#x',
    'https://user:origin-secret@admin.example', 'https://*.example', '*', 'null', 'ftp://admin.example'])
  ('잘못된 출처를 값 노출 없이 거부한다 (%#)', (origin) => {
    expect(() => parseAdminCookieSettings({ ADMIN_AUTH_SECRET: secret.toString('base64'), ADMIN_WEB_ORIGIN: origin }))
      .toThrow('ADMIN_WEB_ORIGIN은 경로 없는 HTTPS 출처 또는 로컬 HTTP 출처여야 합니다.');
  });

  it('공통 환경 설정은 관리자 쿠키 설정 없이 통과한다', () => {
    expect(parseEnvironment({ DATABASE_URL: 'postgresql://tester@localhost/example' })).not.toHaveProperty('ADMIN_AUTH_SECRET');
  });
});

describe('관리자 인증 쿠키 발급과 검증', () => {
  let service: AdminCookieService;
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now * 1000);
    service = new AdminCookieService('reviewer', { secret, origin: 'https://admin.example', secure: true });
  });
  afterEach(() => { jest.useRealTimers(); });

  it('세 필드만 담은 토큰에 서명하고 8시간 고정 쿠키와 인증 정보를 반환한다', () => {
    const issued = service.issue();
    const token = issued.cookie.split(';')[0].split('=')[1];
    expect(token).toBe(sign(validPayload));
    expect(JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString())).toEqual(validPayload);
    expect(issued.cookie).toBe(`youth_admin_auth=${token}; Max-Age=28800; Path=/api/v1/admin; HttpOnly; SameSite=Strict; Secure`);
    expect(issued.cookie).not.toMatch(/Domain|password|scrypt/);
    expect(service.verify(token)).toEqual(issued.identity);
    expect(issued.identity).toEqual({ username: 'reviewer', expiresAt: new Date((now + 28800) * 1000).toISOString() });
  });

  it('인증 확인을 반복해도 만료가 연장되지 않고 만료 초부터 거부한다', () => {
    const token = sign(validPayload);
    jest.setSystemTime((now + 28799) * 1000 + 999);
    expect(service.verify(token).expiresAt).toBe(new Date((now + 28800) * 1000).toISOString());
    jest.setSystemTime((now + 28800) * 1000);
    expect(() => service.verify(token)).toThrow(UnauthorizedException);
  });

  it('발급 시각 직전에는 거부하고 발급 초부터 허용한다', () => {
    const token = sign(validPayload);
    jest.setSystemTime(now * 1000 - 1);
    expect(() => service.verify(token)).toThrow(UnauthorizedException);
    jest.setSystemTime(now * 1000);
    expect(service.verify(token).username).toBe('reviewer');
  });

  it.each([undefined, null, 12, '', 'a', 'a.b.c', '.abc', 'abc.', 'a=.b', 'a.+', 'a./', 'a.b\n', 'a'.repeat(2049)])
  ('없는 값과 잘못된 토큰 형식을 동일한 401로 거부한다 (%#)', (value) => {
    try { service.verify(value); throw new Error('거부되지 않았습니다.'); }
    catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).toEqual({ code: 'ADMIN_UNAUTHORIZED', message: '관리자 인증이 필요합니다.' });
    }
  });

  it.each([
    null, [], 'string', {}, { ...validPayload, sub: 'other' }, { ...validPayload, sub: 1 },
    { ...validPayload, iat: String(now) }, { ...validPayload, exp: null }, { ...validPayload, iat: now + 0.5 },
    { ...validPayload, exp: now + 28800.5 }, { ...validPayload, exp: Number.MAX_SAFE_INTEGER + 1 },
    { ...validPayload, iat: now + 1, exp: now + 28801 }, { ...validPayload, exp: now },
    { ...validPayload, exp: now + 28799 }, { ...validPayload, exp: now + 28801 },
    { ...validPayload, extra: 'unexpected' }, { sub: 'reviewer', iat: now },
    { sub: 'reviewer', exp: now + 28800 },
  ])('서명이 유효해도 관리자와 필드 및 시간이 잘못되면 거부한다 (%#)', (payload) => {
    expect(() => service.verify(sign(payload))).toThrow(UnauthorizedException);
  });

  it('본문 변조, 서명 변조, 다른 키, 짧은 서명을 거부한다', () => {
    const token = sign(validPayload);
    const [payload, signature] = token.split('.');
    const changedPayload = Buffer.from(JSON.stringify({ ...validPayload, sub: 'other' })).toString('base64url');
    const otherSignature = createHmac('sha256', Buffer.alloc(32, 99)).update(payload).digest('base64url');
    for (const invalid of [`${changedPayload}.${signature}`, `${payload}.${otherSignature}`,
      `${payload}.${signature.slice(0, -1)}`, `${payload}.${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`]) {
      expect(() => service.verify(invalid)).toThrow(UnauthorizedException);
    }
  });

  it('같은 바이트로 해석되더라도 비표준 base64url 표기는 거부한다', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const [payload, signature] = sign(validPayload).split('.');
    const changedSignature = signature.slice(0, -1) + alphabet[alphabet.indexOf(signature.at(-1)!) + 1];
    expect(Buffer.from(changedSignature, 'base64url')).toEqual(Buffer.from(signature, 'base64url'));
    expect(() => service.verify(`${payload}.${changedSignature}`)).toThrow(UnauthorizedException);

    const json = JSON.stringify(validPayload);
    const padded = json + ' '.repeat((1 - Buffer.byteLength(json) % 3 + 3) % 3);
    const encoded = Buffer.from(padded).toString('base64url');
    const changedPayload = encoded.slice(0, -1) + alphabet[alphabet.indexOf(encoded.at(-1)!) + 1];
    const validSignature = createHmac('sha256', secret).update(changedPayload).digest('base64url');
    expect(Buffer.from(changedPayload, 'base64url')).toEqual(Buffer.from(encoded, 'base64url'));
    expect(() => service.verify(`${changedPayload}.${validSignature}`)).toThrow(UnauthorizedException);
  });

  it('서명이 유효해도 JSON이나 UTF-8이 잘못되면 거부한다', () => {
    for (const bytes of [Buffer.from('invalid json'), Buffer.from([0xff])]) {
      expect(() => service.verify(signBytes(bytes))).toThrow(UnauthorizedException);
    }
  });

  it('쿠키 값 최대 2048자는 허용하고 초과하면 거부한다', () => {
    const json = JSON.stringify(validPayload);
    const token = signBytes(Buffer.from(json + ' '.repeat(1503 - Buffer.byteLength(json))));
    expect(token.length).toBe(2048);
    expect(service.verify(token).username).toBe('reviewer');
    expect(() => service.verify(token + 'a')).toThrow(UnauthorizedException);
  });

  it.each([false, true])('발급과 삭제에 같은 속성을 사용한다 (Secure=%s)', (secure) => {
    const cookies = new AdminCookieService('reviewer', { secret, secure, origin: secure ? 'https://admin.example' : 'http://localhost:3000' });
    const issued = cookies.issue().cookie;
    const cleared = cookies.clear();
    expect(cleared).toBe(`youth_admin_auth=; Max-Age=0; Path=/api/v1/admin; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`);
    expect(cleared.slice(cleared.indexOf('; Path='))).toBe(issued.slice(issued.indexOf('; Path=')));
  });

  it('한글을 포함한 최대 길이 관리자도 발급과 검증이 가능하다', () => {
    const username = '관'.repeat(64);
    const cookies = new AdminCookieService(username, { secret, secure: false, origin: 'http://localhost:3000' });
    const token = cookies.issue().cookie.split(';')[0].split('=')[1];
    expect(token.length).toBeLessThanOrEqual(2048);
    expect(cookies.verify(token).username).toBe(username);
  });
});
