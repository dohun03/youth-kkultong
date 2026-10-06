import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'median_income_table' })
export class MedianIncomeEntity {
  @PrimaryColumn({ type: 'smallint' })
  year!: number;

  @PrimaryColumn({ name: 'household_size', type: 'smallint' })
  householdSize!: number;

  // PostgreSQL bigint는 JavaScript 정밀도를 넘을 수 있어 문자열로 유지한다.
  @Column({ type: 'bigint' })
  amount!: string;
}
