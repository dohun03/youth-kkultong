import type {
  BenefitAmount,
  PolicyCategory,
  PolicyConditions,
  SourceStatus,
} from '@kkultong/contracts';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PolicySourceEntity } from './policy-source.entity';

@Entity({ name: 'policies' })
export class PolicyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => PolicySourceEntity, { nullable: true })
  @JoinColumn({ name: 'source_id' })
  source!: PolicySourceEntity | null;

  @Column({ name: 'external_id', type: 'text', nullable: true })
  externalId!: string | null;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'varchar', length: 120 })
  agency!: string;

  @Column({ type: 'text' })
  category!: PolicyCategory;

  @Column({ name: 'benefit_summary', type: 'varchar', length: 300 })
  benefitSummary!: string;

  @Column({ name: 'benefit_amount', type: 'jsonb' })
  benefitAmount!: BenefitAmount;

  @Column({ type: 'jsonb' })
  conditions!: PolicyConditions;

  @Column({ name: 'has_unresolved_eligibility_condition', type: 'boolean' })
  hasUnresolvedEligibilityCondition!: boolean;

  @Column({ name: 'unresolved_condition_note', type: 'text', nullable: true })
  unresolvedConditionNote!: string | null;

  @Column({ name: 'required_docs', type: 'text', array: true, default: () => "'{}'" })
  requiredDocs!: string[];

  @Column({ name: 'apply_start', type: 'date', nullable: true })
  applyStart!: string | null;

  @Column({ name: 'apply_end', type: 'date', nullable: true })
  applyEnd!: string | null;

  @Column({ name: 'is_always_open', type: 'boolean', default: false })
  isAlwaysOpen!: boolean;

  @Column({ name: 'official_url', type: 'text' })
  officialUrl!: string;

  @Column({ name: 'source_status', type: 'text', default: 'ACTIVE' })
  sourceStatus!: SourceStatus;

  @Column({ name: 'is_published', type: 'boolean', default: false })
  isPublished!: boolean;

  @Column({ name: 'last_verified_at', type: 'timestamptz' })
  lastVerifiedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
