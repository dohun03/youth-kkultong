/** 검색어를 공백 단위로 나누고 영문 대소문자 통일 */
export function getTitleSearchTerms(keyword: string | undefined): string[] {
  return keyword?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? [];
}

/** 모든 검색 단어가 제목에 포함되면 통과 */
export function matchesPolicyTitle(title: string, terms: readonly string[]): boolean {
  const normalized = title.toLowerCase();
  return terms.every((term) => normalized.includes(term));
}
