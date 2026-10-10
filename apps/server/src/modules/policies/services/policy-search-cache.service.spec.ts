import type { CachedPublicPolicy } from '../repositories/policy.repository';
import { PolicyRepository } from '../repositories/policy.repository';
import { PolicySearchCacheService } from './policy-search-cache.service';

const POLICY_A = createCachedPolicy('policy-a', '기존 정책');
const POLICY_B = createCachedPolicy('policy-b', '새 정책');

describe('PolicySearchCacheService', () => {
  let repository: jest.Mocked<
    Pick<PolicyRepository, 'loadCachePolicies' | 'findSearchContext'>
  >;
  let service: PolicySearchCacheService;

  beforeEach(() => {
    repository = {
      loadCachePolicies: jest.fn().mockResolvedValue([POLICY_A]),
      findSearchContext: jest.fn().mockResolvedValue({
        regionParentByCode: new Map([['11', null]]),
        medianIncomeByHouseholdSize: new Map([[1, 2_000_000]]),
      }),
    };
    service = new PolicySearchCacheService(repository as unknown as PolicyRepository, () =>
      new Date('2026-10-10T00:00:00.000Z'),
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('초기 적재한 일반 객체 스냅샷을 id Map과 함께 반환한다', async () => {
    await service.onModuleInit();

    const snapshot = service.getSnapshot();

    expect(snapshot.policies).toEqual([POLICY_A]);
    expect(snapshot.policyById.get(POLICY_A.id)).toEqual(POLICY_A);
    expect(repository.findSearchContext).toHaveBeenCalledWith({ medianIncomeYear: 2026 });
  });

  it('새 데이터를 모두 읽은 뒤에만 스냅샷을 교체한다', async () => {
    await service.onModuleInit();
    let resolvePolicies: ((policies: CachedPublicPolicy[]) => void) | undefined;
    repository.loadCachePolicies.mockImplementationOnce(
      () =>
        new Promise<CachedPublicPolicy[]>((resolve) => {
          resolvePolicies = resolve;
        }),
    );

    const refresh = service.refresh();

    expect(service.getSnapshot().policyById.has(POLICY_A.id)).toBe(true);
    resolvePolicies?.([POLICY_B]);
    await refresh;

    expect(service.getSnapshot().policyById.has(POLICY_A.id)).toBe(false);
    expect(service.getSnapshot().policyById.get(POLICY_B.id)).toEqual(POLICY_B);
  });

  it('동시에 호출되어도 진행 중인 한 번의 갱신만 사용한다', async () => {
    await service.onModuleInit();
    let resolvePolicies: ((policies: CachedPublicPolicy[]) => void) | undefined;
    repository.loadCachePolicies.mockImplementationOnce(
      () =>
        new Promise<CachedPublicPolicy[]>((resolve) => {
          resolvePolicies = resolve;
        }),
    );

    const firstRefresh = service.refresh();
    const secondRefresh = service.refresh();
    resolvePolicies?.([POLICY_B]);
    await Promise.all([firstRefresh, secondRefresh]);

    expect(repository.loadCachePolicies).toHaveBeenCalledTimes(2);
    expect(repository.findSearchContext).toHaveBeenCalledTimes(2);
  });

  it('갱신에 실패하면 기존 스냅샷을 유지한다', async () => {
    await service.onModuleInit();
    repository.loadCachePolicies.mockRejectedValueOnce(new Error('DB 연결 실패'));

    await expect(service.refresh()).rejects.toThrow('DB 연결 실패');

    expect(service.getSnapshot().policyById.get(POLICY_A.id)).toEqual(POLICY_A);
  });
});

function createCachedPolicy(id: string, title: string): CachedPublicPolicy {
  return {
    id,
    title,
    agency: '청년정책과',
    category: 'HOUSING',
    benefitSummary: '지원',
    benefitAmount: { kind: 'UNKNOWN', text: '지원' },
    conditions: {
      age: { kind: 'ANY' },
      region: { kind: 'ANY' },
      income: { kind: 'ANY' },
      status: { kind: 'ANY' },
      householdSize: { kind: 'ANY' },
    },
    hasUnresolvedEligibilityCondition: false,
    unresolvedConditionNote: null,
    requiredDocs: [],
    applyStart: null,
    applyEnd: null,
    isAlwaysOpen: true,
    officialUrl: 'https://example.go.kr/policy',
    lastVerifiedAt: new Date('2026-10-01T00:00:00.000Z'),
  };
}
