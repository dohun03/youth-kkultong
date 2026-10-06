import { z } from 'zod';
import { POLICY_CATEGORIES, USER_STATUSES } from './enums';

const MIN_AGE = 0;
const MAX_AGE = 120;
const MIN_INCOME_PERCENTAGE = 0;
const MAX_INCOME_PERCENTAGE = 1000;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const HTTP_PROTOCOLS = ['http:', 'https:'] as const;

function hasValidRange(min: number | null, max: number | null): boolean {
  return min === null || max === null || min <= max;
}

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

const IsoDateSchema = z
  .iso
  .date()
  .refine(isRealCalendarDate, '실제로 존재하는 날짜여야 합니다.');

const nonEmptyTextSchema = z.string().min(1, '빈 문자열은 허용하지 않습니다.');

export const NumberRangeSchema = z
  .strictObject({
    min: z.number().nullable(),
    max: z.number().nullable(),
  })
  .refine((value) => hasValidRange(value.min, value.max), {
    message: 'min은 max보다 클 수 없습니다.',
    path: ['min'],
  });

const TodayAgeBasisSchema = z.strictObject({
  kind: z.literal('TODAY'),
});

const FixedDateAgeBasisSchema = z.strictObject({
  kind: z.literal('FIXED_DATE'),
  date: IsoDateSchema,
});

const YearDiffAgeBasisSchema = z.strictObject({
  kind: z.literal('YEAR_DIFF'),
  year: z.number().int(),
});

const BirthYearAgeBasisSchema = z.strictObject({
  kind: z.literal('BIRTH_YEAR'),
});

export const AgeBasisSchema = z.discriminatedUnion('kind', [
  TodayAgeBasisSchema,
  FixedDateAgeBasisSchema,
  YearDiffAgeBasisSchema,
  BirthYearAgeBasisSchema,
]);

const AgeValueSchema = z.number().int().min(MIN_AGE).max(MAX_AGE).nullable();
const BirthYearValueSchema = z.number().int().nullable();

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

export const AgeRuleSchema = z.union([StandardAgeRuleSchema, BirthYearAgeRuleSchema]);

export const IncomeRuleSchema = z
  .strictObject({
    min: z.number().min(MIN_INCOME_PERCENTAGE).max(MAX_INCOME_PERCENTAGE).nullable(),
    max: z.number().min(MIN_INCOME_PERCENTAGE).max(MAX_INCOME_PERCENTAGE).nullable(),
    basisConfirmed: z.literal(true),
  })
  .refine((value) => hasValidRange(value.min, value.max), {
    message: 'min은 max보다 클 수 없습니다.',
    path: ['min'],
  });

export function createConstraintSchema<ValueSchema extends z.ZodType>(valueSchema: ValueSchema) {
  return z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('ANY') }),
    z.strictObject({ kind: z.literal('UNKNOWN') }),
    z.strictObject({ kind: z.literal('RULE'), value: valueSchema }),
  ]);
}

const RegionCodesSchema = z
  .array(z.string().regex(/^(KR|\d{2}|\d{5})$/))
  .min(1, '지역 RULE은 최소 한 개의 지역 코드가 필요합니다.')
  .refine((values) => new Set(values).size === values.length, '지역 코드가 중복되었습니다.');

const UserStatusesSchema = z
  .array(z.enum(USER_STATUSES))
  .min(1, '상태 RULE은 최소 한 개의 상태가 필요합니다.')
  .refine((values) => new Set(values).size === values.length, '상태가 중복되었습니다.');

const HouseholdSizeRangeSchema = z
  .strictObject({
    min: z.number().int().positive().nullable(),
    max: z.number().int().positive().nullable(),
  })
  .refine((value) => hasValidRange(value.min, value.max), {
    message: 'min은 max보다 클 수 없습니다.',
    path: ['min'],
  });

export const PolicyConditionsSchema = z.strictObject({
  age: createConstraintSchema(AgeRuleSchema),
  region: createConstraintSchema(RegionCodesSchema),
  income: createConstraintSchema(IncomeRuleSchema),
  status: createConstraintSchema(UserStatusesSchema),
  householdSize: createConstraintSchema(HouseholdSizeRangeSchema),
});

const PositiveWonSchema = z.number().int().positive();

export const BenefitAmountSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('FIXED'),
    amountWon: PositiveWonSchema,
    text: nonEmptyTextSchema,
  }),
  z.strictObject({
    kind: z.literal('MONTHLY'),
    amountWon: PositiveWonSchema,
    months: z.number().int().positive().nullable(),
    text: nonEmptyTextSchema,
  }),
  z.strictObject({
    kind: z.literal('RATE'),
    text: nonEmptyTextSchema,
  }),
  z.strictObject({
    kind: z.literal('IN_KIND'),
    text: nonEmptyTextSchema,
  }),
  z.strictObject({
    kind: z.literal('UNKNOWN'),
    text: nonEmptyTextSchema,
  }),
]);

const OfficialUrlSchema = z
  .url('officialUrl은 유효한 URL이어야 합니다.')
  .pipe(
    z.string().refine(
      (value) => HTTP_PROTOCOLS.includes(new URL(value).protocol as (typeof HTTP_PROTOCOLS)[number]),
      'officialUrl은 http 또는 https URL이어야 합니다.',
    ),
  );

export const PolicyImportInputSchema = z
  .strictObject({
    externalId: z.string().min(1).max(120),
    title: z.string().min(1).max(200),
    agency: z.string().min(1).max(120),
    category: z.enum(POLICY_CATEGORIES),
    benefitSummary: z.string().min(1).max(300),
    benefitAmount: BenefitAmountSchema,
    conditions: PolicyConditionsSchema,
    hasUnresolvedEligibilityCondition: z.boolean(),
    unresolvedConditionNote: z.string().trim().min(1).nullable(),
    requiredDocs: z.array(z.string()),
    applyStart: IsoDateSchema.nullable(),
    applyEnd: IsoDateSchema.nullable(),
    isAlwaysOpen: z.boolean(),
    officialUrl: OfficialUrlSchema,
    lastVerifiedAt: z.iso.datetime({ offset: true }),
    isPublished: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.applyStart !== null && value.applyEnd !== null && value.applyStart > value.applyEnd) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['applyEnd'],
        message: 'applyEnd는 applyStart보다 빠를 수 없습니다.',
      });
    }

    if (value.isAlwaysOpen && value.applyEnd !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['applyEnd'],
        message: '상시 신청 정책의 applyEnd는 null이어야 합니다.',
      });
    }

    if (value.hasUnresolvedEligibilityCondition && value.unresolvedConditionNote === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unresolvedConditionNote'],
        message: '미확인 자격 조건이 있으면 사유를 입력해야 합니다.',
      });
    }
  });

export const PolicyImportArraySchema = z.array(PolicyImportInputSchema).superRefine((policies, context) => {
  const externalIdIndexes = new Map<string, number>();

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

export type NumberRange = z.infer<typeof NumberRangeSchema>;
export type AgeBasis = z.infer<typeof AgeBasisSchema>;
export type AgeRule = z.infer<typeof AgeRuleSchema>;
export type IncomeRule = z.infer<typeof IncomeRuleSchema>;
export type PolicyConditions = z.infer<typeof PolicyConditionsSchema>;
export type BenefitAmount = z.infer<typeof BenefitAmountSchema>;
export type PolicyImportInput = z.infer<typeof PolicyImportInputSchema>;
