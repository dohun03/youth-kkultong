/** 지역 선택 화면에 제공하는 현행 코드·공식 이름·시도 그룹·직접 상위 코드 */
export interface RegionOption {
  code: string;
  name: string;
  provinceName: string;
  parentCode: string | null;
}
