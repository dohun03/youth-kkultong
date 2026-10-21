import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import type { PolicySearchResponse } from '@youth-kkultong/shared';
import { PoliciesSearchService } from '../services/policies-search.service';

@Controller('policies')
export class PoliciesController {
  constructor(@Inject(PoliciesSearchService) private readonly searchService: PoliciesSearchService) {}

  @Post('search')
  @HttpCode(200)
  search(@Body() body: unknown): Promise<PolicySearchResponse> {
    return this.searchService.search(body);
  }
}
