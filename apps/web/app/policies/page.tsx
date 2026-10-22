'use client';

import { useEffect, useRef, useState } from 'react';
import type { PolicySearchRequest, PolicySearchResponse, SortKey } from '@youth-kkultong/shared';
import { PolicyCard } from './policy-card';
import { EligibilityFilters, isEligibility } from './eligibility-filters';
import { RegionFilter, isRegions } from './region-filter';
import { Pagination } from './pagination';
import { isCategories, useMetaOptions } from './use-meta-options';
import { useSessionExploration } from './use-session-exploration';

/** 로딩·실패·정상 응답을 구분해 API 오류를 빈 목록으로 표시하지 않는다. */
type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'success'; response: PolicySearchResponse };

// 화면에 실제 적용된 정렬을 표시하며, 조건을 지웠을 때 인기순으로 돌아온 것도 반영한다.
const sortLabels: Record<SortKey, string> = {
  popular: '인기순', recommended: '맞춤순', deadline: '마감순', newest: '최신순',
};

/** 빈 입력은 조건 없음, 1~120 정수는 나이, 나머지는 입력 오류(null)로 구분한다. */
function parseAgeInput(input: string): number | undefined | null {
  if (input === '') return undefined;
  // 소수·지수·부호·문자열을 정수로 잘라 보내지 않고 입력한 형태부터 확인한다.
  if (!/^\d+$/.test(input)) return null;
  const age = Number(input);
  return Number.isInteger(age) && age >= 1 && age <= 120 ? age : null;
}

