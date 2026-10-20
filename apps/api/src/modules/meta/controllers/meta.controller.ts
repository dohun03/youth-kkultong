import { Controller, Get, Inject } from '@nestjs/common';
import type { RegionOption } from '@youth-kkultong/shared';
import { DataSource } from 'typeorm';
import { RegionRepository } from '../repositories/region.repository';

/** 조건 선택에 필요한 메타 데이터 제공 API */
@Controller('meta')
export class MetaController {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(RegionRepository) private readonly regionRepository: RegionRepository,
  ) {}

  /** 현행 지역의 코드·이름·시도 그룹·직접 상위 관계 목록을 반환 */
  @Get('regions')
  getRegions(): Promise<RegionOption[]> {
    // 조회 오류는 공통 예외 필터가 처리
    return this.regionRepository.findActive(this.dataSource.manager);
  }
}
