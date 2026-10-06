import { dataSource } from '../datasource';
import { loadSeedData } from './seed-data';
import { seedMedianIncome } from './seed-median-income';
import { seedPolicySources } from './seed-policy-sources';
import { seedRegions } from './seed-regions';

const DATABASE_CONNECTION_MAX_ATTEMPTS = 3;
const DATABASE_CONNECTION_RETRY_DELAY_MS = 1_000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function initializeDataSource(): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= DATABASE_CONNECTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      await dataSource.initialize();
      return;
    } catch (error) {
      lastError = error;

      if (dataSource.isInitialized) {
        await dataSource.destroy();
      }

      if (attempt < DATABASE_CONNECTION_MAX_ATTEMPTS) {
        await delay(DATABASE_CONNECTION_RETRY_DELAY_MS);
      }
    }
  }

  throw new Error('데이터베이스 연결에 실패했습니다.', { cause: lastError });
}

export async function runSeeds(): Promise<void> {
  const seedData = await loadSeedData();

  try {
    await initializeDataSource();
    await dataSource.transaction(async (manager) => {
      await seedPolicySources(manager);
      await seedRegions(manager, seedData.regions);
      await seedMedianIncome(manager, seedData.medianIncomes);
    });

    console.info('기준 데이터 seed가 완료되었습니다.');
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

if (require.main === module) {
  void runSeeds().catch((error: unknown) => {
    console.error('기준 데이터 seed에 실패했습니다.', error);
    process.exitCode = 1;
  });
}
