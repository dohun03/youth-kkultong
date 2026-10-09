import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const NODE_ENV_VALUES = ['development', 'test', 'production'] as const;
const POSTGRES_PROTOCOLS = ['postgres:', 'postgresql:'] as const;
const WORKSPACE_ENV_FILE_PATH = join(__dirname, '../../../../../.env');

/** 브라우저의 Origin 헤더와 정확히 비교할 수 있도록 scheme·host·port만 허용한다. */
const originSchema = z
  .string()
  .url('Origin은 유효한 URL이어야 합니다.')
  .refine(
    (value) => {
      const origin = new URL(value).origin;
      return value === origin || value === `${origin}/`;
    },
    'Origin에는 경로, 쿼리, hash를 포함할 수 없습니다.',
  )
  .transform((value) => new URL(value).origin);

/** 서버 실행 위치와 관계없이 workspace 루트의 .env를 한 번만 읽는다. */
function loadWorkspaceEnvironment(): void {
  if (existsSync(WORKSPACE_ENV_FILE_PATH)) {
    process.loadEnvFile(WORKSPACE_ENV_FILE_PATH);
  }
}

loadWorkspaceEnvironment();

const databaseUrlSchema = z
  .string()
  .url('DATABASE_URL은 유효한 URL이어야 합니다.')
  .pipe(
    z.string().refine(
      (value) =>
        POSTGRES_PROTOCOLS.includes(
          new URL(value).protocol as (typeof POSTGRES_PROTOCOLS)[number],
        ),
      'DATABASE_URL은 PostgreSQL 연결 URL이어야 합니다.',
    ),
  );

export const envSchema = z.object({
  NODE_ENV: z.enum(NODE_ENV_VALUES).default('development'),
  DATABASE_URL: databaseUrlSchema,
  WEB_ORIGIN: originSchema,
  API_ORIGIN: originSchema,
  HIDE_DAYS: z.coerce
    .number()
    .int('HIDE_DAYS는 정수여야 합니다.')
    .nonnegative('HIDE_DAYS는 0 이상이어야 합니다.'),
  MAX_HOUSEHOLD_SIZE: z.coerce
    .number()
    .int('MAX_HOUSEHOLD_SIZE는 정수여야 합니다.')
    .positive('MAX_HOUSEHOLD_SIZE는 1 이상이어야 합니다.'),
});

export type Environment = z.infer<typeof envSchema>;

export function validateEnv(env: Record<string, unknown>): Environment {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    throw new Error(`환경 변수 검증에 실패했습니다.\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}
