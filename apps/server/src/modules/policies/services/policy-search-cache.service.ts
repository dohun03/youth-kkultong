import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PolicyRepository, type CachedPublicPolicy } from '../repositories/policy.repository';

export const POLICY_SEARCH_CACHE_REFRESH_MS = 5 * 60 * 1000;

/** 검색과 공개 정책 조회가 공유하는 한 시점의 읽기 전용 데이터 묶음이다. */
export interface PolicySearchCacheSnapshot {
  policies: readonly CachedPublicPolicy[];
  policyById: ReadonlyMap<string, CachedPublicPolicy>;
  regionParentByCode: ReadonlyMap<string, string | null>;
  medianIncomeByHouseholdSize: ReadonlyMap<number, number>;
}

/**
 * 공개 정책 탐색에 필요한 읽기 데이터를 서버 메모리에 보관한다.
 * 새 스냅샷을 모두 읽은 뒤 참조를 교체해 갱신 중 요청이 이전 데이터를 안전하게 읽게 한다.
 */
export class PolicySearchCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PolicySearchCacheService.name);
  private snapshot: PolicySearchCacheSnapshot | null = null;
  private refreshPromise: Promise<void> | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  public constructor(
    private readonly policyRepository: PolicyRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** 첫 적재가 성공한 뒤에만 5분 주기 갱신을 시작해 빈 캐시로 서버가 열리는 일을 막는다. */
  public async onModuleInit(): Promise<void> {
    await this.refresh();
    this.refreshTimer = setInterval(() => {
      void this.refreshSafely();
    }, POLICY_SEARCH_CACHE_REFRESH_MS);
  }

  /** 서버 종료 시 타이머를 해제해 종료 뒤 갱신이 실행되지 않게 한다. */
  public onModuleDestroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /** 현재 스냅샷을 반환한다. */
  public getSnapshot(): PolicySearchCacheSnapshot {
    if (this.snapshot === null) {
      throw new Error('정책 검색 캐시가 초기화되지 않았습니다.');
    }

    return this.snapshot;
  }

  /**
   * 새 스냅샷을 적재한다. 진행 중인 경우 Promise를 공유해 중복 조회를 막는다.
   * 실패하면 참조 교체 전 종료되므로 기존 스냅샷은 유지된다.
   */
  public async refresh(): Promise<void> {
    if (this.refreshPromise !== null) {
      return this.refreshPromise;
    }

    const refreshPromise = this.replaceSnapshot();
    this.refreshPromise = refreshPromise;

    try {
      await refreshPromise;
    } finally {
      if (this.refreshPromise === refreshPromise) {
        this.refreshPromise = null;
      }
    }
  }

  /** 서버 가동 이후 주기적 갱신을 진행한다. 실패는 요청을 막지 않고 오류만 남긴다. */
  private async refreshSafely(): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      this.logger.error('정책 검색 캐시 갱신에 실패해 기존 스냅샷을 유지합니다.', error);
    }
  }

  /** 정책과 매칭 기준을 모두 준비한 뒤 한 번의 참조 교체로 공개한다. */
  private async replaceSnapshot(): Promise<void> {
    const medianIncomeYear = this.now().getUTCFullYear();
    const [policies, searchContext] = await Promise.all([
      this.policyRepository.loadCachePolicies(),
      this.policyRepository.findSearchContext({ medianIncomeYear }),
    ]);
    // 둘 중 하나라도 실패하면 이 아래에 도달하지 않아 이전 스냅샷이 그대로 남는다.
    const nextSnapshot: PolicySearchCacheSnapshot = {
      policies,
      policyById: new Map(policies.map((policy) => [policy.id, policy])),
      regionParentByCode: searchContext.regionParentByCode,
      medianIncomeByHouseholdSize: searchContext.medianIncomeByHouseholdSize,
    };

    // 객체 하나의 참조만 바꾸므로 요청은 이전 또는 새 스냅샷 전체만 관찰한다.
    this.snapshot = nextSnapshot;
  }
}
