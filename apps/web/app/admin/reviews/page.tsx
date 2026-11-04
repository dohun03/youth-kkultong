'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { adminReviewIdSchema } from '@youth-kkultong/shared';
import type { ReviewKind, ReviewListResponse } from '@youth-kkultong/shared';
import { useAdminSession } from '../admin-session';

/** 서버에 적용한 제목 및 종류와 페이지 조건 */
interface ReviewQuery { keyword: string; kind: ReviewKind | ''; page: number; limit: number }

/** 조회 대기와 실패 및 정상 결과를 구분해 통신 실패를 빈 목록으로 표시하지 않음 */
type ListState = { status: 'loading' } | { status: 'error'; message: string }
  | { status: 'success'; response: ReviewListResponse };

const registeredAt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

/** 화면에서 사용하는 행과 페이지 값의 형식을 확인해 손상된 응답을 오류로 처리 */
function isReviewList(value: unknown, query: ReviewQuery): value is ReviewListResponse {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Partial<ReviewListResponse>;
  const pagination = result.pagination;
  if (!Array.isArray(result.items) || !pagination) return false;
  return pagination.page === query.page && pagination.limit === query.limit
    && Number.isSafeInteger(pagination.total) && pagination.total >= 0
    && Number.isSafeInteger(pagination.totalPages) && pagination.totalPages >= 0
    && result.items.every((item) => item && adminReviewIdSchema.safeParse(item.id).success
      && item.status === 'PENDING' && ['NEW', 'CHANGED'].includes(item.kind)
      && typeof item.title === 'string' && typeof item.externalId === 'string'
      && typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)));
}

