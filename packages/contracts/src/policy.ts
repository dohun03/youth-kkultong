import { z } from 'zod';
import { POLICY_CATEGORIES, USER_STATUSES } from './enums';

// 1. 검증에 사용될 상수 정의
const MIN_AGE = 0; // 최소 나이 (0세)
const MAX_AGE = 120; // 최대 나이 (120세)
const MIN_INCOME_PERCENTAGE = 0; // 최소 소득 분위/비율 (0%)
const MAX_INCOME_PERCENTAGE = 1000; // 최대 소득 분위/비율 (1000%)
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/; // YYYY-MM-DD 형태의 정규식
const HTTP_PROTOCOLS = ['http:', 'https:'] as const; // 허용할 URL 프로토콜

// 2. 유효성 검증 도우미 함수

/** min이 max보다 큰지 검증 (둘 중 하나가 null이면 제약 조건이 없으므로 true) */
function hasValidRange(min: number | null, max: number | null): boolean {
  return min === null || max === null || min <= max;
}

/** 정규식 검사를 통과하더라도 '2026-02-31' 같은 실존하지 않는 날짜인지 엄격하게 검증 */
function isRealCalendarDate(value: string): boolean {
  const matched = ISO_DATE_PATTERN.exec(value);

  if (matched === null) {
    return false;
  }

  const [, year, month, day] = matched;
  const parsedDate = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(parsedDate.getTime()) &&
    parsedDate.getUTCFullYear() === Number(year) &&
    parsedDate.getUTCMonth() + 1 === Number(month) &&
    parsedDate.getUTCDate() === Number(day)
  );
}

// 3. 재사용 가능한 기초 스키마

/** YYYY-MM-DD 형태이면서 실제 달력상 존재하는 날짜인지 검증하는 스키마 */
const IsoDateSchema = z
  .iso
  .date()
  .refine(isRealCalendarDate, '실제로 존재하는 날짜여야 합니다.');

/** 최소 1자 이상의 빈 문자열을 허용하지 않는 문자열 스키마 */
const nonEmptyTextSchema = z.string().min(1, '빈 문자열은 허용하지 않습니다.');

/** 단순 숫자 범위 객체 검증 (min <= max 검증 포함) */
export const NumberRangeSchema = z
  .strictObject({
    min: z.number().nullable(),
    max: z.number().nullable(),
  })
  .refine((value) => hasValidRange(value.min, value.max), {
    message: 'min은 max보다 클 수 없습니다.',
    path: ['min'],
  });

// 4. 나이 계산 기준 스키마

/** 나이 기준: 오늘 날짜 ('TODAY') */
const TodayAgeBasisSchema = z.strictObject({
  kind: z.literal('TODAY'),
});

/** 나이 기준: 특정 고정 날짜 ('FIXED_DATE', 예: 2026-01-01) */
const FixedDateAgeBasisSchema = z.strictObject({
  kind: z.literal('FIXED_DATE'),
  date: IsoDateSchema,
});

/** 나이 기준: 연도 차이 ('YEAR_DIFF', 예: 현재 연도 - 출생 연도) */
const YearDiffAgeBasisSchema = z.strictObject({
  kind: z.literal('YEAR_DIFF'),
  year: z.number().int(),
});

/** 나이 기준: 출생 연도 ('BIRTH_YEAR') */
const BirthYearAgeBasisSchema = z.strictObject({
  kind: z.literal('BIRTH_YEAR'),
});

/** 나이 기준들의 유니온(Discriminated Union) - kind 필드로 구분 */
export const AgeBasisSchema = z.discriminatedUnion('kind', [
  TodayAgeBasisSchema,
  FixedDateAgeBasisSchema,
  YearDiffAgeBasisSchema,
  BirthYearAgeBasisSchema,
]);

// 5. 나이 조건 규칙 스키마

const AgeValueSchema = z.number().int().min(MIN_AGE).max(MAX_AGE).nullable();
const BirthYearValueSchema = z.number().int().nullable();

/** 표준 만 나이 제약 조건 (예: 19세 ~ 34세) */
const StandardAgeRuleSchema = z
  .strictObject({
    min: AgeValueSchema,
    max: AgeValueSchema,
    basis: z.discriminatedUnion('kind', [
      TodayAgeBasisSchema,
      FixedDateAgeBasisSchema,
      YearDiffAgeBasisSchema,
    ]),
  })
  .refine((value) => hasValidRange(value.min, value.max), {
    message: 'min은 max보다 클 수 없습니다.',
    path: ['min'],
  });

