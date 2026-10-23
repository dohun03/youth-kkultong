import { Controller, Get, Inject } from '@nestjs/common';
import type { EligibilityCodesResponse, RegionOption } from '@youth-kkultong/shared';
import { DataSource } from 'typeorm';
import { PolicyRepository } from '../../policies/repositories/policy.repository';
import { JOB_OPTIONS, SCHOOL_OPTIONS } from '../eligibility-codes';
import { RegionRepository } from '../repositories/region.repository';

/** 조건 선택에 필요한 메타 데이터 제공 API */
@Controller('meta')
export class MetaController {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(RegionRepository) private readonly regionRepository: RegionRepository,
    @Inject(PolicyRepository) private readonly policyRepository: PolicyRepository,
  ) {}

  /** 현행 지역의 관계 목록을 반환 */
  @Get('regions')
  getRegions(): Promise<RegionOption[]> {
    return this.regionRepository.findActive(this.dataSource.manager);
  }

  /** 복수·반복 분야를 정리한 분야 선택지를 반환 */
  @Get('categories')
  getCategories(): Promise<string[]> {
    return this.policyRepository.findCategories(this.dataSource.manager);
  }

  /** 검증된 서버 코드표의 취업·학력 선택지를 DB 조회 없이 반환 */
  @Get('eligibility-codes')
  getEligibilityCodes(): EligibilityCodesResponse {
    return { jobCodes: JOB_OPTIONS, schoolCodes: SCHOOL_OPTIONS };
  }
}
