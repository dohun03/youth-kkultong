'use client';

import type { PolicyListResponse } from '@kkultong/contracts';
import { useEffect, useState } from 'react';
import { fetchPolicies } from '../../lib/api/policies';
import { PolicyCard } from './PolicyCard';

/** 목록 요청의 진행 상태에 맞춰 공개 정책과 페이지 이동 UI를 표시한다. */
export function PolicyList(): React.ReactElement {
  const [page, setPage] = useState(1);
  const [retryCount, setRetryCount] = useState(0);
  const [result, setResult] = useState<PolicyListResponse | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setHasError(false);

    void fetchPolicies(page, controller.signal)
      .then((response) => setResult(response))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        setHasError(true);
      });

    return () => controller.abort();
  }, [page, retryCount]);

  if (hasError) {
    return (
      <section aria-labelledby="policy-list-title" className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
        <h2 id="policy-list-title" className="text-xl font-bold text-slate-950">
          정책 목록
        </h2>
        <p className="mt-3 text-slate-700">정책을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
        <button
          className="mt-5 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
          onClick={() => setRetryCount((count) => count + 1)}
          type="button"
        >
          다시 시도
        </button>
      </section>
    );
  }

  if (result === null) {
    return (
      <section aria-busy="true" aria-labelledby="policy-list-title">
        <h2 id="policy-list-title" className="text-2xl font-bold text-slate-950">
          정책 목록
        </h2>
        <p className="mt-3 text-slate-600">정책을 불러오는 중입니다.</p>
      </section>
    );
  }

  if (result.items.length === 0) {
    return (
      <section aria-labelledby="policy-list-title" className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 id="policy-list-title" className="text-2xl font-bold text-slate-950">
          정책 목록
        </h2>
        <p className="mt-3 text-slate-600">현재 보여 드릴 수 있는 정책이 없습니다.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="policy-list-title">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="policy-list-title" className="text-2xl font-bold text-slate-950">
            정책 목록
          </h2>
          <p className="mt-2 text-slate-600">현재 신청 가능한 정책 {result.total}개를 확인해 보세요.</p>
        </div>
        <p className="text-sm text-slate-500">
          {result.page} / {result.totalPages} 페이지
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {result.items.map((policy) => (
          <PolicyCard key={policy.id} policy={policy} />
        ))}
      </div>

      {result.totalPages > 1 ? (
        <nav aria-label="정책 목록 페이지" className="mt-8 flex items-center justify-center gap-3">
          <button
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={result.page === 1}
            onClick={() => setPage((currentPage) => currentPage - 1)}
            type="button"
          >
            이전
          </button>
          <span className="text-sm text-slate-600">{result.page}페이지</span>
          <button
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={result.page === result.totalPages}
            onClick={() => setPage((currentPage) => currentPage + 1)}
            type="button"
          >
            다음
          </button>
        </nav>
      ) : null}
    </section>
  );
}
