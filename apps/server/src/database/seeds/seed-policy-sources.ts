import type { EntityManager } from 'typeorm';
import { PolicySourceEntity } from '../../modules/policies/entities/policy-source.entity';

const MANUAL_POLICY_SOURCE = {
  code: 'MANUAL',
  name: '수동 등록',
  type: 'MANUAL' as const,
  enabled: true,
  baseUrl: null,
};

export async function seedPolicySources(manager: EntityManager): Promise<void> {
  await manager.upsert(PolicySourceEntity, MANUAL_POLICY_SOURCE, ['code']);
}
