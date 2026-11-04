'use client';

import { useState } from 'react';
import { HistoryList } from '../../history/history-list';

/** 상세에서 같은 원본의 종료 이력을 필요할 때 조회 */
export function ReviewHistory({ sourcePolicyId, currentReviewId }: { sourcePolicyId: string; currentReviewId: string }) {
  const [open, setOpen] = useState(false);
  return <section className="review-policy-history">
    <button type="button" className="admin-secondary" aria-expanded={open} aria-controls="policy-history-list"
      onClick={() => setOpen((value) => !value)}>{open ? '같은 정책의 처리 이력 접기' : '같은 정책의 처리 이력 보기'}</button>
    <div id="policy-history-list" hidden={!open}>
      {open && <HistoryList key={sourcePolicyId} sourcePolicyId={sourcePolicyId} currentReviewId={currentReviewId} />}
    </div>
  </section>;
}
