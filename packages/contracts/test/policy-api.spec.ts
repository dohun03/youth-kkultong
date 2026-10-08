import { PolicyListQuerySchema, SearchCriteriaSchema } from '../src';

describe('PolicyListQuerySchema', () => {
  it('page와 size의 기본값을 적용한다', () => {
    expect(PolicyListQuerySchema.parse({})).toEqual({ page: 1, size: 20 });
  });

  it.each([
    [{ page: '0' }],
    [{ page: '1.5' }],
    [{ size: '0' }],
    [{ size: '51' }],
  ])('잘못된 pagination query를 거부한다: %o', (query) => {
    expect(PolicyListQuerySchema.safeParse(query).success).toBe(false);
  });

  it('유효하지 않은 카테고리를 거부한다', () => {
    expect(PolicyListQuerySchema.safeParse({ category: 'INVALID' }).success).toBe(false);
  });
});

describe('SearchCriteriaSchema', () => {
  it('선택 조건이 없는 검색 요청에 pagination 기본값을 적용한다', () => {
    expect(SearchCriteriaSchema.parse({})).toEqual({ page: 1, size: 20 });
  });

  it('유효한 선택 조건을 검증한다', () => {
    expect(
      SearchCriteriaSchema.parse({
        category: ['HOUSING'],
        age: 27,
        regionCode: '11',
        statuses: ['JOB_SEEKER'],
        householdSize: 1,
        householdMonthlyIncome: 1_800_000,
        sort: 'DEADLINE',
      }),
    ).toMatchObject({
      category: ['HOUSING'],
      age: 27,
      regionCode: '11',
      statuses: ['JOB_SEEKER'],
      householdSize: 1,
      householdMonthlyIncome: 1_800_000,
      page: 1,
      size: 20,
      sort: 'DEADLINE',
    });
  });

  it.each([-1, 121, 20.5])('범위를 벗어난 나이를 거부한다: %i', (age) => {
    expect(SearchCriteriaSchema.safeParse({ age }).success).toBe(false);
  });

  it.each([0, -1, 1.5])('유효하지 않은 가구원 수를 거부한다: %i', (householdSize) => {
    expect(SearchCriteriaSchema.safeParse({ householdSize }).success).toBe(false);
  });

  it('음수 월 가구소득을 거부한다', () => {
    expect(SearchCriteriaSchema.safeParse({ householdMonthlyIncome: -1 }).success).toBe(false);
  });

  it.each([
    [{ category: ['INVALID'] }],
    [{ statuses: ['INVALID'] }],
  ])('유효하지 않은 enum을 거부한다: %o', (criteria) => {
    expect(SearchCriteriaSchema.safeParse(criteria).success).toBe(false);
  });
});
