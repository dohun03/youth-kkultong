import { z } from 'zod';

const NODE_ENV_VALUES = ['development', 'test', 'production'] as const;
const POSTGRES_PROTOCOLS = ['postgres:', 'postgresql:'] as const;

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
