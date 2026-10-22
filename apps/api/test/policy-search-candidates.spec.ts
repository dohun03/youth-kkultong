import type { ApplicationStatus, PolicySearchRequest } from '@youth-kkultong/shared';
import * as matching from '../src/modules/matching/evaluate-policy';
import type { ActiveRegionMap } from '../src/modules/matching/region-match';
import * as status from '../src/modules/policies/application-status';
import { buildSearchCandidates } from '../src/modules/policies/policy-search-candidates';
import type { PolicyCandidate } from '../src/modules/policies/repositories/policy.repository';
import snapshot from '../src/database/seeds/regions.json';

/** 실제 상태·종합 판정 함수를 연결해 필터 순서와 전체 후보 반환을 검증한다. */
describe('정책 검색 후보·필터 조합', () => {
  const regions: ActiveRegionMap = new Map(snapshot.regions.filter((region) => region.isActive)
    .map((region) => [region.code, region]));
  const today = '2026-10-21';

  /** Repository가 반환하는 경량 후보와 같은 필드를 가진 정책을 만든다. */
  function policy(id: string, overrides: Partial<PolicyCandidate> = {}): PolicyCandidate {
    return { id, externalId: `external-${id}`, title: `정책 ${id}`, category: '주거', subcategory: '주거지원',
      benefitPreview: '지원 요약', descriptionPreview: '정책 소개', viewCount: 10, sourceRegisteredAt: new Date('2026-10-01T00:00:00Z'),
      applicationPeriodCode: '0057001', applicationPeriodRaw: '20261001 ~ 20261031',
      applicationStartDate: '2026-10-01', applicationEndDate: '2026-10-31',
      ageMin: 19, ageMax: 34, jobCodes: ['0013003'], schoolCodes: ['0049007'], regionCodes: ['41110'],
      hasExtraText: false, ...overrides };
  }

  afterEach(() => jest.restoreAllMocks());

  const states: { id: ApplicationStatus; changes: Partial<PolicyCandidate> }[] = [
    { id: 'OPEN', changes: {} },
    { id: 'CLOSING_SOON', changes: { applicationEndDate: '2026-10-22' } },
    { id: 'UPCOMING', changes: { applicationStartDate: '2026-10-22' } },
    { id: 'ALWAYS_OPEN', changes: { applicationPeriodCode: '0057002', applicationPeriodRaw: null,
      applicationStartDate: null, applicationEndDate: null } },
    { id: 'UNKNOWN', changes: { applicationStartDate: null, applicationEndDate: null } },
    { id: 'CLOSED', changes: { applicationEndDate: '2026-10-20' } },
  ];

  it.each([{}, { includeClosed: false }])('기본 마감 제외 %j는 다른 다섯 상태를 유지한다', (request) => {
    const result = buildSearchCandidates(states.map(({ id, changes }) => policy(id, changes)), request, today, regions);
    expect(result.map((row) => row.applicationStatus)).toEqual(['OPEN', 'CLOSING_SOON', 'UPCOMING', 'ALWAYS_OPEN', 'UNKNOWN']);
    for (const row of result) expect(row).toMatchObject({ score: 0, tags: [] });
  });

  it('includeClosed=true면 마감도 포함한다', () => {
    const result = buildSearchCandidates(states.map(({ id, changes }) => policy(id, changes)), { includeClosed: true }, today, regions);
    expect(result.map((row) => row.applicationStatus)).toEqual(states.map(({ id }) => id));
  });

  it('명시적 마감은 미래 날짜여도 기본 목록에서 빠진다', () => {
    const row = policy('closed', { applicationPeriodCode: '0057003', applicationStartDate: '2026-11-01', applicationEndDate: '2026-11-30' });
    expect(buildSearchCandidates([row], {}, today, regions)).toEqual([]);
    expect(buildSearchCandidates([row], { includeClosed: true }, today, regions)[0].applicationStatus).toBe('CLOSED');
  });

  it.each([undefined, ''])('분야 %j는 NULL·빈 분야를 포함한 전체다', (category) => {
    const rows = [policy('housing'), policy('other', { category: '일자리' }),
      policy('null', { category: null }), policy('empty', { category: '' })];
    expect(buildSearchCandidates(rows, { category }, today, regions).map((row) => row.id))
      .toEqual(['housing', 'other', 'null', 'empty']);
  });

  it.each(['주거', ' 주거 ', '금융･복지･문화', '금융·복지·문화', ' '])('분야 %j는 공백·문장 부호까지 정확 일치한다', (category) => {
    const rows = ['주거', ' 주거 ', '금융･복지･문화', '금융·복지·문화', ' ', null]
      .map((value, index) => policy(String(index), { category: value }));
    const result = buildSearchCandidates(rows, { category }, today, regions);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe(category);
  });

  it('존재하지 않는 분야는 빈 결과다', () => {
    expect(buildSearchCandidates([policy('a')], { category: '없는 분야' }, today, regions)).toEqual([]);
  });

  it('분야·마감 필터를 통과한 후보만 종합 판정하고 명확한 불일치를 제외한다', () => {
    const calculate = jest.spyOn(status, 'calculateApplicationStatus');
    const evaluate = jest.spyOn(matching, 'evaluatePolicy');
    const rows = [policy('other', { category: '일자리' }), policy('closed', { applicationEndDate: '2026-10-20' }),
      policy('mismatch', { ageMin: 35, ageMax: 39 }), policy('kept')];
    const result = buildSearchCandidates(rows, { category: '주거', conditions: { age: 28 } }, today, regions);
    expect(calculate).toHaveBeenCalledTimes(4);
    expect(evaluate.mock.calls.map(([row]) => (row as PolicyCandidate).id)).toEqual(['mismatch', 'kept']);
    expect(result.map((row) => row.id)).toEqual(['kept']);
    expect(calculate.mock.invocationCallOrder[2]).toBeLessThan(evaluate.mock.invocationCallOrder[0]);
  });

  it('추가 설명이 있으면 나이 불일치도 확인 태그와 함께 유지한다', () => {
    const result = buildSearchCandidates([policy('review', { ageMin: 35, ageMax: 39, hasExtraText: true })],
      { conditions: { age: 28 } }, today, regions);
    expect(result[0]).toMatchObject({ id: 'review', score: 0, tags: ['EXTRA_REVIEW', 'AGE_REVIEW'] });
  });

  it('확인 필요·제한 없음은 제외하지 않고 확인된 점수만 붙인다', () => {
    const result = buildSearchCandidates([policy('unclear', { ageMin: null, jobCodes: ['0013001', 'unknown'], schoolCodes: ['0049010'] })],
      { conditions: { age: 28, jobCode: '0013003', schoolCode: '0049007', regionCode: '41111' } }, today, regions);
    expect(result[0]).toMatchObject({ score: 0.5, tags: ['AGE_REVIEW', 'JOB_REVIEW', 'REGION_RELATED'] });
  });

  it.each<{ codes: string[]; score: number; tags: string[] }>([
    { codes: ['11110'], score: 0, tags: [] }, { codes: ['28110'], score: 0, tags: ['REGION_REVIEW'] },
    { codes: ['41110'], score: 0.5, tags: ['REGION_RELATED'] },
  ])('지역 조건 %j는 가점·태그만 다르고 정책은 유지한다', ({ codes, score, tags }) => {
    const result = buildSearchCandidates([policy('region', { regionCodes: codes })],
      { conditions: { regionCode: '41111' } }, today, regions);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ score, tags });
  });

  it('마감 포함이어도 자격 조건의 명확한 불일치는 제외한다', () => {
    expect(buildSearchCandidates([policy('closed', { applicationEndDate: '2026-10-20', ageMin: 35, ageMax: 39 })],
      { includeClosed: true, conditions: { age: 28 } }, today, regions)).toEqual([]);
  });

  it('한국 자정에 상태를 다시 계산해 마감 여부를 반영한다', () => {
    const rows = [policy('deadline', { applicationEndDate: '2026-10-21' })];
    expect(buildSearchCandidates(rows, {}, status.getKoreaToday(new Date('2026-10-21T14:59:59Z')), regions)[0].applicationStatus)
      .toBe('CLOSING_SOON');
    expect(buildSearchCandidates(rows, {}, status.getKoreaToday(new Date('2026-10-21T15:00:00Z')), regions)).toEqual([]);
  });

  it('정렬·페이지 조건에 앞서 전체 후보를 입력 순서로 반환한다', () => {
    const rows = Array.from({ length: 55 }, (_, index) => policy(String(index), { viewCount: index }));
    const result = buildSearchCandidates(rows, { page: 2, limit: 1, sort: 'popular' }, today, regions);
    expect(result.map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(result).toHaveLength(55);
  });

  it('빈 입력과 전부 제외된 입력은 빈 배열이다', () => {
    expect(buildSearchCandidates([], {}, today, regions)).toEqual([]);
    expect(buildSearchCandidates([policy('mismatch', { ageMin: 35, ageMax: 39 })], { conditions: { age: 28 } }, today, regions))
      .toEqual([]);
  });

  it('조건을 입력하지 않으면 추가 설명이 있어도 점수·태그는 비어 있다', () => {
    expect(buildSearchCandidates([policy('extra', { hasExtraText: true })], { conditions: {} }, today, regions)[0])
      .toMatchObject({ score: 0, tags: [] });
  });

  it('상태 계산과 조건 검증 오류는 빈 정상 결과로 숨기지 않는다', () => {
    expect(() => buildSearchCandidates([policy('a')], {}, '잘못된 날짜', regions)).toThrow(RangeError);
    expect(() => buildSearchCandidates([policy('a')], { conditions: { age: 121 } }, today, regions)).toThrow(RangeError);
  });

  it('후보·요청·지역 조회표를 수정하지 않고 새 정책 객체와 태그 배열을 반환한다', () => {
    const row = Object.freeze(policy('a'));
    const rows = Object.freeze([row]);
    const request: PolicySearchRequest = Object.freeze({ conditions: Object.freeze({ age: 28 }) });
    const before = JSON.stringify({ rows, request, regions: [...regions] });
    const result = buildSearchCandidates(rows, request, today, regions);
    expect(result[0]).not.toBe(row);
    expect(result[0]).toMatchObject({ title: row.title, benefitPreview: row.benefitPreview, sourceRegisteredAt: row.sourceRegisteredAt });
    expect(result[0]).not.toHaveProperty('excluded');
    result[0].tags.length = 0;
    expect(buildSearchCandidates(rows, request, today, regions)[0].tags).toEqual(['AGE_MATCH']);
    expect(JSON.stringify({ rows, request, regions: [...regions] })).toBe(before);
  });
});
