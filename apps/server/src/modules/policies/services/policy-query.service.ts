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
import type { PolicyEntity } from '../entities/policy.entity';
import { PolicyRepository } from '../repositories/policy.repository';

/** 공개 정책 목록의 조회 기준을 정규화하고 API 카드 형태로 변환한다. */
export class PolicyQueryService {
  public constructor(
    private readonly policyRepository: PolicyRepository,
    private readonly hideDays: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** 현재 공개 가능한 정책을 페이지 단위로 반환한다. 숨김 기준일은 달력 기준으로 계산해 마감·오래된 검증 정책은 제외한다. */
  public async findPublicPolicies(query: PolicyListQuery): Promise<PolicyListResponse> {
    const normalizedQuery = PolicyListQuerySchema.parse(query);
    const today = toIsoDate(this.now());
    const hideBefore = new Date(`${today}T00:00:00.000Z`);
    hideBefore.setUTCDate(hideBefore.getUTCDate() - this.hideDays);
    const offset = (normalizedQuery.page - 1) * normalizedQuery.size;

    const { policies, total } = await this.policyRepository.findPublicPolicies({
      category: normalizedQuery.category,
      offset,
      limit: normalizedQuery.size,
      today,
      hideBefore,
    });

    return {
      items: policies.map((policy) => this.toPolicyCard(policy)),
      page: normalizedQuery.page,
      size: normalizedQuery.size,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / normalizedQuery.size),
    };
  }

  /**
   * 사용자 조건으로 공개 정책을 평가해 불일치한 정책만 제외한다.
   * 검색 조건은 저장하지 않으며, 컨텍스트는 정책별로 조회하지 않고 한 번에 읽는다.
   */
  public async searchPublicPolicies(criteria: SearchCriteria): Promise<PolicySearchResponse> {
    // 기본 page/size 규칙을 보장한다.
    const normalizedCriteria = SearchCriteriaSchema.parse(criteria);

    // 공개 정책 조건과 중위소득 기준 연도가 한 요청 안에서 달라지지 않도록 현재 시각을 한 번만 읽는다.
    const now = this.now();
    const today = toIsoDate(now);
    // 마지막 검증일이 HIDE_DAYS보다 오래된 정책은 목록·상세·검색 모두에서 숨긴다.
    const hideBefore = new Date(`${today}T00:00:00.000Z`);
    hideBefore.setUTCDate(hideBefore.getUTCDate() - this.hideDays);

    const [policies, searchContext] = await Promise.all([
      // DB는 공개 가능 여부와 category까지만 좁힌다. 조건별 비교는 아래 순수 매칭 엔진이 담당한다.
      this.policyRepository.findAllPublicPolicies({
        categories: normalizedCriteria.category,
        today,
        hideBefore,
      }),
      // 모든 정책이 공유하는 기준 데이터이므로 정책마다 조회하지 않고 한 번만 읽어 N+1을 막는다.
      this.policyRepository.findSearchContext({
        medianIncomeYear: now.getUTCFullYear(),
      }),
    ]);

    // DB 정렬 상태를 유지한 채 개별로 평가한다. flatMap의 빈 배열은 MISMATCH 정책을 결과에서 제거한다.
    const items = policies.flatMap((policy) => {
      const evaluation = evaluatePolicy(
        policy,
        normalizedCriteria,
        {
          today: now,
          ...searchContext,
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

  /** 목록과 같은 공개 기준을 통과한 정책의 상세 정보만 반환한다. */
  public async findPublicPolicy(id: string): Promise<PolicyDetail> {
    const today = toIsoDate(this.now());
    const hideBefore = new Date(`${today}T00:00:00.000Z`);
    hideBefore.setUTCDate(hideBefore.getUTCDate() - this.hideDays);

    const policy = await this.policyRepository.findPublicPolicy({ id, today, hideBefore });
    if (policy === null) {
      throw new NotFoundException('정책을 찾을 수 없습니다.');
    }

    return this.toPolicyDetail(policy);
  }

  private toPolicyCard(policy: PolicyEntity): PolicyCard {
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

  private toPolicyDetail(policy: PolicyEntity): PolicyDetail {
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
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toAppliedCriteria(criteria: SearchCriteria): AppliedCriteria {
  // 값이 입력됐는지 자체를 반환한다. 정책별 MATCH 여부는 items.fieldEvaluations에서 확인한다.
  return {
    age: criteria.age !== undefined,
    region: criteria.regionCode !== undefined,
    status: (criteria.statuses?.length ?? 0) > 0,
    householdSize: criteria.householdSize !== undefined,
    income: criteria.householdMonthlyIncome !== undefined,
  };
}
