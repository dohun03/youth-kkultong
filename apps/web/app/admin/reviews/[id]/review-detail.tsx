'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminReviewIdSchema } from '@youth-kkultong/shared';
import type { AdminReviewDetail, PolicySnapshot, ReviewStatus, SupersededReason } from '@youth-kkultong/shared';
import { useAdminSession } from '../../admin-session';
import { CurrentPublishedSnapshot, ReviewComparison } from './review-comparison';
import { ReviewActions } from './review-actions';

/** 상세 조회의 진행과 오류 및 스냅샷 결과 */
type DetailState = { status: 'loading' } | { status: 'error'; notFound: boolean; message: string }
  | { status: 'success'; detail: AdminReviewDetail };

const statusLabels: Record<ReviewStatus, string> = { PENDING: '검수 대기', APPROVED: '승인됨', REJECTED: '거절됨', SUPERSEDED: '대체됨' };
const supersededLabels: Record<SupersededReason, string> = {
  SOURCE_CHANGED: '더 최근의 원본이 수집됨', PUBLIC_BASE_CHANGED: '공개 기준본이 변경됨',
  MATCHES_PUBLIC: '최신 원본이 공개본과 같아짐', PREVIOUSLY_REJECTED: '이미 거절된 내용과 같아짐',
};
const dateTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false });

/** API의 JSON 객체와 스냅샷 봉투를 확인 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 내용 해시와 원문 객체를 가진 스냅샷인지 확인 */
function isSnapshot(value: unknown): value is PolicySnapshot {
  return isRecord(value) && typeof value.contentHash === 'string' && /^[a-f0-9]{64}$/.test(value.contentHash) && isRecord(value.raw);
}

/** API 시각 문자열의 형식을 확인 */
function isDate(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
/** 공개 및 검수 링크에 사용하는 UUID 형식을 확인 */
function isUuid(value: unknown): value is string { return adminReviewIdSchema.safeParse(value).success; }
/** 미확인 조회수와 정상 정수 조회수를 구분 */
function isViewCount(value: unknown): boolean { return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0); }

/** 잘못된 후보나 손상된 응답을 정상 상세로 표시하지 않도록 사용 필드를 검사 */
function isReviewDetail(value: unknown, id: string): value is AdminReviewDetail {
  if (!isRecord(value) || !isRecord(value.review) || !isRecord(value.latestSource) || !isSnapshot(value.target)) return false;
  const review = value.review;
  const source = value.latestSource;
  const published = value.currentPublished;
  return review.id === id && isUuid(review.sourcePolicyId) && typeof review.title === 'string' && typeof review.externalId === 'string'
    && typeof review.kind === 'string' && ['NEW', 'CHANGED'].includes(review.kind)
    && typeof review.status === 'string' && Object.hasOwn(statusLabels, review.status) && isDate(review.createdAt)
    && (review.closedAt === null || isDate(review.closedAt)) && (review.reviewedBy === null || typeof review.reviewedBy === 'string')
    && (review.rejectionReason === null || typeof review.rejectionReason === 'string')
    && (review.supersededReason === null || (typeof review.supersededReason === 'string' && Object.hasOwn(supersededLabels, review.supersededReason)))
    && review.contentHash === value.target.contentHash
    && (value.base === null ? review.baseContentHash === null : isSnapshot(value.base) && value.base.contentHash === review.baseContentHash)
    && (published === null || (isRecord(published) && isSnapshot(published) && isUuid(published.id) && isViewCount(published.viewCount)))
    && typeof source.contentHash === 'string' && /^[a-f0-9]{64}$/.test(source.contentHash) && isViewCount(source.viewCount)
    && (source.lastCollectedAt === null || isDate(source.lastCollectedAt))
    && typeof source.missingCount === 'number' && Number.isSafeInteger(source.missingCount) && source.missingCount >= 0
    && (value.latestPendingReviewId === null || isUuid(value.latestPendingReviewId)) && typeof value.canReview === 'boolean'
    && Array.isArray(value.changedFields) && value.changedFields.every((field) => isRecord(field) && typeof field.key === 'string'
      && typeof field.beforeExists === 'boolean' && typeof field.afterExists === 'boolean' && Object.hasOwn(field, 'before') && Object.hasOwn(field, 'after'));
}

