import type { ApplicationStatus, SortKey } from '@youth-kkultong/shared';
import { sortPolicies } from '../src/modules/matching/sort-policies';
import type { SortablePolicy } from '../src/modules/matching/sort-policies';
import { calculateApplicationStatus } from '../src/modules/policies/application-status';

/** 목록 정렬의 우선순위·NULL·고정 동점 기준과 입력 불변성을 검증한다. */
describe('정책 목록 정렬', () => {
  const sorts: SortKey[] = ['recommended', 'popular', 'deadline', 'newest'];

  /** 정렬에 필요한 필드만 가진 정책을 만들고 사례별 비교값을 덮어쓴다. */
  function policy(id: string, overrides: Partial<SortablePolicy> = {}): SortablePolicy {
    return { id, externalId: '000001', viewCount: 10, sourceRegisteredAt: new Date('2026-10-01T00:00:00Z'),
      applicationStatus: 'OPEN', applicationStartDate: '2026-10-01', applicationEndDate: '2026-10-31',
      score: 1, tags: [], ...overrides };
  }

  /** 정렬된 내부 ID로 결과 순서를 읽기 쉽게 비교한다. */
  function ids(rows: readonly SortablePolicy[], sort: SortKey): string[] {
    return sortPolicies(rows, sort).map((row) => row.id);
  }

  it('맞춤순은 마감 임박·조회수보다 점수가 우선이다', () => {
    expect(ids([policy('low', { score: 0.5, applicationStatus: 'CLOSING_SOON', viewCount: 999 }),
      policy('high', { score: 3.5, viewCount: 0 })], 'recommended')).toEqual(['high', 'low']);
  });

  it('지역을 입력한 맞춤순은 고득점 다른 지역보다 지역 관련 정책을 우선한다', () => {
    const rows = [policy('other', { score: 3, viewCount: 999, applicationStatus: 'CLOSING_SOON' }),
      policy('related-low', { score: 0.5, tags: ['REGION_RELATED'] }),
      policy('related-high', { score: 1.5, tags: ['REGION_RELATED'] })];
    expect(sortPolicies(rows, 'recommended', true).map((row) => row.id))
      .toEqual(['related-high', 'related-low', 'other']);
    expect(sortPolicies(rows, 'recommended').map((row) => row.id))
      .toEqual(['other', 'related-high', 'related-low']);
    for (const sort of ['popular', 'deadline', 'newest'] as const) {
      expect(sortPolicies(rows, sort, true)).toEqual(sortPolicies(rows, sort));
    }
  });

  it('T-16 점수가 같으면 조회수가 낮아도 마감 임박이 우선이다', () => {
    expect(ids([policy('open', { viewCount: 999 }),
      policy('closing', { applicationStatus: 'CLOSING_SOON', viewCount: 0 })], 'recommended')).toEqual(['closing', 'open']);
  });

  it('T-17 점수와 마감 임박 여부가 같으면 조회수 내림차순이다', () => {
    expect(ids([policy('low', { viewCount: 1 }), policy('high', { viewCount: 100 })], 'recommended'))
      .toEqual(['high', 'low']);
  });

  it('인기순은 점수·신청 상태보다 조회수가 우선이다', () => {
    expect(ids([policy('low', { score: 3.5, applicationStatus: 'CLOSING_SOON', viewCount: 1 }),
      policy('high', { score: 0, viewCount: 100 })], 'popular')).toEqual(['high', 'low']);
  });

  it('최신순은 조회수·점수보다 원본 최초 등록일이 우선이다', () => {
    expect(ids([policy('old', { score: 3.5, viewCount: 999 }),
      policy('new', { score: 0, viewCount: null, sourceRegisteredAt: new Date('2026-10-02T00:00:00Z') })], 'newest'))
      .toEqual(['new', 'old']);
  });

  it('마감순은 접수 중 → 접수 예정 → 상시 → 확인 필요 → 마감 순이다', () => {
    const statuses: ApplicationStatus[] = ['CLOSED', 'UNKNOWN', 'ALWAYS_OPEN', 'UPCOMING', 'OPEN'];
    expect(ids(statuses.map((applicationStatus) => policy(applicationStatus, { applicationStatus })), 'deadline'))
      .toEqual(['OPEN', 'UPCOMING', 'ALWAYS_OPEN', 'UNKNOWN', 'CLOSED']);
  });

  it('접수 중 그룹은 마감 임박 여부보다 종료일이 우선이다', () => {
    expect(ids([policy('closing', { applicationStatus: 'CLOSING_SOON', applicationEndDate: '2026-10-23' }),
      policy('open', { applicationEndDate: '2026-10-22' })], 'deadline')).toEqual(['open', 'closing']);
  });

  it('접수 중 종료일이 같으면 상태·조회수·점수 대신 공통 동점 기준을 쓴다', () => {
    expect(ids([policy('closing', { applicationStatus: 'CLOSING_SOON', viewCount: 999, score: 3.5 }),
      policy('open', { viewCount: 0, score: 0, sourceRegisteredAt: new Date('2026-10-02T00:00:00Z') })], 'deadline'))
      .toEqual(['open', 'closing']);
  });

  it('접수 예정 그룹은 시작일이 가까운 순이며 종료일은 비교하지 않는다', () => {
    expect(ids([policy('later', { applicationStatus: 'UPCOMING', applicationStartDate: '2026-11-02', applicationEndDate: '2026-11-03' }),
      policy('earlier', { applicationStatus: 'UPCOMING', applicationStartDate: '2026-11-01', applicationEndDate: '2026-12-31' })], 'deadline'))
      .toEqual(['earlier', 'later']);
  });

  it.each<ApplicationStatus>(['ALWAYS_OPEN', 'UNKNOWN', 'CLOSED'])(
    '마감순의 %s 그룹은 남아 있는 날짜 대신 공통 동점 기준을 쓴다', (applicationStatus) => {
      expect(ids([policy('old', { applicationStatus, applicationEndDate: '2026-01-01' }),
        policy('new', { applicationStatus, applicationEndDate: '2026-12-31', sourceRegisteredAt: new Date('2026-10-02T00:00:00Z') })], 'deadline'))
        .toEqual(['new', 'old']);
    },
  );

  it.each<SortKey>(['recommended', 'popular'])('%s의 NULL 조회수는 0보다 뒤다', (sort) => {
    expect(ids([policy('null', { viewCount: null, sourceRegisteredAt: new Date('2026-12-31T00:00:00Z') }),
      policy('zero', { viewCount: 0 })], sort)).toEqual(['zero', 'null']);
  });

  it.each(sorts)('%s의 등록일 동점 기준에서 NULL은 가장 뒤다', (sort) => {
    expect(ids([policy('null', { sourceRegisteredAt: null }), policy('old'),
      policy('new', { sourceRegisteredAt: new Date('2026-10-02T00:00:00Z') })], sort))
      .toEqual(['new', 'old', 'null']);
  });

  it.each(sorts)('%s의 외부 ID는 앞자리 0을 유지한 문자열 오름차순이다', (sort) => {
    expect(ids([policy('b', { externalId: '10' }), policy('c', { externalId: '2' }),
      policy('a', { externalId: '0002' })], sort)).toEqual(['a', 'b', 'c']);
  });

  it.each(sorts)('%s의 마지막 동점 기준은 내부 ID 오름차순이다', (sort) => {
    expect(ids([policy('c'), policy('a'), policy('b')], sort)).toEqual(['a', 'b', 'c']);
  });

  it.each<ApplicationStatus>(['OPEN', 'CLOSING_SOON', 'UPCOMING'])(
    '마감순 %s의 비교 날짜가 NULL이면 같은 그룹 뒤로 보낸다', (applicationStatus) => {
      expect(ids([policy('null', { applicationStatus, applicationEndDate: null, applicationStartDate: null }),
        policy('dated', { applicationStatus })], 'deadline')).toEqual(['dated', 'null']);
    },
  );

  it('상태를 검색 날짜로 다시 계산하면 맞춤순의 마감 임박 우선순위도 달라진다', () => {
    const rows = [policy('early', { applicationEndDate: '2026-10-22', viewCount: 1 }),
      policy('late', { applicationEndDate: '2026-10-30', viewCount: 100 })];
    /** 저장 상태 없이 전달된 검색 날짜로 각 정책 상태를 계산한다. */
    const at = (today: string) => rows.map((row) => ({ ...row, applicationStatus: calculateApplicationStatus({
      ...row, applicationPeriodCode: '0057001', applicationPeriodRaw: null,
    }, today) }));
    expect(ids(at('2026-10-10'), 'recommended')).toEqual(['late', 'early']);
    expect(ids(at('2026-10-15'), 'recommended')).toEqual(['early', 'late']);
  });

  it.each(sorts)('%s는 입력 순서가 달라져도 같은 순서이고 원본 배열·자료를 수정하지 않는다', (sort) => {
    const rows = Object.freeze([Object.freeze(policy('c')), Object.freeze(policy('a')), Object.freeze(policy('b'))]);
    const before = JSON.stringify(rows);
    const sorted = sortPolicies(rows, sort);
    expect(sorted.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(ids([...rows].reverse(), sort)).toEqual(['a', 'b', 'c']);
    expect(JSON.stringify(rows)).toBe(before);
    expect(sorted).not.toBe(rows);
    expect(sorted[0]).toBe(rows[1]);
  });

  it.each(sorts)('%s는 빈 배열·단일 정책도 반환하고 추가 필드를 보존한다', (sort) => {
    expect(sortPolicies([], sort)).toEqual([]);
    const row = { ...policy('only'), title: '정책 제목', tags: ['AGE_MATCH'] as const };
    const result = sortPolicies([row], sort);
    expect(result).toEqual([row]);
    expect(result[0].title).toBe('정책 제목');
  });
});
