import { z } from 'zod';

/** 정책 식별자와 제목은 필수이며, 원문 공백과 추가 필드는 보존한다. */
const youthCenterPolicySchema = z.looseObject({
  plcyNo: z.string().refine((value) => value.trim().length > 0),
  plcyNm: z.string().refine((value) => value.trim().length > 0),
});

/** 목록 응답의 성공 값·정책 배열·페이지 메타데이터 구조를 검증한다. */
const youthCenterListResponseSchema = z.looseObject({
  resultCode: z.literal(200),
  resultMessage: z.string(),
  result: z.looseObject({
    youthPolicyList: z.array(youthCenterPolicySchema),
    pagging: z.looseObject({
      totCount: z.number().int().min(0),
      pageNum: z.number().int().min(1),
      pageSize: z.number().int().min(1),
    }),
  }),
});

/** 구조 검증을 통과한 온통청년 목록 응답이다. */
export type YouthCenterListResponse = z.infer<typeof youthCenterListResponseSchema>;

/** 필수 ID·제목 구조를 검증하고 추가 필드를 보존한 원본 정책이다. */
export type YouthCenterRawPolicy = YouthCenterListResponse['result']['youthPolicyList'][number];

/** 입력값이나 원본 Zod 오류 대신 페이지·시도 횟수·실패 필드만 전달한다. */
export class YouthCenterResponseValidationError extends Error {
  /** 검증 실패 단계 */
  readonly stage = 'PAGE_VALIDATION';

  constructor(
    readonly pageNum: number,
    readonly attempts: number,
    readonly fields: string[],
  ) {
    super(`온통청년 ${pageNum}페이지 응답 구조가 올바르지 않습니다 (필드: ${fields.join(', ')}).`);
    this.name = 'YouthCenterResponseValidationError';
  }
}

/** 목록 응답을 검증하고, 실패 시 안전한 필드 경로를 포함한 오류로 변환한다. */
export function parseYouthCenterPageResponse(
  body: unknown,
  pageNum: number,
  attempts = 1,
): YouthCenterListResponse {
  // 필수 구조와 기본 자료형 검증
  const result = youthCenterListResponseSchema.safeParse(body);
  if (!result.success) {
    // 입력 원문 없이 중복을 제거한 필드 경로만 전달
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.') || '$'))];
    throw new YouthCenterResponseValidationError(pageNum, attempts, fields);
  }
  return result.data;
}
