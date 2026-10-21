import { Inject, Injectable } from '@nestjs/common';
import { createPolicySearchSchema } from '@youth-kkultong/shared';
import type { PolicySearchResponse } from '@youth-kkultong/shared';
import { DataSource } from 'typeorm';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { JOB_OPTIONS, SCHOOL_OPTIONS } from '../../meta/eligibility-codes';
import { RegionRepository } from '../../meta/repositories/region.repository';
import { getKoreaToday } from '../application-status';
import { buildSearchCandidates } from '../policy-search-candidates';
import { buildPolicySearchResponse } from '../policy-search-response';
import { PolicyRepository } from '../repositories/policy.repository';

@Injectable()
export class PoliciesSearchService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(PolicyRepository) private readonly policyRepository: PolicyRepository,
    @Inject(RegionRepository) private readonly regionRepository: RegionRepository,
  ) {}

  /** 요청을 검증한 후 전체 후보의 필터·판정·정렬·페이지 분리를 실행한다. */
  async search(body: unknown): Promise<PolicySearchResponse> {
    const today = getKoreaToday(new Date());
    const manager = this.dataSource.manager;
    // 현행 지역 코드와 공식 부모 관계를 한 번 조회해 요청 검증과 모든 정책의 지역 판정에 재사용한다.
    const regionOptions = await this.regionRepository.findActive(manager);
    const activeRegions = new Map(regionOptions.map((region) => [region.code, region]));
    const schema = createPolicySearchSchema({
      regionCodes: new Set(activeRegions.keys()),
      jobCodes: new Set(JOB_OPTIONS.map(({ code }) => code)),
      schoolCodes: new Set(SCHOOL_OPTIONS.map(({ code }) => code)),
    });
    // 공통 검증기를 재사용
    const request = await new ZodValidationPipe(schema).transform(body);
    const candidates = await this.policyRepository.findCandidates(manager);
    const matched = buildSearchCandidates(candidates, request, today, activeRegions);
    return buildPolicySearchResponse(matched, request);
  }
}
