import type { EntityManager } from 'typeorm';
import { RegionEntity } from '../../modules/meta/entities/region.entity';

const SIDO_LEVEL = 1;
const SIGUNGU_LEVEL = 2;

export interface RegionSeedData {
  code: string;
  parentCode: string | null;
  level: number;
  name: string;
}

export async function seedRegions(
  manager: EntityManager,
  regions: readonly RegionSeedData[],
): Promise<void> {
  const sidoRegions = regions.filter((region) => region.level === SIDO_LEVEL);
  const sigunguRegions = regions.filter((region) => region.level === SIGUNGU_LEVEL);

  // self FK를 안전하게 만족시키기 위해 상위 지역을 먼저 저장한다.
  await manager.upsert(RegionEntity, sidoRegions, ['code']);
  await manager.upsert(RegionEntity, sigunguRegions, ['code']);
}
