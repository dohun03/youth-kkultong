/** 쉼표 기준으로 분야를 분리하고 공백, 빈 값, 중복을 제거 */
export function parsePolicyCategories(value: string | null | undefined): string[] {
  return [...new Set((value ?? '').split(',').map((name) => name.trim()).filter(Boolean))];
}
