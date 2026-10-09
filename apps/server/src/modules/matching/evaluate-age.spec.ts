import type { PolicyConditions } from '@kkultong/contracts';
import { evaluateAge } from './evaluate-age';
import { evaluatePolicy } from './evaluate-policy';
import type { MatchContext, MatchablePolicy } from './matching.types';

const DEFAULT_CONTEXT: MatchContext = {
  today: new Date('2026-10-09T00:00:00.000Z'),
  medianIncomeByHouseholdSize: new Map(),
  regionParentByCode: new Map(),
};

function createPolicy(age: PolicyConditions['age']): MatchablePolicy {
  return {
    conditions: {
      age,
      region: { kind: 'ANY' },
      income: { kind: 'ANY' },
      status: { kind: 'ANY' },
      householdSize: { kind: 'ANY' },
    },
    hasUnresolvedEligibilityCondition: false,
  };
}

describe('evaluateAge', () => {
  it('나이를 입력하지 않으면 정책 조건과 무관하게 NOT_PROVIDED를 반환한다', () => {
    expect(evaluateAge({ kind: 'UNKNOWN' }, {})).toBe('NOT_PROVIDED');
  });

  it('ANY 조건은 입력한 나이와 일치한다', () => {
    expect(evaluateAge({ kind: 'ANY' }, { age: 25 })).toBe('MATCH');
  });

  it('UNKNOWN 조건은 입력이 있으면 POLICY_UNKNOWN을 반환한다', () => {
    expect(evaluateAge({ kind: 'UNKNOWN' }, { age: 25 })).toBe('POLICY_UNKNOWN');
  });

  it('TODAY 기준 RULE의 min·max 범위를 포함해 비교한다', () => {
    const condition: PolicyConditions['age'] = {
      kind: 'RULE',
      value: {
        min: 19,
        max: 34,
        basis: { kind: 'TODAY' },
      },
    };

    expect(evaluateAge(condition, { age: 19 })).toBe('MATCH');
    expect(evaluateAge(condition, { age: 34 })).toBe('MATCH');
    expect(evaluateAge(condition, { age: 18 })).toBe('MISMATCH');
    expect(evaluateAge(condition, { age: 35 })).toBe('MISMATCH');
  });

  it.each([
    { kind: 'FIXED_DATE', date: '2026-01-01' } as const,
    { kind: 'YEAR_DIFF', year: 2026 } as const,
    { kind: 'BIRTH_YEAR' } as const,
  ])('현재 나이만으로 판정할 수 없는 $kind 기준은 POLICY_UNKNOWN을 반환한다', (basis) => {
    const condition = {
      kind: 'RULE' as const,
      value: {
        min: 19,
        max: 34,
        basis,
      },
    } as PolicyConditions['age'];

    expect(evaluateAge(condition, { age: 25 })).toBe('POLICY_UNKNOWN');
  });
});

describe('evaluatePolicy', () => {
  it('Step 9에서는 나이·지역·상태 평가 결과를 조립한다', () => {
    expect(evaluatePolicy(createPolicy({ kind: 'ANY' }), { age: 25 }, DEFAULT_CONTEXT)).toEqual({
      fieldEvaluations: {
        age: 'MATCH',
        region: 'NOT_PROVIDED',
        status: 'NOT_PROVIDED',
      },
    });
  });
});
