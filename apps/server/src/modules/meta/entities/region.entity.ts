import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from 'typeorm';

@Entity({ name: 'regions' })
export class RegionEntity {
  @PrimaryColumn({ type: 'text' })
  code!: string;

  @Column({ name: 'parent_code', type: 'text', nullable: true })
  parentCode!: string | null;

  @ManyToOne(() => RegionEntity, (region) => region.children)
  @JoinColumn({ name: 'parent_code', referencedColumnName: 'code' })
  parent!: RegionEntity | null;

  @OneToMany(() => RegionEntity, (region) => region.parent)
  children!: RegionEntity[];

  @Column({ type: 'smallint' })
  level!: number;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;
}
