import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import type { CollectionResult, JsonValue } from '@youth-kkultong/shared';

/** 공개 여부와 별개로 정책별 최신 수집 원본·실제 수집 시각·연속 누락 횟수를 보관한다. */
@Entity('source_policies')
@Unique('UQ_source_policies_source_external_id', ['source', 'externalId'])
@Check('CHK_source_policies_source', `"source" ~ '[^[:space:]]'`)
@Check('CHK_source_policies_external_id', `"external_id" ~ '[^[:space:]]'`)
@Check('CHK_source_policies_title', `"title" ~ '[^[:space:]]'`)
@Check('CHK_source_policies_raw_json', `jsonb_typeof("raw_json") = 'object'`)
@Check('CHK_source_policies_content_hash', `"content_hash" ~ '^[0-9a-f]{64}$'`)
@Check('CHK_source_policies_view_count', `"view_count" IS NULL OR "view_count" >= 0`)
@Check('CHK_source_policies_missing_count', `"missing_count" >= 0`)
@Check('CHK_source_policies_collection_result', `"last_collection_result" IS NULL OR "last_collection_result" IN ('NEW', 'CHANGED', 'UNCHANGED', 'MISSING')`)
// 누락 목록: (missing_count DESC, id ASC) WHERE missing_count > 0.
// 부분·DESC 인덱스는 Step 4 Migration SQL에서 만들고 ORM 자동 변경에서는 제외한다.
@Index('IDX_source_policies_missing', { synchronize: false })
export class SourcePolicy {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_source_policies' })
  id!: string;

  // 공개 policies와는 UUID가 아닌 이 두 식별자로 대응한다. 미승인 신규는 공개본이 없을 수 있다.
  @Column({ type: 'varchar', length: 32 })
  source!: string;

  @Column({ name: 'external_id', type: 'varchar', length: 64 })
  externalId!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ name: 'raw_json', type: 'jsonb' })
  rawJson!: Record<string, JsonValue>;

  @Column({ name: 'content_hash', type: 'char', length: 64 })
  contentHash!: string;

  @Column({ name: 'view_count', type: 'integer', nullable: true })
  viewCount!: number | null;

  // 이관 시각을 실제 수집 시각으로 쓰지 않는다. 이관 후 아직 관찰하지 않은 원본은 NULL이다.
  @Column({ name: 'first_collected_at', type: 'timestamptz', nullable: true })
  firstCollectedAt!: Date | null;

  @Column({ name: 'last_collected_at', type: 'timestamptz', nullable: true })
  lastCollectedAt!: Date | null;

  @Column({ name: 'last_collection_result', type: 'varchar', length: 16, nullable: true })
  lastCollectionResult!: CollectionResult | null;

  // 정상 전체 수집에서 빠진 횟수다. 실패한 실행과 날짜 변경만으로는 늘리지 않는다.
  @Column({ name: 'missing_count', type: 'integer', default: 0 })
  missingCount!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
