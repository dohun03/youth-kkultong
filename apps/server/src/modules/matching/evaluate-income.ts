import type { FieldEvaluation, PolicyConditions } from '@kkultong/contracts';
import type { IncomeCriteria, MatchContext } from './matching.types';

/**
 * 월 가구소득을 같은 가구원 수의 기준 중위소득 대비 비율로 환산해 정책 조건과 비교한다.
 * 기준 중위소득 값이 없으면 임의 값으로 대체하지 않아 POLICY_UNKNOWN을 반환한다.
 */
export function evaluateIncome(
  incomeCondition: PolicyConditions['income'],
  criteria: IncomeCriteria,
  context: MatchContext,
): FieldEvaluation {
  if (criteria.householdMonthlyIncome === undefined) {
    return 'NOT_PROVIDED';
  }

  if (incomeCondition.kind === 'ANY') {
    return 'MATCH';
  }

  if (incomeCondition.kind === 'UNKNOWN') {
    return 'POLICY_UNKNOWN';
  }

  if (criteria.householdSize === undefined) {
    return 'NOT_PROVIDED';
  }

  const medianIncome = context.medianIncomeByHouseholdSize.get(criteria.householdSize);
  if (medianIncome === undefined || medianIncome <= 0) {
    return 'POLICY_UNKNOWN';
  }

  const incomePercentage = (criteria.householdMonthlyIncome / medianIncome) * 100;
  const { min, max } = incomeCondition.value;
  if ((min !== null && incomePercentage < min) || (max !== null && incomePercentage > max)) {
    return 'MISMATCH';
  }

  return 'MATCH';
}
