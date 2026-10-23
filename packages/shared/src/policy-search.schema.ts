import { z } from 'zod';
import type { PolicySearchRequest } from './policies.js';

/** 검색에 허용할 코드 목록. 지역은 현행 DB 코드, 취업·학력은 검증된 서버 코드표를 사용한다. */
export interface PolicySearchCodes {
  regionCodes: ReadonlySet<string>;
  jobCodes: ReadonlySet<string>;
  schoolCodes: ReadonlySet<string>;
}

/** 검색 요청의 자료형·범위·허용 코드를 검사하고 기본값을 채우는 Zod 스키마를 생성한다. */
export function createPolicySearchSchema(codes: PolicySearchCodes) {
  return z.object({
    keyword: z.string().trim().max(100).optional(),
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(50).default(20),
    category: z.string().optional(),
    includeClosed: z.boolean().default(false),
    // 정렬값의 유효성만 검사한다. 기본 정렬과 인기순 전환은 검색 서비스에서 처리한다.
    sort: z.enum(['recommended', 'popular', 'deadline', 'newest']).optional(),
    conditions: z.object({
      age: z.number().int().min(1).max(120).optional(),
      regionCode: z.string().regex(/^\d{5}$/)
        .refine((code) => codes.regionCodes.has(code), '현행 지역 코드가 아닙니다.').optional(),
      jobCode: z.string().min(1)
        .refine((code) => codes.jobCodes.has(code), '허용된 취업 코드가 아닙니다.').optional(),
      schoolCode: z.string().min(1)
        .refine((code) => codes.schoolCodes.has(code), '허용된 학력 코드가 아닙니다.').optional(),
    }).optional(),
  }) satisfies z.ZodType<PolicySearchRequest>;
}
