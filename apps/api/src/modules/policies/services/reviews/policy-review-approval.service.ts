import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ReviewActionRequest, ReviewActionResponse } from '@youth-kkultong/shared';
import { DataSource, QueryFailedError } from 'typeorm';
import { createYouthCenterPolicyContentHash } from '../../../ingestion/youth-center/youth-center-policy.hash';
import { transformYouthCenterPolicy } from '../../../ingestion/youth-center/youth-center-policy.transform';
import { getPolicyReviewConflict } from '../../rules/reviews/policy-review-eligibility';
import { PolicyReviewRepository } from '../../repositories/policy-review.repository';
import { PolicyRepository } from '../../repositories/policy.repository';

/** 잠금 후 검수 조건과 스냅샷을 확인하고 공개 저장 및 승인 기록을 함께 확정 */
@Injectable()
export class PolicyReviewApprovalService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(PolicyReviewRepository) private readonly reviews: PolicyReviewRepository,
    @Inject(PolicyRepository) private readonly policies: PolicyRepository,
  ) {}

  /** 화면의 두 해시로 대기 후보를 승인. 승인 확정된 공개 UUID와 처리 시각 반환 */
  async approve(
    id: string,
    request: ReviewActionRequest,
    reviewedBy: string
  ): Promise<ReviewActionResponse> {
    // DB가 취소를 확정한 충돌만 한 번 재시도
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.approveOnce(id, request, reviewedBy);
      } catch (error) {
        const code = error instanceof QueryFailedError && 'code' in error.driverError ? error.driverError.code : undefined;
        if (attempt >= 2 || (code !== '40P01' && code !== '40001')) throw error;
      }
    }
  }

  /** 새 트랜잭션에서 원본과 후보 및 공개본을 잠그고 승인 조건을 다시 확인 */
  private async approveOnce(id: string, request: ReviewActionRequest, reviewedBy: string): Promise<ReviewActionResponse> {
    // 트랜잭션 시작
    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      const context = await this.reviews.findReviewForUpdate(manager, id);
      if (!context) throw new NotFoundException({ code: 'REVIEW_NOT_FOUND' });

      // 잠금 대기 중 수집이나 다른 검수가 끝났을 수 있어 다시 읽은 값으로 판정
      const conflict = getPolicyReviewConflict(context, request);
      if (conflict) throw new ConflictException({ code: conflict });
      const { review, sourcePolicy } = context;

      // 저장된 리뷰의 스냅샷 구조, 해시를 한 번 더 검증
      const raw = review.rawSnapshot;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || typeof raw.plcyNo !== 'string' || typeof raw.plcyNm !== 'string') {
        throw new Error('승인할 검수 스냅샷의 원본 정책 형식이 올바르지 않습니다.');
      }
      const snapshot = { ...raw, plcyNo: raw.plcyNo, plcyNm: raw.plcyNm };
      if (createYouthCenterPolicyContentHash(snapshot) !== review.contentHash) {
        throw new Error('승인할 검수 스냅샷의 내용과 해시가 일치하지 않습니다.');
      }

      // 검수 당시 스냅샷을 정책 자료로 변환 -> 잠근 원본 vs 정책 식별자가 같은지 확인
      const policy = transformYouthCenterPolicy(snapshot);
      if (policy.source !== sourcePolicy.source || policy.externalId !== sourcePolicy.externalId) {
        throw new Error('승인할 검수 스냅샷과 원본의 출처 또는 외부 ID가 다릅니다.');
      }

      // 승인할 정책을 policies 테이블에 저장 또는 갱신
      // (본문, raw_json은 리뷰의 스냅샷으로 저장. 조회수는 검수 대상이 아니라서 원본 최신값 쓰는게 맞음 )
      const policyId = await this.policies.saveApprovedPolicy(
        manager,
        { ...policy, contentHash: review.contentHash, viewCount: sourcePolicy.viewCount },
        review.basePolicyId
      );
      const closedAt = new Date();
      await this.reviews.approvePendingReview(manager, review.id, reviewedBy, closedAt);

      // 이 콜백이 끝난 뒤 COMMIT에 성공해야 호출자에게 응답이 전달됨
      return { id: review.id, status: 'APPROVED', policyId, closedAt: closedAt.toISOString() };
    });
  }
}
