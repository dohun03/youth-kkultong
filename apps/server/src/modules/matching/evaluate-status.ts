import type { FieldEvaluation, PolicyConditions } from '@kkultong/contracts';
import type { StatusCriteria } from './matching.types';

/**
 * 사용자가 선택한 상태 중 하나라도 정책의 허용 상태와 겹치는지 비교한다.
 */
export function evaluateStatus(
  statusCondition: PolicyConditions['status'],
  criteria: StatusCriteria,
): FieldEvaluation {
  if (criteria.statuses === undefined || criteria.statuses.length === 0) {
    return 'NOT_PROVIDED';
  }

  if (statusCondition.kind === 'ANY') {
    return 'MATCH';
  }

  if (statusCondition.kind === 'UNKNOWN') {
    return 'POLICY_UNKNOWN';
  }

  return criteria.statuses.some((status) => statusCondition.value.includes(status))
    ? 'MATCH'
    : 'MISMATCH';
}
