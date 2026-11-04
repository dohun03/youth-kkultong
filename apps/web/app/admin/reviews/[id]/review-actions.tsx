'use client';

import { useEffect, useRef, useState } from 'react';
import { rejectReviewSchema, reviewActionSchema } from '@youth-kkultong/shared';
import type { AdminReviewDetail } from '@youth-kkultong/shared';
import { useAdminSession } from '../../admin-session';

/** 검수 확인 폼과 단일 처리 요청을 관리하고 결과 확인을 위한 상세 재조회를 연결 */
export function ReviewActions({ detail, onProcessing, onRefresh }: {
  detail: AdminReviewDetail;
  onProcessing: (processing: boolean) => void;
  onRefresh: (message: string) => void;
}) {
  const { requireLogin } = useAdminSession();
  const [action, setAction] = useState<'approve' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const active = useRef(true);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; controller.current?.abort(); };
  }, []);

  /** 화면에서 확인한 두 해시와 검증된 사유를 한 번 전송하고 처리 상태를 다시 확인 */
  async function submit(): Promise<void> {
    if (!action || !detail.canReview || pending.current) return;
    const hashes = { contentHash: detail.review.contentHash, baseContentHash: detail.review.baseContentHash };
    const parsed = action === 'reject' ? rejectReviewSchema.safeParse({ ...hashes, reason }) : reviewActionSchema.safeParse(hashes);
    if (!parsed.success) { setError('거절 사유를 앞뒤 공백 제외 1~1000자로 입력해 주세요.'); return; }

    // 상태 갱신 전 연속 제출도 막고 전송 중에는 확인 폼과 새로고침을 잠금
    pending.current = true;
    setSubmitting(true);
    onProcessing(true);
    setError('');
    controller.current = new AbortController();
    const timeout = setTimeout(() => controller.current?.abort(), 15000);
    let notice = '응답을 확인하지 못했습니다. 상세를 다시 조회합니다. 상태와 처리 정보를 먼저 확인해 주세요. 자동으로 다시 제출하지 않습니다.';
    try {
      const response = await fetch(`/api/v1/admin/reviews/${encodeURIComponent(detail.review.id)}/${action}`, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data), signal: controller.current.signal,
      });
      if (!active.current) return;
      if (response.status === 401) { requireLogin(); return; }
      if (response.ok) {
        notice = `${action === 'approve' ? '승인' : '거절'} 요청이 처리되었습니다. 다시 조회한 상태와 처리 정보를 확인해 주세요.`;
      } else if (response.status === 409) {
        notice = '후보의 내용 또는 처리 상태가 변경되었습니다. 상세를 갱신합니다. 최신 내용을 확인해 주세요.';
      } else if (response.status < 500) {
        notice = response.status === 429 ? '요청이 많아 처리하지 못했습니다. 상세를 확인한 후 잠시 뒤 다시 시도해 주세요.'
          : response.status === 403 ? '요청 출처를 확인하지 못했습니다. 접속 주소를 확인하고 상세 상태를 확인해 주세요.'
            : response.status === 404 ? '검수 후보를 찾을 수 없습니다. 상세를 다시 조회합니다.'
              : '요청을 처리하지 못했습니다. 상세 상태와 입력값을 확인해 주세요.';
      }
    } catch {
      // 응답이 끊겨도 서버에서 확정됐을 수 있으므로 POST 대신 GET으로 결과를 확인
    } finally {
      clearTimeout(timeout);
      if (active.current) onRefresh(notice);
    }
  }

  return <section className="review-actions" aria-label="검수 처리" aria-busy={submitting}>
    <p className="admin-description" id="review-actions-notice">승인하면 검수한 변경본이 공개됩니다. 거절하면 현재 공개본을 유지합니다.</p>
    <div><button type="button" className="admin-search-button" disabled={!detail.canReview || submitting}
      aria-describedby="review-actions-notice" onClick={() => { setAction('approve'); setError(''); }}>승인</button>
      <button type="button" className="admin-secondary" disabled={!detail.canReview || submitting}
        aria-describedby="review-actions-notice" onClick={() => { setAction('reject'); setError(''); }}>거절</button></div>
    {action && <form className="review-action-form" aria-label={action === 'approve' ? '승인 확인' : '거절 확인'}
      onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={submitting}><legend>{action === 'approve' ? '승인 확인' : '거절 확인'}</legend>
        <p>{action === 'approve' ? `“${detail.review.title}”의 변경본을 공개하시겠습니까?` : '거절 사유를 입력한 뒤 확인해 주세요.'}</p>
        {action === 'reject' && <><label htmlFor="review-reason">거절 사유 (필수, 1~1000자)</label>
          <textarea id="review-reason" autoFocus rows={5} value={reason} aria-describedby="review-reason-count review-action-error"
            aria-invalid={Boolean(error)} onChange={(event) => { setReason(event.target.value); setError(''); }} />
          <p id="review-reason-count">앞뒤 공백 제외 {reason.trim().length.toLocaleString('ko-KR')} / 1,000자</p></>}
        {error && <p id="review-action-error" role="alert">{error}</p>}
        <div><button type="submit" autoFocus={action === 'approve'} className="admin-search-button">{action === 'approve' ? '승인 확정' : '거절 확정'}</button>
          <button type="button" className="admin-secondary" onClick={() => { setAction(null); setError(''); }}>취소</button></div>
      </fieldset>
    </form>}
    {submitting && <p role="status">처리 중입니다. 완료 후 상세 상태를 다시 확인합니다.</p>}
  </section>;
}
