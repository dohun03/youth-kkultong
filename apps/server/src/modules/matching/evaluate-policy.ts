import type { SearchCriteria } from '@kkultong/contracts';
import { evaluateAge } from './evaluate-age';
import type { MatchContext, MatchablePolicy, PolicyEvaluation } from './matching.types';

/**
 * 정책 조건 평가를 한 결과로 조립한다.
 * Step 8에서는 나이만 평가하며, context는 이후 조건 평가에도 같은 순수 함수 계약을 유지하기 위해 받는다.
 */
export function evaluatePolicy(
  policy: MatchablePolicy,
  criteria: SearchCriteria,
  _context: MatchContext,
): PolicyEvaluation {
  return {
    fieldEvaluations: {
      age: evaluateAge(policy.conditions.age, criteria),
    },
  };
}
