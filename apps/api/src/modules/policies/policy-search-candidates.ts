import type { ApplicationStatus, PolicySearchRequest } from '@youth-kkultong/shared';
import { evaluatePolicy } from '../matching/evaluate-policy';
import type { PolicyMatchResult } from '../matching/evaluate-policy';
import type { ActiveRegionMap } from '../matching/region-match';
import { calculateApplicationStatus } from './application-status';
import type { PolicyCandidate } from './repositories/policy.repository';

/** 분야·마감·자격 필터를 통과하고 검색 시점의 상태·점수·태그가 붙은 정렬 전 후보 */
export type MatchedPolicyCandidate = PolicyCandidate & Pick<PolicyMatchResult, 'score' | 'tags'> & {
  applicationStatus: ApplicationStatus;
};

/** 조회된 정책 목록에 상태 계산·분야 및 마감 필터·종합 판정을 차례로 적용 */
export function buildSearchCandidates(
  candidates: readonly PolicyCandidate[],
  request: PolicySearchRequest,
  today: string,
  activeRegions: ActiveRegionMap,
): MatchedPolicyCandidate[] {
  const result: MatchedPolicyCandidate[] = [];

  for (const policy of candidates) {
    // 요청마다 한 번 정한 한국 오늘 날짜를 모든 정책에 동일하게 적용한다.
    const applicationStatus = calculateApplicationStatus(policy, today);

    if (request.category !== undefined && request.category !== '' && policy.category !== request.category) continue;
    if (!request.includeClosed && applicationStatus === 'CLOSED') continue;

    // 분야·마감 필터를 통과한 정책만 사용자 조건과 비교한다. 확인 필요는 제외하지 않는다.
    const match = evaluatePolicy(policy, request.conditions, activeRegions);
    if (match.excluded) continue;

    // 정렬에 필요한 상태·점수·태그를 붙인다.
    result.push({ ...policy, applicationStatus, score: match.score, tags: match.tags });
  }

  return result;
}
