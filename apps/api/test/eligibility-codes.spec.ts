import { createPolicySearchSchema } from '@youth-kkultong/shared';
import {
  JOB_OPTIONS, JOB_UNRESTRICTED_CODE, SCHOOL_OPTIONS, SCHOOL_UNRESTRICTED_CODE,
} from '../src/modules/meta/eligibility-codes';
import official from './fixtures/eligibility-codes.official.json';

// 공식 엑셀에서 직접 추출한 기대값을 사용. 로컬 조사 폴더가 없어도 대조 결과를 재검증.
describe('공식 취업·학력 서버 코드표', () => {
  it.each([
    ['취업', JOB_OPTIONS, official.jobCd],
    ['학력', SCHOOL_OPTIONS, official.schoolCd],
  ])('%s 코드·명칭·순서가 공식 원본의 10개 선택지와 정확히 같다', (_name, options, expected) => {
    expect(options).toEqual(expected);
    expect(options).toHaveLength(10);
    expect(new Set(options.map(({ code }) => code)).size).toBe(options.length);
    for (const { code, label } of options) {
      expect(code).toMatch(/^\d{7}$/);
      expect(label.trim()).not.toBe('');
    }
  });

  it('제한없음 코드는 각각 정확히 하나이며 기타와 구분된다', () => {
    expect(JOB_UNRESTRICTED_CODE).toBe('0013010');
    expect(SCHOOL_UNRESTRICTED_CODE).toBe('0049010');
    expect(JOB_OPTIONS.filter(({ label }) => label === '제한없음'))
      .toEqual([{ code: JOB_UNRESTRICTED_CODE, label: '제한없음' }]);
    expect(SCHOOL_OPTIONS.filter(({ label }) => label === '제한없음'))
      .toEqual([{ code: SCHOOL_UNRESTRICTED_CODE, label: '제한없음' }]);
    expect(JOB_OPTIONS).toContainEqual({ code: '0013009', label: '기타' });
    expect(SCHOOL_OPTIONS).toContainEqual({ code: '0049009', label: '기타' });
  });

  // 실제 요청 검증에 이 표를 전달했을 때 모든 선택지가 허용되는지도 확인
  const schema = createPolicySearchSchema({
    regionCodes: new Set(),
    jobCodes: new Set(JOB_OPTIONS.map(({ code }) => code)),
    schoolCodes: new Set(SCHOOL_OPTIONS.map(({ code }) => code)),
  });

  it.each(official.jobCd)('공식 취업 코드 $code ($label)를 요청에 사용할 수 있다', ({ code }) => {
    expect(schema.parse({ conditions: { jobCode: code } }).conditions?.jobCode).toBe(code);
  });

  it.each(official.schoolCd)('공식 학력 코드 $code ($label)를 요청에 사용할 수 있다', ({ code }) => {
    expect(schema.parse({ conditions: { schoolCode: code } }).conditions?.schoolCode).toBe(code);
  });

  it.each([
    { jobCode: '0013011' }, { schoolCode: '0049011' },
    { jobCode: SCHOOL_UNRESTRICTED_CODE }, { schoolCode: JOB_UNRESTRICTED_CODE },
    { jobCode: '13001' }, { schoolCode: '대학 재학' },
    { jobCode: '0013001,0013003' }, { jobCode: ' 0013001 ' },
  ])('미확인·다른 그룹·잘못된 형식의 입력을 거부한다: %j', (conditions) => {
    expect(schema.safeParse({ conditions }).success).toBe(false);
  });
});
