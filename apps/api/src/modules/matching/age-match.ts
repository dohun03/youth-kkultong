import type { Policy } from '../policies/entities/policy.entity';

/** 나이 항목의 부합·불일치·확인 필요·미입력을 구분. 최종 제외 여부는 종합 판정에서 정한다. */
export type AgeMatchResult = 'MATCHED' | 'EXCLUDED' | 'UNKNOWN' | 'NOT_PROVIDED';

/** 정책의 최소·최대 나이 */
export type PolicyAgeRange = Pick<Policy, 'ageMin' | 'ageMax'>;

/** 사용자 만 나이 판정 */
export function checkAge(policy: PolicyAgeRange, age?: number): AgeMatchResult {
  // 나이 미입력
  if (age === undefined) return 'NOT_PROVIDED';

  // 잘못된 나이 판정
  if (!Number.isInteger(age) || age < 1 || age > 120) {
    throw new RangeError('사용자 만 나이는 1~120 사이 정수여야 합니다.');
  }

  const { ageMin, ageMax } = policy;
  // 0~0·누락·역전·과도한 상한인 경우
  if (ageMin === null || ageMax === null || !Number.isInteger(ageMin) || !Number.isInteger(ageMax) || ageMin < 1 || ageMin > ageMax || ageMax > 120) {
    return 'UNKNOWN';
  }

  // 정상 입력된 나이의 일치 여부
  return age >= ageMin && age <= ageMax ? 'MATCHED' : 'EXCLUDED';
}
