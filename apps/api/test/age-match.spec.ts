import { checkAge } from '../src/modules/matching/age-match';
import type { AgeMatchResult, PolicyAgeRange } from '../src/modules/matching/age-match';
import { transformYouthCenterPolicy } from '../src/modules/ingestion/youth-center/youth-center-policy.transform';

/** 나이 구간의 경계와 불명확한 정책 조건을 보수적으로 판정하는지 검증한다. */
describe('나이 조건 판정', () => {
  it.each<[number, number, number, AgeMatchResult]>([
    [19, 34, 28, 'MATCHED'], [35, 39, 28, 'EXCLUDED'],
    [19, 34, 18, 'EXCLUDED'], [19, 34, 19, 'MATCHED'],
    [19, 34, 34, 'MATCHED'], [19, 34, 35, 'EXCLUDED'],
    [28, 28, 27, 'EXCLUDED'], [28, 28, 28, 'MATCHED'], [28, 28, 29, 'EXCLUDED'],
    [1, 120, 1, 'MATCHED'], [1, 120, 120, 'MATCHED'],
    [1, 1, 1, 'MATCHED'], [1, 1, 2, 'EXCLUDED'],
    [120, 120, 120, 'MATCHED'], [120, 120, 119, 'EXCLUDED'],
  ])('정책 %i~%i세에서 사용자 %i세는 %s다', (ageMin, ageMax, age, expected) => {
    expect(checkAge({ ageMin, ageMax }, age)).toBe(expected);
  });

  it.each<[number | null, number | null]>([
    [0, 0], [null, null], [null, 34], [19, null], [35, 19],
    [0, 34], [-1, 34], [19, 0], [19, -1], [19, 121], [19, 999], [121, 121],
    [19.5, 34], [19, 34.5], [NaN, 34], [19, NaN],
    [-Infinity, 34], [19, Infinity],
  ])('정책 범위 %j~%j는 확인 필요이며 불일치로 단정하지 않는다', (ageMin, ageMax) => {
    expect(checkAge({ ageMin, ageMax }, 28)).toBe('UNKNOWN');
  });

  it.each<PolicyAgeRange>([
    { ageMin: 19, ageMax: 34 }, { ageMin: 35, ageMax: 39 },
    { ageMin: 0, ageMax: 0 }, { ageMin: null, ageMax: null },
  ])('나이를 입력하지 않으면 정책 %j에서도 미입력으로 구분한다', (policy) => {
    expect(checkAge(policy)).toBe('NOT_PROVIDED');
    expect(checkAge(policy, undefined)).toBe('NOT_PROVIDED');
  });

  it.each([0, -1, 121, 999, 19.5, NaN, Infinity, -Infinity])('잘못된 사용자 나이 %j는 내부 호출 오류로 알린다', (age) => {
    expect(() => checkAge({ ageMin: 19, ageMax: 34 }, age)).toThrow(RangeError);
  });

  it.each<[string | null, string | null, AgeMatchResult]>([
    ['19', '34', 'MATCHED'], ['35', '39', 'EXCLUDED'], ['0', '0', 'UNKNOWN'],
    [null, '34', 'UNKNOWN'], ['19', null, 'UNKNOWN'], ['39', '19', 'UNKNOWN'],
    ['19', '999', 'UNKNOWN'], ['', ' ', 'UNKNOWN'],
  ])('실제 수집 변환 결과 %j~%j를 판정한다', (min, max, expected) => {
    const policy = transformYouthCenterPolicy({
      plcyNo: 'age-test', plcyNm: '나이 판정용', sprtTrgtMinAge: min, sprtTrgtMaxAge: max,
    });
    expect(checkAge(policy, 28)).toBe(expected);
  });

  it('추가 자격·참여 제한이 있어도 나이 항목 결과만 반환한다', () => {
    const policy = { ageMin: 35, ageMax: 39, extraQualification: '추가 자격', participationRestriction: '참여 제한' };
    expect(checkAge(policy, 28)).toBe('EXCLUDED');
  });

  it('동일한 입력의 결과가 같고 정책 자료를 변경하지 않는다', () => {
    const policy = Object.freeze({ ageMin: 19, ageMax: 34 });
    const before = { ...policy };
    expect(checkAge(policy, 28)).toBe('MATCHED');
    expect(checkAge(policy, 28)).toBe('MATCHED');
    expect(policy).toEqual(before);
  });
});
