import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

@Entity('regions')
@Check('CHK_regions_code', `"code" ~ '^[0-9]{5}$'`)
export class Region {
  @PrimaryColumn({ type: 'varchar', length: 5, primaryKeyConstraintName: 'PK_regions' })
  code!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ name: 'province_name', type: 'varchar', length: 100 })
  provinceName!: string;

  @Column({ name: 'parent_code', type: 'varchar', length: 5, nullable: true })
  parentCode!: string | null;

  @Column({ name: 'is_active', type: 'boolean' })
  isActive!: boolean;

  // 코드 앞자리가 아니라 저장된 직접 상위 관계를 사용한다. 폐지 코드는 삭제하지 않고 보존한다.
  @ManyToOne(() => Region, { nullable: true, onDelete: 'NO ACTION', onUpdate: 'NO ACTION' })
  @JoinColumn({ name: 'parent_code', referencedColumnName: 'code', foreignKeyConstraintName: 'FK_regions_parent_code' })
  parent?: Region | null;
}
