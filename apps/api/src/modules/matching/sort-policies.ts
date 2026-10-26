import type { ApplicationStatus, MatchTag, SortKey } from '@youth-kkultong/shared';
import type { Policy } from '../policies/entities/policy.entity';

/** 경량 정책 후보에 검색 시점의 신청 상태와 맞춤 점수를 붙인 정렬 입력 */
export type SortablePolicy = Pick<Policy,
  'id' | 'externalId' | 'viewCount' | 'sourceRegisteredAt' | 'applicationStartDate' | 'applicationEndDate'
> & {
  applicationStatus: ApplicationStatus;
  score: number;
  tags: readonly MatchTag[];
};

/** 마감순의 신청 상태 그룹 */
const deadlineGroups: Record<ApplicationStatus, number> = {
  OPEN: 0, CLOSING_SOON: 0, UPCOMING: 1, ALWAYS_OPEN: 2, UNKNOWN: 3, CLOSED: 4,
};

/** 숫자·날짜 문자열을 지정 방향으로 비교하되 NULL은 항상 뒤로 보낸다. */
function compareValues<T extends string | number>(left: T | null, right: T | null, direction: 'ASC' | 'DESC'): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  const result = left < right ? -1 : left > right ? 1 : 0;
  return direction === 'ASC' ? result : -result;
}

/** 네 가지 목록 정렬을 적용한 새 배열을 반환하며 정책 자료와 입력 배열은 변경하지 않는다. */
export function sortPolicies<T extends SortablePolicy>(policies: readonly T[], sort: SortKey, prioritizeRegion = false): T[] {
  return [...policies].sort((left, right) => {
    let order = 0;

    // 선택 정렬의 기준을 먼저 비교하고, 동점이면 아래 공통 기준으로 내려간다.
    switch (sort) {
      case 'recommended':
        // 지역 우선 정렬
        order = (prioritizeRegion ? Number(right.tags.includes('REGION_RELATED')) - Number(left.tags.includes('REGION_RELATED')) : 0)
          || right.score - left.score
          || Number(right.applicationStatus === 'CLOSING_SOON') - Number(left.applicationStatus === 'CLOSING_SOON')
          || compareValues(left.viewCount, right.viewCount, 'DESC');
        break;
      case 'popular':
        order = compareValues(left.viewCount, right.viewCount, 'DESC');
        break;
      case 'deadline':
        order = deadlineGroups[left.applicationStatus] - deadlineGroups[right.applicationStatus];
        if (order === 0 && deadlineGroups[left.applicationStatus] === 0) {
          // YYYY-MM-DD는 문자열 순서와 날짜 순서가 같으므로 시각·시간대 변환이 필요 없다.
          order = compareValues(left.applicationEndDate, right.applicationEndDate, 'ASC');
        } else if (order === 0 && left.applicationStatus === 'UPCOMING') {
          order = compareValues(left.applicationStartDate, right.applicationStartDate, 'ASC');
        }
        break;
      case 'newest':
        // 최신순의 최초 등록일 비교는 아래 공통 동점 기준의 첫 항목과 같다.
        break;
    }

    // 모든 정렬에서 최초 등록일 → 외부 ID → 내부 ID를 비교해 입력 순서와 무관한 결과를 만든다.
    return order
      || compareValues(left.sourceRegisteredAt?.getTime() ?? null, right.sourceRegisteredAt?.getTime() ?? null, 'DESC')
      || compareValues(left.externalId, right.externalId, 'ASC')
      || compareValues(left.id, right.id, 'ASC');
  });
}