/** 선택한 분야·마감 포함·만 나이로 첫 페이지를 조회하고 목록과 조회 상태를 보여준다. */
export default function PoliciesPage() {
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(1);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const errorRef = useRef<HTMLHeadingElement>(null);
  const focusAfterSearch = useRef(false);
  useEffect(() => {
    // 페이지·재시도 버튼이 사라진 뒤에도 키보드 초점을 새 결과나 오류 안내로 이어준다.
    if (!focusAfterSearch.current || state.status === 'loading') return;
    const target = state.status === 'success' ? summaryRef.current : errorRef.current;
    if (target) { target.focus(); focusAfterSearch.current = false; }
  }, [state]);
  const { state: categories, retry: retryCategories } = useMetaOptions('/api/v1/meta/categories', isCategories);
  const eligibility = useMetaOptions('/api/v1/meta/eligibility-codes', isEligibility);
  const regions = useMetaOptions('/api/v1/meta/regions', isRegions);
  const { conditions: saved, setConditions, ready } = useSessionExploration();
  // 복원한 코드도 현재 선택지로 확인한다. 조회 실패 중에는 저장값을 보존하되 검색에서 제외한다.
  const jobCode = eligibility.state.status === 'success' && eligibility.state.data.jobCodes.some((item) => item.code === saved.jobCode) ? saved.jobCode! : '';
  const schoolCode = eligibility.state.status === 'success' && eligibility.state.data.schoolCodes.some((item) => item.code === saved.schoolCode) ? saved.schoolCode! : '';
  const regionCode = regions.state.status === 'success' && regions.state.data.some((item) => item.code === saved.regionCode) ? saved.regionCode! : '';
  const category = categories.status === 'success' && categories.data.includes(saved.category ?? '') ? saved.category! : '';
  const includeClosed = saved.includeClosed ?? false;
  const sort = saved.sort;
  const restoringCodes = (Boolean(saved.jobCode || saved.schoolCode) && eligibility.state.status === 'loading')
    || (Boolean(saved.regionCode) && regions.state.status === 'loading')
    || (Boolean(saved.category) && categories.status === 'loading');
  /** 선택 해제 시 필드 자체를 지워 다음 복원에서 이전 조건이 돌아오지 않게 한다. */
  function updateCondition<K extends keyof typeof saved>(field: K, value: (typeof saved)[K]) {
    setConditions((previous) => {
      const next = { ...previous };
      if (value === '' || value === undefined || value === false) delete next[field];
      else next[field] = value;
      return next;
    });
  }
  useEffect(() => {
    if (ready) setAgeInput(saved.age === undefined ? '' : String(saved.age));
    // 최초 저장소 복원이 끝날 때만 입력칸을 채우고 이후의 오류 입력은 사용자가 고치게 둔다.
  }, [ready]);
  useEffect(() => {
    // 메타 조회 성공 후에만 폐지·미확인 코드를 삭제한다. 통신 실패로 저장값을 잃지 않게 한다.
    if (!ready) return;
    setConditions((previous) => {
      const next = { ...previous };
      if (eligibility.state.status === 'success') {
        if (previous.jobCode && !eligibility.state.data.jobCodes.some((item) => item.code === previous.jobCode)) delete next.jobCode;
        if (previous.schoolCode && !eligibility.state.data.schoolCodes.some((item) => item.code === previous.schoolCode)) delete next.schoolCode;
      }
      if (categories.status === 'success' && previous.category && !categories.data.includes(previous.category)) delete next.category;
      if (regions.state.status === 'success' && previous.regionCode && !regions.state.data.some((item) => item.code === previous.regionCode)) delete next.regionCode;
      return Object.keys(next).length === Object.keys(previous).length ? previous : next;
    });
  }, [ready, categories, eligibility.state, regions.state, setConditions]);
  const [ageInput, setAgeInput] = useState('');
  const age = parseAgeInput(ageInput);
  const hasConditions = typeof age === 'number' || Boolean(jobCode || schoolCode || regionCode);
  const selectedSort = sort === undefined ? (hasConditions ? 'recommended' : 'popular')
    : sort === 'recommended' && !hasConditions ? 'popular' : sort;
  const requestedSort = sort === undefined ? undefined : selectedSort;

  useEffect(() => {
    // 조건을 모두 지우면 수동 맞춤순도 인기순으로 전환한다. 다른 수동 정렬은 유지한다.
    // 복원한 코드·나이를 확인한 뒤에만 저장된 맞춤순을 정리한다.
    if (ready && !restoringCodes && age !== null && (saved.age === undefined || saved.age === age)
      && !hasConditions && sort === 'recommended') updateCondition('sort', 'popular');
  }, [hasConditions, sort, age, ready, restoringCodes, saved.age]);

  useEffect(() => {
    // 잘못된 나이는 전송하지 않는다. 이전 결과도 숨겨 현재 입력의 결과처럼 보이지 않게 한다.
    if (!ready || restoringCodes || age === null || (saved.age !== undefined && age !== saved.age)) return;
    const controller = new AbortController();
    let active = true;
    // 응답이 끝없이 지연되어도 오류 안내와 다시 시도 버튼을 보여준다.
    const timeout = setTimeout(() => controller.abort(), 15_000);

    /** 필터를 바꿀 때마다 첫 페이지를 요청하며 조건에 따른 기본 정렬은 API가 결정한다. */
    async function loadPolicies(): Promise<void> {
      setState({ status: 'loading' });
      const request: PolicySearchRequest = { page, limit: 20, includeClosed };
      // 자동 기본 정렬은 서버가 결정하고, 사용자가 고른 정렬만 명시적으로 전송한다.
      if (requestedSort !== undefined) request.sort = requestedSort;
      // '전체'일 때는 category 자체를 보내지 않고, 선택한 실제 분야명만 그대로 보낸다.
      if (category) request.category = category;
      // 선택 입력을 지우면 conditions도 생략한다. 개인 조건은 URL에 넣지 않고 POST 본문으로만 전송한다.
      const conditions: NonNullable<PolicySearchRequest['conditions']> = {};
      if (typeof age === 'number') conditions.age = age;
      if (jobCode) conditions.jobCode = jobCode;
      if (schoolCode) conditions.schoolCode = schoolCode;
      if (regionCode) conditions.regionCode = regionCode;
      if (Object.keys(conditions).length > 0) request.conditions = conditions;

      try {
        const response = await fetch('/api/v1/policies/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          cache: 'no-store',
          signal: controller.signal,
        });
        // HTTP 오류 본문을 정상 검색 결과로 사용하거나 화면에 그대로 노출하지 않는다.
        if (!response.ok) throw new Error('정책 목록 조회 실패');
        const result: PolicySearchResponse = await response.json();
        if (active) setState({ status: 'success', response: result });
      } catch {
        // 페이지를 떠난 뒤 끝난 요청은 화면 상태를 변경하지 않는다.
        if (active) setState({ status: 'error' });
      } finally {
        clearTimeout(timeout);
      }
    }

    void loadPolicies();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt, category, includeClosed, age, jobCode, schoolCode, regionCode, requestedSort, page, ready, restoringCodes, saved.age]);

  return (
    <main className="container policies-page policy-list-page" id="main-content" tabIndex={-1}>
      <p className="eyebrow">내일을 위한 기회</p>
      <h1>청년 정책</h1>
      <p className="page-description">
        나에게 필요한 정책과 지원 정보를 찾아보세요.
      </p>
      <section className="policy-filters" aria-label="정책 필터">
        <div className="filter-heading"><h2>내 조건으로 찾기</h2><p>원하는 조건만 선택하세요.</p></div>
        <div className="category-filter">
          <label htmlFor="policy-category">분야</label>
          <select
            id="policy-category"
            value={category}
            disabled={categories.status !== 'success'}
            onChange={(event) => {
              setState({ status: 'loading' });
              setPage(1); updateCondition('category', event.target.value);
            }}
          >
            <option value="">전체</option>
            {categories.status === 'success' && categories.data.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
        <label className="closed-filter">
          <input
            type="checkbox"
            checked={includeClosed}
            onChange={(event) => {
              setState({ status: 'loading' });
              setPage(1); updateCondition('includeClosed', event.target.checked);
            }}
          />
          마감 포함
        </label>
        <div className="age-filter">
          <label htmlFor="policy-age">만 나이 (선택)</label>
          <div className="age-input-row">
            <input
              id="policy-age"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              placeholder="예: 28"
              value={ageInput}
              aria-invalid={age === null}
              aria-describedby={age === null ? 'age-help age-error' : 'age-help'}
              onChange={(event) => {
                const value = event.target.value;
                if (parseAgeInput(value) !== age) setPage(1);
                setAgeInput(value);
                const parsed = parseAgeInput(value);
                updateCondition('age', typeof parsed === 'number' ? parsed : undefined);
              }}
            />
            <button className="age-clear-button" type="button" disabled={ageInput === ''} onClick={() => { setPage(1); setAgeInput(''); updateCondition('age', undefined); }}>
              나이 지우기
            </button>
          </div>
          <p id="age-help">나이 없이도 볼 수 있어요.</p>
          {age === null && <p id="age-error" role="alert">만 나이는 1~120 사이의 정수로 입력해 주세요. 올바르게 입력하면 목록을 다시 조회합니다.</p>}
        </div>
        <EligibilityFilters state={eligibility.state} retry={eligibility.retry} jobCode={jobCode} schoolCode={schoolCode} onChange={(field, code) => {
          setState({ status: 'loading' });
          setPage(1); updateCondition(field, code);
        }} />
        <RegionFilter state={regions.state} retry={regions.retry} regionCode={regionCode} onChange={(code) => {
          setState({ status: 'loading' });
          setPage(1); updateCondition('regionCode', code);
        }} />
        {categories.status === 'loading' && <p className="filter-message" role="status">분야 선택지를 불러오는 중입니다.</p>}
        {categories.status === 'error' && (
          <div className="filter-message">
            <p role="alert">분야 선택지를 불러오지 못했습니다. 전체 목록은 계속 조회할 수 있어요.</p>
            <button className="retry-button" type="button" onClick={retryCategories}>
              분야 다시 시도
            </button>
          </div>
        )}
      </section>
      <div className="results-toolbar">
        {state.status === 'success' && age !== null ? (
          <p className="list-summary" role="status" aria-atomic="true" ref={summaryRef} tabIndex={-1}>
            총 {state.response.pagination.total.toLocaleString('ko-KR')}건 · {sortLabels[state.response.appliedSort]}
            {state.response.pagination.totalPages > 0 && (
              <> · {state.response.pagination.page} / {state.response.pagination.totalPages}페이지</>
            )}
          </p>
        ) : <p className="results-label">정책 목록</p>}
        <div className="condition-select list-sort">
          <label htmlFor="policy-sort">정렬</label>
          <select id="policy-sort" value={selectedSort} onChange={(event) => {
            const value = event.target.value;
            if (Object.hasOwn(sortLabels, value)) {
              setState({ status: 'loading' });
              setPage(1); updateCondition('sort', value as SortKey);
            }
          }}>
            {(['recommended', 'popular', 'deadline', 'newest'] as const).map((key) => (
              <option key={key} value={key} disabled={key === 'recommended' && !hasConditions}>{sortLabels[key]}</option>
            ))}
          </select>
        </div>
      </div>
      {age !== null && state.status === 'loading' && (
        <p className="loading-message" role="status">정책 목록을 불러오는 중입니다.</p>
      )}
      {age !== null && state.status === 'error' && (
        <section className="empty-state" role="alert" aria-labelledby="error-title">
          <h2 id="error-title" ref={errorRef} tabIndex={-1}>정책 목록을 불러오지 못했습니다</h2>
          <p>잠시 후 다시 시도해 주세요.</p>
          <button className="retry-button" type="button" onClick={() => { focusAfterSearch.current = true; setAttempt((value) => value + 1); }}>
            다시 시도
          </button>
        </section>
      )}
      {age !== null && state.status === 'success' && (
        <section aria-label="정책 목록">
          <p className="policy-disclaimer">최종 신청 자격 및 접수 여부는 공식 신청처에서 확인하세요.</p>
          {state.response.items.length === 0 ? (
            <section className="empty-state" role="status" aria-labelledby="empty-title">
              <span className="empty-mark" aria-hidden="true" />
              <h2 id="empty-title">표시할 정책이 없습니다</h2>
              <p>{state.response.pagination.total > 0 ? '아래 페이지 이동으로 다른 페이지를 확인해 주세요.'
                : category || hasConditions ? '분야나 입력 조건을 줄이거나 마감 포함을 선택해 다시 찾아보세요.'
                  : '현재 조회할 수 있는 정책이 없어요. 나중에 다시 확인해 주세요.'}</p>
            </section>
          ) : (
            <ul className="policy-list">
              {state.response.items.map((policy) => (
                <li key={policy.id}>
                  <PolicyCard policy={policy} />
                </li>
              ))}
            </ul>
          )}
          <Pagination page={state.response.pagination.page} totalPages={state.response.pagination.totalPages} onChange={(nextPage) => {
            if (nextPage >= 1 && nextPage <= state.response.pagination.totalPages) {
              focusAfterSearch.current = true;
              setState({ status: 'loading' });
              setPage(nextPage);
            }
          }} />
        </section>
      )}
    </main>
  );
}
