import { checkJob } from '../src/modules/matching/job-match';
import type { JobMatchResult } from '../src/modules/matching/job-match';
import { transformYouthCenterPolicy } from '../src/modules/ingestion/youth-center/youth-center-policy.transform';
import official from './fixtures/eligibility-codes.official.json';

/** 취업 코드의 OR 판정과 미확인 자료에 대한 보수적 처리를 검증한다. */
describe('취업 조건 판정', () => {
  it.each<[readonly string[] | null, string, JobMatchResult]>([
    [['0013003'], '0013003', 'MATCHED'],
    [['0013001'], '0013003', 'EXCLUDED'],
    [['0013001', '0013003'], '0013003', 'MATCHED'],
    [['0013003', '0013001'], '0013003', 'MATCHED'],
    [['0013001', '0013002'], '0013003', 'EXCLUDED'],
    [['0013003', '0013003'], '0013003', 'MATCHED'],
    [['0013001', '0013001'], '0013003', 'EXCLUDED'],
    [['unknown', '0013003'], '0013003', 'MATCHED'],
    [['0013003', 'unknown'], '0013003', 'MATCHED'],
    [['', '0013003'], '0013003', 'MATCHED'],
    [['0013001', 'unknown'], '0013003', 'UNKNOWN'],
    [['0013001', ''], '0013003', 'UNKNOWN'],
    [['0013001', '0049001'], '0013003', 'UNKNOWN'],
    [['0013009'], '0013009', 'MATCHED'],
    [['0013009'], '0013003', 'EXCLUDED'],
    [['0013010'], '0013003', 'UNRESTRICTED'],
    [['0013010'], '0013010', 'UNRESTRICTED'],
    [['0013003', '0013010'], '0013003', 'UNRESTRICTED'],
    [['0013010', '0013003'], '0013003', 'UNRESTRICTED'],
    [['unknown', '0013010'], '0013003', 'UNRESTRICTED'],
    [['0013010', ''], '0013003', 'UNRESTRICTED'],
    [['0013003'], '0013010', 'EXCLUDED'],
    [null, '0013003', 'UNKNOWN'], [[], '0013003', 'UNKNOWN'],
    [[''], '0013003', 'UNKNOWN'], [[' '], '0013003', 'UNKNOWN'],
    [['unknown'], '0013003', 'UNKNOWN'], [['13003'], '0013003', 'UNKNOWN'],
    [['0013003 '], '0013003', 'UNKNOWN'], [['0013011'], '0013003', 'UNKNOWN'],
  ])('정책 코드 %j와 사용자 %s의 판정은 %s다', (jobCodes, jobCode, expected) => {
    expect(checkJob({ jobCodes }, jobCode)).toBe(expected);
  });

  it.each(official.jobCd)('공식 코드 $code ($label)는 자기 자신과 일치하거나 제한 없음이다', ({ code }) => {
    expect(checkJob({ jobCodes: [code] }, code)).toBe(code === '0013010' ? 'UNRESTRICTED' : 'MATCHED');
  });

  it.each<{ jobCodes: readonly string[] | null }>([
    { jobCodes: null }, { jobCodes: [] }, { jobCodes: ['unknown'] },
    { jobCodes: ['0013001'] }, { jobCodes: ['0013010'] },
  ])(
    '사용자 미입력은 정책 %j와 무관하게 별도 결과다', ({ jobCodes }) => {
      expect(checkJob({ jobCodes })).toBe('NOT_PROVIDED');
      expect(checkJob({ jobCodes }, undefined)).toBe('NOT_PROVIDED');
    },
  );

  it.each(['', ' ', 'unknown', '13003', '0013011', '0049001', '0013003 '])(
    '잘못된 사용자 코드 %j는 내부 호출 오류로 알린다', (jobCode) => {
      expect(() => checkJob({ jobCodes: ['0013003'] }, jobCode)).toThrow(RangeError);
      expect(() => checkJob({ jobCodes: ['0013010'] }, jobCode)).toThrow(RangeError);
    },
  );

  it.each<[string | null, JobMatchResult]>([
    ['0013001, 0013003', 'MATCHED'], ['0013001,0013002', 'EXCLUDED'],
    ['unknown,0013003', 'MATCHED'], ['0013001,unknown', 'UNKNOWN'],
    ['0013001, ,', 'UNKNOWN'], ['0013001,0013010', 'UNRESTRICTED'],
    ['0013010,unknown', 'UNRESTRICTED'], [null, 'UNKNOWN'], ['', 'UNKNOWN'], [' \t ', 'UNKNOWN'],
  ])('실제 수집 원문 %j를 변환한 결과는 %s다', (raw, expected) => {
    const policy = transformYouthCenterPolicy({ plcyNo: 'job-test', plcyNm: '취업 판정용', jobCd: raw });
    expect(checkJob(policy, '0013003')).toBe(expected);
  });

  it('추가 설명이 있어도 취업 항목의 불일치 결과만 반환한다', () => {
    const policy = { jobCodes: ['0013001'], extraQualification: '추가 자격', participationRestriction: '참여 제한' };
    expect(checkJob(policy, '0013003')).toBe('EXCLUDED');
  });

  it('정책 코드 배열을 변경하지 않고 같은 입력에 같은 결과를 반환한다', () => {
    const jobCodes = Object.freeze(['unknown', '0013003', '0013003']);
    const policy = Object.freeze({ jobCodes });
    const before = [...jobCodes];
    expect(checkJob(policy, '0013003')).toBe('MATCHED');
    expect(checkJob(policy, '0013003')).toBe('MATCHED');
    expect(jobCodes).toEqual(before);
  });
});
