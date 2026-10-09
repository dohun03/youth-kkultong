import {
  PolicyListQuerySchema,
  type PolicyCard,
  type PolicyListQuery,
  type PolicyListResponse,
} from '@kkultong/contracts';
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
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
