import { getTitleSearchTerms, matchesPolicyTitle } from '../src/modules/policies/title-search';
import { createPolicySearchSchema } from '@youth-kkultong/shared';

/** 제목 검색의 단어 분리·문자 비교와 요청 검증을 확인한다. */
describe('정책 제목 검색', () => {
  it.each([undefined, '', '  \t\n'])('빈 검색어 %j는 필터를 적용하지 않는다', (keyword) => {
    expect(matchesPolicyTitle('청년 정책', getTitleSearchTerms(keyword))).toBe(true);
  });
  it.each([
    ['청년 주거 지원', ' 주거   청년 ', true],
    ['청년 취업 지원', '청년 주거', false],
    ['청년 IT 취업', 'it 청년', true],
    ['청년 A+B (50%) 지원', 'A+B (50%)', true],
    ['청년 주거 지원', '.*', false],
    ['청년 주거 지원', '%', false],
    ['청년주거 지원', '주거', true],
  ])('%s 제목에 %s 검색 → %s', (title, keyword, expected) => {
    expect(matchesPolicyTitle(title, getTitleSearchTerms(keyword))).toBe(expected);
  });
  const schema = createPolicySearchSchema({ regionCodes: new Set(), jobCodes: new Set(), schoolCodes: new Set() });
  it('앞뒤 공백을 제거하고 최대 100자를 허용한다', () => {
    expect(schema.parse({ keyword: '  청년  ' }).keyword).toBe('청년');
    expect(schema.safeParse({ keyword: '가'.repeat(100) }).success).toBe(true);
  });
  it.each([null, 1, [], {}, '가'.repeat(101)])('잘못된 검색어를 거부한다', (keyword) => {
    expect(schema.safeParse({ keyword }).success).toBe(false);
  });
});
