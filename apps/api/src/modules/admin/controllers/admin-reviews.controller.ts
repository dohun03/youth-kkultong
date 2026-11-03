import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import type { AdminReviewDetail, AdminReviewQuery, ReviewListResponse } from '@youth-kkultong/shared';
import { adminReviewIdSchema, adminReviewQuerySchema } from '@youth-kkultong/shared';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { PolicyReviewsReadService } from '../../policies/services/reviews/policy-reviews-read.service';

/** 인증된 관리자에게 검수 목록과 과거 이력을 포함한 상세 조회 제공 */
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(@Inject(PolicyReviewsReadService) private readonly reviews: PolicyReviewsReadService) {}

  /** 검수 대기, 처리 이력 목록을 필터 및 페이지 조건으로 조회 */
  @Get()
  list(@Query(new ZodValidationPipe(adminReviewQuerySchema)) query: AdminReviewQuery): Promise<ReviewListResponse> {
    return this.reviews.findList(query);
  }

  /** 검수 UUID를 검사하고 스냅샷 비교와 최신 상태를 상세 조회 */
  @Get(':id')
  detail(@Param('id', new ZodValidationPipe(adminReviewIdSchema)) id: string): Promise<AdminReviewDetail> {
    return this.reviews.findById(id);
  }
}
