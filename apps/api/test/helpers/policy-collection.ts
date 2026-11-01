import type { DataSource } from 'typeorm';
import type { Environment } from '../../src/common/environment';
import { Policy } from '../../src/modules/policies/entities/policy.entity';
import { SourcePolicy } from '../../src/modules/policies/entities/source-policy.entity';
import { PolicyReview } from '../../src/modules/policies/entities/policy-review.entity';
import { PolicyRepository } from '../../src/modules/policies/repositories/policy.repository';
import { SourcePolicyRepository } from '../../src/modules/policies/repositories/source-policy.repository';
import { PolicyReviewRepository } from '../../src/modules/policies/repositories/policy-review.repository';
import { PolicyReviewsWriteService } from '../../src/modules/policies/services/policy-reviews-write.service';
import { PolicyCollectionWriteService } from '../../src/modules/policies/services/policy-collection-write.service';
import { createYouthCenterPolicyContentHash } from '../../src/modules/ingestion/youth-center/youth-center-policy.hash';
import { transformYouthCenterPolicy } from '../../src/modules/ingestion/youth-center/youth-center-policy.transform';
import type { YouthCenterRawPolicy } from '../../src/modules/ingestion/youth-center/youth-center-response.schema';

/** 같은 설정과 저장소를 사용하는 실제 수집 저장 서비스를 테스트에 연결 */
export function createCollectionWriter(environment: Environment, policies = new PolicyRepository()): PolicyCollectionWriteService {
  const reviews = new PolicyReviewRepository(environment);
  return new PolicyCollectionWriteService(new SourcePolicyRepository(environment), policies, reviews,
    new PolicyReviewsWriteService(reviews), environment);
}

/** 임시 스키마의 원본과 검수 및 공개 행을 외래키 순서로 정리 */
export async function clearPolicyTables(connection: DataSource): Promise<void> {
  const schema = connection.getRepository(Policy).metadata.schema;
  if (!schema || !/(test_|mvp2_step|step27_cli_)/.test(schema)) throw new Error('테스트 전용 스키마가 필요합니다.');
  await connection.getRepository(PolicyReview).deleteAll();
  await connection.getRepository(SourcePolicy).deleteAll();
  await connection.getRepository(Policy).deleteAll();
}

/** 실제 해시를 가진 공개본을 저장하고 이관 직후의 수집 시각 NULL 원본을 복사 */
export async function seedMigratedPolicies(connection: DataSource, raw: readonly YouthCenterRawPolicy[]): Promise<void> {
  const schema = connection.getRepository(Policy).metadata.schema;
  if (!schema || !/(test_|mvp2_step|step27_cli_)/.test(schema)) throw new Error('테스트 전용 스키마가 필요합니다.');
  const escaped = connection.driver.escape(schema);
  await connection.transaction(async (manager) => {
    await new PolicyRepository().upsertPolicies(manager, raw.map((value) => ({
      ...transformYouthCenterPolicy(value), contentHash: createYouthCenterPolicyContentHash(value),
    })));
    await manager.query(`INSERT INTO ${escaped}.source_policies
      (source, external_id, title, raw_json, content_hash, view_count)
      SELECT source, external_id, title, raw_json, content_hash, view_count FROM ${escaped}.policies
      ON CONFLICT (source, external_id) DO NOTHING`);
  });
}
