import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminReviewDetail, AdminReviewQuery, PolicySnapshot, ReviewListItem, ReviewListResponse } from '@youth-kkultong/shared';
import { DataSource } from 'typeorm';
import { PolicyReviewRepository } from '../../repositories/policy-review.repository';
import { calculatePolicyFieldDiff } from '../../rules/reviews/policy-field-diff';
import { getPolicyReviewConflict } from '../../rules/reviews/policy-review-eligibility';

/** 관리자 검수 목록과 당시 스냅샷 및 현재 상태를 비교하는 상세 응답 조립 */
@Injectable()
export class PolicyReviewsReadService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(PolicyReviewRepository) private readonly reviews: PolicyReviewRepository,
  ) {}

  /** 필터를 적용한 검수 목록과 페이지 정보 반환 */
  async findList(query: AdminReviewQuery): Promise<ReviewListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { rows, total } = await this.reviews.findReviewList(this.dataSource.manager, query);
    return {
      items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), closedAt: row.closedAt?.toISOString() ?? null })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** 같은 읽기 시점의 데이터로 보관된 스냅샷, 최신 상태, 검수 가능 여부 반환 */
  async findById(id: string): Promise<AdminReviewDetail> {
    // 성공 시 COMMIT, 실패 시 ROLLBACK을 수행하고 전용 연결을 반환
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const detail = await this.reviews.findReviewDetail(manager, id);
      if (!detail) throw new NotFoundException({ code: 'REVIEW_NOT_FOUND' });
      const { review, sourcePolicy, publicPolicy, latestPendingReviewId } = detail;

      // 목록과 상세 모두 보관 당시의 제목을 제공
      const item: ReviewListItem = {
        id: review.id,
        sourcePolicyId: review.sourcePolicyId,
        source: sourcePolicy.source,
        externalId: sourcePolicy.externalId,
        title: review.rawSnapshot.plcyNm as string,
        kind: review.kind,
        status: review.status,
        contentHash: review.contentHash,
        baseContentHash: review.baseContentHash,
        createdAt: review.createdAt.toISOString(),
        closedAt: review.closedAt?.toISOString() ?? null,
        reviewedBy: review.reviewedBy,
        rejectionReason: review.rejectionReason,
        supersededReason: review.supersededReason,
      };

      return {
        review: item,
        // 후보 생성 당시 공개본의 스냅샷. 신규면 null
        base: review.baseRawSnapshot === null ? null : {
          contentHash: review.baseContentHash!,
          raw: review.baseRawSnapshot,
        },
        // 승인해서 공개하려는 변경본의 스냅샷
        target: {
          contentHash: review.contentHash,
          raw: review.rawSnapshot,
        },
        // 현재 공개 중인 정책
        currentPublished: publicPolicy === null ? null : {
          // JSONB에 저장된 공개 원문을 공용 JSON 응답 타입으로 전달
          id: publicPolicy.id,
          contentHash: publicPolicy.contentHash,
          raw: publicPolicy.rawJson as PolicySnapshot['raw'],
          viewCount: publicPolicy.viewCount,
        },
        // 가장 최근 수집 원본의 해시·조회수·누락 정보
        latestSource: {
          contentHash: sourcePolicy.contentHash,
          viewCount: sourcePolicy.viewCount,
          lastCollectedAt: sourcePolicy.lastCollectedAt?.toISOString() ?? null,
          missingCount: sourcePolicy.missingCount,
        },
        // base와 target 사이의 필드 차이
        changedFields: calculatePolicyFieldDiff(review.baseRawSnapshot, review.rawSnapshot),
        // 같은 정책의 최신 대기 후보 ID
        latestPendingReviewId,
        // 지금 승인·거절할 수 있는 상태인지
        canReview: getPolicyReviewConflict({ review, sourcePolicy, publicPolicy }) === null,
      };
    });
  }
}
