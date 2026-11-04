'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { adminReviewIdSchema, missingPolicyQuerySchema } from '@youth-kkultong/shared';
import type { MissingPolicyResponse } from '@youth-kkultong/shared';
import { useAdminSession } from '../admin-session';

/** 서버에 적용한 제목과 최소 누락 횟수 및 페이지 조건 */
interface MissingQuery { keyword: string; minMissingCount: number; page: number; limit: number }

/** 조회 대기와 실패 및 정상 결과를 구분해 통신 실패를 빈 목록으로 표시하지 않음 */
type ListState = { status: 'loading' } | { status: 'error'; message: string }
  | { status: 'success'; response: MissingPolicyResponse };

const collectedAtFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

/** 화면에서 사용하는 행과 페이지 값의 형식을 확인해 손상된 응답을 오류로 처리 */
function isMissingList(value: unknown, query: MissingQuery): value is MissingPolicyResponse {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Partial<MissingPolicyResponse>;
  const pagination = result.pagination;
  if (!Array.isArray(result.items) || !pagination) return false;
  return pagination.page === query.page && pagination.limit === query.limit
    && Number.isSafeInteger(pagination.total) && pagination.total >= 0
    && pagination.totalPages === Math.ceil(pagination.total / query.limit)
    && result.items.length <= query.limit
    && result.items.every((item) => item && adminReviewIdSchema.safeParse(item.sourcePolicyId).success
      && typeof item.title === 'string' && typeof item.externalId === 'string'
      && Number.isInteger(item.missingCount) && item.missingCount >= query.minMissingCount && item.missingCount <= 2147483647
      && (item.lastCollectedAt === null || (typeof item.lastCollectedAt === 'string' && Number.isFinite(Date.parse(item.lastCollectedAt))))
      && (item.policyId === null || adminReviewIdSchema.safeParse(item.policyId).success)
      && (item.latestPendingReviewId === null || adminReviewIdSchema.safeParse(item.latestPendingReviewId).success));
}

