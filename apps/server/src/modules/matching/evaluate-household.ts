import type { FieldEvaluation, PolicyConditions } from '@kkultong/contracts';
import type { HouseholdCriteria } from './matching.types';

/** 사용자 가구원 수와 정책의 가구원 수 조건을 비교한다. */
export function evaluateHousehold(
  householdCondition: PolicyConditions['householdSize'],
  criteria: HouseholdCriteria,
): FieldEvaluation {
  if (criteria.householdSize === undefined) {
    return 'NOT_PROVIDED';
  }

  if (householdCondition.kind === 'ANY') {
    return 'MATCH';
  }

  if (householdCondition.kind === 'UNKNOWN') {
    return 'POLICY_UNKNOWN';
  }

  const { min, max } = householdCondition.value;
  if (
    (min !== null && criteria.householdSize < min) ||
    (max !== null && criteria.householdSize > max)
  ) {
    return 'MISMATCH';
  }

  return 'MATCH';
}
