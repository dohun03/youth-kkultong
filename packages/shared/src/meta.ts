/** 지역 선택 화면에 제공하는 현행 코드·공식 이름·시도 그룹·직접 상위 코드 */
export interface RegionOption {
  code: string;
  name: string;
  provinceName: string;
  parentCode: string | null;
}

/** 취업·학력 선택지 하나의 공식 코드와 한국어 표시명 */
export interface EligibilityCodeOption {
  readonly code: string;
  readonly label: string;
}

/** 취업·학력 코드표 API 응답. 실제 코드값은 서버에서 관리 */
export interface EligibilityCodesResponse {
  jobCodes: readonly EligibilityCodeOption[];
  schoolCodes: readonly EligibilityCodeOption[];
}
