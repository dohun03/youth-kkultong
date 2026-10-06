import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MedianIncomeSeedData } from './seed-median-income';
import type { RegionSeedData } from './seed-regions';

const DATA_DIRECTORY = join(__dirname, 'data');
const REGIONS_FILE_NAME = 'regions.json';
const MEDIAN_INCOME_FILE_NAME = 'median-income.json';
const FILE_READ_MAX_ATTEMPTS = 2;
const FILE_READ_RETRY_DELAY_MS = 100;
const SIDO_LEVEL = 1;
const SIGUNGU_LEVEL = 2;
const MIN_HOUSEHOLD_SIZE = 1;

interface SeedData {
  regions: RegionSeedData[];
  medianIncomes: MedianIncomeSeedData[];
}

function isRegionSeedData(value: unknown): value is RegionSeedData {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const region = value as Record<string, unknown>;

  return (
    typeof region.code === 'string' &&
    typeof region.name === 'string' &&
    (region.parentCode === null || typeof region.parentCode === 'string') &&
    (region.level === SIDO_LEVEL || region.level === SIGUNGU_LEVEL)
  );
}

function isMedianIncomeSeedData(value: unknown): value is MedianIncomeSeedData {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const medianIncome = value as Record<string, unknown>;

  return (
    Number.isInteger(medianIncome.year) &&
    Number.isInteger(medianIncome.householdSize) &&
    Number.isSafeInteger(medianIncome.amount) &&
    (medianIncome.householdSize as number) >= MIN_HOUSEHOLD_SIZE &&
    (medianIncome.amount as number) > 0
  );
}

function parseSeedArray<T>(fileName: string, content: string, isValid: (value: unknown) => value is T): T[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`${fileName} JSON 파싱에 실패했습니다.`, { cause: error });
  }

  if (!Array.isArray(parsed) || !parsed.every(isValid)) {
    throw new Error(`${fileName} 형식이 올바르지 않습니다.`);
  }

  return parsed;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readSeedFile(fileName: string): Promise<string> {
  const filePath = join(DATA_DIRECTORY, fileName);
  let lastError: unknown;

  for (let attempt = 1; attempt <= FILE_READ_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await readFile(filePath, 'utf8');
    } catch (error) {
      lastError = error;

      if (attempt < FILE_READ_MAX_ATTEMPTS) {
        await delay(FILE_READ_RETRY_DELAY_MS);
      }
    }
  }

  throw new Error(`${fileName} 파일을 읽을 수 없습니다.`, { cause: lastError });
}

export async function loadSeedData(): Promise<SeedData> {
  const [regionsContent, medianIncomeContent] = await Promise.all([
    readSeedFile(REGIONS_FILE_NAME),
    readSeedFile(MEDIAN_INCOME_FILE_NAME),
  ]);

  return {
    regions: parseSeedArray(REGIONS_FILE_NAME, regionsContent, isRegionSeedData),
    medianIncomes: parseSeedArray(
      MEDIAN_INCOME_FILE_NAME,
      medianIncomeContent,
      isMedianIncomeSeedData,
    ),
  };
}
