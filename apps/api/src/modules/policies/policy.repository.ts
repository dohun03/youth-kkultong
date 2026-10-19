import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { Policy } from './entities/policy.entity';

/** 정책 테이블 조회 */
@Injectable()
export class PolicyRepository {
  /** 정책 해시 조회 */
  async findContentHashes(
    manager: EntityManager,
    keys: readonly Pick<Policy, 'source' | 'externalId'>[],
  ): Promise<Pick<Policy, 'source' | 'externalId' | 'contentHash'>[]> {
    if (keys.length === 0) return [];

    // 변경 여부 비교에 필요한 출처·외부 ID·해시만 가져오기
    return manager.getRepository(Policy).find({
      select: { source: true, externalId: true, contentHash: true },
      where: keys.map(({ source, externalId }) => ({ source, externalId })),
    });
  }
}
