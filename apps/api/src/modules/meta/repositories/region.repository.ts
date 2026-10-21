import { Injectable } from '@nestjs/common';
import type { RegionOption } from '@youth-kkultong/shared';
import type { EntityManager } from 'typeorm';
import { In } from 'typeorm';
import { Region } from '../entities/region.entity';

@Injectable()
export class RegionRepository {
  /** 정책 원문에 있는 지역 이름을 묶음 조회한다. 과거 정책 표시를 위해 폐지 지역도 포함한다. */
  async findByCodes(manager: EntityManager, codes: readonly string[]): Promise<Pick<Region, 'code' | 'name'>[]> {
    if (codes.length === 0) return [];
    return manager.getRepository(Region).find({
      select: { code: true, name: true }, where: { code: In([...new Set(codes)]) },
    });
  }

  /** 현행 지역 목록 조회 (폐지 지역 제외) */
  async findActive(manager: EntityManager): Promise<RegionOption[]> {
    // 부모 지역은 DB에 저장된 parentCode를 그대로 반환
    const regions = await manager.getRepository(Region).find({
      select: { code: true, name: true, provinceName: true, parentCode: true },
      where: { isActive: true },
      order: { code: 'ASC' },
    });
    // 엔티티 자체 대신 객체로 반환
    return regions.map(({ code, name, provinceName, parentCode }) => ({ code, name, provinceName, parentCode }));
  }
}
