import type { CollectionResult, ReviewKind } from '@youth-kkultong/shared';
import type { Policy } from './entities/policy.entity';
import type { SourcePolicy } from './entities/source-policy.entity';
import type { PolicyReview } from './entities/policy-review.entity';
import type { SupersededReviewInput } from './repositories/policy-review.repository';

/** 원본 하나의 검수 판단에 필요한 최신 내용과 공개본, 대기와 거절 정보 */
export interface PolicyReviewContext {
  collectionResult: CollectionResult;
  sourcePolicy: Pick<SourcePolicy, 'id' | 'source' | 'externalId' | 'contentHash'>;
  publicPolicy: Pick<Policy, 'id' | 'source' | 'externalId' | 'contentHash'> | null;
  pendingReview: Pick<PolicyReview,
    'id' | 'sourcePolicyId' | 'status' | 'contentHash' | 'basePolicyId' | 'baseContentHash'
  > | null;
  rejectedHashes: readonly Pick<PolicyReview, 'sourcePolicyId' | 'contentHash'>[];
}

/** 기존 대기 유지, 신규 후보 생략, 후보 생성 중 하나와 필요한 대체 처리 */
export type PolicyReviewDecision =
  | { action: 'KEEP'; pendingReviewId: string }
  | { action: 'SKIP'; superseded: SupersededReviewInput | null }
  | { action: 'CREATE'; kind: ReviewKind; superseded: SupersededReviewInput | null };

/** 최신 원본과 현재 공개 기준을 비교해 검수 후보 (생성/유지/대체) 여부를 판단 */
export function decidePolicyReview(context: PolicyReviewContext): PolicyReviewDecision {
  const { collectionResult, sourcePolicy, publicPolicy, pendingReview, rejectedHashes } = context;

  // 같은 정책의 공개본과 대기를 비교하도록 식별자와 대기 상태를 확인
  if (publicPolicy && (publicPolicy.source !== sourcePolicy.source || publicPolicy.externalId !== sourcePolicy.externalId)) {
    throw new Error('검수 원본과 현재 공개본의 출처 또는 외부 ID가 다릅니다.');
  }
  if (pendingReview && (pendingReview.sourcePolicyId !== sourcePolicy.id || pendingReview.status !== 'PENDING')) {
    throw new Error('검수 비교 대상은 같은 원본의 대기 후보여야 합니다.');
  }

  // 이번 수집에서 누락된 원본은 기존 대기를 유지
  if (collectionResult === 'MISSING') {
    return pendingReview ? { action: 'KEEP', pendingReviewId: pendingReview.id } : { action: 'SKIP', superseded: null };
  }

  // 공개본과 같아진 내용은 기존 대기를 정리하고 새 후보 생성을 생략
  if (publicPolicy?.contentHash === sourcePolicy.contentHash) {
    return { action: 'SKIP', superseded: pendingReview ? { id: pendingReview.id, reason: 'MATCHES_PUBLIC' } : null };
  }

  // 같은 원본에서 거절했던 내용은 공개 기준이 바뀌어도 자동 재검수를 생략
  const previouslyRejected = rejectedHashes.some((review) =>
    review.sourcePolicyId === sourcePolicy.id && review.contentHash === sourcePolicy.contentHash);
  if (previouslyRejected) {
    return { action: 'SKIP', superseded: pendingReview ? { id: pendingReview.id, reason: 'PREVIOUSLY_REJECTED' } : null };
  }

  // 변경본 해시와 공개 기준 UUID, 해시가 모두 같으면 기존 대기를 유지
  if (pendingReview && pendingReview.contentHash === sourcePolicy.contentHash
    && pendingReview.basePolicyId === (publicPolicy?.id ?? null)
    && pendingReview.baseContentHash === (publicPolicy?.contentHash ?? null)) {
    return { action: 'KEEP', pendingReviewId: pendingReview.id };
  }

  // 기존 대기가 최신 상태와 다르면 원본 변경을 우선해 대체 사유를 지정
  const superseded: SupersededReviewInput | null = pendingReview ? {
    id: pendingReview.id,
    reason: pendingReview.contentHash !== sourcePolicy.contentHash ? 'SOURCE_CHANGED' : 'PUBLIC_BASE_CHANGED',
  } : null;

  // 현재 공개본이 있는 정책은 변경 후보, 아직 공개되지 않은 정책은 신규 후보로 생성
  return { action: 'CREATE', kind: publicPolicy === null ? 'NEW' : 'CHANGED', superseded };
}
