import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { z } from 'zod';

const integerString = z.string().regex(/^\d+$/, '0 이상의 정수 문자열이어야 합니다.').transform(Number);
const positiveInteger = integerString.pipe(z.number().int().min(1).max(Number.MAX_SAFE_INTEGER));

const environmentSchema = z.object({
  // 브라우저에 허용할 출처만 지정한다. 경로·와일드카드·인증정보는 받지 않는다.
  API_CORS_ORIGINS: z.string().default('http://localhost:3000,http://127.0.0.1:3000')
    .transform((value) => value.split(',').map((origin) => origin.trim()))
    .pipe(z.array(z.string().refine((origin) => {
      try {
        const url = new URL(origin);
        return ['http:', 'https:'].includes(url.protocol) && url.origin === origin;
      } catch { return false; }
    }, '경로와 인증정보 없는 HTTP(S) 출처가 필요합니다.')).min(1)),
  DATABASE_URL: z.string().trim().refine((value) => {
    try {
      const url = new URL(value);
      return ['postgres:', 'postgresql:'].includes(url.protocol)
        && Boolean(url.hostname && url.username)
        && url.pathname.length > 1;
    } catch {
      return false;
    }
  }, '사용자·호스트·DB 이름을 포함한 PostgreSQL URL이 필요합니다.'),
  // 조회 서버와 Migration은 인증키 없이 실행할 수 있다. 수집 시작 시 필수 검사는 수집 모듈의 책임이다.
  YOUTH_CENTER_API_KEY: z.string().trim().transform((value) => value || undefined).optional(),
  YOUTH_CENTER_PAGE_SIZE: positiveInteger.prefault('50'),
  YOUTH_CENTER_REQUEST_DELAY_MS: integerString
    .pipe(z.number().int().min(0).max(2_147_483_647)).prefault('3000'),
  YOUTH_CENTER_MAX_ATTEMPTS: integerString
    .pipe(z.number().int().min(1).max(3)).prefault('3'),
  POLICY_IMPORT_BATCH_SIZE: integerString
    .pipe(z.number().int().min(1).max(200)).prefault('200'),
  TZ: z.literal('Asia/Seoul').default('Asia/Seoul'),
});

export type Environment = z.infer<typeof environmentSchema>;
export const ENVIRONMENT = Symbol('ENVIRONMENT');

/** 비밀값 대신 잘못된 항목명과 검증 이유만 오류에 포함한다. */
export function parseEnvironment(values: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(values);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`환경변수 설정이 올바르지 않습니다.\n${details.join('\n')}`);
  }
  return result.data;
}

/** 루트 .env보다 실행 환경의 값을 우선하며, 컨테이너에서는 .env 없이도 실행한다. */
export function loadEnvironment(): Environment {
  let fileValues: Record<string, string | undefined> = {};
  try {
    fileValues = parseEnv(readFileSync(resolve(__dirname, '../../../../.env'), 'utf8'));
  } catch (error) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) {
      throw new Error('루트 .env 파일을 읽지 못했습니다. 파일 권한과 형식을 확인하세요.');
    }
  }
  const environment = parseEnvironment({ ...fileValues, ...process.env });
  process.env.TZ = environment.TZ;
  return environment;
}
