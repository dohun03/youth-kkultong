'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { adminReviewIdSchema } from '@youth-kkultong/shared';
import type { ReviewStatus, ReviewListResponse, SupersededReason } from '@youth-kkultong/shared';
import { useAdminSession } from '../admin-session';

/** 이력 목록에서 선택할 수 있는 종료 상태 */
type HistoryStatus = Exclude<ReviewStatus, 'PENDING'> | 'PROCESSED';
/** 서버에 적용한 제목과 처리 상태 및 페이지 조건 */
interface HistoryQuery { keyword: string; status: HistoryStatus; page: number; limit: number }

/** 조회 대기와 실패 및 정상 결과를 구분해 통신 실패를 빈 목록으로 표시하지 않음 */
type ListState = { status: 'loading' } | { status: 'error'; message: string }
  | { status: 'success'; response: ReviewListResponse };

const statusLabels: Record<HistoryStatus, string> = { PROCESSED: '전체 처리 이력', APPROVED: '승인됨', REJECTED: '거절됨', SUPERSEDED: '대체됨' };
const supersededLabels: Record<SupersededReason, string> = {
  SOURCE_CHANGED: '더 최근의 원본이 수집됨', PUBLIC_BASE_CHANGED: '공개 기준본이 변경됨',
  MATCHES_PUBLIC: '최신 원본이 공개본과 같아짐', PREVIOUSLY_REJECTED: '이미 거절된 내용과 같아짐',
};
const closedAtFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

/** 화면에서 사용하는 행과 페이지 값의 형식을 확인해 손상된 응답을 오류로 처리 */
function isHistoryList(value: unknown, query: HistoryQuery, sourcePolicyId?: string): value is ReviewListResponse {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Partial<ReviewListResponse>;
  const pagination = result.pagination;
  if (!Array.isArray(result.items) || !pagination) return false;
  return pagination.page === query.page && pagination.limit === query.limit
    && Number.isSafeInteger(pagination.total) && pagination.total >= 0
    && pagination.totalPages === Math.ceil(pagination.total / query.limit)
    && result.items.length <= query.limit
    && result.items.every((item) => item && adminReviewIdSchema.safeParse(item.id).success
      && adminReviewIdSchema.safeParse(item.sourcePolicyId).success
      && (!sourcePolicyId || item.sourcePolicyId === sourcePolicyId)
      && ['APPROVED', 'REJECTED', 'SUPERSEDED'].includes(item.status)
      && (query.status === 'PROCESSED' || item.status === query.status) && ['NEW', 'CHANGED'].includes(item.kind)
      && typeof item.title === 'string' && typeof item.externalId === 'string'
      && typeof item.closedAt === 'string' && Number.isFinite(Date.parse(item.closedAt))
      && (item.status === 'SUPERSEDED' ? item.reviewedBy === null && item.rejectionReason === null
        && typeof item.supersededReason === 'string' && Object.hasOwn(supersededLabels, item.supersededReason)
        : typeof item.reviewedBy === 'string' && item.supersededReason === null
          && (item.status === 'REJECTED' ? typeof item.rejectionReason === 'string' : item.rejectionReason === null)));
}

