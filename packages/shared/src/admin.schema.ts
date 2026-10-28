import { z } from 'zod';
import type {
  AdminLoginRequest, AdminReviewQuery, MissingPolicyQuery,
  RejectReviewRequest, ReviewActionRequest,
} from './admin.js';

// 해시는 공백 제거·대소문자 변환 없이 검사한다. 화면에서 확인한 원래 값을 그대로 비교한다.
const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const keywordSchema = z.string().trim().max(100).optional();

// query는 문자열만 받는다. 숫자 강제 변환 전에 검사해 빈 값·부호·소수·배열을 거부한다.
// HTTP query 파서가 중복 키를 배열로 전달하므로 같은 키를 여러 번 보낸 값도 통과하지 못한다.
const positiveQueryInteger = z.string().regex(/^\d+$/).transform(Number)
  .pipe(z.number().int().min(1).max(Number.MAX_SAFE_INTEGER));

/** 로그인 식별자의 공백과 길이를 검사하고 비밀번호의 원래 공백은 보존한다. */
export const adminLoginSchema = z.strictObject({
  username: z.string().min(1).max(64).regex(/^\S+$/u),
  password: z.string().min(1).max(256),
}) satisfies z.ZodType<AdminLoginRequest>;

/** 로그아웃은 빈 JSON 객체만 받는다. 임의 필드나 누락된 본문은 허용하지 않는다. */
export const adminLogoutSchema = z.strictObject({});

/** 상세·승인·거절 경로의 검수 ID는 기존 공개 API와 같은 UUID 형식으로 검사한다. */
export const adminReviewIdSchema = z.uuid();

/** 승인에는 두 해시만 받는다. 신규 후보의 기준 해시도 생략하지 않고 명시적 NULL로 받는다. */
export const reviewActionSchema = z.strictObject({
  contentHash: contentHashSchema,
  baseContentHash: contentHashSchema.nullable(),
}) satisfies z.ZodType<ReviewActionRequest>;

/** 거절 사유는 앞뒤 공백만 제거하고 원문을 텍스트로 보존한다. */
export const rejectReviewSchema = reviewActionSchema.extend({
  reason: z.string().trim().min(1).max(1000),
}) satisfies z.ZodType<RejectReviewRequest>;

/** 검수·이력 query의 필터를 검사하고 기본 페이지·상태를 채운다. */
export const adminReviewQuerySchema = z.strictObject({
  page: positiveQueryInteger.default(1),
  limit: positiveQueryInteger.pipe(z.number().max(50)).default(20),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'PROCESSED']).default('PENDING'),
  kind: z.enum(['NEW', 'CHANGED']).optional(),
  keyword: keywordSchema,
  sourcePolicyId: z.uuid().optional(),
}) satisfies z.ZodType<AdminReviewQuery>;

/** 누락 query는 검수 목록과 같은 페이지 규칙에 INTEGER 범위의 최소 횟수를 더한다. */
export const missingPolicyQuerySchema = z.strictObject({
  page: positiveQueryInteger.default(1),
  limit: positiveQueryInteger.pipe(z.number().max(50)).default(20),
  keyword: keywordSchema,
  minMissingCount: positiveQueryInteger.pipe(z.number().max(2_147_483_647)).default(1),
}) satisfies z.ZodType<MissingPolicyQuery>;
