import type { FieldEvaluation, PolicyConditions } from '@kkultong/contracts';
import type { AgeCriteria } from './matching.types';

/**
 * 현재 나이 입력과 정책의 나이 조건을 안전하게 비교한다.
 * 생년월일이 필요한 기준은 현재 나이만으로 확정할 수 없으므로 제외하지 않고 POLICY_UNKNOWN으로 남긴다.
 */
export function evaluateAge(
  ageCondition: PolicyConditions['age'],
  criteria: AgeCriteria,
): FieldEvaluation {
  if (criteria.age === undefined) {
    return 'NOT_PROVIDED';
  }

  if (ageCondition.kind === 'ANY') {
    return 'MATCH';
  }

  if (ageCondition.kind === 'UNKNOWN') {
    return 'POLICY_UNKNOWN';
  }

  if (ageCondition.value.basis.kind !== 'TODAY') {
    return 'POLICY_UNKNOWN';
  }

  const { min, max } = ageCondition.value;
  if ((min !== null && criteria.age < min) || (max !== null && criteria.age > max)) {
    return 'MISMATCH';
  }

  return 'MATCH';
}