/** 종료된 검수를 상태와 제목으로 조회하고 당시 스냅샷 상세로 연결 */
export function HistoryList({ sourcePolicyId, currentReviewId }: { sourcePolicyId?: string; currentReviewId?: string }) {
  const { requireLogin } = useAdminSession();
  const [query, setQuery] = useState<HistoryQuery>({ keyword: '', status: 'PROCESSED', page: 1, limit: 20 });
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
      const parameters = new URLSearchParams({ status: query.status, page: String(query.page), limit: String(query.limit) });
      if (query.keyword) parameters.set('keyword', query.keyword);
      if (sourcePolicyId) parameters.set('sourcePolicyId', sourcePolicyId);
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
        if (!response.ok) throw new Error(response.status === 429 ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.' : '처리 이력 목록 조회 실패');
        const result: unknown = await response.json();
        if (!isHistoryList(result, query, sourcePolicyId)) throw new Error('처리 이력 목록 응답 오류');
        if (active) setState({ status: 'success', response: result });
      } catch (error) {
        // 이전 필터의 늦은 응답과 페이지를 떠난 뒤의 응답은 현재 화면을 바꾸지 않음
        if (active) setState({ status: 'error', message: error instanceof Error && error.message.startsWith('요청이 많습니다.')
          ? error.message : '처리 이력 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' });
      } finally { clearTimeout(timeout); }
    }
    void load();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [query, attempt, requireLogin, sourcePolicyId]);

  useEffect(() => {
    // 페이지 및 재시도 버튼이 사라져도 결과나 오류 안내로 키보드 초점을 연결
    if (!focusAfterLoad.current || state.status === 'loading') return;
    const target = state.status === 'success' ? summaryRef.current : errorRef.current;
    if (target) { target.focus({ preventScroll: true }); focusAfterLoad.current = false; }
  }, [state]);

  /** 필터를 적용하면 기존 결과를 숨기고 첫 페이지부터 다시 조회 */
  function updateFilters(changes: Partial<HistoryQuery>): void {
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

  const RowHeading = sourcePolicyId ? 'h4' : 'h3';
  const response = state.status === 'success' ? state.response : null;
  const hasFilters = Boolean(query.keyword || query.status !== 'PROCESSED');
  const pagination = response?.pagination;
  const startPage = pagination ? Math.max(1, Math.min(query.page - 2, pagination.totalPages - 4)) : 1;
  const pages = pagination ? Array.from({ length: Math.min(5, pagination.totalPages) }, (_, index) => startPage + index) : [];

  return <section className="admin-panel admin-reviews admin-history" aria-label={sourcePolicyId ? '같은 정책의 처리 이력' : '처리 이력'}>
    <div className="admin-list-heading"><div>{sourcePolicyId ? <h3>같은 정책의 처리 이력</h3> : <h2>처리 이력</h2>}
      <p className="admin-description">승인과 거절 및 시스템이 대체한 검수 이력을 확인해 주세요.</p></div>
      <button type="button" className="admin-secondary" onClick={retry} disabled={state.status === 'loading'}>새로고침</button></div>
    <form className="admin-review-filters" role="search" aria-label={sourcePolicyId ? '같은 정책 이력 검색' : '처리 이력 검색'} onSubmit={search}>
      <div className="admin-keyword-field"><label htmlFor={sourcePolicyId ? 'policy-history-keyword' : 'history-keyword'}>정책 제목</label>
        <div className="admin-keyword-controls"><input id={sourcePolicyId ? 'policy-history-keyword' : 'history-keyword'} type="search" maxLength={100} autoComplete="off"
          placeholder="정책 제목을 입력하세요" value={keywordInput} onChange={(event) => setKeywordInput(event.target.value)}
          onKeyDown={(event) => {
            // 한글 조합을 확정하는 Enter를 검색 제출로 처리하지 않음
            if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
          }} />
          <button type="submit" className="admin-search-button">검색</button></div></div>
      <div className="admin-history-status-filter"><label htmlFor="history-status">처리 상태</label><select id="history-status" value={query.status}
        onChange={(event) => updateFilters({ status: event.target.value as HistoryStatus })}>
        {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div className="admin-history-limit"><label htmlFor="history-limit">표시 개수</label><select id="history-limit" value={query.limit}
        onChange={(event) => updateFilters({ limit: Number(event.target.value) })}>
        {[10, 20, 50].map((limit) => <option key={limit} value={limit}>{limit}개</option>)}</select></div>
      {(hasFilters || keywordInput) && <button type="button" className="admin-secondary admin-reset" onClick={() => {
        setKeywordInput(''); updateFilters({ keyword: '', status: 'PROCESSED' });
      }}>조건 초기화</button>}
    </form>
    <div className="admin-review-results" aria-busy={state.status === 'loading'}>
      {state.status === 'loading' && <p role="status" className="admin-list-state">처리 이력 목록을 불러오고 있습니다.</p>}
      {state.status === 'error' && <div role="alert" className="admin-list-state">
        <h3 ref={errorRef} tabIndex={-1}>목록을 불러오지 못했습니다</h3><p>{state.message}</p>
        <button type="button" className="retry-button" onClick={retry}>다시 시도</button></div>}
      {response && pagination && <>
        <p ref={summaryRef} tabIndex={-1} role="status" className="admin-review-summary">
          처리 이력 <strong>{pagination.total.toLocaleString('ko-KR')}건</strong>
          {pagination.totalPages > 0 && <span>{query.page.toLocaleString('ko-KR')} / {pagination.totalPages.toLocaleString('ko-KR')}페이지</span>}</p>
        {response.items.length === 0 ? <div className="admin-list-state">
          <h3>{pagination.total > 0 ? '현재 페이지에 처리 이력이 없습니다.'
            : hasFilters ? '검색 조건에 맞는 처리 이력이 없습니다.' : '처리 이력이 없습니다.'}</h3>
          <p className="admin-description">{pagination.total > 0 ? '목록이 변경되었습니다. 첫 페이지에서 다시 확인해 주세요.'
            : hasFilters ? '다른 제목이나 처리 상태로 검색해 보세요.' : '승인과 거절 또는 시스템 대체가 완료되면 이곳에 표시됩니다.'}</p>
          {pagination.total > 0 && <button type="button" className="admin-secondary" onClick={() => changePage(1)}>첫 페이지로</button>}
        </div> : <ul className="admin-review-list" aria-label="처리 이력 목록">
          {response.items.map((item) => <li key={item.id} className="admin-review-row">
            <div className="admin-review-title"><span className={`admin-review-kind ${item.kind === 'NEW' ? 'is-new' : 'is-changed'}`}>{item.kind === 'NEW' ? '신규' : '변경'}</span>
              <RowHeading><Link href={`/admin/reviews/${encodeURIComponent(item.id)}`} prefetch={false}
                aria-current={item.id === currentReviewId ? 'page' : undefined}>{item.title}</Link></RowHeading></div>
            <div className="admin-history-status"><span className={`admin-badge status-${item.status.toLowerCase()}`}>{statusLabels[item.status as HistoryStatus]}</span>
              {item.id === currentReviewId && <span className="admin-description">현재 보고 있는 이력</span>}</div>
            <dl className="admin-review-meta"><div><dt>외부 ID</dt><dd>{item.externalId}</dd></div>
              <div><dt>처리 시각 (한국)</dt><dd><time dateTime={item.closedAt!}>{closedAtFormatter.format(new Date(item.closedAt!))}</time></dd></div>
              <div><dt>처리자</dt><dd>{item.status === 'SUPERSEDED' ? '시스템 자동 대체' : item.reviewedBy}</dd></div>
              <div className="admin-history-reason"><dt>{item.status === 'REJECTED' ? '거절 사유' : item.status === 'SUPERSEDED' ? '대체 사유' : '처리 내용'}</dt>
                <dd>{item.status === 'REJECTED' ? item.rejectionReason : item.status === 'SUPERSEDED'
                  ? supersededLabels[item.supersededReason!] : '검수한 변경본을 공개 정책에 반영'}</dd></div></dl>
          </li>)}
        </ul>}
        {pagination.totalPages > 0 && <nav className="admin-pagination" aria-label="처리 이력 페이지">
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
