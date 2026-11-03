import { Inject, Injectable } from '@nestjs/common';
import type { MissingPolicyQuery, MissingPolicyResponse } from '@youth-kkultong/shared';
import { DataSource } from 'typeorm';
import { SourcePolicyRepository } from '../../repositories/source-policy.repository';

/** 누락 원본의 목록과 페이지 정보를 관리자 응답으로 조립 */
@Injectable()
export class MissingPoliciesReadService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(SourcePolicyRepository) private readonly sources: SourcePolicyRepository,
  ) {}

  /** 누락 목록을 조회하고 실제 수집 시각은 ISO 문자열 또는 NULL로 전달 */
  async findList(query: MissingPolicyQuery): Promise<MissingPolicyResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { rows, total } = await this.sources.findMissingPolicies(this.dataSource.manager, query);
    return {
      items: rows.map((row) => ({ ...row, lastCollectedAt: row.lastCollectedAt?.toISOString() ?? null })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
