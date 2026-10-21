import type { PolicySearchRequest, PolicySearchResponse, SortKey } from '@youth-kkultong/shared';
import { sortPolicies } from '../matching/sort-policies';
import type { MatchedPolicyCandidate } from './policy-search-candidates';
import { toPolicyCard } from './policy-card';

/** 전체 후보를 정렬한 뒤 페이지를 나누고 공용 목록 카드·페이지 정보로 조립한다. */
export function buildPolicySearchResponse(
  candidates: readonly MatchedPolicyCandidate[],
  request: PolicySearchRequest,
): PolicySearchResponse {
  const page = request.page ?? 1;
  const limit = request.limit ?? 20;
  // 잘못된 page, limit 검증
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new RangeError('페이지는 1 이상 정수, 페이지 크기는 1~50 사이 정수여야 합니다.');
  }

  const conditions = request.conditions;
  // 분야·마감 포함 여부는 사용자 자격 조건에 포함하지 않는다.
  const hasConditions = conditions !== undefined && (conditions.age !== undefined || conditions.jobCode !== undefined
    || conditions.schoolCode !== undefined || conditions.regionCode !== undefined);
  let appliedSort: SortKey = request.sort ?? (hasConditions ? 'recommended' : 'popular');
  // 사용자 조건이 없는 맞춤순 요청은 실제 적용값도 인기순으로 돌려준다.
  if (appliedSort === 'recommended' && !hasConditions) appliedSort = 'popular';

  const sorted = sortPolicies(candidates, appliedSort);
  const total = sorted.length;
  const totalPages = Math.ceil(total / limit);
  // 반드시 전체 정렬 후 자른다. 초과 페이지는 빈 배열이며 큰 페이지 번호의 곱셈도 피한다.
  const pageItems = page > totalPages ? [] : sorted.slice((page - 1) * limit, page * limit);

  return {
    // 내부 조건·ID·추가 설명 플래그는 노출하지 않고 공용 카드 필드만 명시적으로 옮긴다.
    items: pageItems.map(toPolicyCard),
    pagination: { page, limit, total, totalPages },
    appliedSort,
  };
}