/** 출생 연도 기준 나이 제약 조건 (예: 1990년생 ~ 2005년생) */
const BirthYearAgeRuleSchema = z
  .strictObject({
    min: BirthYearValueSchema,
    max: BirthYearValueSchema,
    basis: BirthYearAgeBasisSchema,
  })
  .refine((value) => hasValidRange(value.min, value.max), {
    message: 'min은 max보다 클 수 없습니다.',
    path: ['min'],
  });

/** 일반 나이 조건 또는 출생 연도 조건 중 하나 */
export const AgeRuleSchema = z.union([StandardAgeRuleSchema, BirthYearAgeRuleSchema]);

// 6. 기타 제약 조건 스키마 (소득, 가구원수, 지역 등)

/** 소득 조건 스키마 (예: 중위소득 0% ~ 150%) */
export const IncomeRuleSchema = z
  .strictObject({
    min: z.number().min(MIN_INCOME_PERCENTAGE).max(MAX_INCOME_PERCENTAGE).nullable(),
    max: z.number().min(MIN_INCOME_PERCENTAGE).max(MAX_INCOME_PERCENTAGE).nullable(),
    basisConfirmed: z.literal(true), // 기준 확인 여부가 항상 true여야 함
  })
  .refine((value) => hasValidRange(value.min, value.max), {
    message: 'min은 max보다 클 수 없습니다.',
    path: ['min'],
  });

/**
 * 팩토리 함수: 모든 조건 필드(나이, 지역, 소득 등)를 아래 3가지 형태 중 하나로 만들어 줌
 * 1) ANY: 누구나 대상 (제약 없음)
 * 2) UNKNOWN: 조건을 알 수 없음/미확인
 * 3) RULE: 구체적인 세부 규칙 존재 (value에 전달된 스키마 적용)
 */
export function createConstraintSchema<ValueSchema extends z.ZodType>(valueSchema: ValueSchema) {
  return z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('ANY') }),
    z.strictObject({ kind: z.literal('UNKNOWN') }),
    z.strictObject({ kind: z.literal('RULE'), value: valueSchema }),
  ]);
}

/** 지역 코드 배열 스키마 (예: ['KR', '11', '11010']) */
const RegionCodesSchema = z
  .array(z.string().regex(/^(KR|\d{2}|\d{5})$/)) // 'KR', '11'(시/도), '11010'(시/군/구) 형태만 허용
  .min(1, '지역 RULE은 최소 한 개의 지역 코드가 필요합니다.')
  .refine((values) => new Set(values).size === values.length, '지역 코드가 중복되었습니다.');

/** 대상 취업/학업 상태 배열 스키마 (예: ['UNEMPLOYED', 'STUDENT']) */
const UserStatusesSchema = z
  .array(z.enum(USER_STATUSES))
  .min(1, '상태 RULE은 최소 한 개의 상태가 필요합니다.')
  .refine((values) => new Set(values).size === values.length, '상태가 중복되었습니다.');

/** 가구원 수 범위 스키마 (예: 1명 ~ 4명) */
const HouseholdSizeRangeSchema = z
  .strictObject({
    min: z.number().int().positive().nullable(),
    max: z.number().int().positive().nullable(),
  })
  .refine((value) => hasValidRange(value.min, value.max), {
    message: 'min은 max보다 클 수 없습니다.',
    path: ['min'],
  });

/** 정책 자격 조건 5가지 모음 스키마 */
export const PolicyConditionsSchema = z.strictObject({
  age: createConstraintSchema(AgeRuleSchema), // 나이 조건
  region: createConstraintSchema(RegionCodesSchema), // 지역 조건
  income: createConstraintSchema(IncomeRuleSchema), // 소득 조건
  status: createConstraintSchema(UserStatusesSchema), // 개인 상태 조건
  householdSize: createConstraintSchema(HouseholdSizeRangeSchema), // 가구원수 조건
});

// 7. 혜택 금액 스키마

const PositiveWonSchema = z.number().int().positive(); // 양의 정수(원 단위)

/** 혜택 지급 방식 5가지 분류 */
export const BenefitAmountSchema = z.discriminatedUnion('kind', [
  // 1) 고정 금액 지급 (예: 500,000원)
  z.strictObject({
    kind: z.literal('FIXED'),
    amountWon: PositiveWonSchema,
    text: nonEmptyTextSchema,
  }),
  // 2) 매월 지급 (예: 월 200,000원씩 12개월간)
  z.strictObject({
    kind: z.literal('MONTHLY'),
    amountWon: PositiveWonSchema,
    months: z.number().int().positive().nullable(),
    text: nonEmptyTextSchema,
  }),
  // 3) 비율 지원 (예: 학자금 대출 이자 100% 지원)
  z.strictObject({
    kind: z.literal('RATE'),
    text: nonEmptyTextSchema,
  }),
  // 4) 현물 지원 (예: 도서 상품권, 교통카드 지원)
  z.strictObject({
    kind: z.literal('IN_KIND'),
    text: nonEmptyTextSchema,
  }),
  // 5) 금액 미정/상세 파악 불가
  z.strictObject({
    kind: z.literal('UNKNOWN'),
    text: nonEmptyTextSchema,
  }),
]);

