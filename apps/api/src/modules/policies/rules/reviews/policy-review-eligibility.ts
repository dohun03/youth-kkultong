import type { ReviewActionRequest } from '@youth-kkultong/shared';
import type { PolicyReview } from '../../entities/policy-review.entity';
import type { SourcePolicy } from '../../entities/source-policy.entity';
import type { Policy } from '../../entities/policy.entity';

/** (검수 후보, 최신 원본, 현재 공개본) 에서 처리 가능 여부를 확인할 값 */
export interface PolicyReviewEligibilityContext {
  review: Pick<PolicyReview, 'status' | 'kind' | 'contentHash' | 'basePolicyId' | 'baseContentHash'>;
  sourcePolicy: Pick<SourcePolicy, 'contentHash'>;
  publicPolicy: Pick<Policy, 'id' | 'contentHash'> | null;
}

/** 검수를 막는 상태 또는 내용 및 공개 기준의 충돌 코드 */
export type PolicyReviewConflict = 'REVIEW_NOT_PENDING' | 'REVIEW_CONTENT_CONFLICT' | 'REVIEW_BASE_CONFLICT';

/**
 * 해당 리뷰를 승인/거절 처리해도 되는지 판단하는 함수
 * 즉 검수 불가 사유를 반환. 모든 조건이 맞으면 NULL을 반환
 * 상세 조회는 context만 전달하고 승인 및 거절은 화면의 request도 전달해 해시를 추가 확인
 */
export function getPolicyReviewConflict(
  context: PolicyReviewEligibilityContext,
  request?: ReviewActionRequest,
): PolicyReviewConflict | null {
  const { review, sourcePolicy, publicPolicy } = context;

  // 아직 대기 상태인가?
  if (review.status !== 'PENDING') return 'REVIEW_NOT_PENDING';

  // 화면의 변경본 해시가 후보와 같고, 후보 해시도 최신 수집 원본과 같은가?
  if ((request && request.contentHash !== review.contentHash) || review.contentHash !== sourcePolicy.contentHash) return 'REVIEW_CONTENT_CONFLICT';

  // 화면의 기준본 해시가 후보에 저장된 기준 해시와 같은가?
  if (request && request.baseContentHash !== review.baseContentHash) return 'REVIEW_BASE_CONFLICT';

  // 현재 공개본이 후보 생성 당시의 공개 UUID·해시를 유지하는가? 신규 후보라면 기준본과 현재 공개본이 모두 없어야 합니다.
  if (review.kind === 'NEW') {
    return review.basePolicyId === null && review.baseContentHash === null && publicPolicy === null
      ? null : 'REVIEW_BASE_CONFLICT';
  }

  // 변경 후보는 공개본의 내용 해시뿐 아니라 같은 공개 행인지 UUID까지 확인
  if (publicPolicy === null || review.basePolicyId !== publicPolicy.id || review.baseContentHash !== publicPolicy.contentHash) return 'REVIEW_BASE_CONFLICT';

  return null;
}
