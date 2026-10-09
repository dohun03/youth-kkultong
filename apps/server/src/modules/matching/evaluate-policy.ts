import type { SearchCriteria } from '@kkultong/contracts';
import { evaluateAge } from './evaluate-age';
import { evaluateRegion } from './evaluate-region';
import { evaluateStatus } from './evaluate-status';
import type { MatchContext, MatchablePolicy, PolicyEvaluation } from './matching.types';

/**
 * 정책 조건 평가를 한 결과로 조립한다.
 * Step 9에서는 나이·지역·상태를 평가하며, 남은 조건은 다음 Step에서 같은 결과 객체에 추가한다.
 */
export function evaluatePolicy(
  policy: MatchablePolicy,
  criteria: SearchCriteria,
  context: MatchContext,
): PolicyEvaluation {
  return {
    fieldEvaluations: {
      age: evaluateAge(policy.conditions.age, criteria),
      region: evaluateRegion(policy.conditions.region, criteria, context),
      status: evaluateStatus(policy.conditions.status, criteria),
    },
  };
}
