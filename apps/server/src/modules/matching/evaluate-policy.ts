import type {
  MatchSummary,
  PolicyFieldEvaluations,
  SearchCriteria,
} from '@kkultong/contracts';
import { evaluateAge } from './evaluate-age';
import { evaluateHousehold } from './evaluate-household';
import { evaluateIncome } from './evaluate-income';
import { evaluateRegion } from './evaluate-region';
import { evaluateStatus } from './evaluate-status';
import type { MatchContext, MatchablePolicy, PolicyEvaluation } from './matching.types';

/**
 * 정책 조건 평가를 한 결과로 조립한다.
 * 명백한 불일치만 검색 결과에서 제외하고, 자동 판정이 어려운 조건은 별도 확인 상태로 남긴다.
 */
export function evaluatePolicy(
  policy: MatchablePolicy,
  criteria: SearchCriteria,
  context: MatchContext,
): PolicyEvaluation {
  const fieldEvaluations: PolicyFieldEvaluations = {
    age: evaluateAge(policy.conditions.age, criteria),
    region: evaluateRegion(policy.conditions.region, criteria, context),
    income: evaluateIncome(policy.conditions.income, criteria, context),
    status: evaluateStatus(policy.conditions.status, criteria),
    householdSize: evaluateHousehold(policy.conditions.householdSize, criteria),
  };
  const requiresManualCheck =
    policy.hasUnresolvedEligibilityCondition ||
    Object.values(fieldEvaluations).includes('POLICY_UNKNOWN');

  return {
    fieldEvaluations,
    excluded: Object.values(fieldEvaluations).includes('MISMATCH'),
    matchSummary: determineMatchSummary(policy, criteria, requiresManualCheck),
    requiresManualCheck,
  };
}

function determineMatchSummary(
  policy: MatchablePolicy,
  criteria: SearchCriteria,
  requiresManualCheck: boolean,
): MatchSummary {
  if (!hasQualificationCriteria(criteria)) {
    return 'UNASSESSED';
  }

  if (requiresManualCheck) {
    return 'NEEDS_CHECK';
  }

  if (hasMissingRuleInput(policy, criteria)) {
    return 'PARTIAL';
  }

  return 'MATCHED';
}

function hasQualificationCriteria(criteria: SearchCriteria): boolean {
  return (
    criteria.age !== undefined ||
    criteria.regionCode !== undefined ||
    (criteria.statuses?.length ?? 0) > 0 ||
    criteria.householdSize !== undefined ||
    criteria.householdMonthlyIncome !== undefined
  );
}

function hasMissingRuleInput(
  policy: MatchablePolicy,
  criteria: SearchCriteria,
): boolean {
  return (
    (policy.conditions.age.kind === 'RULE' && criteria.age === undefined) ||
    (policy.conditions.region.kind === 'RULE' && criteria.regionCode === undefined) ||
    (policy.conditions.status.kind === 'RULE' && (criteria.statuses?.length ?? 0) === 0) ||
    (policy.conditions.householdSize.kind === 'RULE' && criteria.householdSize === undefined) ||
    (policy.conditions.income.kind === 'RULE' &&
      (criteria.householdMonthlyIncome === undefined || criteria.householdSize === undefined))
  );
}
