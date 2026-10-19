import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { Policy } from './entities/policy.entity';
import type { PolicyRefreshInput, PolicyWriteInput } from './policies-write.service';

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

  /** 신규 정책 추가, 변경 정책 갱신 */
  async upsertPolicies(manager: EntityManager, policies: readonly PolicyWriteInput[]): Promise<void> {
    if (policies.length === 0) return;

    const repository = manager.getRepository(Policy);
    const query = repository.createQueryBuilder().insert();
    const rows = policies.map((policy, index) => {
      const registered = `registered${index}`;
      const modified = `modified${index}`;
      const raw = `raw${index}`;

      // 원본 시각은 Date 변환 없이 전달하고 JSON도 매개변수로 바인딩
      query.setParameters({
        [registered]: policy.sourceRegisteredAt,
        [modified]: policy.sourceModifiedAt,
        [raw]: JSON.stringify(policy.rawJson),
      });

      return {
        ...policy,
        sourceRegisteredAt: () => `CAST(:${registered} AS timestamp)`,
        sourceModifiedAt: () => `CAST(:${modified} AS timestamp)`,
        rawJson: () => `CAST(:${raw} AS jsonb)`,
      };
    });

    // 기존 정책의 ID·출처·외부 ID·최초 저장일은 유지
    const updates = repository.metadata.columns
      .filter((column) => !column.isGenerated && !column.isCreateDate && !column.isUpdateDate
        && !['source', 'externalId'].includes(column.propertyName))
      .map((column) => column.databaseName);

    // SQL 생성·컬럼 이름 처리·매개변수 번호 지정은 TypeORM에 맡김
    await query.values(rows).orUpdate(updates, ['source', 'external_id']).updateEntity(false).execute();
  }

  /** 내용이 같은 정책들의 원본 JSON·조회수·마지막 반영일만 한 번에 갱신 */
  async refreshPolicies(manager: EntityManager, policies: readonly PolicyRefreshInput[]): Promise<void> {
    if (policies.length === 0) return;

    // JSON 배열을 DB에서 행 목록으로 바꿔 서로 다른 원본·조회수를 한 번에 갱신
    // 테이블명은 내부 정의에서 가져오고, 정책 값은 sql 태그가 자동으로 바인딩
    await manager.sql`
      UPDATE ${() => this.tableName(manager)} AS policy
      SET raw_json = incoming."rawJson", view_count = incoming."viewCount", updated_at = CURRENT_TIMESTAMP
      FROM jsonb_to_recordset(${JSON.stringify(policies)}::jsonb)
        AS incoming(source text, "externalId" text, "rawJson" jsonb, "viewCount" integer)
      WHERE policy.source = incoming.source AND policy.external_id = incoming."externalId"
    `;
  }

  /** 현재 연결에서 사용하는 정책 테이블의 스키마·이름 가져오기 */
  private tableName(manager: EntityManager): string {
    const { schema, tableName } = manager.getRepository(Policy).metadata;
    return [schema, tableName].filter((name): name is string => Boolean(name))
      .map((name) => manager.dataSource.driver.escape(name)).join('.');
  }
}
