import { UnauthorizedException } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// 저장할 해시의 앞부분과 scrypt 계산 설정
const PREFIX = 'scrypt$16384$8$1$';
const OPTIONS = { N: 16384, r: 8, p: 1 };

/** 인증에 사용할 관리자 계정과 해시에서 꺼낸 salt 및 비교 키 */
export interface AdminCredentials {
  username: string;
  passwordHash: { salt: Buffer; key: Buffer };
}

/** 관리자 설정 입력 -> 계정과 해시 형식 검사 -> 인증에 사용할 설정 반환 */
export function parseAdminCredentials(values: Record<string, unknown>): AdminCredentials {
  // 1. 설정된 계정이 공백 없는 1~64자 문자열인지 확인
  const username = values.ADMIN_USERNAME;
  if (typeof username !== 'string' || username.length < 1 || username.length > 64 || /\s/u.test(username)) {
    throw new Error('ADMIN_USERNAME은 공백 없는 1~64자 식별자여야 합니다.');
  }

  // 2. 해시의 계산 설정과 길이를 확인 (base64 salt 24자 + 구분자 + 비교 키 88자)
  const hash = values.ADMIN_PASSWORD_HASH;
  if (typeof hash !== 'string' || hash.length !== PREFIX.length + 24 + 1 + 88 || !hash.startsWith(PREFIX)) {
    throw new Error('ADMIN_PASSWORD_HASH 형식이 올바르지 않습니다.');
  }

  // 3. 해시에서 salt와 비교 키를 꺼냄
  const parts = hash.slice(PREFIX.length).split('$');
  if (parts.length !== 2) throw new Error('ADMIN_PASSWORD_HASH 형식이 올바르지 않습니다.');
  const salt = Buffer.from(parts[0], 'base64');
  const key = Buffer.from(parts[1], 'base64');

  // 4. 실제 바이트 수와 base64 표기가 올바른지 확인
  if (salt.length !== 16 || key.length !== 64
    || salt.toString('base64') !== parts[0] || key.toString('base64') !== parts[1]) {
    throw new Error('ADMIN_PASSWORD_HASH 형식이 올바르지 않습니다.');
  }
  return { username, passwordHash: { salt, key } };
}

/** 로그인 입력 -> 저장된 해시와 비교 -> 관리자 계정 반환 또는 401 오류 */
export class AdminCredentialsService {
  constructor(private readonly credentials: AdminCredentials) {}

  /** 비밀번호 길이 확인 -> 같은 salt로 계산 및 비교 -> 계정까지 일치하면 인증 성공 */
  async authenticate(username: string, password: string): Promise<string> {
    let passwordMatches = false;

    // 계정이 틀리던 말던 항상 비밀번호 계산을 먼저 수행 (보안)
    if (typeof password === 'string' && password.length >= 1 && password.length <= 256) {
      const key = await deriveKey(password, this.credentials.passwordHash.salt);
      try {
        // 계산한 키와 저장된 키를 같은 길이로 비교
        passwordMatches = timingSafeEqual(key, this.credentials.passwordHash.key);
      } finally {
        // 비교가 끝난 임시 키를 0으로 덮어씀
        key.fill(0);
      }
    }

    // 계정 또는 비밀번호가 틀리면 같은 401 인증 오류를 반환
    if (username !== this.credentials.username || !passwordMatches) {
      throw new UnauthorizedException({
        code: 'ADMIN_UNAUTHORIZED',
        message: '관리자 인증이 필요합니다.',
      });
    }
    return this.credentials.username;
  }
}

/** 초기 비밀번호 입력 -> 무작위 salt로 계산 -> 설정에 저장할 해시 문자열 반환 */
export async function createAdminPasswordHash(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < 1 || password.length > 256) {
    throw new Error('비밀번호는 1~256자여야 합니다.');
  }

  // 매번 다른 해시가 나오도록 salt를 새로 생성
  const salt = randomBytes(16);
  // 입력 비밀번호 + 솔트 -> 결과 키 생성
  const key = await deriveKey(password, salt);
  try {
    // 계산 설정 + salt + 비교 키를 $로 연결해 해시 생성
    return `${PREFIX}${salt.toString('base64')}$${key.toString('base64')}`;
  } finally {
    key.fill(0);
  }
}

/** 해시 생성과 로그인에서 공통 사용: 비밀번호 + salt -> key 생성 */
function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, OPTIONS, (error, key) => {
      if (error) reject(new Error('관리자 비밀번호 계산에 실패했습니다.'));
      else resolve(key);
    });
  });
}
