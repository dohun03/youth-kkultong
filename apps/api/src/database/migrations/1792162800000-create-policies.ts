import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePolicies1792162800000 implements MigrationInterface {
  /** 원본 보존용 컬럼과 조회용 컬럼을 명세대로 함께 생성한다. */
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "policies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "source" varchar(32) NOT NULL,
        "external_id" varchar(64) NOT NULL,
        "title" text NOT NULL,
        "category" varchar(100),
        "subcategory" varchar(100),
        "description" text,
        "benefit_text" text,
        "apply_url" text,
        "reference_url_1" text,
        "reference_url_2" text,
        "view_count" integer,
        "source_registered_at" timestamp,
        "source_modified_at" timestamp,
        "application_period_code" varchar(20),
        "application_period_raw" text,
        "application_start_date" date,
        "application_end_date" date,
        "age_min" integer,
        "age_max" integer,
        "job_codes" text[],
        "school_codes" text[],
        "region_codes" text[],
        "extra_qualification" text,
        "participation_restriction" text,
        "raw_json" jsonb NOT NULL,
        "content_hash" char(64) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_policies" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_policies_source_external_id" UNIQUE ("source", "external_id")
      )
    `);
    await queryRunner.query('CREATE INDEX "IDX_policies_category" ON "policies" ("category")');
    await queryRunner.query('CREATE INDEX "IDX_policies_view_count" ON "policies" ("view_count" DESC)');
    await queryRunner.query('CREATE INDEX "IDX_policies_source_registered_at" ON "policies" ("source_registered_at" DESC)');
  }

  /** 정책 테이블을 되돌리면 해당 테이블의 제약조건·인덱스도 함께 제거된다. */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "policies"');
  }
}
