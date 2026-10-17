import { transformYouthCenterPolicy, transformYouthCenterPolicyBasicInfo, YouthCenterPolicyTransformError } from '../src/modules/ingestion/youth-center-policy.transform';
import type { YouthCenterRawPolicy } from '../src/modules/ingestion/youth-center-response.schema';
import sample from './fixtures/youth-center-policy.json';

/** 나이·코드·추가 조건과 신청기간의 변환 및 원본 보존을 검증한다. */
describe('온통청년 자격 조건·신청기간 변환', () => {
  /** 원본의 선택 필드와 내부 자료형의 대응이다. */
  const fields = [
    ['sprtTrgtMinAge', 'ageMin'], ['sprtTrgtMaxAge', 'ageMax'], ['jobCd', 'jobCodes'],
    ['schoolCd', 'schoolCodes'], ['zipCd', 'regionCodes'], ['addAplyQlfcCndCn', 'extraQualification'],
    ['ptcpPrpTrgtCn', 'participationRestriction'], ['aplyPrdSeCd', 'applicationPeriodCode'],
    ['aplyYmd', 'applicationPeriodRaw'],
  ] as const;

  it('실제 응답의 0~0 나이·제한 없음 코드·지역 코드·추가 자격을 변환한다', () => {
    const result = transformYouthCenterPolicy(sample);
    expect(result).toEqual({
      ...transformYouthCenterPolicyBasicInfo(sample),
      ageMin: 0, ageMax: 0, jobCodes: ['0013010'], schoolCodes: ['0049010'],
      regionCodes: ['41131', '41133', '41135', '41210', '41220', '41271', '41273', '41290', '41310', '41390', '41410', '41550', '41610', '41830'],
      extraQualification: '연령‧소득과 무관한 사실상 1인가구(노인가구, 조손가구, 한부모가정 등) 포함',
      participationRestriction: null, applicationPeriodCode: '0057002', applicationPeriodRaw: null,
      applicationStartDate: null, applicationEndDate: null,
    });
    expect(result).not.toHaveProperty('contentHash');
    expect(result).not.toHaveProperty('applicationStatus');
  });

  it.each(fields)('%s의 누락·NULL·빈 문자열·공백을 %s=NULL로 정규화한다', (field, target) => {
    for (const value of [undefined, null, '', ' \t\r\n ']) {
      expect(transformYouthCenterPolicy({ ...sample, [field]: value })[target]).toBeNull();
    }
    const raw: YouthCenterRawPolicy = { ...sample };
    Reflect.deleteProperty(raw, field);
    expect(transformYouthCenterPolicy(raw)[target]).toBeNull();
  });

  it('선택 정보가 없는 정책은 나이·자격·기간을 추정하지 않는다', () => {
    const result = transformYouthCenterPolicy({ plcyNo: '000001', plcyNm: '최소 정책' });
    for (const [, target] of fields) expect(result[target]).toBeNull();
    expect(result.applicationStartDate).toBeNull();
    expect(result.applicationEndDate).toBeNull();
  });

  it.each([
    ['0', 0], ['019', 19], [' 39\t', 39], ['-1', -1], ['+19', 19],
    ['121', 121], ['999', 999], ['2147483647', 2147483647], ['-2147483648', -2147483648],
  ])('나이 문자열 %j를 %i로 변환하며 자격 범위를 이 단계에서 판정하지 않는다', (value, expected) => {
    expect(transformYouthCenterPolicy({ ...sample, sprtTrgtMinAge: value, sprtTrgtMaxAge: value }))
      .toMatchObject({ ageMin: expected, ageMax: expected });
  });

  it('역전된 나이 범위도 임의로 바꾸지 않고 후속 매칭 판단을 위해 유지한다', () => {
    expect(transformYouthCenterPolicy({ ...sample, sprtTrgtMinAge: '39', sprtTrgtMaxAge: '19' }))
      .toMatchObject({ ageMin: 39, ageMax: 19 });
  });

  it.each(['sprtTrgtMinAge', 'sprtTrgtMaxAge'])('%s의 정수 해석 오류·DB 범위 초과는 정책과 필드를 전달한다', (field) => {
    for (const value of ['19세', '19.0', '1e2', '0x13', 'NaN', 'Infinity', '2147483648', '-2147483649', '9'.repeat(400)]) {
      expect(() => transformYouthCenterPolicy({ ...sample, [field]: value })).toThrow(expect.objectContaining({
        stage: 'TRANSFORMATION', policyId: sample.plcyNo, field, reason: 'INVALID_INTEGER',
      }));
    }
  });

  it.each([
    ['jobCd', 'jobCodes'], ['schoolCd', 'schoolCodes'], ['zipCd', 'regionCodes'],
  ] as const)('%s를 쉼표로 나누고 공백만 제거하며 앞자리 0·중복·순서를 보존한다', (field, target) => {
    expect(transformYouthCenterPolicy({ ...sample, [field]: ' 0013003,\t0013009 , 0013003\n' })[target])
      .toEqual(['0013003', '0013009', '0013003']);
    expect(transformYouthCenterPolicy({ ...sample, [field]: '0' })[target]).toEqual(['0']);
  });

  it('미확인·폐지·빈 코드 토큰을 제거하거나 제한 없음으로 해석하지 않는다', () => {
    expect(transformYouthCenterPolicy({ ...sample, jobCd: '0013003, ,unknown', schoolCd: ',,', zipCd: '28177,99999' }))
      .toMatchObject({ jobCodes: ['0013003', '', 'unknown'], schoolCodes: ['', '', ''], regionCodes: ['28177', '99999'] });
  });

  it('추가 자격·참여 제한의 공백과 줄바꿈은 보존하고 신청기간 코드 주변 공백은 제거한다', () => {
    expect(transformYouthCenterPolicy({
      ...sample, addAplyQlfcCndCn: ' 추가 자격\r\n ', ptcpPrpTrgtCn: '\t참여 제한\n', aplyPrdSeCd: ' 0057001 ',
    })).toMatchObject({ extraQualification: ' 추가 자격\r\n ', participationRestriction: '\t참여 제한\n', applicationPeriodCode: '0057001' });
  });

  it.each([
    ['20261001 ~ 20261031', '2026-10-01', '2026-10-31'],
    ['2026-10-01 ~ 2026-10-31', '2026-10-01', '2026-10-31'],
    [' \t20261001~2026-10-31\r\n', '2026-10-01', '2026-10-31'],
    ['20261017 ~ 20261017', '2026-10-17', '2026-10-17'],
    ['20240229 ~ 20240301', '2024-02-29', '2024-03-01'],
    ['20000229 ~ 20000301', '2000-02-29', '2000-03-01'],
    ['00010101 ~ 99991231', '0001-01-01', '9999-12-31'],
  ])('단일 명확한 신청기간 %j를 DATE용 문자열로 변환한다', (value, start, end) => {
    expect(transformYouthCenterPolicy({ ...sample, aplyYmd: value })).toMatchObject({
      applicationPeriodRaw: value, applicationStartDate: start, applicationEndDate: end,
    });
  });

  it.each([
    '20261001 ~ 20261031\\N20261201 ~ 20261231',
    '20261001 ~ 20261031\n20261201 ~ 20261231',
    '20261001 ~ 20261031, 20261201 ~ 20261231',
    '20260601 ~ 20250710', '20260229 ~ 20260301', '19000229 ~ 19000301',
    '20260431 ~ 20260501', '20261001 ~ 20261032', '20261301 ~ 20261331',
    '20260001 ~ 20260101', '20261000 ~ 20261001', '00000101 ~ 20261031',
    '20261001', '20261001 ~', '~ 20261031', '상시', '예산 소진 시까지',
    '모집기간: 20261001 ~ 20261031', '20261001 ~ 20261031 (예정)',
    '2026.10.01 ~ 2026.10.31', '20261001 - 20261031',
    '2026-10-01T00:00:00Z ~ 2026-10-31T23:59:59Z',
  ])('복수 기간·역전·잘못된 날짜·모호한 기간은 원문만 남긴다: %j', (value) => {
    expect(transformYouthCenterPolicy({ ...sample, aplyYmd: value })).toMatchObject({
      applicationPeriodRaw: value, applicationStartDate: null, applicationEndDate: null,
    });
  });

  it.each(['0057001', '0057002', '0057003', 'unknown'])('기간 코드 %s와 원문을 독립적으로 보존하고 현재 상태는 계산하지 않는다', (code) => {
    expect(transformYouthCenterPolicy({ ...sample, aplyPrdSeCd: code, aplyYmd: '20261001 ~ 20261031' }))
      .toMatchObject({ applicationPeriodCode: code, applicationStartDate: '2026-10-01', applicationEndDate: '2026-10-31' });
  });

  it('신청기간이 없으면 사업기간에서 신청일을 추정하지 않는다', () => {
    expect(transformYouthCenterPolicy({ ...sample, aplyYmd: '', bizPrdBgngYmd: '20260101', bizPrdEndYmd: '20261231' }))
      .toMatchObject({ applicationPeriodRaw: null, applicationStartDate: null, applicationEndDate: null });
  });

  it.each(fields)('%s의 잘못된 자료형은 정책 ID·필드를 가진 변환 오류다', (field) => {
    for (const value of [0, 19, false, [], {}]) {
      expect(() => transformYouthCenterPolicy({ ...sample, [field]: value })).toThrow(expect.objectContaining({
        policyId: sample.plcyNo, field, reason: 'INVALID_TYPE', stage: 'TRANSFORMATION',
      }));
    }
  });

  it('신청기간 코드의 DB 최대 길이를 검사한다', () => {
    expect(() => transformYouthCenterPolicy({ ...sample, aplyPrdSeCd: 'a'.repeat(20) })).not.toThrow();
    expect(() => transformYouthCenterPolicy({ ...sample, aplyPrdSeCd: 'a'.repeat(21) }))
      .toThrow(expect.objectContaining({ policyId: sample.plcyNo, field: 'aplyPrdSeCd', reason: 'TOO_LONG' }));
  });

  it('원본 나이·쉼표 코드·복수 기간·추가 필드·중첩 값을 수정하지 않는다', () => {
    const raw = {
      ...sample, sprtTrgtMinAge: ' 019 ', jobCd: '0013003, 0013009',
      aplyYmd: '20261001 ~ 20261031\\N20261201 ~ 20261231', extra: { list: [0, null, ' 원문 '] },
    };
    const before = structuredClone(raw);
    Object.freeze(raw.extra.list);
    Object.freeze(raw.extra);
    Object.freeze(raw);
    const result = transformYouthCenterPolicy(raw);
    expect(result).toMatchObject({ ageMin: 19, jobCodes: ['0013003', '0013009'], rawJson: before });
    expect(raw).toEqual(before);
  });

  it('나이 해석 오류에 실패 값·본문·링크를 포함하지 않는다', () => {
    const secret = 'eligibility-unit-secret';
    try {
      transformYouthCenterPolicy({ ...sample, sprtTrgtMinAge: `https://example.com/?apiKeyNm=${secret}` });
      throw new Error('잘못된 나이를 허용했습니다.');
    } catch (error) {
      expect(error).toBeInstanceOf(YouthCenterPolicyTransformError);
      expect(String(error)).toContain(sample.plcyNo);
      expect(String(error)).toContain('sprtTrgtMinAge');
      expect(String(error) + JSON.stringify(error) + (error as Error).stack).not.toMatch(/eligibility-unit-secret|apiKeyNm|https:\/\/|example\.com/);
    }
  });
});
