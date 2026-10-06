import type { EntityManager } from 'typeorm';
import { MedianIncomeEntity } from '../../modules/meta/entities/median-income.entity';

export interface MedianIncomeSeedData {
  year: number;
  householdSize: number;
  amount: number;
}

export async function seedMedianIncome(
  manager: EntityManager,
  medianIncomes: readonly MedianIncomeSeedData[],
): Promise<void> {
  const rows = medianIncomes.map((medianIncome) => ({
    ...medianIncome,
    // PostgreSQL bigint를 Entity 정의와 동일하게 문자열로 전달한다.
    amount: String(medianIncome.amount),
  }));

  await manager.upsert(MedianIncomeEntity, rows, ['year', 'householdSize']);
}
