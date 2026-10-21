'use client';

import { useEffect, useState } from 'react';
import type { PolicySearchRequest, PolicySearchResponse } from '@youth-kkultong/shared';
import { PolicyCard } from './policy-card';

/** 로딩·실패·정상 응답을 구분해 API 오류를 빈 목록으로 표시하지 않는다. */
type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'success'; response: PolicySearchResponse };

/** 사용자 조건 없이 첫 페이지를 조회하고, 정책 목록과 조회 상태를 보여준다. */
export default function PoliciesPage() {
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    // 응답이 끝없이 지연되어도 오류 안내와 다시 시도 버튼을 보여준다.
    const timeout = setTimeout(() => controller.abort(), 15_000);

    /** 기존 Next.js 전달 경로로 기본 검색을 요청하며 정렬은 API의 인기순 기본값을 따른다. */
    async function loadPolicies(): Promise<void> {
      setState({ status: 'loading' });
      const request: PolicySearchRequest = { page: 1, limit: 20, includeClosed: false };

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
  }, [attempt]);

  return (
    <main className="container policies-page" id="main-content">
      <p className="eyebrow">내일을 위한 기회</p>
      <h1>청년 정책</h1>
      <p className="page-description">
        나에게 필요한 정책과 지원 정보를 찾아보세요.
      </p>
      {state.status === 'loading' && (
        <p role="status">정책 목록을 불러오는 중입니다.</p>
      )}
      {state.status === 'error' && (
        <section className="empty-state" role="alert" aria-labelledby="error-title">
          <h2 id="error-title">정책 목록을 불러오지 못했습니다</h2>
          <p>잠시 후 다시 시도해 주세요.</p>
          <button className="retry-button" type="button" onClick={() => setAttempt((value) => value + 1)}>
            다시 시도
          </button>
        </section>
      )}
      {state.status === 'success' && (
        <section aria-label="정책 목록">
          <p className="list-summary" role="status">
            총 {state.response.pagination.total.toLocaleString('ko-KR')}건 · 인기순
            {state.response.pagination.totalPages > 0 && (
              <> · {state.response.pagination.page} / {state.response.pagination.totalPages}페이지</>
            )}
          </p>
          {state.response.items.length === 0 ? (
            <section className="empty-state" aria-labelledby="empty-title">
              <span className="empty-mark" aria-hidden="true" />
              <h2 id="empty-title">표시할 정책이 없습니다</h2>
              <p>현재 조회할 수 있는 정책이 없어요. 나중에 다시 확인해 주세요.</p>
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
        </section>
      )}
    </main>
  );
}
