/** 취업·학력 선택지 하나의 공식 코드와 한국어 표시명 */
export interface EligibilityCodeOption {
  readonly code: string;
  readonly label: string;
}

// 온통청년 공식 API코드정보.xlsx의 '코드정보' 시트(jobCd·schoolCd)를 대조함.
// 원본 출처·SHA-256과 대조 결과는 docs/mvp-1/SUMMARY.md의 Step 29에 기록.
// 공식 표의 '기타'도 유효한 선택지이며, 관측 빈도에 따라 코드를 빼거나 추가하지 않음.
/** 취업 요건의 공식 선택지. 앞자리 0을 보존하도록 문자열로 관리 */
export const JOB_OPTIONS = [
  { code: '0013001', label: '재직자' },
  { code: '0013002', label: '자영업자' },
  { code: '0013003', label: '미취업자' },
  { code: '0013004', label: '프리랜서' },
  { code: '0013005', label: '일용근로자' },
  { code: '0013006', label: '(예비)창업자' },
  { code: '0013007', label: '단기근로자' },
  { code: '0013008', label: '영농종사자' },
  { code: '0013009', label: '기타' },
  { code: '0013010', label: '제한없음' },
] as const satisfies readonly EligibilityCodeOption[];

/** 학력 요건의 공식 선택지. 표시명과 문장 부호는 원본 그대로 유지 */
export const SCHOOL_OPTIONS = [
  { code: '0049001', label: '고졸 미만' },
  { code: '0049002', label: '고교 재학' },
  { code: '0049003', label: '고졸 예정' },
  { code: '0049004', label: '고교 졸업' },
  { code: '0049005', label: '대학 재학' },
  { code: '0049006', label: '대졸 예정' },
  { code: '0049007', label: '대학 졸업' },
  { code: '0049008', label: '석·박사' },
  { code: '0049009', label: '기타' },
  { code: '0049010', label: '제한없음' },
] as const satisfies readonly EligibilityCodeOption[];

// '제한없음'을 코드 누락이나 '기타'와 구분. 점수·태그 처리는 후속 매칭 단계의 책임.
/** 취업 제한이 없음을 나타내는 공식 코드 */
export const JOB_UNRESTRICTED_CODE = '0013010';
/** 학력 제한이 없음을 나타내는 공식 코드 */
export const SCHOOL_UNRESTRICTED_CODE = '0049010';
