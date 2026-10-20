import { Injectable } from '@nestjs/common';
import type { RegionOption } from '@youth-kkultong/shared';
import type { EntityManager } from 'typeorm';
import { Region } from './entities/region.entity';

@Injectable()
export class RegionRepository {
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
