'use client';

import { useEffect, useState } from 'react';
import type { PolicySearchRequest, PolicySearchResponse, SortKey } from '@youth-kkultong/shared';
import { PolicyCard } from './policy-card';

/** 로딩·실패·정상 응답을 구분해 API 오류를 빈 목록으로 표시하지 않는다. */
type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'success'; response: PolicySearchResponse };

/** 분야 선택지 조회 상태를 목록 조회와 분리해 한쪽 오류가 다른 기능을 막지 않게 한다. */
type CategoriesState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'success'; items: string[] };

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
  const [categories, setCategories] = useState<CategoriesState>({ status: 'loading' });
  const [categoriesAttempt, setCategoriesAttempt] = useState(0);
  const [category, setCategory] = useState('');
  const [includeClosed, setIncludeClosed] = useState(false);
  const [ageInput, setAgeInput] = useState('');
  const age = parseAgeInput(ageInput);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 15_000);

    /** DB에 저장된 실제 분야를 가져오며 묶음 분야명도 하나의 선택지로 유지한다. */
    async function loadCategories(): Promise<void> {
      setCategories({ status: 'loading' });
      try {
        const response = await fetch('/api/v1/meta/categories', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('분야 조회 실패');
        const items: unknown = await response.json();
        // 선택지에 잘못된 자료형이 섞이면 빈 목록으로 숨기지 않고 오류로 안내한다.
        if (!Array.isArray(items) || !items.every((item): item is string => typeof item === 'string' && item.trim().length > 0)) {
          throw new Error('분야 응답 형식 오류');
        }
        if (active) setCategories({ status: 'success', items });
      } catch {
        if (active) setCategories({ status: 'error' });
      } finally {
        clearTimeout(timeout);
      }
    }

    void loadCategories();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [categoriesAttempt]);

  useEffect(() => {
    // 잘못된 나이는 전송하지 않는다. 이전 결과도 숨겨 현재 입력의 결과처럼 보이지 않게 한다.
    if (age === null) return;
    const controller = new AbortController();
    let active = true;
    // 응답이 끝없이 지연되어도 오류 안내와 다시 시도 버튼을 보여준다.
    const timeout = setTimeout(() => controller.abort(), 15_000);

    /** 필터를 바꿀 때마다 첫 페이지를 요청하며 조건에 따른 기본 정렬은 API가 결정한다. */
    async function loadPolicies(): Promise<void> {
      setState({ status: 'loading' });
      const request: PolicySearchRequest = { page: 1, limit: 20, includeClosed };
      // '전체'일 때는 category 자체를 보내지 않고, 선택한 실제 분야명만 그대로 보낸다.
      if (category) request.category = category;
      // 선택 입력을 지우면 conditions도 생략한다. 나이는 URL·브라우저 저장소에 남기지 않는다.
      if (typeof age === 'number') request.conditions = { age };

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
  }, [attempt, category, includeClosed, age]);

  return (
    <main className="container policies-page" id="main-content">
      <p className="eyebrow">내일을 위한 기회</p>
      <h1>청년 정책</h1>
      <p className="page-description">
        나에게 필요한 정책과 지원 정보를 찾아보세요.
      </p>
      <section className="policy-filters" aria-label="정책 필터">
        <div className="category-filter">
          <label htmlFor="policy-category">분야</label>
          <select
            id="policy-category"
            value={category}
            disabled={categories.status !== 'success'}
            onChange={(event) => {
              setState({ status: 'loading' });
              setCategory(event.target.value);
            }}
          >
            <option value="">전체</option>
            {categories.status === 'success' && categories.items.map((item) => (
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
              setIncludeClosed(event.target.checked);
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
              onChange={(event) => setAgeInput(event.target.value)}
            />
            <button className="age-clear-button" type="button" disabled={ageInput === ''} onClick={() => setAgeInput('')}>
              나이 지우기
            </button>
          </div>
          <p id="age-help">입력하지 않아도 정책을 볼 수 있어요.</p>
          {age === null && <p id="age-error" role="alert">만 나이는 1~120 사이의 정수로 입력해 주세요. 올바르게 입력하면 목록을 다시 조회합니다.</p>}
        </div>
        {categories.status === 'loading' && <p className="filter-message" role="status">분야 선택지를 불러오는 중입니다.</p>}
        {categories.status === 'error' && (
          <div className="filter-message">
            <p role="alert">분야 선택지를 불러오지 못했습니다. 전체 목록은 계속 조회할 수 있어요.</p>
            <button className="retry-button" type="button" onClick={() => setCategoriesAttempt((value) => value + 1)}>
              분야 다시 시도
            </button>
          </div>
        )}
      </section>
      {age !== null && state.status === 'loading' && (
        <p role="status">정책 목록을 불러오는 중입니다.</p>
      )}
      {age !== null && state.status === 'error' && (
        <section className="empty-state" role="alert" aria-labelledby="error-title">
          <h2 id="error-title">정책 목록을 불러오지 못했습니다</h2>
          <p>잠시 후 다시 시도해 주세요.</p>
          <button className="retry-button" type="button" onClick={() => setAttempt((value) => value + 1)}>
            다시 시도
          </button>
        </section>
      )}
      {age !== null && state.status === 'success' && (
        <section aria-label="정책 목록">
          <p className="list-summary" role="status">
            총 {state.response.pagination.total.toLocaleString('ko-KR')}건 · {sortLabels[state.response.appliedSort]}
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
