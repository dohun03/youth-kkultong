import type { PolicyImportInput } from '@kkultong/contracts';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { DataSource } from 'typeorm';
import { Mvp0CorePolicy1760000000000 } from '../../src/database/migrations/001-mvp0-core-policy';
import { loadSeedData } from '../../src/database/seeds/seed-data';
import { seedMedianIncome } from '../../src/database/seeds/seed-median-income';
import { seedPolicySources } from '../../src/database/seeds/seed-policy-sources';
import { seedRegions } from '../../src/database/seeds/seed-regions';
import { MedianIncomeEntity } from '../../src/modules/meta/entities/median-income.entity';
import { RegionEntity } from '../../src/modules/meta/entities/region.entity';
import { PolicyEntity } from '../../src/modules/policies/entities/policy.entity';
import { PolicySourceEntity } from '../../src/modules/policies/entities/policy-source.entity';
import { PolicyRepository } from '../../src/modules/policies/repositories/policy.repository';
import { PolicyWriteService } from '../../src/modules/policies/services/policy-write.service';

const TEST_TIMEOUT_MS = 60_000;
const POSTGRES_PORT = 5432;
const TEST_DATABASE_NAME = 'kkultong_test';
const TEST_DATABASE_USER = 'kkultong';
const TEST_DATABASE_PASSWORD = 'kkultong_test';
const POSTGRES_READY_LOG_COUNT = 2;

jest.setTimeout(TEST_TIMEOUT_MS);

function createPolicy(externalId: string, overrides: Partial<PolicyImportInput> = {}): PolicyImportInput {
  return {
    externalId,
    title: `${externalId} 정책`,
    agency: '청년정책과',
    category: 'HOUSING',
    benefitSummary: '월 20만 원 지원',
    benefitAmount: { kind: 'MONTHLY', amountWon: 200_000, months: 12, text: '월 20만 원' },
    conditions: {
      age: { kind: 'ANY' },
      region: { kind: 'RULE', value: ['11'] },
      income: { kind: 'UNKNOWN' },
      status: { kind: 'ANY' },
      householdSize: { kind: 'ANY' },
    },
    hasUnresolvedEligibilityCondition: false,
    unresolvedConditionNote: null,
    requiredDocs: ['신분증'],
    applyStart: '2026-01-01',
    applyEnd: '2026-12-31',
    isAlwaysOpen: false,
    officialUrl: `https://example.go.kr/policies/${externalId}`,
    lastVerifiedAt: '2026-10-05T00:00:00.000+09:00',
    isPublished: true,
    ...overrides,
  };
}

async function seedReferenceData(dataSource: DataSource): Promise<void> {
  const { regions, medianIncomes } = await loadSeedData();

  await dataSource.transaction(async (manager) => {
    await seedPolicySources(manager);
    await seedRegions(manager, regions);
    await seedMedianIncome(manager, medianIncomes);
  });
}

