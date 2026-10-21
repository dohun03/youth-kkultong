import { checkSchool } from '../src/modules/matching/school-match';
import type { SchoolMatchResult } from '../src/modules/matching/school-match';
import { transformYouthCenterPolicy } from '../src/modules/ingestion/youth-center/youth-center-policy.transform';
import official from './fixtures/eligibility-codes.official.json';

/** 학력 코드의 정확한 일치·OR 판정·제한 없음과 미확인 자료의 보수적 처리를 검증한다. */
describe('학력 조건 판정', () => {
  it.each<[readonly string[] | null, string, SchoolMatchResult]>([
    [['0049005'], '0049005', 'MATCHED'],
    [['0049001'], '0049005', 'EXCLUDED'],
    [['0049001', '0049005'], '0049005', 'MATCHED'],
    [['0049005', '0049001'], '0049005', 'MATCHED'],
    [['0049001', '0049002'], '0049005', 'EXCLUDED'],
    [['0049005', '0049005'], '0049005', 'MATCHED'],
    [['0049001', '0049001'], '0049005', 'EXCLUDED'],
    [['unknown', '0049005'], '0049005', 'MATCHED'],
    [['0049005', 'unknown'], '0049005', 'MATCHED'],
    [['', '0049005'], '0049005', 'MATCHED'],
    [['0049001', 'unknown'], '0049005', 'UNKNOWN'],
    [['0049001', ''], '0049005', 'UNKNOWN'],
    [['0049001', '0013001'], '0049005', 'UNKNOWN'],
    [['0049009'], '0049009', 'MATCHED'],
    [['0049009'], '0049005', 'EXCLUDED'],
    [['0049010'], '0049005', 'UNRESTRICTED'],
    [['0049010'], '0049010', 'UNRESTRICTED'],
    [['0049005', '0049010'], '0049005', 'UNRESTRICTED'],
    [['0049010', '0049005'], '0049005', 'UNRESTRICTED'],
    [['unknown', '0049010'], '0049005', 'UNRESTRICTED'],
    [['0049010', ''], '0049005', 'UNRESTRICTED'],
    [['0049005'], '0049010', 'EXCLUDED'],
    [null, '0049005', 'UNKNOWN'], [[], '0049005', 'UNKNOWN'],
    [[''], '0049005', 'UNKNOWN'], [[' '], '0049005', 'UNKNOWN'],
    [['unknown'], '0049005', 'UNKNOWN'], [['49005'], '0049005', 'UNKNOWN'],
    [['0049005 '], '0049005', 'UNKNOWN'], [['0049011'], '0049005', 'UNKNOWN'],
    [['0049004'], '0049007', 'EXCLUDED'],
    [['0049007'], '0049008', 'EXCLUDED'],
    [['0049007'], '0049005', 'EXCLUDED'],
  ])('정책 코드 %j와 사용자 %s의 판정은 %s다', (schoolCodes, schoolCode, expected) => {
    expect(checkSchool({ schoolCodes }, schoolCode)).toBe(expected);
  });

  it.each(official.schoolCd)('공식 코드 $code ($label)는 자기 자신과 일치하거나 제한 없음이다', ({ code }) => {
    expect(checkSchool({ schoolCodes: [code] }, code)).toBe(code === '0049010' ? 'UNRESTRICTED' : 'MATCHED');
  });

  it.each<{ schoolCodes: readonly string[] | null }>([
    { schoolCodes: null }, { schoolCodes: [] }, { schoolCodes: ['unknown'] },
    { schoolCodes: ['0049001'] }, { schoolCodes: ['0049010'] },
  ])('사용자 미입력은 정책 %j와 무관하게 별도 결과다', ({ schoolCodes }) => {
    expect(checkSchool({ schoolCodes })).toBe('NOT_PROVIDED');
    expect(checkSchool({ schoolCodes }, undefined)).toBe('NOT_PROVIDED');
  });

  it.each(['', ' ', 'unknown', '49005', '0049011', '0013001', '0049005 '])(
    '잘못된 사용자 코드 %j는 내부 호출 오류로 알린다', (schoolCode) => {
      expect(() => checkSchool({ schoolCodes: ['0049005'] }, schoolCode)).toThrow(RangeError);
      expect(() => checkSchool({ schoolCodes: ['0049010'] }, schoolCode)).toThrow(RangeError);
    },
  );

  it.each<[string | null, SchoolMatchResult]>([
    ['0049001, 0049005', 'MATCHED'], ['0049001,0049002', 'EXCLUDED'],
    ['unknown,0049005', 'MATCHED'], ['0049001,unknown', 'UNKNOWN'],
    ['0049001, ,', 'UNKNOWN'], ['0049001,0049010', 'UNRESTRICTED'],
    ['0049010,unknown', 'UNRESTRICTED'], [null, 'UNKNOWN'], ['', 'UNKNOWN'], [' \t ', 'UNKNOWN'],
  ])('실제 수집 원문 %j를 변환한 결과는 %s다', (raw, expected) => {
    const policy = transformYouthCenterPolicy({ plcyNo: 'school-test', plcyNm: '학력 판정용', schoolCd: raw });
    expect(checkSchool(policy, '0049005')).toBe(expected);
  });

  it('추가 설명이 있어도 학력 항목의 불일치 결과만 반환한다', () => {
    const policy = { schoolCodes: ['0049001'], extraQualification: '추가 자격', participationRestriction: '참여 제한' };
    expect(checkSchool(policy, '0049005')).toBe('EXCLUDED');
  });

  it('정책 코드 배열을 변경하지 않고 같은 입력에 같은 결과를 반환한다', () => {
    const schoolCodes = Object.freeze(['unknown', '0049005', '0049005']);
    const policy = Object.freeze({ schoolCodes });
    const before = [...schoolCodes];
    expect(checkSchool(policy, '0049005')).toBe('MATCHED');
    expect(checkSchool(policy, '0049005')).toBe('MATCHED');
    expect(schoolCodes).toEqual(before);
  });
});
