import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { JsonValue, ReviewKind, ReviewStatus, SupersededReason } from '@youth-kkultong/shared';
import { Policy } from './policy.entity';
import { SourcePolicy } from './source-policy.entity';

/** 특정 변경본과 당시 공개 기준본을 보존하고 검수 결과·처리 이력을 기록한다. */
@Entity('policy_reviews')
@Check('CHK_policy_reviews_content_hash', `"content_hash" ~ '^[0-9a-f]{64}$'`)
@Check('CHK_policy_reviews_raw_snapshot', `jsonb_typeof("raw_snapshot") = 'object'`)
@Check('CHK_policy_reviews_base_content_hash', `"base_content_hash" IS NULL OR "base_content_hash" ~ '^[0-9a-f]{64}$'`)
@Check('CHK_policy_reviews_base_raw_snapshot', `"base_raw_snapshot" IS NULL OR jsonb_typeof("base_raw_snapshot") = 'object'`)
// 신규에는 기준본이 없고, 변경에는 기준 ID·해시·원본 세 값이 모두 있어야 한다.
@Check('CHK_policy_reviews_kind_base', `
  ("kind" = 'NEW' AND "base_policy_id" IS NULL AND "base_content_hash" IS NULL AND "base_raw_snapshot" IS NULL)
  OR ("kind" = 'CHANGED' AND "base_policy_id" IS NOT NULL AND "base_content_hash" IS NOT NULL AND "base_raw_snapshot" IS NOT NULL)
`)
@Check('CHK_policy_reviews_superseded_reason', `"superseded_reason" IS NULL OR "superseded_reason" IN ('SOURCE_CHANGED', 'PUBLIC_BASE_CHANGED', 'MATCHES_PUBLIC', 'PREVIOUSLY_REJECTED')`)
// SQL CHECK는 NULL 결과도 통과시키므로, 필수 처리 정보에는 IS NOT NULL을 명시한다.
@Check('CHK_policy_reviews_status_fields', `
  ("status" = 'PENDING' AND "reviewed_by" IS NULL AND "rejection_reason" IS NULL AND "superseded_reason" IS NULL AND "closed_at" IS NULL)
  OR ("status" = 'APPROVED' AND "reviewed_by" IS NOT NULL AND "rejection_reason" IS NULL AND "superseded_reason" IS NULL AND "closed_at" IS NOT NULL)
  OR ("status" = 'REJECTED' AND "reviewed_by" IS NOT NULL AND "rejection_reason" IS NOT NULL AND "rejection_reason" ~ '[^[:space:]]' AND "superseded_reason" IS NULL AND "closed_at" IS NOT NULL)
  OR ("status" = 'SUPERSEDED' AND "reviewed_by" IS NULL AND "rejection_reason" IS NULL AND "superseded_reason" IS NOT NULL AND "closed_at" IS NOT NULL)
`)
// 아래 인덱스는 모두 Step 4 Migration SQL에서 생성한다. DESC·부분 조건을 ORM이 다시 만들지 않게 한다.
// UNIQUE (source_policy_id) WHERE status = 'PENDING': 원본 하나의 대기는 최대 한 건.
@Index('UQ_policy_reviews_pending', { synchronize: false })
// (closed_at DESC, id ASC) WHERE status <> 'PENDING': 처리 완료 목록.
@Index('IDX_policy_reviews_processed', { synchronize: false })
// (status, created_at DESC, id ASC): 상태별 목록.
@Index('IDX_policy_reviews_status_created', { synchronize: false })
// (source_policy_id, created_at DESC, id ASC): 같은 원본의 전체 이력.
@Index('IDX_policy_reviews_source_created', { synchronize: false })
// (source_policy_id, content_hash) WHERE status = 'REJECTED': 거절했던 내용 확인. 전체 UNIQUE는 금지한다.
@Index('IDX_policy_reviews_rejected_hash', { synchronize: false })
export class PolicyReview {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_policy_reviews' })
  id!: string;

  @Column({ name: 'source_policy_id', type: 'uuid', update: false })
  sourcePolicyId!: string;

  // 원본 한 건에 여러 검수 이력이 연결된다. 삭제 전파·관계 자동 저장은 사용하지 않는다.
  @ManyToOne(() => SourcePolicy, { nullable: false, onDelete: 'RESTRICT', onUpdate: 'NO ACTION' })
  @JoinColumn({ name: 'source_policy_id', referencedColumnName: 'id', foreignKeyConstraintName: 'FK_policy_reviews_source_policy_id' })
  sourcePolicy?: SourcePolicy;

  // 후보 내용은 일반 ORM 갱신에서 제외한다. 처리 시에는 아래의 상태·처리 정보만 갱신한다.
  @Column({ type: 'varchar', length: 16, update: false })
  kind!: ReviewKind;

  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  status!: ReviewStatus;

  @Column({ name: 'content_hash', type: 'char', length: 64, update: false })
  contentHash!: string;

  @Column({ name: 'raw_snapshot', type: 'jsonb', update: false })
  rawSnapshot!: Record<string, JsonValue>;

  @Column({ name: 'base_policy_id', type: 'uuid', nullable: true, update: false })
  basePolicyId!: string | null;

  // 기준본은 과거 공개본이다. 이후 공개 내용이 바뀌어도 아래 스냅샷은 그대로 남긴다.
  @ManyToOne(() => Policy, { nullable: true, onDelete: 'RESTRICT', onUpdate: 'NO ACTION' })
  @JoinColumn({ name: 'base_policy_id', referencedColumnName: 'id', foreignKeyConstraintName: 'FK_policy_reviews_base_policy_id' })
  basePolicy?: Policy | null;

  @Column({ name: 'base_content_hash', type: 'char', length: 64, nullable: true, update: false })
  baseContentHash!: string | null;

  @Column({ name: 'base_raw_snapshot', type: 'jsonb', nullable: true, update: false })
  baseRawSnapshot!: Record<string, JsonValue> | null;

  @Column({ name: 'reviewed_by', type: 'varchar', length: 64, nullable: true })
  reviewedBy!: string | null;

  @Column({ name: 'rejection_reason', type: 'varchar', length: 1000, nullable: true })
  rejectionReason!: string | null;

  @Column({ name: 'superseded_reason', type: 'varchar', length: 32, nullable: true })
  supersededReason!: SupersededReason | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;
}