describe('PolicyWriteService PostgreSQL 통합', () => {
  let container: StartedTestContainer;
  let dataSource: DataSource;
  let service: PolicyWriteService;

  beforeAll(async () => {
    // 공식 이미지의 초기화용 임시 서버와 최종 서버 로그를 모두 기다려 TCP 연결을 보장한다.
    container = await new GenericContainer('postgres:16')
      .withEnvironment({
        POSTGRES_DB: TEST_DATABASE_NAME,
        POSTGRES_USER: TEST_DATABASE_USER,
        POSTGRES_PASSWORD: TEST_DATABASE_PASSWORD,
      })
      .withExposedPorts(POSTGRES_PORT)
      .withWaitStrategy(
        Wait.forLogMessage(/database system is ready to accept connections/, POSTGRES_READY_LOG_COUNT),
      )
      .start();
    dataSource = new DataSource({
      type: 'postgres',
      url: `postgresql://${TEST_DATABASE_USER}:${TEST_DATABASE_PASSWORD}@${container.getHost()}:${container.getMappedPort(POSTGRES_PORT)}/${TEST_DATABASE_NAME}`,
      entities: [RegionEntity, MedianIncomeEntity, PolicySourceEntity, PolicyEntity],
      migrations: [Mvp0CorePolicy1760000000000],
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    await seedReferenceData(dataSource);
    service = new PolicyWriteService(dataSource, new PolicyRepository(dataSource));
  });

  beforeEach(async () => {
    await dataSource.getRepository(PolicyEntity).clear();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }

    await container?.stop();
  });

  it('신규 정책 3건을 생성하고 DB에 저장한다', async () => {
    const inputs = ['policy-1', 'policy-2', 'policy-3'].map((externalId) => createPolicy(externalId));

    await expect(service.importManualBatch(inputs)).resolves.toEqual({
      total: 3,
      created: 3,
      updated: 0,
      unchanged: 0,
    });
    await expect(dataSource.getRepository(PolicyEntity).count()).resolves.toBe(3);
  });

  it('동일 정책 3건을 재import하면 행과 식별자를 유지한다', async () => {
    const inputs = ['policy-1', 'policy-2', 'policy-3'].map((externalId) => createPolicy(externalId));
    await service.importManualBatch(inputs);
    const originalIds = new Map(
      (await dataSource.getRepository(PolicyEntity).find()).map((policy) => [policy.externalId, policy.id]),
    );

    await expect(service.importManualBatch(inputs)).resolves.toEqual({
      total: 3,
      created: 0,
      updated: 0,
      unchanged: 3,
    });

    const policies = await dataSource.getRepository(PolicyEntity).find();
    expect(policies).toHaveLength(3);
    expect(new Map(policies.map((policy) => [policy.externalId, policy.id]))).toEqual(originalIds);
  });

  it('내용이 변경된 정책은 같은 행을 UPDATED로 처리한다', async () => {
    const input = createPolicy('policy-1');
    await service.importManualBatch([input]);
    const original = await dataSource.getRepository(PolicyEntity).findOneByOrFail({ externalId: input.externalId });

    await expect(
      service.importManualBatch([createPolicy('policy-1', { benefitSummary: '월 25만 원 지원' })]),
    ).resolves.toEqual({ total: 1, created: 0, updated: 1, unchanged: 0 });

    const updated = await dataSource.getRepository(PolicyEntity).findOneByOrFail({ externalId: input.externalId });
    expect(updated).toMatchObject({
      id: original.id,
      createdAt: original.createdAt,
      benefitSummary: '월 25만 원 지원',
    });
    expect(updated.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime());
    await expect(dataSource.getRepository(PolicyEntity).count()).resolves.toBe(1);
  });

  it('잘못된 지역 코드가 포함되면 기존 정책 변경도 함께 rollback한다', async () => {
    const originalInput = createPolicy('policy-1');
    await service.importManualBatch([originalInput]);

    await expect(
      service.importManualBatch([
        createPolicy('policy-1', { benefitSummary: '변경되면 안 되는 혜택' }),
        createPolicy('policy-2'),
        createPolicy('policy-3'),
        createPolicy('invalid-region', {
          conditions: {
            ...originalInput.conditions,
            region: { kind: 'RULE', value: ['99999'] },
          },
        }),
      ]),
    ).rejects.toMatchObject({ code: 'REGION_NOT_FOUND' });

    const policies = await dataSource.getRepository(PolicyEntity).find();
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatchObject({
      externalId: 'policy-1',
      benefitSummary: originalInput.benefitSummary,
    });
  });

  it('dry-run은 신규 3건을 생성 예정으로 계산하지만 저장하지 않는다', async () => {
    const inputs = ['policy-1', 'policy-2', 'policy-3'].map((externalId) => createPolicy(externalId));

    await expect(service.importManualBatch(inputs, { dryRun: true })).resolves.toEqual({
      total: 3,
      created: 3,
      updated: 0,
      unchanged: 0,
    });
    await expect(dataSource.getRepository(PolicyEntity).count()).resolves.toBe(0);
  });

  it('기준 데이터 seed를 반복해도 중복 행을 만들지 않는다', async () => {
    await seedReferenceData(dataSource);
    await seedReferenceData(dataSource);

    await expect(dataSource.getRepository(PolicySourceEntity).countBy({ code: 'MANUAL' })).resolves.toBe(1);
    await expect(dataSource.getRepository(RegionEntity).count()).resolves.toBe(284);
    await expect(dataSource.getRepository(MedianIncomeEntity).count()).resolves.toBe(8);
  });
});
