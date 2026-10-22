import type { PolicySearchRequest, SortKey, UserConditions } from '@youth-kkultong/shared';
import { buildPolicySearchResponse } from '../src/modules/policies/policy-search-response';
import { buildSearchCandidates } from '../src/modules/policies/policy-search-candidates';
import type { MatchedPolicyCandidate } from '../src/modules/policies/policy-search-candidates';
import type { ActiveRegionMap } from '../src/modules/matching/region-match';
import { createPolicySearchSchema } from '@youth-kkultong/shared';
import { JOB_OPTIONS, SCHOOL_OPTIONS } from '../src/modules/meta/eligibility-codes';
import snapshot from '../src/database/seeds/regions.json';

/** 전체 정렬 이후의 페이지 경계와 기본 정렬·공용 응답 계약을 검증한다. */
describe('정책 검색 응답 조립', () => {
  /** 필터와 매칭을 통과한 후보를 만들고 사례별 값만 덮어쓴다. */
  function policy(index: number, overrides: Partial<MatchedPolicyCandidate> = {}): MatchedPolicyCandidate {
    return { id: `id-${index}`, externalId: String(index).padStart(5, '0'), title: `정책 ${index}`,
      category: '주거', subcategory: '주거지원', benefitPreview: '지원 요약', descriptionPreview: '정책 소개', viewCount: index,
      sourceRegisteredAt: new Date('2026-10-01T00:00:00Z'), applicationPeriodCode: '0057001',
      applicationPeriodRaw: '20261001 ~ 20261031', applicationStartDate: '2026-10-01', applicationEndDate: '2026-10-31',
      ageMin: 19, ageMax: 34, jobCodes: ['0013003'], schoolCodes: ['0049007'], regionCodes: ['41110'],
      hasExtraText: false, applicationStatus: 'OPEN', score: 1, tags: ['AGE_MATCH'], ...overrides };
  }

  const regions: ActiveRegionMap = new Map(snapshot.regions.filter((region) => region.isActive)
    .map((region) => [region.code, region]));
  const schema = createPolicySearchSchema({ regionCodes: new Set(regions.keys()),
    jobCodes: new Set(JOB_OPTIONS.map(({ code }) => code)), schoolCodes: new Set(SCHOOL_OPTIONS.map(({ code }) => code)) });
  const rows = Array.from({ length: 55 }, (_, index) => policy(index));

  it.each<{ request: PolicySearchRequest; expected: SortKey }>([
    { request: {}, expected: 'popular' }, { request: { category: '주거' }, expected: 'popular' },
    { request: { includeClosed: true }, expected: 'popular' }, { request: { conditions: {} }, expected: 'popular' },
    { request: { conditions: { age: undefined, jobCode: undefined, schoolCode: undefined, regionCode: undefined } }, expected: 'popular' },
    { request: { conditions: { age: 28 } }, expected: 'recommended' },
    { request: { conditions: { jobCode: '0013003' } }, expected: 'recommended' },
    { request: { conditions: { schoolCode: '0049007' } }, expected: 'recommended' },
    { request: { conditions: { regionCode: '41111' } }, expected: 'recommended' },
    { request: { sort: 'recommended' }, expected: 'popular' },
    { request: { sort: 'recommended', conditions: {} }, expected: 'popular' },
    { request: { sort: 'recommended', category: '주거', includeClosed: true }, expected: 'popular' },
    { request: { sort: 'recommended', conditions: { age: 28 } }, expected: 'recommended' },
  ])('요청 $request의 실제 정렬은 $expected다', ({ request, expected }) => {
    const result = buildPolicySearchResponse([policy(0, { score: 3 }), policy(1, { score: 0 })], request);
    expect(result.appliedSort).toBe(expected);
    expect(result.items.map((row) => row.id)).toEqual(expected === 'popular' ? ['id-1', 'id-0'] : ['id-0', 'id-1']);
  });

  it.each<SortKey>(['popular', 'deadline', 'newest'])('수동 정렬 %s는 조건 유무와 관계없이 유지한다', (sort) => {
    for (const conditions of [undefined, {}, { age: 28 }] satisfies (UserConditions | undefined)[]) {
      expect(buildPolicySearchResponse(rows, { sort, conditions }).appliedSort).toBe(sort);
    }
  });

  it('기본 크기 20개로 전체 인기순 정렬 후 첫 페이지를 반환한다', () => {
    const result = buildPolicySearchResponse(rows, {});
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 55, totalPages: 3 });
    expect(result.items.map((row) => row.id)).toEqual(Array.from({ length: 20 }, (_, index) => `id-${54 - index}`));
  });

  it('마지막 페이지는 남은 건수만 반환한다', () => {
    const result = buildPolicySearchResponse(rows, { page: 3 });
    expect(result.items.map((row) => row.id)).toEqual(Array.from({ length: 15 }, (_, index) => `id-${14 - index}`));
    expect(result.pagination).toEqual({ page: 3, limit: 20, total: 55, totalPages: 3 });
  });

  it.each([1, 50])('페이지 크기 경계 %i를 적용한다', (limit) => {
    const result = buildPolicySearchResponse(rows, schema.parse({ limit }));
    expect(result.items).toHaveLength(limit);
    expect(result.pagination).toEqual({ page: 1, limit, total: 55, totalPages: Math.ceil(55 / limit) });
  });

  it('전체 건수가 페이지 크기의 배수여도 빈 페이지를 추가하지 않는다', () => {
    const result = buildPolicySearchResponse(rows.slice(0, 40), { page: 2 });
    expect(result.items).toHaveLength(20);
    expect(result.pagination.totalPages).toBe(2);
  });

  it.each([4, Number.MAX_SAFE_INTEGER])('초과 페이지 %i는 총건수를 유지한 빈 결과다', (page) => {
    expect(buildPolicySearchResponse(rows, { page })).toMatchObject({ items: [],
      pagination: { page, limit: 20, total: 55, totalPages: 3 }, appliedSort: 'popular' });
  });

  it('0건 결과는 totalPages=0이고 요청 페이지를 유지한다', () => {
    expect(buildPolicySearchResponse([], { page: 2, conditions: { age: 28 } })).toEqual({ items: [],
      pagination: { page: 2, limit: 20, total: 0, totalPages: 0 }, appliedSort: 'recommended' });
  });

  it('T-22 실제 필터·점수 계산 후 전체 정렬의 21~40번째를 반환한다', () => {
    const raw = Array.from({ length: 65 }, (_, index) => policy(index, {
      category: index < 5 ? '일자리' : '주거',
      applicationEndDate: index >= 5 && index < 10 ? '2026-10-20' : '2026-10-31',
      ageMin: index >= 10 && index < 15 ? 35 : 19,
      ageMax: index >= 10 && index < 15 ? 39 : 34,
      jobCodes: index >= 40 ? ['0013003'] : null,
      viewCount: index >= 40 ? 0 : 1000 + index,
    }));
    const request = schema.parse({ page: 2, category: '주거', conditions: { age: 28, jobCode: '0013003' } });
    const candidates = buildSearchCandidates(raw, request, '2026-10-21', regions);
    const result = buildPolicySearchResponse(candidates, request);
    expect(result.pagination).toEqual({ page: 2, limit: 20, total: 50, totalPages: 3 });
    expect(result.appliedSort).toBe('recommended');
    expect(result.items.map((row) => row.id)).toEqual([
      ...Array.from({ length: 5 }, (_, index) => `id-${60 + index}`),
      ...Array.from({ length: 15 }, (_, index) => `id-${39 - index}`),
    ]);
    expect(result.items.slice(0, 5).every((row) => row.score === 2)).toBe(true);
    expect(result.items.slice(5).every((row) => row.score === 1)).toBe(true);
  });

  it('공용 카드 필드만 내보내고 기간 원문·확인 태그를 보존한다', () => {
    const input = policy(1, { benefitPreview: null, descriptionPreview: null, category: null, subcategory: null,
      applicationPeriodRaw: '접수 일정 추후 공지', applicationStatus: 'UNKNOWN', applicationEndDate: null,
      score: 0, tags: ['AGE_REVIEW'], hasExtraText: true });
    expect(buildPolicySearchResponse([input], {}).items[0]).toEqual({
      id: 'id-1', title: '정책 1', category: null, subcategory: null, benefitPreview: '', descriptionPreview: '',
      applicationStatus: 'UNKNOWN', applicationPeriodText: '접수 일정 추후 공지', applicationEndDate: null,
      viewCount: 1, score: 0, tags: ['AGE_REVIEW'],
    });
  });

  it('없는 기간 원문은 NULL로, 있는 지원 요약은 그대로 반환한다', () => {
    const result = buildPolicySearchResponse([policy(1, { applicationPeriodRaw: null })], {});
    expect(result.items[0]).toMatchObject({ applicationPeriodText: null, benefitPreview: '지원 요약' });
  });

  it.each<PolicySearchRequest>([
    { page: 0 }, { page: -1 }, { page: 1.5 }, { page: Infinity }, { page: Number.MAX_SAFE_INTEGER + 1 },
    { limit: 0 }, { limit: -1 }, { limit: 1.5 }, { limit: 51 }, { limit: NaN },
  ])('잘못된 페이지 입력 %j는 조용히 보정하지 않는다', (request) => {
    expect(schema.safeParse(request).success).toBe(false);
    expect(() => buildPolicySearchResponse(rows, request)).toThrow(RangeError);
  });

  it('후보·요청을 수정하지 않고 응답의 태그 배열도 독립적으로 만든다', () => {
    const candidate = Object.freeze(policy(0));
    const input = Object.freeze([candidate]);
    const request = Object.freeze({ sort: 'popular' as const });
    const before = JSON.stringify({ input, request });
    const result = buildPolicySearchResponse(input, request);
    result.items[0].tags.length = 0;
    expect(candidate.tags).toEqual(['AGE_MATCH']);
    expect(JSON.stringify({ input, request })).toBe(before);
  });
});
