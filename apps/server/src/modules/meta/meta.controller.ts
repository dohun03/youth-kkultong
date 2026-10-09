import { Controller, Get } from '@nestjs/common';
import type { PolicyCategory, UserStatus } from '@kkultong/contracts';
import { MetaService, type RegionOption } from './meta.service';

@Controller('meta')
export class MetaController {
  public constructor(private readonly metaService: MetaService) {}

  /** 시·도 선택 목록을 조회한다. */
  @Get('regions')
  public findRegions(): Promise<RegionOption[]> {
    return this.metaService.findRegions();
  }

  /** 정책 목록 필터에 표시할 카테고리 enum을 조회한다. */
  @Get('categories')
  public findCategories(): PolicyCategory[] {
    return this.metaService.findCategories();
  }

  /** 조건 검색에 표시할 사용자 상태 enum을 조회한다. */
  @Get('statuses')
  public findStatuses(): UserStatus[] {
    return this.metaService.findStatuses();
  }
}
