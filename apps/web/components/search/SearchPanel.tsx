'use client';

import type {
  PolicyCard as PolicyCardData,
  PolicyCategory,
  PolicyListResponse,
  PolicySearchCard,
  PolicySearchResponse,
  SearchCriteria,
  UserStatus,
} from '@kkultong/contracts';
import { FormEvent, useEffect, useState } from 'react';
import { fetchPolicies, fetchSearchOptions, searchPolicies, type SearchOptions } from '../../lib/api/policies';
import { PolicyCard } from '../policy/PolicyCard';

const categoryLabels: Record<PolicyCategory, string> = {
  HOUSING: '주거',
  FINANCE: '금융',
  JOB: '일자리',
  EDUCATION: '교육',
  WELFARE: '복지',
  ETC: '기타',
};

const statusLabels: Record<UserStatus, string> = {
  JOB_SEEKER: '취업 준비 중',
  STUDENT: '학생',
  EMPLOYEE: '재직 중',
  UNEMPLOYED: '미취업',
};

/** 기본 조건을 입력받아 정책 검색과 전체 목록 조회를 전환한다. */
export function SearchPanel(): React.ReactElement {
  const [options, setOptions] = useState<SearchOptions | null>(null);
  const [category, setCategory] = useState<PolicyCategory | ''>('');
  const [regionCode, setRegionCode] = useState('');
  const [age, setAge] = useState('');
  const [statuses, setStatuses] = useState<UserStatus[]>([]);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [householdSize, setHouseholdSize] = useState('');
  const [householdMonthlyIncome, setHouseholdMonthlyIncome] = useState('');
  const [submittedCriteria, setSubmittedCriteria] = useState<SearchCriteria | null>(null);
  const [page, setPage] = useState(1);
  const [refreshId, setRefreshId] = useState(0);
  const [result, setResult] = useState<PolicyListResponse | PolicySearchResponse | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    void fetchSearchOptions(controller.signal)
      .then(setOptions)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setHasError(true);
        }
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setHasError(false);

    const request = submittedCriteria === null
      ? fetchPolicies(page, controller.signal)
      : searchPolicies({ ...submittedCriteria, page }, controller.signal);

    void request
      .then(setResult)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setHasError(true);
        }
      });

    return () => controller.abort();
  }, [page, refreshId, submittedCriteria]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const criteria: SearchCriteria = {};
    if (category !== '') {
      criteria.category = [category];
    }
    if (regionCode !== '') {
      criteria.regionCode = regionCode;
    }
    if (age !== '') {
      criteria.age = Number(age);
    }
    if (statuses.length > 0) {
      criteria.statuses = statuses;
    }
    if (householdSize !== '') {
      criteria.householdSize = Number(householdSize);
    }
    if (householdMonthlyIncome !== '') {
      criteria.householdMonthlyIncome = Number(householdMonthlyIncome);
    }

    setPage(1);
    setSubmittedCriteria(criteria);
  }

  function handleReset(): void {
    setCategory('');
    setRegionCode('');
    setAge('');
    setStatuses([]);
    setIsAdvancedOpen(false);
    setHouseholdSize('');
    setHouseholdMonthlyIncome('');
    setPage(1);
    setSubmittedCriteria(null);
    setRefreshId((current) => current + 1);
  }

  function toggleStatus(status: UserStatus): void {
    setStatuses((current) =>
      current.includes(status) ? current.filter((value) => value !== status) : [...current, status],
    );
  }

  const isSearchResult = submittedCriteria !== null;
  const resultCards = result === null ? [] : toResultCards(result);

  return (
    <>
      <section aria-labelledby="search-title" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6">
          <h2 id="search-title" className="text-2xl font-bold text-slate-950">조건 검색</h2>
          <p className="mt-2 text-slate-600">입력한 조건과 명확히 맞지 않는 정책을 제외해 보여 드립니다.</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="grid gap-5 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-semibold text-slate-800">
              카테고리
              <select
                className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal"
                disabled={options === null}
                onChange={(event) => setCategory(event.target.value as PolicyCategory | '')}
                value={category}
              >
                <option value="">전체</option>
                {options?.categories.map((value) => <option key={value} value={value}>{categoryLabels[value]}</option>)}
              </select>
            </label>

            <label className="grid gap-2 text-sm font-semibold text-slate-800">
              시·도
              <select
                className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal"
                disabled={options === null}
                onChange={(event) => setRegionCode(event.target.value)}
                value={regionCode}
              >
                <option value="">전체</option>
                {options?.regions.map((region) => <option key={region.code} value={region.code}>{region.name}</option>)}
              </select>
            </label>

            <label className="grid gap-2 text-sm font-semibold text-slate-800">
              나이
              <input
                className="rounded-lg border border-slate-300 px-3 py-2.5 font-normal"
                max="120"
                min="0"
                onChange={(event) => setAge(event.target.value)}
                placeholder="예: 27"
                type="number"
                value={age}
              />
            </label>

            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-slate-800">현재 상태</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {options?.statuses.map((status) => (
                  <label className="flex items-center gap-2 text-sm text-slate-700" key={status}>
                    <input
                      checked={statuses.includes(status)}
                      onChange={() => toggleStatus(status)}
                      type="checkbox"
                    />
                    {statusLabels[status]}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="mt-6 border-t border-slate-100 pt-6">
            <button
              aria-controls="advanced-conditions"
              aria-expanded={isAdvancedOpen}
              className="text-sm font-semibold text-emerald-800 underline"
              onClick={() => setIsAdvancedOpen((current) => !current)}
              type="button"
            >
              {isAdvancedOpen ? '추가 조건 닫기' : '추가 조건 열기'}
            </button>

            {isAdvancedOpen ? (
              <div id="advanced-conditions" className="mt-4 rounded-xl bg-slate-50 p-4">
                <p className="text-sm leading-6 text-slate-600">일부 정책은 소득 기준을 자동으로 판단하기 어려울 수 있습니다.</p>
                <div className="mt-4 grid gap-5 md:grid-cols-2">
                  <label className="grid gap-2 text-sm font-semibold text-slate-800">
                    가구원 수
                    <input
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal"
                      min="1"
                      onChange={(event) => setHouseholdSize(event.target.value)}
                      placeholder="예: 1"
                      type="number"
                      value={householdSize}
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-semibold text-slate-800">
                    월 가구소득
                    <input
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal"
                      min="0"
                      onChange={(event) => setHouseholdMonthlyIncome(event.target.value)}
                      placeholder="예: 3000000"
                      type="number"
                      value={householdMonthlyIncome}
                    />
                  </label>
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-7 flex flex-wrap gap-3">
            <button className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white" type="submit">
              결과 보기
            </button>
            <button className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800" onClick={handleReset} type="button">
              조건 초기화
            </button>
          </div>
        </form>
      </section>

      <section aria-labelledby="policy-results-title" className="mt-10">
        {hasError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
            <h2 id="policy-results-title" className="text-2xl font-bold text-slate-950">정책 결과</h2>
            <p className="mt-3 text-slate-700">정책을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
            <button className="mt-5 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white" onClick={() => setRefreshId((current) => current + 1)} type="button">
              다시 시도
            </button>
          </div>
        ) : result === null ? (
          <div aria-busy="true">
            <h2 id="policy-results-title" className="text-2xl font-bold text-slate-950">정책 결과</h2>
            <p className="mt-3 text-slate-600">정책을 불러오는 중입니다.</p>
          </div>
        ) : resultCards.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 id="policy-results-title" className="text-2xl font-bold text-slate-950">정책 결과</h2>
            <p className="mt-3 text-slate-600">
              {isSearchResult
                ? '입력한 조건과 명확히 맞지 않는 정책을 제외한 결과가 없습니다.'
                : '현재 보여 드릴 수 있는 정책이 없습니다.'}
            </p>
            {isSearchResult ? <p className="mt-2 text-slate-600">조건을 일부 해제하거나 전체 정책을 확인해 보세요.</p> : null}
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="policy-results-title" className="text-2xl font-bold text-slate-950">정책 결과</h2>
                <p className="mt-2 text-slate-600">
                  {isSearchResult
                    ? `조건에 맞지 않는 정책을 제외한 결과 ${result.total}개`
                    : `현재 신청 가능한 정책 ${result.total}개를 확인해 보세요.`}
                </p>
              </div>
              <p className="text-sm text-slate-500">{result.page} / {result.totalPages} 페이지</p>
            </div>

            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {resultCards.map(({ policy, searchResult }) => (
                <PolicyCard key={policy.id} policy={policy} searchResult={searchResult} />
              ))}
            </div>

            {result.totalPages > 1 ? (
              <nav aria-label="정책 결과 페이지" className="mt-8 flex items-center justify-center gap-3">
                <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-40" disabled={result.page === 1} onClick={() => setPage((current) => current - 1)} type="button">이전</button>
                <span className="text-sm text-slate-600">{result.page}페이지</span>
                <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-40" disabled={result.page === result.totalPages} onClick={() => setPage((current) => current + 1)} type="button">다음</button>
              </nav>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}

interface ResultCard {
  policy: PolicyCardData;
  searchResult?: Pick<PolicySearchCard, 'matchSummary' | 'requiresManualCheck'>;
}

function toResultCards(result: PolicyListResponse | PolicySearchResponse): ResultCard[] {
  if ('appliedCriteria' in result) {
    return result.items.map(({ policy, matchSummary, requiresManualCheck }) => ({
      policy,
      searchResult: { matchSummary, requiresManualCheck },
    }));
  }

  return result.items.map((policy) => ({ policy }));
}
