import { scryptSync } from 'node:crypto';

// HTTP 통합 테스트에서만 사용하는 합성 자격. 실제 관리자 설정은 읽거나 수정하지 않음
const salt = Buffer.alloc(16, 7);
export const testAdminValues = {
  ADMIN_USERNAME: 'test-reviewer',
  ADMIN_PASSWORD_HASH: `scrypt$16384$8$1$${salt.toString('base64')}$${scryptSync('test-only-password', salt, 64).toString('base64')}`,
  ADMIN_AUTH_SECRET: Buffer.alloc(32, 9).toString('base64'),
  ADMIN_WEB_ORIGIN: 'http://localhost:3000',
};
