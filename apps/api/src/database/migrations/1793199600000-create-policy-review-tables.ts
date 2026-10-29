import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createYouthCenterPolicyContentHash } from '../../modules/ingestion/youth-center/youth-center-policy.hash';
import type { YouthCenterRawPolicy } from '../../modules/ingestion/youth-center/youth-center-response.schema';

/** 최신 원본·검수 테이블을 생성하고 기존 공개 정책을 초기 원본으로 복사한다. */
export class CreatePolicyReviewTables1793199600000 implements MigrationInterface {
  /** 하나의 트랜잭션에서 기존 데이터 검증·테이블 생성·초기 원본 복사를 실행한다. */
  async up(queryRunner: QueryRunner): Promise<void> {
    // 트랜잭션 시작 여부를 확인
    if (!queryRunner.isTransactionActive) throw new Error('원본·검수 이관은 트랜잭션 안에서만 실행할 수 있습니다.');

    // 대상 스키마 확인: pgsql의 기본 스키마는 "public" 이다.
    const dataSource = queryRunner.dataSource;
    const options = dataSource.options;
    const schema = dataSource.driver.escape('schema' in options && options.schema ? options.schema : 'public');

    // 검증부터 복사 완료까지 해당 스키마의 기존 정책의 추가/수정/삭제 락을 건다.
    await queryRunner.query(`LOCK TABLE ${schema}."policies" IN SHARE MODE`);

    // 출처·외부 ID가 같은 정책이 여러 건 저장되어 있는지 검사한다.
    const duplicates: unknown[] = await queryRunner.query(`
      SELECT 1 FROM ${schema}."policies" GROUP BY "source", "external_id" HAVING count(*) > 1 LIMIT 1
    `);
    if (duplicates.length > 0) throw new Error('기존 정책 식별자가 중복되어 원본 이관을 중단했습니다.');

    // 원본이 JSON 객체인지 확인하고 해시를 다시 계산해 저장된 값과 비교
    const policies: { raw_json: YouthCenterRawPolicy; content_hash: string }[] = await queryRunner.query(
      `SELECT "raw_json", "content_hash" FROM ${schema}."policies"`,
    );
    for (const policy of policies) {
      const raw = policy.raw_json;
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('기존 정책 원본이 JSON 객체가 아니어서 원본 이관을 중단했습니다.');
      }
      if (createYouthCenterPolicyContentHash(raw) !== policy.content_hash) {
        throw new Error('기존 정책 원본과 내용 해시가 일치하지 않아 원본 이관을 중단했습니다.');
      }
    }

