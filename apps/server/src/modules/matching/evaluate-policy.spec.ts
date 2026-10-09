import type { PolicyConditions } from '@kkultong/contracts';
import { evaluatePolicy } from './evaluate-policy';
import type { MatchContext, MatchablePolicy } from './matching.types';

const CONTEXT: MatchContext = {
  today: new Date('2026-10-09T00:00:00.000Z'),
  medianIncomeByHouseholdSize: new Map([[2, 4_000_000]]),
  regionParentByCode: new Map(),
};

function createPolicy(
  conditionOverrides: Partial<PolicyConditions> = {},
  hasUnresolvedEligibilityCondition = false,
): MatchablePolicy {
  return {
    conditions: {
      age: { kind: 'ANY' },
      region: { kind: 'ANY' },
      income: { kind: 'ANY' },
      status: { kind: 'ANY' },
      householdSize: { kind: 'ANY' },
      ...conditionOverrides,
    },
    hasUnresolvedEligibilityCondition,
  };
}

describe('evaluatePolicy', () => {
  it('사용자 조건이 없으면 UNASSESSED를 반환한다', () => {
    const evaluation = evaluatePolicy(createPolicy(), {}, CONTEXT);

    expect(evaluation).toMatchObject({
      excluded: false,
      matchSummary: 'UNASSESSED',
      requiresManualCheck: false,
    });
  });

  it('모든 입력 조건이 일치하면 MATCHED를 반환한다', () => {
    const evaluation = evaluatePolicy(createPolicy(), { age: 25 }, CONTEXT);

    expect(evaluation).toMatchObject({
      excluded: false,
      matchSummary: 'MATCHED',
      requiresManualCheck: false,
    });
  });

  it('비교 가능한 RULE의 입력이 부족하면 PARTIAL을 반환한다', () => {
    const evaluation = evaluatePolicy(
      createPolicy({
        age: { kind: 'RULE', value: { min: 19, max: 34, basis: { kind: 'TODAY' } } },
      }),
      { statuses: ['STUDENT'] },
      CONTEXT,
    );

    expect(evaluation).toMatchObject({
      excluded: false,
      matchSummary: 'PARTIAL',
      requiresManualCheck: false,
      fieldEvaluations: { age: 'NOT_PROVIDED' },
    });
  });

  it('정책 UNKNOWN 또는 미해결 조건은 NEEDS_CHECK로 유지한다', () => {
    const unknownIncome = evaluatePolicy(
      createPolicy({ income: { kind: 'UNKNOWN' } }),
      { householdMonthlyIncome: 2_000_000, householdSize: 2 },
      CONTEXT,
    );
    const unresolvedPolicy = evaluatePolicy(createPolicy({}, true), { age: 25 }, CONTEXT);

    expect(unknownIncome).toMatchObject({ matchSummary: 'NEEDS_CHECK', requiresManualCheck: true });
    expect(unresolvedPolicy).toMatchObject({ matchSummary: 'NEEDS_CHECK', requiresManualCheck: true });
  });

  it('MISMATCH가 하나라도 있으면 excluded=true를 반환한다', () => {
    const evaluation = evaluatePolicy(
      createPolicy({ status: { kind: 'RULE', value: ['STUDENT'] } }),
      { statuses: ['EMPLOYEE'] },
      CONTEXT,
    );

    expect(evaluation).toMatchObject({
      excluded: true,
      fieldEvaluations: { status: 'MISMATCH' },
    });
  });
});
