import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

@Entity('policies')
@Unique('UQ_policies_source_external_id', ['source', 'externalId'])
@Index('IDX_policies_category', ['category'])
// DESC 인덱스는 TypeORM 데코레이터로 표현할 수 없어 Migration에서 직접 생성·검증한다.
@Index('IDX_policies_view_count', { synchronize: false })
@Index('IDX_policies_source_registered_at', { synchronize: false })
export class Policy {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_policies' })
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  source!: string;

  @Column({ name: 'external_id', type: 'varchar', length: 64 })
  externalId!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  category!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  subcategory!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'benefit_text', type: 'text', nullable: true })
  benefitText!: string | null;

  @Column({ name: 'apply_url', type: 'text', nullable: true })
  applyUrl!: string | null;

  @Column({ name: 'reference_url_1', type: 'text', nullable: true })
  referenceUrl1!: string | null;

  @Column({ name: 'reference_url_2', type: 'text', nullable: true })
  referenceUrl2!: string | null;

  @Column({ name: 'view_count', type: 'integer', nullable: true })
  viewCount!: number | null;

  // 원본의 시간대 없는 시각과 내부 저장 시각(timestamptz)을 구분한다.
  @Column({ name: 'source_registered_at', type: 'timestamp', nullable: true })
  sourceRegisteredAt!: Date | null;

  @Column({ name: 'source_modified_at', type: 'timestamp', nullable: true })
  sourceModifiedAt!: Date | null;

  @Column({ name: 'application_period_code', type: 'varchar', length: 20, nullable: true })
  applicationPeriodCode!: string | null;

  @Column({ name: 'application_period_raw', type: 'text', nullable: true })
  applicationPeriodRaw!: string | null;

  // DATE는 시각·시간대 변환이 없는 YYYY-MM-DD 문자열로 읽고 쓴다.
  @Column({ name: 'application_start_date', type: 'date', nullable: true })
  applicationStartDate!: string | null;

  @Column({ name: 'application_end_date', type: 'date', nullable: true })
  applicationEndDate!: string | null;

  @Column({ name: 'age_min', type: 'integer', nullable: true })
  ageMin!: number | null;

  @Column({ name: 'age_max', type: 'integer', nullable: true })
  ageMax!: number | null;

  @Column({ name: 'job_codes', type: 'text', array: true, nullable: true })
  jobCodes!: string[] | null;

  @Column({ name: 'school_codes', type: 'text', array: true, nullable: true })
  schoolCodes!: string[] | null;

  @Column({ name: 'region_codes', type: 'text', array: true, nullable: true })
  regionCodes!: string[] | null;

  @Column({ name: 'extra_qualification', type: 'text', nullable: true })
  extraQualification!: string | null;

  @Column({ name: 'participation_restriction', type: 'text', nullable: true })
  participationRestriction!: string | null;

  @Column({ name: 'raw_json', type: 'jsonb' })
  rawJson!: Record<string, unknown>;

  @Column({ name: 'content_hash', type: 'char', length: 64 })
  contentHash!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
