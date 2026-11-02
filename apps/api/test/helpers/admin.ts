import { scryptSync } from 'node:crypto';
import { AdminModule } from '../../src/modules/admin/admin.module';

// HTTP 통합 테스트에서만 사용하는 합성 자격. 실제 관리자 설정은 읽거나 수정하지 않음
const salt = Buffer.alloc(16, 7);
export const testAdminValues = {
  ADMIN_USERNAME: 'test-reviewer',
  ADMIN_PASSWORD_HASH: `scrypt$16384$8$1$${salt.toString('base64')}$${scryptSync('test-only-password', salt, 64).toString('base64')}`,
  ADMIN_AUTH_SECRET: Buffer.alloc(32, 9).toString('base64'),
  ADMIN_WEB_ORIGIN: 'http://localhost:3000',
};

/** 인증 전용 HTTP 테스트에서 실제 인증 제공자와 Guard 및 인증 컨트롤러만 등록 */
export function adminAuthTestModule(values: Record<string, unknown> = testAdminValues) {
  // 전체 관리자 조회 API는 별도 DB 통합 테스트에서 검증하고 인증 테스트의 의존성을 제한
  const { providers, exports } = AdminModule.forHttp(values);
  return { module: AdminModule, providers, exports };
}
