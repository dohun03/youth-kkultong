import type { SourceType } from '@kkultong/contracts';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'policy_sources' })
export class PolicySourceEntity {
  @PrimaryGeneratedColumn({ type: 'smallint' })
  id!: number;

  @Column({ type: 'text', unique: true })
  code!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  type!: SourceType;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ name: 'base_url', type: 'text', nullable: true })
  baseUrl!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
