import type { EntityManager } from 'typeorm';
import { loadSeedData } from './seed-data';
import { seedMedianIncome } from './seed-median-income';
import { seedPolicySources } from './seed-policy-sources';
import { seedRegions } from './seed-regions';

function createEntityManager(): EntityManager {
  return {
    upsert: jest.fn().mockResolvedValue(undefined),
  } as unknown as EntityManager;
}

describe('MVP0 기준 데이터 seed', () => {
  it('공식 기준 데이터는 시도·시군구와 2026년 1~8인 중위소득을 포함한다', async () => {
    const { regions, medianIncomes } = await loadSeedData();

    expect(regions.filter((region) => region.level === 1)).toHaveLength(16);
    expect(regions.filter((region) => region.level === 2)).toHaveLength(268);
    expect(regions.every((region) => region.name.length > 0)).toBe(true);
    expect(medianIncomes).toEqual([
      { year: 2026, householdSize: 1, amount: 2_564_238 },
      { year: 2026, householdSize: 2, amount: 4_199_292 },
      { year: 2026, householdSize: 3, amount: 5_359_036 },
      { year: 2026, householdSize: 4, amount: 6_494_738 },
      { year: 2026, householdSize: 5, amount: 7_556_719 },
      { year: 2026, householdSize: 6, amount: 8_555_952 },
      { year: 2026, householdSize: 7, amount: 9_515_150 },
      { year: 2026, householdSize: 8, amount: 10_474_348 },
    ]);
  });

  it('모든 기준 데이터를 식별자 기준 upsert하고 지역 부모를 먼저 저장한다', async () => {
    const manager = createEntityManager();
    const { regions, medianIncomes } = await loadSeedData();

    await seedPolicySources(manager);
    await seedRegions(manager, regions);
    await seedMedianIncome(manager, medianIncomes);

    const upsert = manager.upsert as jest.Mock;

    expect(upsert).toHaveBeenCalledTimes(4);
    expect(upsert.mock.calls[0]?.[2]).toEqual(['code']);
    expect(upsert.mock.calls[1]?.[2]).toEqual(['code']);
    expect(upsert.mock.calls[2]?.[2]).toEqual(['code']);
    expect(upsert.mock.calls[3]?.[2]).toEqual(['year', 'householdSize']);
    expect(upsert.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining([expect.objectContaining({ parentCode: null })]),
    );
    expect(upsert.mock.calls[2]?.[1]).toEqual(
      expect.arrayContaining([expect.objectContaining({ parentCode: '11' })]),
    );
  });
});