/** 실제 검수 대기를 제목과 종류로 조회하고 선택한 후보의 상세 경로로 연결 */
export default function ReviewsPage() {
  const { requireLogin } = useAdminSession();
  const [query, setQuery] = useState<ReviewQuery>({ keyword: '', kind: '', page: 1, limit: 20 });
  const [keywordInput, setKeywordInput] = useState('');
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
      const parameters = new URLSearchParams({ status: 'PENDING', page: String(query.page), limit: String(query.limit) });
      if (query.keyword) parameters.set('keyword', query.keyword);
      if (query.kind) parameters.set('kind', query.kind);
      try {
        const response = await fetch(`/api/v1/admin/reviews?${parameters}`, {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        });
        if (!active) return;
        if (response.status === 401) {
          setState({ status: 'loading' });
          requireLogin();
          return;
        }
        if (!response.ok) throw new Error(response.status === 429 ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.' : '검수 대기 목록 조회 실패');
        const result: unknown = await response.json();
        if (!isReviewList(result, query)) throw new Error('검수 대기 목록 응답 오류');
        if (active) setState({ status: 'success', response: result });
      } catch (error) {
        // 이전 필터의 늦은 응답과 페이지를 떠난 뒤의 응답은 현재 화면을 바꾸지 않음
        if (active) setState({ status: 'error', message: error instanceof Error && error.message.startsWith('요청이 많습니다.')
          ? error.message : '검수 대기 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' });
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
  function updateFilters(changes: Partial<ReviewQuery>): void {
    setState({ status: 'loading' });
    setQuery((previous) => ({ ...previous, ...changes, page: 1 }));
  }

  /** 입력 초안은 제출할 때 앞뒤 공백을 제거해 검색 조건에 반영 */
  function search(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    updateFilters({ keyword: keywordInput.trim() });
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
  const hasFilters = Boolean(query.keyword || query.kind);
  const pagination = response?.pagination;
  const startPage = pagination ? Math.max(1, Math.min(query.page - 2, pagination.totalPages - 4)) : 1;
  const pages = pagination ? Array.from({ length: Math.min(5, pagination.totalPages) }, (_, index) => startPage + index) : [];

  return <section className="admin-panel admin-reviews" aria-labelledby="review-list-title">
    <div className="admin-list-heading"><div><h2 id="review-list-title">검수 대기</h2>
      <p className="admin-description">새로 수집되거나 변경된 정책을 확인해 주세요.</p></div>
      <button type="button" className="admin-secondary" onClick={retry} disabled={state.status === 'loading'}>새로고침</button></div>
    <form className="admin-review-filters" role="search" aria-label="검수 대기 검색" onSubmit={search}>
      <div className="admin-keyword-field"><label htmlFor="review-keyword">정책 제목</label>
        <div className="admin-keyword-controls"><input id="review-keyword" type="search" maxLength={100} autoComplete="off"
          placeholder="정책 제목을 입력하세요" value={keywordInput} onChange={(event) => setKeywordInput(event.target.value)}
          onKeyDown={(event) => {
            // 한글 조합을 확정하는 Enter를 검색 제출로 처리하지 않음
            if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
          }} />
          <button type="submit" className="admin-search-button">검색</button></div></div>
      <div><label htmlFor="review-kind">종류</label><select id="review-kind" value={query.kind}
        onChange={(event) => updateFilters({ kind: event.target.value as ReviewKind | '' })}>
        <option value="">전체</option><option value="NEW">신규</option><option value="CHANGED">변경</option></select></div>
      <div><label htmlFor="review-limit">표시 개수</label><select id="review-limit" value={query.limit}
        onChange={(event) => updateFilters({ limit: Number(event.target.value) })}>
        {[10, 20, 50].map((limit) => <option key={limit} value={limit}>{limit}개</option>)}</select></div>
      {(hasFilters || keywordInput) && <button type="button" className="admin-secondary admin-reset" onClick={() => {
        setKeywordInput(''); updateFilters({ keyword: '', kind: '' });
      }}>조건 초기화</button>}
    </form>
    <div className="admin-review-results" aria-busy={state.status === 'loading'}>
      {state.status === 'loading' && <p role="status" className="admin-list-state">검수 대기 목록을 불러오고 있습니다.</p>}
      {state.status === 'error' && <div role="alert" className="admin-list-state">
        <h3 ref={errorRef} tabIndex={-1}>목록을 불러오지 못했습니다</h3><p>{state.message}</p>
        <button type="button" className="retry-button" onClick={retry}>다시 시도</button></div>}
      {response && pagination && <>
        <p ref={summaryRef} tabIndex={-1} role="status" className="admin-review-summary">
          검수 대기 <strong>{pagination.total.toLocaleString('ko-KR')}건</strong>
          {pagination.totalPages > 0 && <span>{query.page.toLocaleString('ko-KR')} / {pagination.totalPages.toLocaleString('ko-KR')}페이지</span>}</p>
        {response.items.length === 0 ? <div className="admin-list-state">
          <h3>{pagination.total > 0 ? '현재 페이지에 검수 대기 정책이 없습니다.'
            : hasFilters ? '검색 조건에 맞는 검수 대기 정책이 없습니다.' : '검수 대기 정책이 없습니다.'}</h3>
          <p className="admin-description">{pagination.total > 0 ? '목록이 변경되었습니다. 첫 페이지에서 다시 확인해 주세요.'
            : hasFilters ? '다른 제목이나 종류로 검색해 보세요.' : '검수가 필요한 새 정책이나 변경 내용이 있으면 이곳에 표시됩니다.'}</p>
          {pagination.total > 0 && <button type="button" className="admin-secondary" onClick={() => changePage(1)}>첫 페이지로</button>}
        </div> : <ul className="admin-review-list" aria-label="검수 대기 정책">
          {response.items.map((item) => <li key={item.id} className="admin-review-row">
            <div className="admin-review-title"><span className={`admin-review-kind ${item.kind === 'NEW' ? 'is-new' : 'is-changed'}`}>{item.kind === 'NEW' ? '신규' : '변경'}</span>
              <h3><Link href={`/admin/reviews/${encodeURIComponent(item.id)}`} prefetch={false}>{item.title}</Link></h3></div>
            <dl className="admin-review-meta"><div><dt>외부 ID</dt><dd>{item.externalId}</dd></div>
              <div><dt>등록 시각 (한국)</dt><dd><time dateTime={item.createdAt}>{registeredAt.format(new Date(item.createdAt))}</time></dd></div></dl>
          </li>)}
        </ul>}
        {pagination.totalPages > 0 && <nav className="admin-pagination" aria-label="검수 대기 페이지">
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
