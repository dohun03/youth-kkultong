import type { MatchTag, UserConditions } from '@youth-kkultong/shared';
import { checkAge } from './age-match';
import type { PolicyAgeRange } from './age-match';
import { checkJob } from './job-match';
import type { PolicyJobCodes } from './job-match';
import { checkSchool } from './school-match';
import type { PolicySchoolCodes } from './school-match';
import { checkRegion } from './region-match';
import type { ActiveRegionMap, PolicyRegionCodes } from './region-match';

/** 경량 정책 후보의 자격 조건과 추가 자격·참여 제한 설명의 존재 여부 */
export type PolicyMatchingInput = PolicyAgeRange & PolicyJobCodes & PolicySchoolCodes & PolicyRegionCodes & { hasExtraText: boolean; };

/** 최종 제외 여부, 확인된 일치 점수, 태그 */
export interface PolicyMatchResult {
  excluded: boolean;
  score: number;
  tags: MatchTag[];
}

/** 항목별 판정을 조합해 제외하고, 일치 점수와 확인 태그를 계산 */
export function evaluatePolicy(
  policy: PolicyMatchingInput,
  conditions: UserConditions | undefined,
  activeRegions: ActiveRegionMap,
): PolicyMatchResult {
  // 사용자 조건이 없으면 점수와 태그를 비운다.
  if (!conditions || (conditions.age === undefined && conditions.jobCode === undefined
    && conditions.schoolCode === undefined && conditions.regionCode === undefined)) {
    return { excluded: false, score: 0, tags: [] };
  }

  // 기존 순수 함수를 호출한다. 입력하지 않은 항목은 각 함수에서 미입력으로 구분한다.
  const results = [
    { result: checkAge(policy, conditions.age), matchTag: 'AGE_MATCH', reviewTag: 'AGE_REVIEW' },
    { result: checkJob(policy, conditions.jobCode), matchTag: 'JOB_MATCH', reviewTag: 'JOB_REVIEW' },
    { result: checkSchool(policy, conditions.schoolCode), matchTag: 'SCHOOL_MATCH', reviewTag: 'SCHOOL_REVIEW' },
  ] as const;
  const region = checkRegion(policy, conditions.regionCode, activeRegions);
  let score = region.score;
  let excluded = false;
  const tags: MatchTag[] = [];
  const reviewTags: MatchTag[] = [];

  for (const { result, matchTag, reviewTag } of results) {
    // 명확한 부합만 1점. 제한 없음·미입력·확인 필요에는 가점이나 감점이 없다.
    if (result === 'MATCHED') {
      score += 1;
      tags.push(matchTag);
    } else if (result === 'UNKNOWN' || (result === 'EXCLUDED' && policy.hasExtraText)) {
      // 추가 설명이 있으면 구조화된 조건의 불일치를 제외 대신 항목별 확인 필요로 전환한다.
      reviewTags.push(reviewTag);
    }

    // 나이·취업·학력 중 하나라도 확실히 불일치하고 추가 설명이 없으면 제외한다.
    if (result === 'EXCLUDED' && !policy.hasExtraText) excluded = true;
  }

  // 태그는 부합 → 추가 조건 → 항목별 확인 → 지역 순서로 일정하게 조합한다.
  if (policy.hasExtraText) tags.push('EXTRA_REVIEW');
  tags.push(...reviewTags, ...region.tags);
  return { excluded, score, tags };
}
