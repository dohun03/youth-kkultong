import { parsePolicyCategories } from '@youth-kkultong/shared';
/** 원문을 바꾸지 않고 분야 선택·판정·표시에서 공유할 분리 규칙을 검증한다. */
describe('분야 분리', () => {
  it.each([
    [null, []], ['', []], [' , , ', []], ['일자리,일자리,일자리', ['일자리']],
    [' 일자리, 교육,일자리 ', ['일자리', '교육']],
    ['금융･복지･문화,금융･복지･문화', ['금융･복지･문화']],
    ['교육,교육･직업훈련', ['교육', '교육･직업훈련']],
  ] as const)('%s 분야를 정리한다', (raw, expected) => expect(parsePolicyCategories(raw)).toEqual(expected));
});
