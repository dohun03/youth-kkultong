import {
  PolicyImportArraySchema,
  PolicyImportInputSchema,
} from '../src';

const validPolicy = {
  externalId: '2026-example-policy',
  title: '예시 청년 지원 정책',
  agency: '예시 기관',
  category: 'WELFARE',
  benefitSummary: '최대 100만원 지원',
  benefitAmount: {
    kind: 'FIXED',
    amountWon: 1_000_000,
    text: '최대 100만원',
  },
  conditions: {
    age: {
      kind: 'RULE',
      value: {
        min: 19,
        max: 34,
        basis: { kind: 'TODAY' },
      },
    },
    region: {
      kind: 'RULE',
      value: ['11'],
    },
    income: {
      kind: 'RULE',
      value: {
        min: null,
        max: 150,
        basisConfirmed: true,
      },
    },
    status: {
      kind: 'RULE',
      value: ['JOB_SEEKER'],
    },
    householdSize: {
      kind: 'RULE',
      value: {
        min: 1,
        max: 2,
      },
    },
  },
  hasUnresolvedEligibilityCondition: false,
  unresolvedConditionNote: null,
  requiredDocs: [],
  applyStart: '2026-01-01',
  applyEnd: '2026-12-31',
  isAlwaysOpen: false,
  officialUrl: 'https://example.go.kr/policy',
  lastVerifiedAt: '2026-10-05T00:00:00+09:00',
  isPublished: true,
};

function expectInvalidPolicy(policy: unknown): void {
  expect(PolicyImportInputSchema.safeParse(policy).success).toBe(false);
}

