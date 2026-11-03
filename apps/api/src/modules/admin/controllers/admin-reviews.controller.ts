import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { AdminReviewDetail, AdminReviewQuery, RejectReviewRequest, ReviewActionRequest, ReviewActionResponse, ReviewListResponse } from '@youth-kkultong/shared';
import { adminReviewIdSchema, adminReviewQuerySchema, rejectReviewSchema, reviewActionSchema } from '@youth-kkultong/shared';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { PolicyReviewsReadService } from '../../policies/services/reviews/policy-reviews-read.service';
import { PolicyReviewApprovalService } from '../../policies/services/reviews/policy-review-approval.service';
import { PolicyReviewRejectionService } from '../../policies/services/reviews/policy-review-rejection.service';
import type { AdminRequest } from '../guards/admin.guard';

/** 인증된 관리자에게 검수 조회와 승인 및 거절 경로 제공 */
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(
    @Inject(PolicyReviewsReadService) private readonly reviews: PolicyReviewsReadService,
    @Inject(PolicyReviewApprovalService) private readonly approval: PolicyReviewApprovalService,
    @Inject(PolicyReviewRejectionService) private readonly rejection: PolicyReviewRejectionService,
  ) {}

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

  /** 화면에서 확인한 두 해시로 검수 후보를 승인하고 공개 결과 반환 */
  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @Param('id', new ZodValidationPipe(adminReviewIdSchema)) id: string,
    @Body(new ZodValidationPipe(reviewActionSchema)) body: ReviewActionRequest,
    @Req() request: AdminRequest,
  ): Promise<ReviewActionResponse> {
    // Guard에서 검증한 관리자 식별자를 처리자로 전달
    return this.approval.approve(id, body, request.admin!.username);
  }

  /** 화면의 두 해시와 검증한 사유로 검수 후보를 거절하고 처리 결과 반환 */
  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @Param('id', new ZodValidationPipe(adminReviewIdSchema)) id: string,
    @Body(new ZodValidationPipe(rejectReviewSchema)) body: RejectReviewRequest,
    @Req() request: AdminRequest,
  ): Promise<ReviewActionResponse> {
    // 사유의 앞뒤 공백을 제거한 입력과 인증된 처리자를 업무 서비스로 전달
    return this.rejection.reject(id, body, request.admin!.username);
  }
}
