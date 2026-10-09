import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  type PolicyDetail,
  PolicyListQuerySchema,
  type PolicyListQuery,
  type PolicyListResponse,
} from '@kkultong/contracts';
import { PolicyQueryService } from '../services/policy-query.service';

@Controller('policies')
export class PoliciesController {
  public constructor(private readonly policyQueryService: PolicyQueryService) {}

  /** 개인 조건 없이 공개 정책 목록을 조회한다. */
  @Get()
  public async findPolicies(@Query() query: unknown): Promise<PolicyListResponse> {
    const parsedQuery = PolicyListQuerySchema.safeParse(query);

    if (!parsedQuery.success) {
      throw new BadRequestException('정책 목록 query 형식이 올바르지 않습니다.');
    }

    return this.policyQueryService.findPublicPolicies(parsedQuery.data satisfies PolicyListQuery);
  }

  /** 공개 가능한 정책 한 건의 상세 정보를 조회한다. */
  @Get(':id')
  public async findPolicy(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<PolicyDetail> {
    return this.policyQueryService.findPublicPolicy(id);
  }
}
