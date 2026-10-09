import type { PolicyConditions } from '@kkultong/contracts';
import { evaluateIncome } from './evaluate-income';
import type { MatchContext } from './matching.types';

const CONTEXT: MatchContext = {
  today: new Date('2026-10-09T00:00:00.000Z'),
  medianIncomeByHouseholdSize: new Map([[2, 4_000_000]]),
  regionParentByCode: new Map(),
};

function rule(min: number | null, max: number | null): PolicyConditions['income'] {
  return {
    kind: 'RULE',
    value: { min, max, basisConfirmed: true },
  } as PolicyConditions['income'];
}

describe('evaluateIncome', () => {
  it('소득을 입력하지 않으면 NOT_PROVIDED를 반환한다', () => {
    expect(evaluateIncome({ kind: 'ANY' }, {}, CONTEXT)).toBe('NOT_PROVIDED');
  });

  it('ANY와 UNKNOWN 조건을 구분한다', () => {
    const criteria = { householdMonthlyIncome: 2_000_000, householdSize: 2 };

    expect(evaluateIncome({ kind: 'ANY' }, criteria, CONTEXT)).toBe('MATCH');
    expect(evaluateIncome({ kind: 'UNKNOWN' }, criteria, CONTEXT)).toBe('POLICY_UNKNOWN');
  });

  it('RULE은 가구원 수가 없으면 NOT_PROVIDED를 반환한다', () => {
    expect(evaluateIncome(rule(0, 150), { householdMonthlyIncome: 2_000_000 }, CONTEXT)).toBe(
      'NOT_PROVIDED',
    );
  });

  it('기준 중위소득 대비 비율과 경계를 비교한다', () => {
    const condition = rule(50, 100);

    expect(evaluateIncome(condition, { householdMonthlyIncome: 2_000_000, householdSize: 2 }, CONTEXT)).toBe(
      'MATCH',
    );
    expect(evaluateIncome(condition, { householdMonthlyIncome: 1_999_999, householdSize: 2 }, CONTEXT)).toBe(
      'MISMATCH',
    );
    expect(evaluateIncome(condition, { householdMonthlyIncome: 4_000_001, householdSize: 2 }, CONTEXT)).toBe(
      'MISMATCH',
    );
  });

  it('기준 중위소득 값이 없으면 POLICY_UNKNOWN을 반환한다', () => {
    expect(evaluateIncome(rule(0, 150), { householdMonthlyIncome: 2_000_000, householdSize: 3 }, CONTEXT)).toBe(
      'POLICY_UNKNOWN',
    );
  });
});
