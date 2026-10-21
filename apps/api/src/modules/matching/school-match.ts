import { SCHOOL_OPTIONS, SCHOOL_UNRESTRICTED_CODE } from '../meta/eligibility-codes';

/** 학력 항목의 부합·불일치·확인 필요·미입력·제한 없음을 구분 */
export type SchoolMatchResult = 'MATCHED' | 'EXCLUDED' | 'UNKNOWN' | 'NOT_PROVIDED' | 'UNRESTRICTED';

/** 수집 단계에서 쉼표를 나누고 공백을 제거한 정책 학력 코드 목록 */
export interface PolicySchoolCodes {
  schoolCodes: readonly string[] | null;
}

/** 공식 코드표의 유효한 학력 코드만 판정 */
const validSchoolCodes = new Set<string>(SCHOOL_OPTIONS.map(({ code }) => code));

/** 사용자 학력 코드 판정 */
export function checkSchool(policy: PolicySchoolCodes, schoolCode?: string): SchoolMatchResult {
  // 학력 코드 미입력
  if (schoolCode === undefined) return 'NOT_PROVIDED';

  // 잘못된 학력 코드 판정
  if (!validSchoolCodes.has(schoolCode)) {
    throw new RangeError('사용자 학력 코드는 공식 학력 코드표의 값이어야 합니다.');
  }

  const codes = policy.schoolCodes;
  // 정책에 학력코드가 없는 경우
  if (codes === null || codes.length === 0) return 'UNKNOWN';

  // OR 조건 중 제한 없음이 있으면 통과. 가점은 주지 않는다
  if (codes.includes(SCHOOL_UNRESTRICTED_CODE)) return 'UNRESTRICTED';
  // 미확인 코드가 섞여 있어도 확인된 코드가 하나라도 일치하면 부합
  if (codes.includes(schoolCode)) return 'MATCHED';

  // 모두 불일치할 때 제외 후보 또는 확인 필요로 구분
  return codes.every((code) => validSchoolCodes.has(code)) ? 'EXCLUDED' : 'UNKNOWN';
}
