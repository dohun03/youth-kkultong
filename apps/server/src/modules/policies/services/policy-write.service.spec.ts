import type { PolicyImportInput } from '@kkultong/contracts';
import type { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { PolicyEntity } from '../entities/policy.entity';
import { PolicySourceEntity } from '../entities/policy-source.entity';
import { PolicyRepository } from '../repositories/policy.repository';
import { PolicyWriteError, PolicyWriteService } from './policy-write.service';

const MANUAL_SOURCE: PolicySourceEntity = {
  id: 1,
  code: 'MANUAL',
  name: '수동 등록',
  type: 'MANUAL',
  enabled: true,
  baseUrl: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function createInput(overrides: Partial<PolicyImportInput> = {}): PolicyImportInput {
  return {
    externalId: 'policy-1',
    title: '청년 주거 지원',
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
    officialUrl: 'https://example.com/policies/1',
    lastVerifiedAt: '2026-01-01T00:00:00.000Z',
    isPublished: false,
    ...overrides,
  };
}

class PolicyStore {
  public readonly policies: PolicyEntity[] = [];
  public readonly regionCodes = new Set(['11', '11110']);
  public failOnExternalId: string | null = null;
  private nextId = 1;

  public readonly manager = {
    create: <Entity>(target: new () => Entity, fields: Partial<Entity>): Entity => {
      const entity = new target();
      return Object.assign(entity as object, fields) as Entity;
    },
  } as unknown as EntityManager;

  public createRepository(): PolicyRepository {
    return {
      findSourceByCode: jest.fn(async (code: string) => (code === 'MANUAL' ? MANUAL_SOURCE : null)),
      findBySourceIdentity: jest.fn(async (_sourceId: number, externalId: string) => {
        return this.policies.find((policy) => policy.externalId === externalId) ?? null;
      }),
      findExistingRegionCodes: jest.fn(async (codes: string[]) =>
        codes.filter((code) => this.regionCodes.has(code)),
      ),
      save: jest.fn(async (policy: PolicyEntity) => {
        if (policy.externalId === this.failOnExternalId) {
          throw new Error('저장 실패');
        }

        const existingIndex = this.policies.findIndex((item) => item.id === policy.id);

        if (existingIndex === -1) {
          policy.id = `policy-${this.nextId}`;
          this.nextId += 1;
          policy.createdAt = new Date('2026-01-01T00:00:00.000Z');
          policy.updatedAt = new Date('2026-01-01T00:00:00.000Z');
          this.policies.push(policy);
        } else {
          policy.updatedAt = new Date('2026-01-02T00:00:00.000Z');
          this.policies[existingIndex] = policy;
        }

        return policy;
      }),
    } as unknown as PolicyRepository;
  }

  public createDataSource(): DataSource {
    return {
      createQueryRunner: jest.fn(() => this.createQueryRunner()),
      transaction: jest.fn(async (callback: (manager: EntityManager) => unknown) => callback(this.manager)),
    } as unknown as DataSource;
  }

  private createQueryRunner(): QueryRunner {
    let snapshot: PolicyEntity[] = [];
    const thisStore = this;

    return {
      manager: this.manager,
      isTransactionActive: false,
      connect: jest.fn(),
      startTransaction: jest.fn(async function startTransaction(this: QueryRunner) {
        snapshot = structuredClone(thisStore.policies);
        (this as unknown as { isTransactionActive: boolean }).isTransactionActive = true;
      }),
      commitTransaction: jest.fn(async function commitTransaction(this: QueryRunner) {
        (this as unknown as { isTransactionActive: boolean }).isTransactionActive = false;
      }),
      rollbackTransaction: jest.fn(async function rollbackTransaction(this: QueryRunner) {
        thisStore.policies.splice(0, thisStore.policies.length, ...structuredClone(snapshot));
        (this as unknown as { isTransactionActive: boolean }).isTransactionActive = false;
      }),
      release: jest.fn(),
    } as unknown as QueryRunner;
  }
}

describe('PolicyWriteService', () => {
  let store: PolicyStore;
  let service: PolicyWriteService;

  beforeEach(() => {
    store = new PolicyStore();
    service = new PolicyWriteService(store.createDataSource(), store.createRepository());
  });

  it('신규·동일·변경 정책을 각각 CREATED·UNCHANGED·UPDATED로 처리한다', async () => {
    const input = createInput();
    const created = await service.importManualBatch([input]);
    const originalPolicy = store.policies[0];

    const unchanged = await service.importManualBatch([input]);
    const updated = await service.importManualBatch([
      createInput({ benefitSummary: '월 25만 원 지원' }),
    ]);

    expect(created).toEqual({ total: 1, created: 1, updated: 0, unchanged: 0 });
    expect(unchanged).toEqual({ total: 1, created: 0, updated: 0, unchanged: 1 });
    expect(updated).toEqual({ total: 1, created: 0, updated: 1, unchanged: 0 });
    expect(store.policies).toHaveLength(1);
    expect(store.policies[0]).toMatchObject({
      id: originalPolicy?.id,
      createdAt: originalPolicy?.createdAt,
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      benefitSummary: '월 25만 원 지원',
      sourceStatus: 'ACTIVE',
    });
  });

  it('존재하지 않는 지역 코드는 정책을 저장하지 않고 진단 정보를 반환한다', async () => {
    await expect(
      service.importManualBatch([
        createInput({
          conditions: {
            ...createInput().conditions,
            region: { kind: 'RULE', value: ['99999'] },
          },
        }),
      ]),
    ).rejects.toMatchObject({
      code: 'REGION_NOT_FOUND',
      details: expect.objectContaining({
        index: 0,
        externalId: 'policy-1',
        field: 'conditions.region.value.0',
      }),
    });

    expect(store.policies).toHaveLength(0);
  });

  it('저장 중 한 건이 실패하면 이전 저장도 전체 rollback한다', async () => {
    store.failOnExternalId = 'policy-2';

    await expect(
      service.importManualBatch([createInput(), createInput({ externalId: 'policy-2' })]),
    ).rejects.toMatchObject({ code: 'DB_CONSTRAINT_FAILED' });

    expect(store.policies).toHaveLength(0);
  });

  it('dry-run은 실제 저장 경로를 실행하지만 변경을 commit하지 않는다', async () => {
    const summary = await service.importManualBatch([createInput()], { dryRun: true });

    expect(summary).toEqual({ total: 1, created: 1, updated: 0, unchanged: 0 });
    expect(store.policies).toHaveLength(0);
  });
});
