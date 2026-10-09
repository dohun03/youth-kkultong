import type { FieldEvaluation, PolicyConditions } from '@kkultong/contracts';
import type { MatchContext, RegionCriteria } from './matching.types';

/**
 * 사용자 지역과 정책의 허용 지역을 비교한다.
 * 시·도 입력만으로 특정 시·군·구 자격을 확정할 수 없을 때는 정책을 제외하지 않고 NOT_PROVIDED로 남긴다.
 */
export function evaluateRegion(
  regionCondition: PolicyConditions['region'],
  criteria: RegionCriteria,
  context: MatchContext,
): FieldEvaluation {
  if (criteria.regionCode === undefined) {
    return 'NOT_PROVIDED';
  }

  if (regionCondition.kind === 'ANY') {
    return 'MATCH';
  }

  if (regionCondition.kind === 'UNKNOWN') {
    return 'POLICY_UNKNOWN';
  }

  let hasPolicyUnknown = false;
  let hasNotProvided = false;

  for (const policyRegionCode of regionCondition.value) {
    const evaluation = evaluateRuleRegion(policyRegionCode, criteria.regionCode, context);
    if (evaluation === 'MATCH') {
      return 'MATCH';
    }

    if (evaluation === 'POLICY_UNKNOWN') {
      hasPolicyUnknown = true;
    }

    if (evaluation === 'NOT_PROVIDED') {
      hasNotProvided = true;
    }
  }

  if (hasPolicyUnknown) {
    return 'POLICY_UNKNOWN';
  }

  if (hasNotProvided) {
    return 'NOT_PROVIDED';
  }

  return 'MISMATCH';
}

function evaluateRuleRegion(
  policyRegionCode: string,
  userRegionCode: string,
  context: MatchContext,
): FieldEvaluation {
  if (policyRegionCode === 'KR') {
    return 'MATCH';
  }

  // KR은 거주 지역을 특정하지 않으므로 지역 한정 정책의 일치 여부를 판단하지 않는다.
  if (userRegionCode === 'KR') {
    return 'NOT_PROVIDED';
  }

  const policySidoCode = findSidoCode(policyRegionCode, context);
  const userSidoCode = findSidoCode(userRegionCode, context);
  if (policySidoCode === null || userSidoCode === null) {
    return 'POLICY_UNKNOWN';
  }

  if (policySidoCode !== userSidoCode) {
    return 'MISMATCH';
  }

  if (policyRegionCode.length === 2) {
    return 'MATCH';
  }

  if (userRegionCode.length === 2) {
    return 'NOT_PROVIDED';
  }

  return policyRegionCode === userRegionCode ? 'MATCH' : 'MISMATCH';
}

function findSidoCode(regionCode: string, context: MatchContext): string | null {
  if (regionCode.length === 2) {
    return regionCode;
  }

  return context.regionParentByCode.get(regionCode) ?? null;
}
