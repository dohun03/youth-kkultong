import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { MissingPolicyQuery, MissingPolicyResponse } from '@youth-kkultong/shared';
import { missingPolicyQuerySchema } from '@youth-kkultong/shared';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { MissingPoliciesReadService } from '../../policies/services/missing-policies-read.service';

/** 인증된 관리자가 수집에서 누락된 원본 정책을 조회하는 경로 제공 */
@Controller('admin/source-policies')
export class AdminSourcePoliciesController {
  constructor(@Inject(MissingPoliciesReadService) private readonly missing: MissingPoliciesReadService) {}

  /** 누락 조회 조건을 검사하고 공개 여부와 관계없이 누락 원본 목록 반환 */
  @Get('missing')
  listMissing(@Query(new ZodValidationPipe(missingPolicyQuerySchema)) query: MissingPolicyQuery): Promise<MissingPolicyResponse> {
    return this.missing.findList(query);
  }
}