    // 최신 원본과 수집 시각·누락 정보를 담을 테이블 및 값 검증 제약을 생성
    await queryRunner.query(`
      CREATE TABLE ${schema}."source_policies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "source" varchar(32) NOT NULL,
        "external_id" varchar(64) NOT NULL,
        "title" text NOT NULL,
        "raw_json" jsonb NOT NULL,
        "content_hash" char(64) NOT NULL,
        "view_count" integer,
        "first_collected_at" timestamptz,
        "last_collected_at" timestamptz,
        "last_collection_result" varchar(16),
        "missing_count" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_source_policies" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_source_policies_source_external_id" UNIQUE ("source", "external_id"),
        CONSTRAINT "CHK_source_policies_source" CHECK ("source" ~ '[^[:space:]]'),
        CONSTRAINT "CHK_source_policies_external_id" CHECK ("external_id" ~ '[^[:space:]]'),
        CONSTRAINT "CHK_source_policies_title" CHECK ("title" ~ '[^[:space:]]'),
        CONSTRAINT "CHK_source_policies_raw_json" CHECK (jsonb_typeof("raw_json") = 'object'),
        CONSTRAINT "CHK_source_policies_content_hash" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "CHK_source_policies_view_count" CHECK ("view_count" IS NULL OR "view_count" >= 0),
        CONSTRAINT "CHK_source_policies_missing_count" CHECK ("missing_count" >= 0),
        CONSTRAINT "CHK_source_policies_collection_result" CHECK ("last_collection_result" IS NULL OR "last_collection_result" IN ('NEW', 'CHANGED', 'UNCHANGED', 'MISSING'))
      )
    `);
    // 검수 스냅샷·처리 이력 테이블과 원본·공개본을 참조하는 외래키를 생성
    await queryRunner.query(`
      CREATE TABLE ${schema}."policy_reviews" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "source_policy_id" uuid NOT NULL,
        "kind" varchar(16) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'PENDING',
        "content_hash" char(64) NOT NULL,
        "raw_snapshot" jsonb NOT NULL,
        "base_policy_id" uuid,
        "base_content_hash" char(64),
        "base_raw_snapshot" jsonb,
        "reviewed_by" varchar(64),
        "rejection_reason" varchar(1000),
        "superseded_reason" varchar(32),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "closed_at" timestamptz,
        CONSTRAINT "PK_policy_reviews" PRIMARY KEY ("id"),
        CONSTRAINT "FK_policy_reviews_source_policy_id" FOREIGN KEY ("source_policy_id")
          REFERENCES ${schema}."source_policies" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_policy_reviews_base_policy_id" FOREIGN KEY ("base_policy_id")
          REFERENCES ${schema}."policies" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "CHK_policy_reviews_content_hash" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "CHK_policy_reviews_raw_snapshot" CHECK (jsonb_typeof("raw_snapshot") = 'object'),
        CONSTRAINT "CHK_policy_reviews_base_content_hash" CHECK ("base_content_hash" IS NULL OR "base_content_hash" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "CHK_policy_reviews_base_raw_snapshot" CHECK ("base_raw_snapshot" IS NULL OR jsonb_typeof("base_raw_snapshot") = 'object'),
        CONSTRAINT "CHK_policy_reviews_kind_base" CHECK (
          ("kind" = 'NEW' AND "base_policy_id" IS NULL AND "base_content_hash" IS NULL AND "base_raw_snapshot" IS NULL)
          OR ("kind" = 'CHANGED' AND "base_policy_id" IS NOT NULL AND "base_content_hash" IS NOT NULL AND "base_raw_snapshot" IS NOT NULL)
        ),
        CONSTRAINT "CHK_policy_reviews_superseded_reason" CHECK ("superseded_reason" IS NULL OR "superseded_reason" IN ('SOURCE_CHANGED', 'PUBLIC_BASE_CHANGED', 'MATCHES_PUBLIC', 'PREVIOUSLY_REJECTED')),
        CONSTRAINT "CHK_policy_reviews_status_fields" CHECK (
          ("status" = 'PENDING' AND "reviewed_by" IS NULL AND "rejection_reason" IS NULL AND "superseded_reason" IS NULL AND "closed_at" IS NULL)
          OR ("status" = 'APPROVED' AND "reviewed_by" IS NOT NULL AND "rejection_reason" IS NULL AND "superseded_reason" IS NULL AND "closed_at" IS NOT NULL)
          OR ("status" = 'REJECTED' AND "reviewed_by" IS NOT NULL AND "rejection_reason" IS NOT NULL AND "rejection_reason" ~ '[^[:space:]]' AND "superseded_reason" IS NULL AND "closed_at" IS NOT NULL)
          OR ("status" = 'SUPERSEDED' AND "reviewed_by" IS NULL AND "rejection_reason" IS NULL AND "superseded_reason" IS NOT NULL AND "closed_at" IS NOT NULL)
        )
      )
    `);

    // 누락·검수 목록 조회를 위한 인덱스, 원본당 대기 한 건을 보장하는 유일 인덱스를 생성
    await queryRunner.query(`CREATE INDEX "IDX_source_policies_missing" ON ${schema}."source_policies" ("missing_count" DESC, "id" ASC) WHERE "missing_count" > 0`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_policy_reviews_pending" ON ${schema}."policy_reviews" ("source_policy_id") WHERE "status" = 'PENDING'`);
    await queryRunner.query(`CREATE INDEX "IDX_policy_reviews_processed" ON ${schema}."policy_reviews" ("closed_at" DESC, "id" ASC) WHERE "status" <> 'PENDING'`);
    await queryRunner.query(`CREATE INDEX "IDX_policy_reviews_status_created" ON ${schema}."policy_reviews" ("status", "created_at" DESC, "id" ASC)`);
    await queryRunner.query(`CREATE INDEX "IDX_policy_reviews_source_created" ON ${schema}."policy_reviews" ("source_policy_id", "created_at" DESC, "id" ASC)`);
    await queryRunner.query(`CREATE INDEX "IDX_policy_reviews_rejected_hash" ON ${schema}."policy_reviews" ("source_policy_id", "content_hash") WHERE "status" = 'REJECTED'`);

    // 공개 정책의 여섯 필드를 초기 원본으로 복사한다. 나머지 컬럼은 테이블의 기본값을 적용한다.
    await queryRunner.query(`
      INSERT INTO ${schema}."source_policies" ("source", "external_id", "title", "raw_json", "content_hash", "view_count")
      SELECT "source", "external_id", "title", "raw_json", "content_hash", "view_count"
      FROM ${schema}."policies"
    `);
  }

  /** 역이관 요청을 오류로 중단하고 백업 복원 절차를 안내한다. */
  async down(): Promise<void> {
    throw new Error('원본·검수 이력을 삭제하는 역이관은 제공하지 않습니다. 백업 복원 절차를 사용하세요.');
  }
}
