import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Mvp0CorePolicy1760000000000 implements MigrationInterface {
  name = 'Mvp0CorePolicy1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    await queryRunner.query(`
      CREATE TABLE regions (
        code text PRIMARY KEY,
        parent_code text REFERENCES regions(code),
        level smallint NOT NULL CHECK (level IN (1, 2)),
        name text NOT NULL,
        active boolean NOT NULL DEFAULT true
      )
    `);
    await queryRunner.query('CREATE INDEX idx_regions_parent ON regions(parent_code)');

    await queryRunner.query(`
      CREATE TABLE median_income_table (
        year smallint NOT NULL,
        household_size smallint NOT NULL CHECK (household_size >= 1),
        amount bigint NOT NULL CHECK (amount > 0),
        PRIMARY KEY (year, household_size)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE policy_sources (
        id smallserial PRIMARY KEY,
        code text NOT NULL UNIQUE,
        name text NOT NULL,
        type text NOT NULL CHECK (type IN ('MANUAL', 'API')),
        enabled boolean NOT NULL DEFAULT true,
        base_url text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE policies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source_id smallint REFERENCES policy_sources(id),
        external_id text,
        title varchar(200) NOT NULL,
        agency varchar(120) NOT NULL,
        category text NOT NULL CHECK (category IN (
          'HOUSING', 'FINANCE', 'JOB', 'EDUCATION', 'WELFARE', 'ETC'
        )),
        benefit_summary varchar(300) NOT NULL,
        benefit_amount jsonb NOT NULL,
        conditions jsonb NOT NULL,
        has_unresolved_eligibility_condition boolean NOT NULL,
        unresolved_condition_note text,
        required_docs text[] NOT NULL DEFAULT '{}',
        apply_start date,
        apply_end date,
        is_always_open boolean NOT NULL DEFAULT false,
        official_url text NOT NULL,
        source_status text NOT NULL DEFAULT 'ACTIVE' CHECK (source_status IN (
          'ACTIVE', 'NOT_SEEN', 'CLOSED'
        )),
        is_published boolean NOT NULL DEFAULT false,
        last_verified_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (source_id, external_id),
        CHECK (
          apply_start IS NULL
          OR apply_end IS NULL
          OR apply_start <= apply_end
        ),
        CHECK (NOT is_always_open OR apply_end IS NULL),
        CHECK (
          NOT has_unresolved_eligibility_condition
          OR (
            unresolved_condition_note IS NOT NULL
            AND btrim(unresolved_condition_note) <> ''
          )
        ),
        CHECK (official_url ~ '^https?://')
      )
    `);
    await queryRunner.query(
      'CREATE INDEX idx_policies_active ON policies(is_published, source_status, apply_end)',
    );
    await queryRunner.query('CREATE INDEX idx_policies_category ON policies(category)');
    await queryRunner.query('CREATE INDEX idx_policies_verified ON policies(last_verified_at)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE policies');
    await queryRunner.query('DROP TABLE policy_sources');
    await queryRunner.query('DROP TABLE median_income_table');
    await queryRunner.query('DROP TABLE regions');
  }
}
