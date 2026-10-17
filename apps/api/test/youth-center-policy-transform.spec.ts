import { transformYouthCenterPolicyBasicInfo, YouthCenterPolicyTransformError } from '../src/modules/ingestion/youth-center-policy.transform';
import type { YouthCenterRawPolicy } from '../src/modules/ingestion/youth-center-response.schema';
import sample from './fixtures/youth-center-policy.json';

/** 외부 응답에서 기본 정보와 후속 변환용 코드만 발췌한 자료의 매핑을 검증한다. */
describe('온통청년 정책 기본 정보 변환', () => {
  /** 공백·누락 검증에 사용하는 원본 필드와 내부 필드의 대응이다. */
  const nullableFields = [
    ['lclsfNm', 'category'], ['mclsfNm', 'subcategory'], ['plcyExplnCn', 'description'],
    ['plcySprtCn', 'benefitText'], ['aplyUrlAddr', 'applyUrl'], ['refUrlAddr1', 'referenceUrl1'],
    ['refUrlAddr2', 'referenceUrl2'], ['inqCnt', 'viewCount'],
    ['frstRegDt', 'sourceRegisteredAt'], ['lastMdfcnDt', 'sourceModifiedAt'],
  ] as const;

  it('대표 실제 응답의 모든 기본 필드를 내부 이름으로 변환한다', () => {
    expect(transformYouthCenterPolicyBasicInfo(sample)).toEqual({
      source: 'youthcenter',
      externalId: '20261014005400213950',
      title: '1인가구 병원 안심동행 사업',
      category: '금융･복지･문화',
      subcategory: '건강',
      description: '병원 이용에 어려움을 겪는 1인가구에게 병원 동행서비스 지원\n',
      benefitText: sample.plcySprtCn,
      applyUrl: 'https://gg24.gg.go.kr/svcreqst/selectSvcReqst.do?svc_seq=850',
      referenceUrl1: 'https://gg24.gg.go.kr',
      referenceUrl2: 'https://www.gg.go.kr/1ingg/main.do',
      viewCount: 14,
      sourceRegisteredAt: '2026-10-14 16:23:02',
      sourceModifiedAt: '2026-10-15 10:27:26',
      rawJson: sample,
    });
  });

  it.each(nullableFields)('%s의 누락·NULL·빈 문자열·공백을 %s=NULL로 정규화한다', (field, target) => {
    for (const empty of [undefined, null, '', ' \t\r\n ']) {
      expect(transformYouthCenterPolicyBasicInfo({ ...sample, [field]: empty })[target]).toBeNull();
    }
    const raw: YouthCenterRawPolicy = { ...sample };
    Reflect.deleteProperty(raw, field);
    expect(transformYouthCenterPolicyBasicInfo(raw)[target]).toBeNull();
  });

  it('필수값만 있는 정책도 변환하며 선택 정보를 임의로 채우지 않는다', () => {
    const raw = { plcyNo: '000001', plcyNm: '최소 정책' };
    const result = transformYouthCenterPolicyBasicInfo(raw);
    expect(result).toMatchObject({ source: 'youthcenter', externalId: '000001', title: '최소 정책', rawJson: raw });
    for (const [, target] of nullableFields) expect(result[target]).toBeNull();
  });

  it('내용이 있는 문자열은 ID의 앞자리 0·앞뒤 공백·줄바꿈까지 보존한다', () => {
    const raw = {
      ...sample, plcyNo: ' 000001 ', plcyNm: ' 원문 제목\n', lclsfNm: ' 분야 ',
      mclsfNm: ' 중분류 ', plcyExplnCn: ' 설명\n ', plcySprtCn: '\t지원 내용\r\n',
      aplyUrlAddr: ' https://example.com/apply ', refUrlAddr1: ' https://example.com/1 ',
      refUrlAddr2: '\thttps://example.com/2\n',
    };
    expect(transformYouthCenterPolicyBasicInfo(raw)).toMatchObject({
      externalId: raw.plcyNo, title: raw.plcyNm, category: raw.lclsfNm, subcategory: raw.mclsfNm,
      description: raw.plcyExplnCn, benefitText: raw.plcySprtCn, applyUrl: raw.aplyUrlAddr,
      referenceUrl1: raw.refUrlAddr1, referenceUrl2: raw.refUrlAddr2,
    });
  });

  it('링크의 프로토콜·형식 검사는 후속 상세 응답에 남기고 원문을 보존한다', () => {
    expect(transformYouthCenterPolicyBasicInfo({ ...sample, aplyUrlAddr: '잘못된 링크', refUrlAddr1: 'ftp://example.com' }))
      .toMatchObject({ applyUrl: '잘못된 링크', referenceUrl1: 'ftp://example.com' });
  });

  it('추가 필드·중첩 객체·원본 빈 값과 조회수 문자열을 변경하지 않는다', () => {
    const raw = {
      ...sample, inqCnt: '00014', lclsfNm: ' ', unknown: { values: [null, 0, true, '', ' 원문 '] },
    };
    const before = structuredClone(raw);
    Object.freeze(raw.unknown.values);
    Object.freeze(raw.unknown);
    Object.freeze(raw);
    const result = transformYouthCenterPolicyBasicInfo(raw);
    expect(result).toMatchObject({ category: null, viewCount: 14, rawJson: before });
    expect(raw).toEqual(before);
    expect(result).not.toHaveProperty('jobCodes');
    expect(result).not.toHaveProperty('applicationStartDate');
    expect(result).not.toHaveProperty('contentHash');
  });

  it.each([
    ['0', 0], ['000', 0], ['14', 14], [' 42\t', 42], ['00014', 14], ['2147483647', 2147483647],
  ])('조회수 문자열 %j를 정수 %i로 변환한다', (value, expected) => {
    expect(transformYouthCenterPolicyBasicInfo({ ...sample, inqCnt: value }).viewCount).toBe(expected);
  });

  it.each([
    undefined, null, '', ' ', '-1', '+1', '1.0', '1.5', '1e3', '1,000', '0x10', 'NaN',
    'Infinity', '조회수 14', '2147483648', '9007199254740993', '9'.repeat(400), 0, 14, true, [], {},
  ])('해석할 수 없거나 INTEGER 범위를 넘은 조회수는 NULL로 둔다: %j', (value) => {
    const raw = { ...sample, inqCnt: value };
    expect(transformYouthCenterPolicyBasicInfo(raw).viewCount).toBeNull();
    expect(raw.inqCnt).toEqual(value);
  });

  it.each(['frstRegDt', 'lastMdfcnDt'])('%s의 유효한 시각은 시간대 없이 보존한다', (field) => {
    for (const timestamp of [
      '2026-10-17 00:30:00', '2024-02-29 23:59:59', '2000-02-29 00:00:00',
      '0001-01-01 00:00:00', '9999-12-31 23:59:59', '2026-03-08 02:30:00',
    ]) {
      const target = field === 'frstRegDt' ? 'sourceRegisteredAt' : 'sourceModifiedAt';
      expect(transformYouthCenterPolicyBasicInfo({ ...sample, [field]: timestamp })[target]).toBe(timestamp);
    }
  });

  it.each(['frstRegDt', 'lastMdfcnDt'])('%s의 형식·달력 날짜·시각 오류는 정책 ID와 필드를 전달한다', (field) => {
    for (const timestamp of [
      '2026-02-29 00:00:00', '1900-02-29 12:00:00', '2026-04-31 12:00:00',
      '0000-01-01 00:00:00', '2026-00-01 00:00:00', '2026-13-01 00:00:00',
      '2026-10-00 00:00:00', '2026-10-32 00:00:00', '2026-10-17 24:00:00',
      '2026-10-17 23:60:00', '2026-10-17 23:59:60', '2026-10-17T00:30:00Z',
      '2026-10-17 00:30:00+09:00', '2026-10-17 00:30:00.000', '2026-1-7 0:0:0',
      '2026-10-17', '2026-10-17 00:30:00\n', ' 2026-10-17 00:30:00',
    ]) {
      try {
        transformYouthCenterPolicyBasicInfo({ ...sample, [field]: timestamp });
        throw new Error('잘못된 시각을 허용했습니다.');
      } catch (error) {
        expect(error).toBeInstanceOf(YouthCenterPolicyTransformError);
        expect(error).toMatchObject({ policyId: sample.plcyNo, field, stage: 'TRANSFORMATION', reason: 'INVALID_TIMESTAMP' });
      }
    }
  });

  it.each(nullableFields.filter(([field]) => field !== 'inqCnt'))('%s의 잘못된 자료형을 변환 오류로 전달한다', (field) => {
    for (const value of [0, false, [], {}]) {
      expect(() => transformYouthCenterPolicyBasicInfo({ ...sample, [field]: value }))
        .toThrow(expect.objectContaining({ policyId: sample.plcyNo, field, reason: 'INVALID_TYPE' }));
    }
  });

  it.each(['plcyNo', 'plcyNm'])('필수 필드 %s의 빈 문자열·공백을 거부한다', (field) => {
    for (const value of ['', ' \t\n ']) {
      expect(() => transformYouthCenterPolicyBasicInfo({ ...sample, [field]: value }))
        .toThrow(expect.objectContaining({ field, reason: 'REQUIRED' }));
    }
  });

  it.each([['plcyNo', 64], ['lclsfNm', 100], ['mclsfNm', 100]] as const)(
    '%s의 DB 최대 길이 %i는 허용하고 초과하면 해당 필드에서 중단한다', (field, length) => {
      expect(() => transformYouthCenterPolicyBasicInfo({ ...sample, [field]: '가'.repeat(length) })).not.toThrow();
      expect(() => transformYouthCenterPolicyBasicInfo({ ...sample, [field]: '가'.repeat(length + 1) }))
        .toThrow(expect.objectContaining({ field, reason: 'TOO_LONG' }));
    },
  );

  it('변환 오류에 실패 값·정책 본문·링크·원본 오류를 포함하지 않는다', () => {
    const secret = 'transform-unit-secret';
    const raw = { ...sample, frstRegDt: `https://example.com/?apiKeyNm=${secret}`, plcyExplnCn: secret };
    const before = structuredClone(raw);
    try {
      transformYouthCenterPolicyBasicInfo(raw);
      throw new Error('잘못된 시각을 허용했습니다.');
    } catch (error) {
      expect(error).toBeInstanceOf(YouthCenterPolicyTransformError);
      expect(String(error)).toContain(sample.plcyNo);
      expect(String(error)).toContain('frstRegDt');
      expect(String(error) + JSON.stringify(error) + (error as Error).stack).not.toMatch(/transform-unit-secret|apiKeyNm|https:\/\/|example\.com/);
      expect(error).not.toHaveProperty('cause');
    }
    expect(raw).toEqual(before);
  });
});