/** 누락 원본을 조회하고 현재 공개본과 최신 검수 대기로 연결 */
export default function MissingPage() {
  const { requireLogin } = useAdminSession();
  const [query, setQuery] = useState<MissingQuery>({ keyword: '', minMissingCount: 1, page: 1, limit: 20 });
  const [keywordInput, setKeywordInput] = useState('');
  const [minimumInput, setMinimumInput] = useState('1');
  const [filterError, setFilterError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const errorRef = useRef<HTMLHeadingElement>(null);
  const focusAfterLoad = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setState({ status: 'loading' });

    /** 현재 필터로 같은 출처의 목록 API를 호출하고 인증 실패와 일반 오류를 구분 */
    async function load(): Promise<void> {
      const parameters = new URLSearchParams({ minMissingCount: String(query.minMissingCount), page: String(query.page), limit: String(query.limit) });
      if (query.keyword) parameters.set('keyword', query.keyword);
      try {
        const response = await fetch(`/api/v1/admin/source-policies/missing?${parameters}`, {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        });
        if (!active) return;
        if (response.status === 401) {
          setState({ status: 'loading' });
          requireLogin();
          return;
        }
        if (!response.ok) throw new Error(response.status === 429 ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.' : '누락 정책 목록 조회 실패');
        const result: unknown = await response.json();
        if (!isMissingList(result, query)) throw new Error('누락 정책 목록 응답 오류');
        if (active) setState({ status: 'success', response: result });
      } catch (error) {
        // 이전 필터의 늦은 응답과 페이지를 떠난 뒤의 응답은 현재 화면을 바꾸지 않음
        if (active) setState({ status: 'error', message: error instanceof Error && error.message.startsWith('요청이 많습니다.')
          ? error.message : '누락 정책 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' });
      } finally { clearTimeout(timeout); }
    }
    void load();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [query, attempt, requireLogin]);

  useEffect(() => {
    // 페이지 및 재시도 버튼이 사라져도 결과나 오류 안내로 키보드 초점을 연결
    if (!focusAfterLoad.current || state.status === 'loading') return;
    const target = state.status === 'success' ? summaryRef.current : errorRef.current;
    if (target) { target.focus({ preventScroll: true }); focusAfterLoad.current = false; }
  }, [state]);

  /** 필터를 적용하면 기존 결과를 숨기고 첫 페이지부터 다시 조회 */
  function updateFilters(changes: Partial<MissingQuery>): void {
    setState({ status: 'loading' });
    setQuery((previous) => ({ ...previous, ...changes, page: 1 }));
  }

  /** 제목과 최소 누락 횟수 초안을 공용 스키마로 검사한 뒤 함께 적용 */
  function search(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsed = missingPolicyQuerySchema.safeParse({ keyword: keywordInput.trim(), minMissingCount: minimumInput,
      page: '1', limit: String(query.limit) });
    if (!parsed.success) {
      setFilterError('최소 누락 횟수는 1~2,147,483,647 사이의 정수, 제목은 100자 이내로 입력해 주세요.');
      return;
    }
    setFilterError('');
    updateFilters({ keyword: parsed.data.keyword ?? '', minMissingCount: parsed.data.minMissingCount });
  }

  /** 같은 조건을 다시 읽고 완료된 결과 안내로 초점을 이동 */
  function retry(): void {
    focusAfterLoad.current = true;
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }

  /** 선택한 페이지를 조회하고 결과 건수 안내로 초점을 이동 */
  function changePage(page: number): void {
    focusAfterLoad.current = true;
    setState({ status: 'loading' });
    setQuery((previous) => ({ ...previous, page }));
  }

  const response = state.status === 'success' ? state.response : null;
  const hasFilters = Boolean(query.keyword || query.minMissingCount !== 1);
  const pagination = response?.pagination;
  const startPage = pagination ? Math.max(1, Math.min(query.page - 2, pagination.totalPages - 4)) : 1;
  const pages = pagination ? Array.from({ length: Math.min(5, pagination.totalPages) }, (_, index) => startPage + index) : [];

  return <section className="admin-panel admin-reviews admin-missing" aria-labelledby="missing-list-title">
    <div className="admin-list-heading"><div><h2 id="missing-list-title">누락 정책</h2>
      <p className="admin-description">정상 수집에서 연속으로 확인되지 않은 원본입니다. 누락만으로 공개가 중단되지는 않습니다.</p></div>
      <button type="button" className="admin-secondary" onClick={retry} disabled={state.status === 'loading'}>새로고침</button></div>
    <form className="admin-review-filters" role="search" aria-label="누락 정책 검색" onSubmit={search} noValidate>
      <div className="admin-keyword-field"><label htmlFor="missing-keyword">정책 제목</label>
        <div className="admin-keyword-controls"><input id="missing-keyword" type="search" maxLength={100} autoComplete="off"
          placeholder="정책 제목을 입력하세요" value={keywordInput} onChange={(event) => setKeywordInput(event.target.value)}
          onKeyDown={(event) => {
            // 한글 조합을 확정하는 Enter를 검색 제출로 처리하지 않음
            if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
          }} />
          <button type="submit" className="admin-search-button">검색</button></div></div>
      <div className="admin-missing-minimum"><label htmlFor="missing-minimum">최소 누락 횟수</label>
        <input id="missing-minimum" type="number" inputMode="numeric" min={1} max={2147483647} step={1}
          value={minimumInput} aria-invalid={Boolean(filterError)} aria-describedby={filterError ? 'missing-filter-error' : undefined}
          onChange={(event) => { setMinimumInput(event.target.value); setFilterError(''); }} /></div>
      <div className="admin-missing-limit"><label htmlFor="missing-limit">표시 개수</label><select id="missing-limit" value={query.limit}
        onChange={(event) => updateFilters({ limit: Number(event.target.value) })}>
        {[10, 20, 50].map((limit) => <option key={limit} value={limit}>{limit}개</option>)}</select></div>
      {(hasFilters || keywordInput || minimumInput !== '1') && <button type="button" className="admin-secondary admin-reset" onClick={() => {
        setKeywordInput(''); setMinimumInput('1'); setFilterError(''); updateFilters({ keyword: '', minMissingCount: 1 });
      }}>조건 초기화</button>}
      {filterError && <p id="missing-filter-error" role="alert" className="admin-filter-error">{filterError}</p>}
    </form>
    <div className="admin-review-results" aria-busy={state.status === 'loading'}>
      {state.status === 'loading' && <p role="status" className="admin-list-state">누락 정책 목록을 불러오고 있습니다.</p>}
      {state.status === 'error' && <div role="alert" className="admin-list-state">
        <h3 ref={errorRef} tabIndex={-1}>목록을 불러오지 못했습니다</h3><p>{state.message}</p>
        <button type="button" className="retry-button" onClick={retry}>다시 시도</button></div>}
      {response && pagination && <>
        <p ref={summaryRef} tabIndex={-1} role="status" className="admin-review-summary">
          누락 정책 <strong>{pagination.total.toLocaleString('ko-KR')}건</strong>
          {pagination.totalPages > 0 && <span>{query.page.toLocaleString('ko-KR')} / {pagination.totalPages.toLocaleString('ko-KR')}페이지</span>}</p>
        {response.items.length === 0 ? <div className="admin-list-state">
          <h3>{pagination.total > 0 ? '현재 페이지에 누락 정책이 없습니다.'
            : hasFilters ? '검색 조건에 맞는 누락 정책이 없습니다.' : '누락 정책이 없습니다.'}</h3>
          <p className="admin-description">{pagination.total > 0 ? '목록이 변경되었습니다. 첫 페이지에서 다시 확인해 주세요.'
            : hasFilters ? '다른 제목이나 최소 누락 횟수로 검색해 보세요.' : '현재 조건에 해당하는 누락 원본이 있으면 이곳에 표시됩니다.'}</p>
          {pagination.total > 0 && <button type="button" className="admin-secondary" onClick={() => changePage(1)}>첫 페이지로</button>}
        </div> : <ul className="admin-review-list" aria-label="누락 정책 목록">
          {response.items.map((item) => <li key={item.sourcePolicyId} className="admin-review-row">
            <div className="admin-review-title"><span className={`admin-badge ${item.policyId ? 'is-published' : 'is-unpublished'}`}>{item.policyId ? '공개 중' : '미공개'}</span>
              <h3>{item.title}</h3></div>
            <dl className="admin-review-meta"><div><dt>외부 ID</dt><dd>{item.externalId}</dd></div>
              <div><dt>연속 누락 횟수</dt><dd>{item.missingCount.toLocaleString('ko-KR')}회</dd></div>
              <div><dt>마지막 실제 수집 (한국)</dt><dd>{item.lastCollectedAt === null ? '아직 실제 수집 기록 없음'
                : <time dateTime={item.lastCollectedAt}>{collectedAtFormatter.format(new Date(item.lastCollectedAt))}</time>}</dd></div></dl>
            <div className="admin-missing-links">
              {item.policyId && <Link href={`/policies/${encodeURIComponent(item.policyId)}`} prefetch={false}>공개 정책 보기 →</Link>}
              {item.latestPendingReviewId && <Link href={`/admin/reviews/${encodeURIComponent(item.latestPendingReviewId)}`} prefetch={false}>검수 대기 보기 →</Link>}
              {!item.policyId && !item.latestPendingReviewId && <p className="admin-description">연결할 공개본과 대기 후보가 없습니다.</p>}
            </div>
          </li>)}
        </ul>}
        {pagination.totalPages > 0 && <nav className="admin-pagination" aria-label="누락 정책 페이지">
          <button type="button" disabled={query.page <= 1} onClick={() => changePage(1)}>처음</button>
          <button type="button" disabled={query.page <= 1} onClick={() => changePage(query.page - 1)}>이전</button>
          {pages.map((page) => <button type="button" key={page} aria-label={`${page}페이지`} aria-current={page === query.page ? 'page' : undefined}
            disabled={page === query.page} onClick={() => changePage(page)}>{page}</button>)}
          <button type="button" disabled={query.page >= pagination.totalPages} onClick={() => changePage(query.page + 1)}>다음</button>
          <button type="button" disabled={query.page >= pagination.totalPages} onClick={() => changePage(pagination.totalPages)}>마지막</button>
        </nav>}
      </>}
    </div>
  </section>;
}
