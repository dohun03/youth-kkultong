import { Inject, Injectable } from '@nestjs/common';
import type { CollectionResult } from '@youth-kkultong/shared';
import type { EntityManager } from 'typeorm';
import { ENVIRONMENT } from '../../../common/environment';
import type { Environment } from '../../../common/environment';
import { SourcePolicy } from '../entities/source-policy.entity';

/** 실제 수집된 원본과 수집 결과를 담는 저장 입력 타입 */
export type CollectedSourcePolicyInput = Pick<SourcePolicy,
  'source' | 'externalId' | 'title' | 'rawJson' | 'contentHash' | 'viewCount'
> & { lastCollectionResult: Exclude<CollectionResult, 'MISSING'> };

/** 누락 원본의 ID와 계산된 누락 횟수를 담는 저장 입력 타입 */
export type MissingSourcePolicyInput = Pick<SourcePolicy, 'id' | 'missingCount'>;

/** 전달받은 트랜잭션에서 SourcePolicy의 잠금 조회와 묶음 저장을 담당 */
@Injectable()
export class SourcePolicyRepository {
  constructor(@Inject(ENVIRONMENT) private readonly environment: Environment) {}

  /** 해당 출처의 원본 전체를 식별자 순서대로 잠그고 조회 */
  async findBySourceForUpdate(manager: EntityManager, source: string): Promise<SourcePolicy[]> {
    this.requireTransaction(manager);

    // 같은 출처의 원본을 순서대로 잠가 수집 저장과 관리자 검수의 처리 순서를 맞춤
    return manager.getRepository(SourcePolicy).createQueryBuilder('original')
      .where('original.source = :source', { source })
      .orderBy('original.source', 'ASC')
      .addOrderBy('original.externalId', 'ASC')
      .setLock('pessimistic_write')
      .getMany();
  }

  /** 이번에 수집된 원본을 묶음으로 추가 or 갱신 */
  async upsertCollectedPolicies(
    manager: EntityManager,
    policies: readonly CollectedSourcePolicyInput[],
    collectedAt: Date,
  ): Promise<void> {
    this.requireTransaction(manager);
    if (policies.length === 0) return;

    // (출처 + 외부 ID) 한쌍의 key로 사용해서 저장 중복 체크
    const keys = new Set<string>();
    for (const policy of policies) {
      const key = JSON.stringify([policy.source, policy.externalId]);
      if (keys.has(key)) throw new Error('저장할 수집 원본에 중복 식별자가 있습니다.');
      keys.add(key);
    }

    // 입력된 정책 배열을 복사 -> (출처 + 외부 ID) 순서로 정렬 -> 저장 순서를 고정
    const sortedPolicies = [...policies].sort((a, b) => {
      if (a.source !== b.source) return a.source < b.source ? -1 : 1;
      return a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0;
    });

    // 모든 데이터에 적용할 수집 시각
    const observedAt = collectedAt.toISOString();

    // 배치 단위로 나눠서 한번에 쿼리로 갱신
    const batchSize = this.environment.POLICY_IMPORT_BATCH_SIZE;

    for (let offset = 0; offset < sortedPolicies.length; offset += batchSize) {
      // 정렬해둔 정책 배열 배치 단위로 잘라서 담기
      const batch = sortedPolicies.slice(offset, offset + batchSize);

      // JSON 묶음을 DB의 행 목록으로 바꾸고 원문과 조회수, 수집 시각을 매개변수로 전달
      // 새 식별자는 원본을 추가하고, 기존 식별자는 최신 내용과 최근 수집 시각을 갱신
      // 첫 수집 시각은 비어 있을 때만 채우고 다시 수집된 원본의 누락 횟수는 0으로 초기화
      await manager.sql`
        INSERT INTO ${() => this.tableName(manager)} AS original
          (source, external_id, title, raw_json, content_hash, view_count,
           first_collected_at, last_collected_at, last_collection_result, missing_count)
        SELECT incoming.source, incoming."externalId", incoming.title, incoming."rawJson",
               incoming."contentHash", incoming."viewCount", ${observedAt}::timestamptz,
               ${observedAt}::timestamptz, incoming."lastCollectionResult", 0
        FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb)
          AS incoming(source text, "externalId" text, title text, "rawJson" jsonb,
                      "contentHash" text, "viewCount" integer, "lastCollectionResult" text)
        ORDER BY incoming.source, incoming."externalId"
        ON CONFLICT (source, external_id) DO UPDATE SET
          title = EXCLUDED.title, raw_json = EXCLUDED.raw_json, content_hash = EXCLUDED.content_hash,
          view_count = EXCLUDED.view_count,
          first_collected_at = COALESCE(original.first_collected_at, EXCLUDED.first_collected_at),
          last_collected_at = EXCLUDED.last_collected_at,
          last_collection_result = EXCLUDED.last_collection_result,
          missing_count = 0, updated_at = CURRENT_TIMESTAMP
      `;
    }
  }

  /** 누락 원본의 계산된 누락 횟수와 수집 결과를 묶음으로 갱신 */
  async updateMissingPolicies(manager: EntityManager, policies: readonly MissingSourcePolicyInput[]): Promise<void> {
    this.requireTransaction(manager);
    if (policies.length === 0) return;

    // 중복 갱신 예외 처리
    if (new Set(policies.map(({ id }) => id)).size !== policies.length) {
      throw new Error('저장할 누락 원본에 중복 ID가 있습니다.');
    }

    // 누락 목록을 배치 사이즈로 나눠 갱신
    const batchSize = this.environment.POLICY_IMPORT_BATCH_SIZE;

    for (let offset = 0; offset < policies.length; offset += batchSize) {
      const batch = policies.slice(offset, offset + batchSize);

      // 원본 ID로 대상을 찾아 누락 횟수와 MISSING 결과, DB 반영 시각을 갱신
      await manager.sql`
        UPDATE ${() => this.tableName(manager)} AS original
        SET missing_count = incoming."missingCount", last_collection_result = 'MISSING',
            updated_at = CURRENT_TIMESTAMP
        FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS incoming(id uuid, "missingCount" integer)
        WHERE original.id = incoming.id
      `;
    }
  }

  /** 전달받은 DB 매니저가 진행 중인 트랜잭션에 연결되어 있는지 확인 */
  private requireTransaction(manager: EntityManager): void {
    if (!manager.queryRunner?.isTransactionActive) {
      throw new Error('수집 원본 조회·저장에는 진행 중인 트랜잭션 관리자가 필요합니다.');
    }
  }

  /** 현재 연결의 스키마와 테이블 이름을 SQL 식별자로 변환 */
  private tableName(manager: EntityManager): string {
    const { schema, tableName } = manager.getRepository(SourcePolicy).metadata;
    return [schema, tableName].filter((name): name is string => Boolean(name))
      .map((name) => manager.dataSource.driver.escape(name)).join('.');
  }
}