/** 공식 신청 URL 검증 스키마 (http 또는 https만 허용) */
const OfficialUrlSchema = z
  .url('officialUrl은 유효한 URL이어야 합니다.')
  .pipe(
    z.string().refine(
      (value) => HTTP_PROTOCOLS.includes(new URL(value).protocol as (typeof HTTP_PROTOCOLS)[number]),
      'officialUrl은 http 또는 https URL이어야 합니다.',
    ),
  );

// 8. 단일 정책 입력 JSON 데이터(PolicyImportInput) 전체 스키마

export const PolicyImportInputSchema = z
  .strictObject({
    externalId: z.string().min(1).max(120), // 외부 관리용 고유 ID
    title: z.string().min(1).max(200), // 정책 제목
    agency: z.string().min(1).max(120), // 주관 기관명
    category: z.enum(POLICY_CATEGORIES), // 정책 카테고리 (주거, 금융 등)
    benefitSummary: z.string().min(1).max(300), // 혜택 요약
    benefitAmount: BenefitAmountSchema, // 혜택 상세
    conditions: PolicyConditionsSchema, // 신청 자격 조건들
    hasUnresolvedEligibilityCondition: z.boolean(), // 해석이 명확하지 않은 자격 조건 포함 여부
    unresolvedConditionNote: z.string().trim().min(1).nullable(), // 미해결 조건 비고/사유
    requiredDocs: z.array(z.string()), // 제출 필요 서류 목록
    applyStart: IsoDateSchema.nullable(), // 신청 시작일 (YYYY-MM-DD 또는 null)
    applyEnd: IsoDateSchema.nullable(), // 신청 마감일 (YYYY-MM-DD 또는 null)
    isAlwaysOpen: z.boolean(), // 상시 신청 여부
    officialUrl: OfficialUrlSchema, // 공식 안내 URL
    lastVerifiedAt: z.iso.datetime({ offset: true }), // 데이터 검증 시각 (ISO DateTime)
    isPublished: z.boolean(), // 공개 상태 여부
  })
  // 💡 데이터 간 상호 연관 관계 교차 검증 (Cross-field Validation)
  .superRefine((value, context) => {
    // 1) 시작일이 마감일보다 느릴 수 없음
    if (value.applyStart !== null && value.applyEnd !== null && value.applyStart > value.applyEnd) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['applyEnd'],
        message: 'applyEnd는 applyStart보다 빠를 수 없습니다.',
      });
    }

    // 2) 상시 신청 정책인데 마감일(applyEnd)이 지정되어 있으면 안 됨
    if (value.isAlwaysOpen && value.applyEnd !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['applyEnd'],
        message: '상시 신청 정책의 applyEnd는 null이어야 합니다.',
      });
    }

    // 3) 해석하기 모호한 자격 조건이 true인데 사유가 작성되어 있지 않으면 안 됨
    if (value.hasUnresolvedEligibilityCondition && value.unresolvedConditionNote === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unresolvedConditionNote'],
        message: '미확인 자격 조건이 있으면 사유를 입력해야 합니다.',
      });
    }
  });

// 9. 정책 JSON 배열 전체 스키마 (Batch Import용)

export const PolicyImportArraySchema = z.array(PolicyImportInputSchema).superRefine((policies, context) => {
  const externalIdIndexes = new Map<string, number>();

  // 배열 내부를 돌며 externalId 중복이 발생하는지 검사
  policies.forEach((policy, index) => {
    const previousIndex = externalIdIndexes.get(policy.externalId);

    if (previousIndex !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'externalId'],
        message: `externalId가 ${previousIndex + 1}번째 정책과 중복됩니다.`,
      });
      return;
    }

    externalIdIndexes.set(policy.externalId, index);
  });
});

// 10. TypeScript 타입 추론 추출
// Zod 스키마로부터 TypeScript 타입을 자동으로 생성하여 코드 전반에서 가져다 씁니다.
export type NumberRange = z.infer<typeof NumberRangeSchema>;
export type AgeBasis = z.infer<typeof AgeBasisSchema>;
export type AgeRule = z.infer<typeof AgeRuleSchema>;
export type IncomeRule = z.infer<typeof IncomeRuleSchema>;
export type PolicyConditions = z.infer<typeof PolicyConditionsSchema>;
export type BenefitAmount = z.infer<typeof BenefitAmountSchema>;
export type PolicyImportInput = z.infer<typeof PolicyImportInputSchema>;