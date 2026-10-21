import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import type { PolicyDetail, PolicySearchResponse } from '@youth-kkultong/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { PoliciesSearchService } from '../services/policies-search.service';
import { PoliciesDetailService } from '../services/policies-detail.service';

@Controller('policies')
export class PoliciesController {
  constructor(
    @Inject(PoliciesSearchService) private readonly searchService: PoliciesSearchService,
    @Inject(PoliciesDetailService) private readonly detailService: PoliciesDetailService,
  ) {}

  // 정책 목록 조회
  @Post('search')
  @HttpCode(200)
  search(@Body() body: unknown): Promise<PolicySearchResponse> {
    return this.searchService.search(body);
  }

  // 특정 정책 상세 조회
  @Get(':id')
  detail(@Param('id', new ZodValidationPipe(z.uuid())) id: string): Promise<PolicyDetail> {
    return this.detailService.findById(id);
  }
}
