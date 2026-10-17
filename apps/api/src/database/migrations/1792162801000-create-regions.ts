import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRegions1792162801000 implements MigrationInterface {
  /** 5자리 지역 코드와 직접 상위 관계를 저장하고 폐지 여부를 명시적으로 관리한다. */
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "regions" (
        "code" varchar(5) NOT NULL,
        "name" varchar(100) NOT NULL,
        "province_name" varchar(100) NOT NULL,
        "parent_code" varchar(5),
        "is_active" boolean NOT NULL,
        CONSTRAINT "PK_regions" PRIMARY KEY ("code"),
        CONSTRAINT "CHK_regions_code" CHECK ("code" ~ '^[0-9]{5}$'),
        CONSTRAINT "FK_regions_parent_code" FOREIGN KEY ("parent_code")
          REFERENCES "regions" ("code") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
  }

  /** 지역 테이블만 되돌리며 정책 테이블에는 영향을 주지 않는다. */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "regions"');
  }
}
