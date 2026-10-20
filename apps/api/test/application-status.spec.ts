import type { ApplicationStatus } from '@youth-kkultong/shared';
import { calculateApplicationStatus, getKoreaToday } from '../src/modules/policies/application-status';
import type { ApplicationPeriod } from '../src/modules/policies/application-status';
import { transformYouthCenterPolicy } from '../src/modules/ingestion/youth-center/youth-center-policy.transform';

/** 저장된 날짜를 비교하는 상태 계산과 한국 자정 경계를 검증한다. */
describe('신청 상태 계산', () => {
  const period: ApplicationPeriod = {
    applicationPeriodCode: '0057001', applicationPeriodRaw: '20261001 ~ 20261022',
    applicationStartDate: '2026-10-01', applicationEndDate: '2026-10-22',
  };

  it.each<[string, ApplicationStatus]>([
    ['2026-09-30', 'UPCOMING'], ['2026-10-01', 'OPEN'], ['2026-10-14', 'OPEN'],
    ['2026-10-15', 'CLOSING_SOON'], ['2026-10-22', 'CLOSING_SOON'], ['2026-10-23', 'CLOSED'],
  ])('오늘 %s의 상태는 %s다 (시작일·8일·7일·0일·다음날)', (today, expected) => {
    expect(calculateApplicationStatus(period, today)).toBe(expected);
  });

  it.each([null, '', '미확인', '0057001'])('코드 %j여도 단일 유효 날짜가 있으면 날짜로 판단한다', (code) => {
    expect(calculateApplicationStatus({ ...period, applicationPeriodCode: code }, '2026-10-15'))
      .toBe('CLOSING_SOON');
  });

  it.each([null, '', '  ', '상시', ' 상시 '])('날짜 충돌 없는 상시 원문 %j를 허용한다', (raw) => {
    expect(calculateApplicationStatus({
      applicationPeriodCode: '0057002', applicationPeriodRaw: raw,
      applicationStartDate: null, applicationEndDate: null,
    }, '2026-10-21')).toBe('ALWAYS_OPEN');
  });

  it.each(['2026-09-30', '2026-10-15', '2026-10-23'])('상시 코드와 유한 날짜가 충돌하면 %s에도 확인 필요다', (today) => {
    expect(calculateApplicationStatus({ ...period, applicationPeriodCode: '0057002' }, today)).toBe('UNKNOWN');
  });

  it.each<[string | null, string | null]>([
    [null, null], [null, '2026-10-22'], ['2026-10-01', null], ['2026-10-23', '2026-10-22'],
    ['2026-02-29', '2026-10-22'], ['1900-02-29', '2026-10-22'],
    ['2026-10-01', '2026-04-31'], ['0000-01-01', '2026-10-22'],
    ['2026-13-01', '2026-10-22'], ['2026-00-01', '2026-10-22'],
    ['2026-10-00', '2026-10-22'], ['2026-10-01', '2026-10-32'],
    ['20261001', '2026-10-22'], ['2026-1-01', '2026-10-22'],
    ['2026-10-01', '2026-10-22\n'], ['2026-10-01', '2026-10-22T00:00:00Z'],
  ])('누락·역전·형식 오류 날짜 %j ~ %j는 확인 필요다', (start, end) => {
    const input = { ...period, applicationStartDate: start, applicationEndDate: end };
    expect(calculateApplicationStatus(input, '2026-10-21')).toBe('UNKNOWN');
    expect(calculateApplicationStatus({ ...input, applicationPeriodCode: '0057003' }, '2026-10-21'))
      .toBe('CLOSED');
  });

  it.each([null, '', '미확인', '0057001'])('코드 %j와 날짜가 모두 불명확하면 확인 필요다', (code) => {
    expect(calculateApplicationStatus({
      applicationPeriodCode: code, applicationPeriodRaw: null,
      applicationStartDate: null, applicationEndDate: null,
    }, '2026-10-21')).toBe('UNKNOWN');
  });

  it.each([
    '20261001 ~ 20261005, 20261020 ~ 20261022', '20261023 ~ 20261022',
    '20260229 ~ 20261022', '20261001 ~', '접수 일정 추후 공지',
  ])('원문 %j를 실제 수집 변환한 뒤에도 일부 기간을 추측하지 않는다 (T-15)', (raw) => {
    for (const code of ['0057001', '0057002', '0057003']) {
      const transformed = transformYouthCenterPolicy({
        plcyNo: 'status-test', plcyNm: '기간 확인용', aplyPrdSeCd: code, aplyYmd: raw,
      });
      expect(calculateApplicationStatus(transformed, '2026-10-21'))
        .toBe(code === '0057003' ? 'CLOSED' : 'UNKNOWN');
    }
  });

  it.each([
    ['2024-02-22', '2024-02-29', '2024-02-22'],
    ['2026-01-25', '2026-02-01', '2026-01-25'],
    ['2026-12-25', '2027-01-01', '2026-12-25'],
    ['0001-01-01', '0001-01-08', '0001-01-01'],
    ['0099-12-25', '0100-01-01', '0099-12-25'],
    ['9999-12-24', '9999-12-31', '9999-12-24'],
  ])('윤년·월말·연말·작은 연도의 달력 날짜 차이를 계산한다: %s ~ %s', (start, end, today) => {
    expect(calculateApplicationStatus({ ...period, applicationStartDate: start, applicationEndDate: end }, today))
      .toBe('CLOSING_SOON');
  });

  it('하루만 접수하는 정책은 그날 마감 임박이다', () => {
    expect(calculateApplicationStatus({ ...period, applicationStartDate: '2026-10-22' }, '2026-10-22'))
      .toBe('CLOSING_SOON');
  });

  it.each([
    ['2026-10-21T14:59:59.999Z', '2026-10-21', 'CLOSING_SOON'],
    ['2026-10-21T15:00:00.000Z', '2026-10-22', 'CLOSED'],
    ['2026-10-22T00:00:00+09:00', '2026-10-22', 'CLOSED'],
  ])('시각 %s를 한국 날짜 %s로 변환해 자정부터 상태가 바뀐다', (instant, today, expected) => {
    const now = new Date(instant);
    const timestamp = now.getTime();
    expect(getKoreaToday(now)).toBe(today);
    expect(calculateApplicationStatus({ ...period, applicationEndDate: '2026-10-21' }, getKoreaToday(now)))
      .toBe(expected);
    expect(now.getTime()).toBe(timestamp);
  });

  it('명시적 마감은 미래의 접수 날짜보다 우선한다', () => {
    expect(calculateApplicationStatus({ ...period, applicationPeriodCode: '0057003' }, '2026-09-30'))
      .toBe('CLOSED');
  });

  it('동일한 입력은 결과가 같고 원본을 변경하지 않는다', () => {
    const input = Object.freeze({ ...period });
    const before = { ...input };
    expect(calculateApplicationStatus(input, '2026-10-15')).toBe('CLOSING_SOON');
    expect(calculateApplicationStatus(input, '2026-10-15')).toBe('CLOSING_SOON');
    expect(input).toEqual(before);
  });

  it.each(['', '2026-02-29', '2026-10-21T00:00:00Z'])('잘못된 오늘 날짜 %j는 내부 호출 오류로 알린다', (today) => {
    expect(() => calculateApplicationStatus(period, today)).toThrow(RangeError);
  });

  it('잘못된 기준 시각은 날짜 변환 오류로 알린다', () => {
    expect(() => getKoreaToday(new Date(NaN))).toThrow(RangeError);
  });
});
