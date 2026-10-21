import type { UserConditions } from '@youth-kkultong/shared';
import { evaluatePolicy } from '../src/modules/matching/evaluate-policy';
import type { PolicyMatchingInput, PolicyMatchResult } from '../src/modules/matching/evaluate-policy';
import type { ActiveRegionMap } from '../src/modules/matching/region-match';
import snapshot from '../src/database/seeds/regions.json';

/** 실제 항목별 함수를 조합해 SPEC T-02~T-11과 점수·태그·보수적 제외를 검증한다. */
describe('정책 조건 종합 판정', () => {
  const regions: ActiveRegionMap = new Map(snapshot.regions.filter((region) => region.isActive)
    .map((region) => [region.code, region]));
  const policy: PolicyMatchingInput = {
    ageMin: 19, ageMax: 34, jobCodes: ['0013003'], schoolCodes: ['0049007'],
    regionCodes: ['41110'], hasExtraText: false,
  };

  it.each<{
    name: string; changes: Partial<PolicyMatchingInput>; conditions: UserConditions; expected: PolicyMatchResult;
  }>([
    { name: 'T-02 나이 부합', changes: {}, conditions: { age: 28 },
      expected: { excluded: false, score: 1, tags: ['AGE_MATCH'] } },
    { name: 'T-03 유효 나이 불일치', changes: { ageMin: 35, ageMax: 39 }, conditions: { age: 28 },
      expected: { excluded: true, score: 0, tags: [] } },
    { name: 'T-04 추가 설명이 있으면 제외 보류', changes: { ageMin: 35, ageMax: 39, hasExtraText: true },
      conditions: { age: 28 }, expected: { excluded: false, score: 0, tags: ['EXTRA_REVIEW', 'AGE_REVIEW'] } },
    { name: 'T-05 0~0 나이', changes: { ageMin: 0, ageMax: 0 }, conditions: { age: 28 },
      expected: { excluded: false, score: 0, tags: ['AGE_REVIEW'] } },
    { name: 'T-05 과도한 나이 상한', changes: { ageMax: 999 }, conditions: { age: 28 },
      expected: { excluded: false, score: 0, tags: ['AGE_REVIEW'] } },
    { name: 'T-06 학력 제한 없음은 0점', changes: { schoolCodes: ['0049010'] }, conditions: { schoolCode: '0049007' },
      expected: { excluded: false, score: 0, tags: [] } },
    { name: 'T-07 복수 취업 코드 OR', changes: { jobCodes: ['0013001', '0013003'] }, conditions: { jobCode: '0013003' },
      expected: { excluded: false, score: 1, tags: ['JOB_MATCH'] } },
    { name: 'T-08 미확인 취업 코드 혼합', changes: { jobCodes: ['0013001', 'unknown'] }, conditions: { jobCode: '0013003' },
      expected: { excluded: false, score: 0, tags: ['JOB_REVIEW'] } },
    { name: 'T-09 다른 지역은 유지', changes: { regionCodes: ['11110'] }, conditions: { regionCode: '41111' },
      expected: { excluded: false, score: 0, tags: [] } },
    { name: 'T-10 상위 시 관련', changes: {}, conditions: { regionCode: '41111' },
      expected: { excluded: false, score: 0.5, tags: ['REGION_RELATED'] } },
    { name: 'T-11 폐지 지역만 존재', changes: { regionCodes: ['28110'] }, conditions: { regionCode: '41111' },
      expected: { excluded: false, score: 0, tags: ['REGION_REVIEW'] } },
  ])('$name', ({ changes, conditions, expected }) => {
    expect(evaluatePolicy({ ...policy, ...changes }, conditions, regions)).toEqual(expected);
  });

  const allConditions: UserConditions = { age: 28, jobCode: '0013003', schoolCode: '0049007', regionCode: '41111' };

  it('모든 항목이 부합하면 최대 3.5점이며 태그가 중복되지 않는다', () => {
    expect(evaluatePolicy({ ...policy, regionCodes: ['41111', '41110', '41111'] }, allConditions, regions))
      .toEqual({ excluded: false, score: 3.5, tags: ['AGE_MATCH', 'JOB_MATCH', 'SCHOOL_MATCH', 'REGION_RELATED'] });
  });

  it.each<Partial<PolicyMatchingInput>>([
    { ageMin: 35, ageMax: 39 }, { jobCodes: ['0013001'] }, { schoolCodes: ['0049001'] },
  ])('한 항목이라도 확실한 불일치면 다른 부합·지역 가점이 있어도 제외한다: %j', (changes) => {
    const result = evaluatePolicy({ ...policy, ...changes }, allConditions, regions);
    expect(result.excluded).toBe(true);
    expect(result.score).toBe(2.5);
  });

  it('추가 설명은 모든 불일치 항목을 확인 태그로 전환한다', () => {
    expect(evaluatePolicy({
      ...policy, ageMin: 35, ageMax: 39, jobCodes: ['0013001'], schoolCodes: ['0049001'], hasExtraText: true,
    }, allConditions, regions)).toEqual({
      excluded: false, score: 0.5, tags: ['EXTRA_REVIEW', 'AGE_REVIEW', 'JOB_REVIEW', 'SCHOOL_REVIEW', 'REGION_RELATED'],
    });
  });

  it('추가 설명이 있어도 확인된 부합 가점은 유지한다', () => {
    expect(evaluatePolicy({ ...policy, jobCodes: ['0013001'], hasExtraText: true }, allConditions, regions))
      .toEqual({ excluded: false, score: 2.5,
        tags: ['AGE_MATCH', 'SCHOOL_MATCH', 'EXTRA_REVIEW', 'JOB_REVIEW', 'REGION_RELATED'] });
  });

  it('추가 설명만 있어도 사용자 조건이 있으면 추가 조건 확인을 표시한다', () => {
    expect(evaluatePolicy({ ...policy, hasExtraText: true }, { age: 28 }, regions))
      .toEqual({ excluded: false, score: 1, tags: ['AGE_MATCH', 'EXTRA_REVIEW'] });
  });

  it('미확인 항목은 감점하지 않고 확인된 부합 점수를 유지한다', () => {
    expect(evaluatePolicy({ ...policy, ageMin: null, jobCodes: ['unknown'] }, allConditions, regions))
      .toEqual({ excluded: false, score: 1.5, tags: ['SCHOOL_MATCH', 'AGE_REVIEW', 'JOB_REVIEW', 'REGION_RELATED'] });
  });

  it('정책 조건이 모두 누락되면 제한 없음으로 추정하지 않는다', () => {
    expect(evaluatePolicy({ ageMin: null, ageMax: null, jobCodes: null, schoolCodes: null,
      regionCodes: null, hasExtraText: false }, allConditions, regions)).toEqual({ excluded: false, score: 0,
      tags: ['AGE_REVIEW', 'JOB_REVIEW', 'SCHOOL_REVIEW', 'REGION_REVIEW'] });
  });

  it('제한 없음은 일치 코드·미확인 코드가 섞여 있어도 가점·일치 태그를 만들지 않는다', () => {
    expect(evaluatePolicy({ ...policy, jobCodes: ['0013003', '0013010', 'unknown'],
      schoolCodes: ['0049010', '0049007'] }, { jobCode: '0013003', schoolCode: '0049007' }, regions))
      .toEqual({ excluded: false, score: 0, tags: [] });
  });

  it.each<{ conditions: UserConditions; expected: PolicyMatchResult }>([
    { conditions: { jobCode: '0013003' }, expected: { excluded: false, score: 1, tags: ['JOB_MATCH'] } },
    { conditions: { schoolCode: '0049007' }, expected: { excluded: false, score: 1, tags: ['SCHOOL_MATCH'] } },
    { conditions: { age: 28, jobCode: '0013003' }, expected: { excluded: false, score: 2, tags: ['AGE_MATCH', 'JOB_MATCH'] } },
    { conditions: { regionCode: '41111' }, expected: { excluded: false, score: 0.5, tags: ['REGION_RELATED'] } },
  ])('입력한 조건만 점수와 태그에 반영한다: $conditions', ({ conditions, expected }) => {
    expect(evaluatePolicy({ ...policy, ageMin: null, ...('age' in conditions ? { ageMin: 19 } : {}) }, conditions, regions))
      .toEqual(expected);
  });

  it.each<{ conditions: UserConditions | undefined }>([
    { conditions: undefined }, { conditions: {} },
    { conditions: { age: undefined, jobCode: undefined, schoolCode: undefined, regionCode: undefined } },
  ])('사용자 조건이 없으면 추가 설명·정책 오류와 무관하게 빈 결과다: $conditions', ({ conditions }) => {
    expect(evaluatePolicy({ ...policy, ageMin: 0, jobCodes: null, schoolCodes: ['unknown'],
      hasExtraText: true }, conditions, new Map())).toEqual({ excluded: false, score: 0, tags: [] });
  });

  it.each<UserConditions>([{ age: 121 }, { jobCode: 'unknown' }, { schoolCode: 'unknown' }, { regionCode: '28110' }])(
    '잘못된 내부 입력 %j의 검증 오류를 숨기지 않는다', (conditions) => {
      expect(() => evaluatePolicy(policy, conditions, regions)).toThrow(RangeError);
    },
  );

  it('정책·사용자 조건·지역 조회표를 변경하지 않고 독립된 결과를 반환한다', () => {
    const input = Object.freeze({ ...policy, jobCodes: Object.freeze(['0013003']),
      schoolCodes: Object.freeze(['0049007']), regionCodes: Object.freeze(['41110']) });
    const conditions = Object.freeze({ ...allConditions });
    const before = JSON.stringify({ input, conditions, regions: [...regions] });
    const result = evaluatePolicy(input, conditions, regions);
    const expected = structuredClone(result);
    result.tags.length = 0;
    expect(evaluatePolicy(input, conditions, regions)).toEqual(expected);
    expect(JSON.stringify({ input, conditions, regions: [...regions] })).toBe(before);
  });
});
