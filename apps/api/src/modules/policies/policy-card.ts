import type { PolicyCard } from '@youth-kkultong/shared';
import type { Policy } from './entities/policy.entity';

/** 목록·상세에서 공통 카드 응답을 만들 때 필요한 필드 */
export type PolicyCardInput = Pick<Policy,
  'id' | 'title' | 'category' | 'subcategory' | 'applicationPeriodRaw' | 'applicationEndDate' | 'viewCount'
> & Pick<PolicyCard, 'applicationStatus' | 'score' | 'tags'> & { benefitPreview: string | null };

/** 내부 조건을 노출하지 않고 공용 카드 필드만 옮긴다. 태그 배열도 별도로 복사한다. */
export function toPolicyCard(policy: PolicyCardInput): PolicyCard {
  return {
    id: policy.id,
    title: policy.title,
    category: policy.category,
    subcategory: policy.subcategory,
    benefitPreview: policy.benefitPreview ?? '',
    applicationStatus: policy.applicationStatus,
    applicationPeriodText: policy.applicationPeriodRaw,
    applicationEndDate: policy.applicationEndDate,
    viewCount: policy.viewCount,
    score: policy.score,
    tags: [...policy.tags],
  };
}
