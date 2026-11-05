import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { rejectReviewSchema } from '@youth-kkultong/shared';
import type { RejectReviewRequest, ReviewActionResponse } from '@youth-kkultong/shared';
import { DataSource, QueryFailedError } from 'typeorm';
import { getPolicyReviewConflict } from '../../rules/reviews/policy-review-eligibility';
import { PolicyReviewRepository } from '../../repositories/policy-review.repository';

/** 잠금 후 검수 조건을 확인하고 거절 사유와 처리 이력을 함께 확정 */
@Injectable()
export class PolicyReviewRejectionService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(PolicyReviewRepository) private readonly reviews: PolicyReviewRepository,
  ) {}

  /** 화면의 두 해시와 필수 사유로 대기 후보를 거절. 공개 UUID와 처리 시각 반환 */
  async reject(id: string, request: RejectReviewRequest, reviewedBy: string): Promise<ReviewActionResponse> {
    // 스키마 검증
    const parsed = rejectReviewSchema.safeParse(request);
    if (!parsed.success) throw new BadRequestException('요청값이 올바르지 않습니다.');

    // 취소가 확정된 교착과 직렬화 충돌만 한 번 더 실행
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.rejectOnce(id, parsed.data, reviewedBy);
      } catch (error) {
        const code = error instanceof QueryFailedError && 'code' in error.driverError ? error.driverError.code : undefined;
        if (attempt >= 2 || (code !== '40P01' && code !== '40001')) throw error;
      }
    }
  }

  /** 재시도에서도 새 트랜잭션의 최신 원본과 공개 기준을 확인한 뒤 거절 기록 저장 */
  private async rejectOnce(id: string, request: RejectReviewRequest, reviewedBy: string): Promise<ReviewActionResponse> {
    // 트랜잭션 시작
    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      // 원본, 후보, 공개본을 조회 후 잠금
      const context = await this.reviews.findReviewForUpdate(manager, id);
      if (!context) throw new NotFoundException({ code: 'REVIEW_NOT_FOUND' });

      // 검수 가능한지 검증
      const conflict = getPolicyReviewConflict(context, request);
      if (conflict) throw new ConflictException({ code: conflict });

      // 후보의 처리 정보만 기록하고 같은 종료 시각을 응답에도 사용
      const closedAt = new Date();
      await this.reviews.rejectPendingReview(manager, id, reviewedBy, request.reason, closedAt);
      return {
        id, status: 'REJECTED', policyId: context.publicPolicy?.id ?? null, closedAt: closedAt.toISOString(),
      };
    });
  }
}
