import 'reflect-metadata';
import { DataSource, getMetadataArgsStorage } from 'typeorm';
import { EntityMetadataBuilder } from 'typeorm/metadata-builder/EntityMetadataBuilder';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { PolicyReview } from '../src/modules/policies/entities/policy-review.entity';
import { SourcePolicy } from '../src/modules/policies/entities/source-policy.entity';

// DB에 접속하지 않고 실제 TypeORM이 읽는 컬럼·외래키·제약 정의를 조합한다.
const source = new DataSource({ type: 'postgres', entities: [Policy, SourcePolicy, PolicyReview] });
const definitions = new EntityMetadataBuilder(source, getMetadataArgsStorage()).build([Policy, SourcePolicy, PolicyReview]);
const original = definitions.find(({ target }) => target === SourcePolicy)!;
const review = definitions.find(({ target }) => target === PolicyReview)!;

describe('수집 원본·검수 엔티티의 명세 대조', () => {
  it('원본은 명세의 13개 컬럼만 정의하고 정규화된 공개 본문을 복제하지 않는다', () => {
    expect(original.tableName).toBe('source_policies');
    expect(original.columns.map((column) => [column.databaseName, column.type, column.length, column.isNullable])).toEqual([
      ['id', 'uuid', '', false], ['source', 'varchar', '32', false], ['external_id', 'varchar', '64', false],
      ['title', 'text', '', false], ['raw_json', 'jsonb', '', false], ['content_hash', 'char', '64', false],
      ['view_count', 'integer', '', true], ['first_collected_at', 'timestamptz', '', true],
      ['last_collected_at', 'timestamptz', '', true], ['last_collection_result', 'varchar', '16', true],
      ['missing_count', 'integer', '', false], ['created_at', 'timestamptz', '', false], ['updated_at', 'timestamptz', '', false],
    ]);
  });

  it('검수는 명세의 15개 컬럼으로 스냅샷·기준본·처리 정보를 구분한다', () => {
    expect(review.tableName).toBe('policy_reviews');
    expect(review.columns.map((column) => [column.databaseName, column.type, column.length, column.isNullable])).toEqual([
      ['id', 'uuid', '', false], ['source_policy_id', 'uuid', '', false], ['kind', 'varchar', '16', false],
      ['status', 'varchar', '16', false], ['content_hash', 'char', '64', false], ['raw_snapshot', 'jsonb', '', false],
      ['base_policy_id', 'uuid', '', true], ['base_content_hash', 'char', '64', true], ['base_raw_snapshot', 'jsonb', '', true],
      ['reviewed_by', 'varchar', '64', true], ['rejection_reason', 'varchar', '1000', true],
      ['superseded_reason', 'varchar', '32', true], ['created_at', 'timestamptz', '', false], ['closed_at', 'timestamptz', '', true],
    ]);
  });

  it('UUID는 자동 생성하고 원본 식별자는 출처·외부 ID 조합으로 유일하다', () => {
    for (const model of [original, review]) {
      expect(model.primaryColumns).toHaveLength(1);
      expect(model.primaryColumns[0]).toMatchObject({ propertyName: 'id', isGenerated: true, generationStrategy: 'uuid' });
    }
    expect(original.uniques.map(({ name, columns }) => [name, columns.map(({ databaseName }) => databaseName)]))
      .toEqual([['UQ_source_policies_source_external_id', ['source', 'external_id']]]);
    // 종료된 해시로 돌아온 새 후보를 막는 전체 UNIQUE를 추가하지 않는다.
    expect(review.uniques).toEqual([]);
  });

  it('이관 원본의 실제 수집 시각·결과에는 현재 시각이나 가짜 판정을 기본값으로 넣지 않는다', () => {
    for (const name of ['firstCollectedAt', 'lastCollectedAt', 'lastCollectionResult']) {
      const column = original.findColumnWithPropertyName(name)!;
      expect(column.isNullable).toBe(true);
      expect(column.default).toBeUndefined();
    }
    expect(original.findColumnWithPropertyName('missingCount')!.default).toBe(0);
    expect(review.findColumnWithPropertyName('status')!.default).toBe('PENDING');
    for (const name of ['reviewedBy', 'rejectionReason', 'supersededReason', 'closedAt']) {
      expect(review.findColumnWithPropertyName(name)!.default).toBeUndefined();
    }
  });

  it('행 생성·갱신 시각과 실제 수집·종료 시각을 별도로 관리한다', () => {
    expect(original.findColumnWithPropertyName('createdAt')!.isCreateDate).toBe(true);
    expect(original.findColumnWithPropertyName('updatedAt')!.isUpdateDate).toBe(true);
    expect(review.findColumnWithPropertyName('createdAt')!.isCreateDate).toBe(true);
    expect(review.findColumnWithPropertyName('closedAt')!.isUpdateDate).toBe(false);
    expect(review.updateDateColumn).toBeUndefined();
  });

  it('검수 원본은 필수 다대일, 과거 공개 기준본은 선택 다대일이며 모두 삭제를 제한한다', () => {
    expect(review.foreignKeys.map(({ name, columns, referencedEntityMetadata, referencedColumns, onDelete, onUpdate }) => ({
      name, columns: columns.map(({ databaseName }) => databaseName), table: referencedEntityMetadata.tableName,
      references: referencedColumns.map(({ databaseName }) => databaseName), onDelete, onUpdate,
    }))).toEqual([
      { name: 'FK_policy_reviews_source_policy_id', columns: ['source_policy_id'], table: 'source_policies', references: ['id'], onDelete: 'RESTRICT', onUpdate: 'NO ACTION' },
      { name: 'FK_policy_reviews_base_policy_id', columns: ['base_policy_id'], table: 'policies', references: ['id'], onDelete: 'RESTRICT', onUpdate: 'NO ACTION' },
    ]);
    expect(review.relations.map(({ propertyName, relationType, isNullable, isCascadeInsert, isCascadeUpdate, isCascadeRemove }) => ({
      propertyName, relationType, isNullable, isCascadeInsert, isCascadeUpdate, isCascadeRemove,
    }))).toEqual([
      { propertyName: 'sourcePolicy', relationType: 'many-to-one', isNullable: false, isCascadeInsert: false, isCascadeUpdate: false, isCascadeRemove: false },
      { propertyName: 'basePolicy', relationType: 'many-to-one', isNullable: true, isCascadeInsert: false, isCascadeUpdate: false, isCascadeRemove: false },
    ]);
    // 공개본과 최신 원본은 서로 다른 UUID이며 source/external_id로 대응한다. 새 FK는 만들지 않는다.
    expect(original.foreignKeys).toEqual([]);
    expect(definitions.find(({ target }) => target === Policy)!.foreignKeys).toEqual([]);
  });

  it('후보의 내용·기준 스냅샷은 일반 ORM 갱신에서 제외하고 상태·처리 정보는 갱신 가능하다', () => {
    for (const name of ['sourcePolicyId', 'kind', 'contentHash', 'rawSnapshot', 'basePolicyId', 'baseContentHash', 'baseRawSnapshot']) {
      expect(review.findColumnWithPropertyName(name)!.isUpdate).toBe(false);
    }
    for (const name of ['status', 'reviewedBy', 'rejectionReason', 'supersededReason', 'closedAt']) {
      expect(review.findColumnWithPropertyName(name)!.isUpdate).toBe(true);
    }
  });

  it('부분·DESC·대기 유일성 인덱스는 Migration 소유로 표시한다', () => {
    expect(original.indices.map(({ name, synchronize }) => [name, synchronize]))
      .toEqual([['IDX_source_policies_missing', false]]);
    expect(review.indices.map(({ name, synchronize }) => [name, synchronize]).sort()).toEqual([
      ['UQ_policy_reviews_pending', false], ['IDX_policy_reviews_processed', false],
      ['IDX_policy_reviews_status_created', false], ['IDX_policy_reviews_source_created', false],
      ['IDX_policy_reviews_rejected_hash', false],
    ].sort());
  });
});
