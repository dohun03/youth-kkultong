import { Injectable } from '@nestjs/common';
import { POLICY_CATEGORIES, USER_STATUSES, type PolicyCategory, type UserStatus } from '@kkultong/contracts';
import { DataSource } from 'typeorm';
import { RegionEntity } from './entities/region.entity';

/**
 * 검색 UI에서 선택할 수 있는 시·도 행정구역의 최소 정보다.
 */
export interface RegionOption {
  code: string;
  name: string;
}

@Injectable()
export class MetaService {
  public constructor(private readonly dataSource: DataSource) {}

  /**
   * MVP1 초기 지역 선택 UI에 필요한 활성 시·도만 행정 코드 순서로 조회한다.
   * 시·군·구는 다음 단계의 상세 지역 입력이 필요해질 때까지 응답에 포함하지 않는다.
   */
  public async findRegions(): Promise<RegionOption[]> {
    return this.dataSource.getRepository(RegionEntity).find({
      select: {
        code: true,
        name: true,
      },
      where: {
        active: true,
        level: 1,
      },
      order: {
        code: 'ASC',
      },
    });
  }

  /** 정책 목록 필터가 사용할 공유 카테고리 enum을 반환한다. */
  public findCategories(): PolicyCategory[] {
    return [...POLICY_CATEGORIES];
  }

  /** 사용자 상태 조건 입력이 사용할 공유 상태 enum을 반환한다. */
  public findStatuses(): UserStatus[] {
    return [...USER_STATUSES];
  }
}
