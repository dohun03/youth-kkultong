import {
  type AppliedCriteria,
  type PolicyDetail,
  PolicyListQuerySchema,
  type PolicyCard,
  type PolicyListQuery,
  type PolicyListResponse,
  type PolicySearchResponse,
  SearchCriteriaSchema,
  type SearchCriteria,
} from '@kkultong/contracts';
import { NotFoundException } from '@nestjs/common';
import { evaluatePolicy } from '../../matching/evaluate-policy';
import type { CachedPublicPolicy } from '../repositories/policy.repository';
import { PolicySearchCacheService } from './policy-search-cache.service';

/** 공개 정책 목록의 조회 기준을 정규화하고 API 카드 형태로 변환한다. */
export class PolicyQueryService {
  public constructor(
    private readonly policySearchCache: PolicySearchCacheService,
    private readonly hideDays: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** 캐시 스냅샷에서 현재 공개 가능한 정책 목록을 페이지 단위로 만든다. */
  public async list(query: PolicyListQuery): Promise<PolicyListResponse> {
    const normalizedQuery = PolicyListQuerySchema.parse(query);
    const { today, hideBefore } = this.visibilityDates();
    const offset = (normalizedQuery.page - 1) * normalizedQuery.size;

    // 적재 시점과 무관하게 마감·검증일은 현재 날짜로 다시 판단한다.
    const policies = this.visiblePolicies(today, hideBefore, normalizedQuery.category);
    const total = policies.length;

    return {
      items: policies.slice(offset, offset + normalizedQuery.size).map((policy) => this.toPolicyCard(policy)),
      page: normalizedQuery.page,
      size: normalizedQuery.size,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / normalizedQuery.size),
    };
  }

  /**
   * 캐시의 공개 정책을 사용자 조건으로 평가해 MISMATCH만 결과에서 뺀다.
   * 요청 중 DB에 접근하지 않고, 같은 스냅샷의 지역·중위소득 Map을 함께 사용한다.
   */
  public async search(criteria: SearchCriteria): Promise<PolicySearchResponse> {
    // 기본 page/size 규칙을 보장한다.
    const normalizedCriteria = SearchCriteriaSchema.parse(criteria);

    // 공개 정책 조건과 중위소득 기준 연도가 한 요청 안에서 달라지지 않도록 현재 시각을 한 번만 읽는다.
    const now = this.now();
    const { today, hideBefore } = this.visibilityDates(now);

    const cacheSnapshot = this.policySearchCache.getSnapshot();
    const policies = this.visiblePolicies(today, hideBefore, normalizedCriteria.category);

    // 스냅샷의 적재 순서는 DB 정렬 순서다. MISMATCH는 빈 배열로 바꿔 결과에서만 제외한다.
    const items = policies.flatMap((policy) => {
      const evaluation = evaluatePolicy(
        policy,
        normalizedCriteria,
        {
          today: now,
          regionParentByCode: cacheSnapshot.regionParentByCode,
          medianIncomeByHouseholdSize: cacheSnapshot.medianIncomeByHouseholdSize,
        }
      );

      // 제외 대상이면 빈 배열 반환
      if (evaluation.excluded) {
        return [];
      }

      return [
        {
          policy: this.toPolicyCard(policy),
          fieldEvaluations: evaluation.fieldEvaluations,
          matchSummary: evaluation.matchSummary,
          requiresManualCheck: evaluation.requiresManualCheck,
        },
      ];
    });

    // 평가·제외가 끝난 결과를 기준으로 페이지를 나눠 total이 실제 검색 결과 수를 나타내게 한다.
    const offset = (normalizedCriteria.page - 1) * normalizedCriteria.size;

    return {
      items: items.slice(offset, offset + normalizedCriteria.size),
      page: normalizedCriteria.page,
      size: normalizedCriteria.size,
      total: items.length,
      totalPages: items.length === 0 ? 0 : Math.ceil(items.length / normalizedCriteria.size),
      appliedCriteria: toAppliedCriteria(normalizedCriteria),
    };
  }