describe('PolicyImportInputSchema', () => {
  it('정상 FIXED 혜택 정책을 검증한다', () => {
    expect(PolicyImportInputSchema.parse(validPolicy)).toMatchObject(validPolicy);
  });

  it('정상 MONTHLY 혜택 정책을 검증한다', () => {
    expect(
      PolicyImportInputSchema.parse({
        ...validPolicy,
        benefitAmount: {
          kind: 'MONTHLY',
          amountWon: 200_000,
          months: 12,
          text: '매월 20만원, 최대 12개월',
        },
      }).benefitAmount,
    ).toMatchObject({ kind: 'MONTHLY', amountWon: 200_000, months: 12 });
  });

  it('MONTHLY 혜택의 잘못된 금액과 개월 수를 거부한다', () => {
    expectInvalidPolicy({
      ...validPolicy,
      benefitAmount: {
        kind: 'MONTHLY',
        amountWon: 0,
        months: 12,
        text: '매월 20만원, 최대 12개월',
      },
    });
    expectInvalidPolicy({
      ...validPolicy,
      benefitAmount: {
        kind: 'MONTHLY',
        amountWon: 200_000,
        months: 0,
        text: '매월 20만원, 최대 12개월',
      },
    });
  });

  it('0 이하의 amountWon을 거부한다', () => {
    expectInvalidPolicy({
      ...validPolicy,
      benefitAmount: { ...validPolicy.benefitAmount, amountWon: 0 },
    });
  });

  it('실제로 존재하지 않는 날짜를 거부한다', () => {
    expectInvalidPolicy({ ...validPolicy, applyStart: '2026-02-31' });
  });

  it('신청 시작일이 마감일보다 늦으면 거부한다', () => {
    expectInvalidPolicy({
      ...validPolicy,
      applyStart: '2026-12-31',
      applyEnd: '2026-01-01',
    });
  });

  it('min이 max보다 큰 나이 조건을 거부한다', () => {
    expectInvalidPolicy({
      ...validPolicy,
      conditions: {
        ...validPolicy.conditions,
        age: {
          kind: 'RULE',
          value: { min: 35, max: 34, basis: { kind: 'TODAY' } },
        },
      },
    });
  });

  it('나이 조건의 경계값만 허용한다', () => {
    expect(
      PolicyImportInputSchema.safeParse({
        ...validPolicy,
        conditions: {
          ...validPolicy.conditions,
          age: { kind: 'RULE', value: { min: 0, max: 120, basis: { kind: 'TODAY' } } },
        },
      }).success,
    ).toBe(true);
    expectInvalidPolicy({
      ...validPolicy,
      conditions: {
        ...validPolicy.conditions,
        age: { kind: 'RULE', value: { min: -1, max: 120, basis: { kind: 'TODAY' } } },
      },
    });
  });

  it('지원하지 않는 AgeBasis를 거부한다', () => {
    expectInvalidPolicy({
      ...validPolicy,
      conditions: {
        ...validPolicy.conditions,
        age: {
          kind: 'RULE',
          value: { min: 19, max: 34, basis: { kind: 'REFERENCE_DATE' } },
        },
      },
    });
  });

  it('빈 지역 또는 상태 RULE을 거부한다', () => {
    expectInvalidPolicy({
      ...validPolicy,
      conditions: {
        ...validPolicy.conditions,
        region: { kind: 'RULE', value: [] },
      },
    });
    expectInvalidPolicy({
      ...validPolicy,
      conditions: {
        ...validPolicy.conditions,
        status: { kind: 'RULE', value: [] },
      },
    });
  });

  it('중복된 지역 또는 상태 RULE 값을 거부한다', () => {
    expectInvalidPolicy({
      ...validPolicy,
      conditions: {
        ...validPolicy.conditions,
        region: { kind: 'RULE', value: ['11', '11'] },
      },
    });
    expectInvalidPolicy({
      ...validPolicy,
      conditions: {
        ...validPolicy.conditions,
        status: { kind: 'RULE', value: ['JOB_SEEKER', 'JOB_SEEKER'] },
      },
    });
  });

  it('ANY·UNKNOWN·RULE 제약을 각각 허용한다', () => {
    expect(
      PolicyImportInputSchema.safeParse({
        ...validPolicy,
        conditions: {
          ...validPolicy.conditions,
          age: { kind: 'ANY' },
          region: { kind: 'UNKNOWN' },
        },
      }).success,
    ).toBe(true);
  });

  it('ANY·UNKNOWN에는 value를, RULE에는 value 누락을 허용하지 않는다', () => {
    expectInvalidPolicy({
      ...validPolicy,
      conditions: {
        ...validPolicy.conditions,
        income: { kind: 'ANY', value: { min: null, max: 150, basisConfirmed: true } },
      },
    });
    expectInvalidPolicy({
      ...validPolicy,
      conditions: {
        ...validPolicy.conditions,
        region: { kind: 'UNKNOWN', value: ['11'] },
      },
    });
    expectInvalidPolicy({
      ...validPolicy,
      conditions: {
        ...validPolicy.conditions,
        income: { kind: 'RULE' },
      },
    });
  });

  it('소득 산정 기준이 확정되지 않은 RULE을 거부한다', () => {
    expectInvalidPolicy({
      ...validPolicy,
      conditions: {
        ...validPolicy.conditions,
        income: {
          kind: 'RULE',
          value: { min: null, max: 150, basisConfirmed: false },
        },
      },
    });
  });

  it('미확인 자격 조건에 사유가 없으면 거부한다', () => {
    expectInvalidPolicy({
      ...validPolicy,
      hasUnresolvedEligibilityCondition: true,
      unresolvedConditionNote: null,
    });
  });

  it('상시 신청 정책에 applyEnd가 있으면 거부한다', () => {
    expectInvalidPolicy({ ...validPolicy, isAlwaysOpen: true });
  });

  it('http 또는 https가 아닌 URL을 거부한다', () => {
    expectInvalidPolicy({ ...validPolicy, officialUrl: 'ftp://example.go.kr/policy' });
  });
});

describe('PolicyImportArraySchema', () => {
  it('동일한 externalId를 가진 정책을 거부한다', () => {
    expect(PolicyImportArraySchema.safeParse([validPolicy, { ...validPolicy }]).success).toBe(false);
  });
});