/** 검수 상세를 같은 출처 API에서 읽고 당시 스냅샷과 현재 상태를 구분해 표시 */
export function ReviewDetail({ id }: { id: string }) {
  const { requireLogin } = useAdminSession();
  const [state, setState] = useState<DetailState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [actionNotice, setActionNotice] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => { setActionNotice(''); setProcessing(false); }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let active = true;
    setState({ status: 'loading' });
    /** 인증 실패와 없는 후보 및 일시적인 오류를 구분해 상세 조회 */
    async function load(): Promise<void> {
      try {
        const response = await fetch(`/api/v1/admin/reviews/${encodeURIComponent(id)}`, {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        });
        if (!active) return;
        if (response.status === 401) { requireLogin(); return; }
        if (!response.ok) {
          setState({ status: 'error', notFound: response.status === 404, message: response.status === 404
            ? '요청한 검수 후보를 찾을 수 없습니다.' : response.status === 429
              ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.' : '검수 상세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' });
          return;
        }
        const result: unknown = await response.json();
        if (!isReviewDetail(result, id)) throw new Error('검수 상세 응답 형식 오류');
        if (active) setState({ status: 'success', detail: result });
      } catch {
        if (active) setState({ status: 'error', notFound: false, message: '검수 상세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' });
      } finally { clearTimeout(timeout); }
    }
    void load();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [id, attempt, requireLogin]);

  const detail = state.status === 'success' ? state.detail : null;
  const sourceChanged = detail !== null && detail.target.contentHash !== detail.latestSource.contentHash;
  const publicChanged = detail !== null && (detail.base === null ? detail.currentPublished !== null
    : detail.currentPublished === null || detail.base.contentHash !== detail.currentPublished.contentHash);

  return <section className="admin-panel admin-review-detail">
    <Link className="admin-detail-back" href="/admin/reviews">← 검수 대기 목록으로</Link>
    <div className="admin-list-heading"><div><h2>검수 상세</h2><p className="admin-review-id">검수 ID: {id}</p></div>
      <button type="button" className="admin-secondary" disabled={state.status === 'loading' || processing} onClick={() => setAttempt((value) => value + 1)}>새로고침</button></div>
    {actionNotice && <p role="status" className="review-info">{actionNotice}</p>}
    {state.status === 'loading' && <p role="status" className="admin-list-state">검수 상세를 불러오고 있습니다.</p>}
    {state.status === 'error' && <div role="alert" className="admin-list-state"><h3>{state.notFound ? '검수 후보가 없습니다' : '상세를 불러오지 못했습니다'}</h3>
      <p>{state.message}</p>{!state.notFound && <button type="button" className="retry-button" onClick={() => setAttempt((value) => value + 1)}>다시 시도</button>}</div>}
    {detail && <>
      <header className="review-detail-heading"><div className="review-detail-badges"><span className={`admin-review-kind ${detail.review.kind === 'NEW' ? 'is-new' : 'is-changed'}`}>{detail.review.kind === 'NEW' ? '신규' : '변경'}</span>
        <span className="admin-badge">{statusLabels[detail.review.status]}</span><span className={`review-eligibility${detail.canReview ? ' can-review' : ''}`}>{detail.canReview ? '검수 가능' : '검수 불가'}</span></div>
        <h3>{detail.review.title}</h3><dl className="review-facts"><div><dt>외부 ID</dt><dd>{detail.review.externalId}</dd></div>
          <div><dt>후보 등록 시각 (한국)</dt><dd><time dateTime={detail.review.createdAt}>{dateTime.format(new Date(detail.review.createdAt))}</time></dd></div>
          <div><dt>최신 수집 조회수</dt><dd>{detail.latestSource.viewCount === null ? '확인되지 않음' : `${detail.latestSource.viewCount.toLocaleString('ko-KR')}회`}</dd></div>
          <div><dt>마지막 실제 수집 (한국)</dt><dd>{detail.latestSource.lastCollectedAt === null ? '아직 실제 수집 기록 없음'
            : <time dateTime={detail.latestSource.lastCollectedAt}>{dateTime.format(new Date(detail.latestSource.lastCollectedAt))}</time>}</dd></div>
          {detail.review.closedAt && <div><dt>처리 시각 (한국)</dt><dd>{dateTime.format(new Date(detail.review.closedAt))}</dd></div>}
          {detail.review.reviewedBy && <div><dt>처리자</dt><dd>{detail.review.reviewedBy}</dd></div>}
        </dl>
      </header>
      <div className="review-notices">
        {detail.review.status !== 'PENDING' && <p className="review-info">{detail.review.status === 'SUPERSEDED' ? '새 후보나 현재 상태로 대체된 검수 이력입니다.' : `처리가 끝난 검수 이력입니다. 상태: ${statusLabels[detail.review.status]}`}</p>}
        {sourceChanged && <p className="review-warning">이후 수집된 원본 내용이 달라졌습니다. 이 후보는 최신 원본과 다릅니다.</p>}
        {publicChanged && <p className="review-warning">검수 당시와 현재 공개본이 달라졌습니다. 아래 현재 공개본을 확인해 주세요.</p>}
        {detail.review.status === 'PENDING' && !detail.canReview && !sourceChanged && !publicChanged
          && <p className="review-warning">현재 원본 또는 공개 기준이 이 후보와 일치하지 않습니다. 최신 상태를 다시 확인해 주세요.</p>}
        {detail.latestSource.missingCount > 0 && <p className="review-warning">최근 정상 수집에서 {detail.latestSource.missingCount.toLocaleString('ko-KR')}회 연속 확인되지 않았습니다.
          {detail.canReview ? ' 저장된 마지막 정상 원본을 기준으로 검수할 수 있습니다.' : ' 아래의 처리 가능 여부를 확인해 주세요.'}</p>}
        {detail.latestPendingReviewId && detail.latestPendingReviewId !== id && <Link className="review-latest-link" href={`/admin/reviews/${detail.latestPendingReviewId}`} prefetch={false}>최신 검수 대기 후보 보기 →</Link>}
        {detail.review.rejectionReason && <div className="review-info"><strong>거절 사유</strong><pre>{detail.review.rejectionReason}</pre></div>}
        {detail.review.supersededReason && <p className="review-info">대체 사유: {supersededLabels[detail.review.supersededReason]}</p>}
      </div>
      <ReviewComparison base={detail.base} target={detail.target} changedFields={detail.changedFields} />
      <section className="review-current" aria-labelledby="review-current-title"><h3 id="review-current-title">현재 공개본</h3>
        {detail.currentPublished === null ? <p className="admin-description">현재 공개된 정책이 없습니다.</p> : <>
          <p>현재 공개 조회수: {detail.currentPublished.viewCount === null ? '확인되지 않음' : `${detail.currentPublished.viewCount.toLocaleString('ko-KR')}회`}</p>
          <Link className="review-latest-link" href={`/policies/${detail.currentPublished.id}`} prefetch={false}>현재 공개 정책 보기 →</Link>
          <CurrentPublishedSnapshot snapshot={detail.currentPublished} />
        </>}
      </section>
      <ReviewActions key={`${id}:${attempt}`} detail={detail} onProcessing={setProcessing} onRefresh={(message) => {
        setActionNotice(message);
        setProcessing(false);
        setAttempt((value) => value + 1);
      }} />
    </>}
  </section>;
}