  /** `policyById` 캐시에서 정책을 찾고, 현재 공개 기준을 통과할 때만 상세를 반환한다. */
  public async get(id: string): Promise<PolicyDetail> {
    const { today, hideBefore } = this.visibilityDates();

    const policy = this.policySearchCache.getSnapshot().policyById.get(id);
    if (policy === undefined || !isVisible(policy, today, hideBefore)) {
      throw new NotFoundException('정책을 찾을 수 없습니다.');
    }

    return this.toPolicyDetail(policy);
  }

  /** list, search 메서드가 같이 사용하는 공개일·카테고리 필터다. DB조회 대신 스냅샷을 반환한다. */
  private visiblePolicies(
    today: string,
    hideBefore: Date,
    categories?: PolicyListQuery['category'] | SearchCriteria['category'],
  ): CachedPublicPolicy[] {
    return this.policySearchCache.getSnapshot()
      .policies.filter(
        (policy) => isVisible(policy, today, hideBefore) && (categories === undefined || categories.includes(policy.category)),
      );
  }

  /** 목록과 검색 결과에 공통으로 노출할 최소 카드 응답을 만든다. */
  private toPolicyCard(policy: CachedPublicPolicy): PolicyCard {
    return {
      id: policy.id,
      title: policy.title,
      agency: policy.agency,
      category: policy.category,
      benefitSummary: policy.benefitSummary,
      benefitAmount: policy.benefitAmount,
      applyStart: policy.applyStart,
      applyEnd: policy.applyEnd,
      isAlwaysOpen: policy.isAlwaysOpen,
      regionCondition: policy.conditions.region,
      ageCondition: policy.conditions.age,
      requiresManualCheck: policy.hasUnresolvedEligibilityCondition,
    };
  }

  /** 상세 화면에만 필요한 조건 원문과 공식 링크를 포함한다. */
  private toPolicyDetail(policy: CachedPublicPolicy): PolicyDetail {
    return {
      id: policy.id,
      title: policy.title,
      agency: policy.agency,
      category: policy.category,
      benefitSummary: policy.benefitSummary,
      benefitAmount: policy.benefitAmount,
      applyStart: policy.applyStart,
      applyEnd: policy.applyEnd,
      isAlwaysOpen: policy.isAlwaysOpen,
      ageCondition: policy.conditions.age,
      regionCondition: policy.conditions.region,
      statusCondition: policy.conditions.status,
      incomeCondition: policy.conditions.income,
      householdSizeCondition: policy.conditions.householdSize,
      requiresManualCheck: policy.hasUnresolvedEligibilityCondition,
      manualCheckNote: policy.unresolvedConditionNote,
      requiredDocs: policy.requiredDocs,
      officialUrl: policy.officialUrl,
      lastVerifiedAt: policy.lastVerifiedAt.toISOString(),
    };
  }

  /** 오늘 날짜와 오래된 검증 정책을 숨길 기준일을 한 요청 안에서 일관되게 계산한다. */
  private visibilityDates(now: Date = this.now()): { today: string; hideBefore: Date } {
    const today = toIsoDate(now);
    const hideBefore = new Date(`${today}T00:00:00.000Z`);
    hideBefore.setUTCDate(hideBefore.getUTCDate() - this.hideDays);

    return { today, hideBefore };
  }
}

/** 공개·활성 출처 정책만 캐시에 있으므로 날짜 기준만 요청 시점에 확인한다. */
function isVisible(
  policy: CachedPublicPolicy,
  today: string,
  hideBefore: Date,
): boolean {
  return ((policy.applyEnd === null || policy.applyEnd >= today) && policy.lastVerifiedAt >= hideBefore);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 입력 여부만 요약한다. 정책별 MATCH 여부는 각 item의 fieldEvaluations에서 확인한다. */
function toAppliedCriteria(criteria: SearchCriteria): AppliedCriteria {
  return {
    age: criteria.age !== undefined,
    region: criteria.regionCode !== undefined,
    status: (criteria.statuses?.length ?? 0) > 0,
    householdSize: criteria.householdSize !== undefined,
    income: criteria.householdMonthlyIncome !== undefined,
  };
}
