import { checkRegion } from '../src/modules/matching/region-match';
import type { ActiveRegionMap, RegionMatchResult } from '../src/modules/matching/region-match';
import { transformYouthCenterPolicy } from '../src/modules/ingestion/youth-center/youth-center-policy.transform';
import snapshot from '../src/database/seeds/regions.json';

/** 공식 현행·폐지 지역 스냅샷으로 지역 가점과 확인 태그를 검증한다. */
describe('지역 연관성 판정', () => {
  const regions: ActiveRegionMap = new Map(snapshot.regions.filter((region) => region.isActive)
    .map((region) => [region.code, region]));
  const related: RegionMatchResult = { score: 0.5, tags: ['REGION_RELATED'] };
  const review: RegionMatchResult = { score: 0, tags: ['REGION_REVIEW'] };
  const neutral: RegionMatchResult = { score: 0, tags: [] };

  it.each<[readonly string[] | null, string, RegionMatchResult]>([
    [['41111'], '41111', related], [['41110'], '41111', related],
    [['41000'], '41111', related], [['11000'], '11110', related],
    [['48120'], '48121', related], [['48121'], '48121', related],
    [['41111', '41110', '41000', '41111'], '41111', related],
    [['11110'], '41111', neutral], [['41113'], '41111', neutral],
    [['41111'], '41110', related], [['48170'], '48121', neutral],
    [['28110'], '41111', review], [['28260'], '41111', review],
    [['41195'], '41192', review], [['99999'], '41111', review],
    [[''], '41111', review], [[' '], '41111', review],
    [['4111'], '41111', review], [['41111 '], '41111', review],
    [['11110', '99999'], '41111', review],
    [['99999', '41111'], '41111', related],
    [['41110', '28110', ''], '41111', related],
    [null, '41111', review], [[], '41111', review],
  ])('정책 %j와 사용자 %s의 결과는 %j다', (regionCodes, regionCode, expected) => {
    const result = checkRegion({ regionCodes }, regionCode, regions);
    expect(result).toEqual(expected);
    expect(result).not.toHaveProperty('excluded');
  });

  it('서울 전체는 공식 25개 구 각각과 관련이며 구 선택은 형제 구와 관련이 없다', () => {
    const districts = snapshot.regions.filter((region) => region.isActive && region.parentCode === '11000');
    expect(districts).toHaveLength(25);
    for (const district of districts) {
      expect(checkRegion({ regionCodes: [district.code] }, '11000', regions)).toEqual(related);
    }
    expect(checkRegion({ regionCodes: ['11000'] }, '11530', regions)).toEqual(related);
    expect(checkRegion({ regionCodes: ['11110'] }, '11530', regions)).toEqual(neutral);
    expect(checkRegion({ regionCodes: ['41111'] }, '41000', regions)).toEqual(related);
  });

  it.each<{ regionCodes: readonly string[] | null }>([
    { regionCodes: null }, { regionCodes: [] }, { regionCodes: ['41111'] }, { regionCodes: ['28110'] },
  ])('사용자 지역 미입력은 정책 %j와 무관하게 점수·태그가 비어 있다', (policy) => {
    expect(checkRegion(policy, undefined, regions)).toEqual(neutral);
  });

  it.each(['', ' ', '4111', '411110', '99999', '28110', '41195', '41111 '])(
    '현행 코드가 아닌 사용자 지역 %j는 내부 호출 오류로 알린다', (regionCode) => {
      expect(() => checkRegion({ regionCodes: ['41111'] }, regionCode, regions)).toThrow(RangeError);
    },
  );

  it('코드 앞자리가 전혀 달라도 공식 부모 관계가 있으면 관련이다', () => {
    const officialRelations: ActiveRegionMap = new Map([
      ['12345', { parentCode: '98765' }], ['98765', { parentCode: null }],
    ]);
    expect(checkRegion({ regionCodes: ['98765'] }, '12345', officialRelations)).toEqual(related);
  });

  it('앞자리가 같아도 공식 부모 관계가 없으면 관련으로 추정하지 않는다', () => {
    const officialRelations: ActiveRegionMap = new Map([
      ['12345', { parentCode: null }], ['12340', { parentCode: null }],
    ]);
    expect(checkRegion({ regionCodes: ['12340'] }, '12345', officialRelations)).toEqual(neutral);
  });

  it.each<ActiveRegionMap>([
    new Map([['12345', { parentCode: '98765' }], ['55555', { parentCode: null }]]),
    new Map([['12345', { parentCode: '98765' }], ['98765', { parentCode: '12345' }],
      ['55555', { parentCode: null }]]),
  ])('부모 누락·순환 관계는 확인 필요로 반환하며 확인된 일치는 유지한다', (incomplete) => {
    expect(checkRegion({ regionCodes: ['55555'] }, '12345', incomplete)).toEqual(review);
    expect(checkRegion({ regionCodes: ['12345'] }, '12345', incomplete)).toEqual(related);
  });

  it.each<[string | null, RegionMatchResult]>([
    ['41110, 11110', related], ['11110', neutral], ['28110', review],
    ['11110,unknown', review], ['41111, ,unknown', related], [null, review], ['', review],
  ])('실제 수집 지역 원문 %j를 변환한 결과는 %j다', (raw, expected) => {
    const policy = transformYouthCenterPolicy({ plcyNo: 'region-test', plcyNm: '지역 판정용', zipCd: raw });
    expect(checkRegion(policy, '41111', regions)).toEqual(expected);
  });

  it('입력 코드·지역 조회표를 변경하지 않고 같은 결과를 반환한다', () => {
    const policy = Object.freeze({ regionCodes: Object.freeze(['41110', '41111', '41111']) });
    const before = JSON.stringify([...regions]);
    expect(checkRegion(policy, '41111', regions)).toEqual(related);
    expect(checkRegion(policy, '41111', regions)).toEqual(related);
    expect(policy.regionCodes).toEqual(['41110', '41111', '41111']);
    expect(JSON.stringify([...regions])).toBe(before);
  });
});
