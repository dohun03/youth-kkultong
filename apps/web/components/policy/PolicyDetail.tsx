'use client';

import type { PolicyConditions, PolicyDetail as PolicyDetailData, UserStatus } from '@kkultong/contracts';
import { useEffect, useState } from 'react';
import { fetchPolicy } from '../../lib/api/policies';

const statusLabels: Record<UserStatus, string> = {
  JOB_SEEKER: '구직자',
  STUDENT: '학생',
  EMPLOYEE: '재직자',
  UNEMPLOYED: '미취업자',
};

interface PolicyDetailProps {
  policyId: string;
}

/** 정책 상세의 로딩·오류·404 상태와 공개 정책 정보를 함께 표시한다. */
export function PolicyDetail({ policyId }: PolicyDetailProps): React.ReactElement {
  const [policy, setPolicy] = useState<PolicyDetailData | null | undefined>(undefined);
  const [retryCount, setRetryCount] = useState(0);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setPolicy(undefined);
    setHasError(false);

    void fetchPolicy(policyId, controller.signal)
      .then((response) => setPolicy(response))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        setHasError(true);
      });

    return () => controller.abort();
  }, [policyId, retryCount]);

  if (hasError) {
    return (
      <section aria-labelledby="policy-detail-title" className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
        <h1 id="policy-detail-title" className="text-2xl font-bold text-slate-950">
          정책 상세
        </h1>
        <p className="mt-3 text-slate-700">정책 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
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

  if (policy === undefined) {
    return (
      <section aria-busy="true" aria-labelledby="policy-detail-title">
        <h1 id="policy-detail-title" className="text-2xl font-bold text-slate-950">
          정책 상세
        </h1>
        <p className="mt-3 text-slate-600">정책 정보를 불러오는 중입니다.</p>
      </section>
    );
  }

  if (policy === null) {
    return (
      <section aria-labelledby="policy-detail-title" className="rounded-2xl border border-slate-200 bg-white p-6">
        <h1 id="policy-detail-title" className="text-2xl font-bold text-slate-950">
          정책을 찾을 수 없습니다
        </h1>
        <p className="mt-3 text-slate-600">정책이 종료되었거나 현재 공개되지 않았을 수 있습니다.</p>
        <a className="mt-5 inline-flex text-sm font-semibold text-emerald-800 underline" href="/">
          정책 목록으로 돌아가기
        </a>
      </section>
    );
  }

  return <PolicyDetailContent policy={policy} />;
}

function PolicyDetailContent({ policy }: { policy: PolicyDetailData }): React.ReactElement {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <a className="text-sm font-semibold text-emerald-800 underline" href="/">
        정책 목록으로 돌아가기
      </a>

      <header className="mt-6 border-b border-slate-100 pb-7">
        <p className="text-sm font-semibold text-emerald-700">{formatCategory(policy.category)}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">{policy.title}</h1>
        <p className="mt-3 text-slate-600">{policy.agency}</p>
      </header>

      <DetailSection title="지원 내용">
        <p className="leading-7 text-slate-800">{policy.benefitSummary}</p>
        <p className="mt-2 text-sm text-slate-600">{policy.benefitAmount.text}</p>
      </DetailSection>

      <DetailSection title="신청 기간">
        <p className="text-slate-800">{formatApplyPeriod(policy)}</p>
      </DetailSection>

      <DetailSection title="자격 조건">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <ConditionRow label="나이" value={formatAgeCondition(policy.ageCondition)} />
          <ConditionRow label="지역" value={formatRegionCondition(policy.regionCondition)} />
          <ConditionRow label="상태" value={formatStatusCondition(policy.statusCondition)} />
          <ConditionRow label="소득" value={formatIncomeCondition(policy.incomeCondition)} />
          <ConditionRow label="가구원 수" value={formatHouseholdSizeCondition(policy.householdSizeCondition)} />
        </dl>
      </DetailSection>

      <DetailSection title="추가 확인 조건">
        {policy.requiresManualCheck ? (
          <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold">추가 조건 확인 필요</p>
            {policy.manualCheckNote !== null ? <p className="mt-2 leading-6">{policy.manualCheckNote}</p> : null}
          </div>
        ) : (
          <p className="text-slate-700">추가로 확인할 조건이 없습니다.</p>
        )}
      </DetailSection>

      <DetailSection title="필요 서류">
        {policy.requiredDocs.length > 0 ? (
          <ul className="list-disc space-y-2 pl-5 text-slate-800">
            {policy.requiredDocs.map((document) => (
              <li key={document}>{document}</li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-700">별도 제출 서류는 공식 공고에서 확인해 주세요.</p>
        )}
      </DetailSection>

      <DetailSection title="마지막 확인일">
        <p className="text-slate-800">{policy.lastVerifiedAt.slice(0, 10)}</p>
      </DetailSection>

      <a
        className="mt-8 inline-flex rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 focus:outline-2 focus:outline-offset-2 focus:outline-slate-900"
        href={policy.officialUrl}
        rel="noreferrer"
        target="_blank"
      >
        공식 공고 보기
      </a>
    </article>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="border-b border-slate-100 py-7 last:border-b-0">
      <h2 className="text-xl font-bold text-slate-950">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ConditionRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <dt className="font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 text-slate-800">{value}</dd>
    </div>
  );
}

function formatCategory(category: PolicyDetailData['category']): string {
  const labels: Record<PolicyDetailData['category'], string> = {
    HOUSING: '주거',
    FINANCE: '금융',
    JOB: '일자리',
    EDUCATION: '교육',
    WELFARE: '복지',
    ETC: '기타',
  };

  return labels[category];
}

function formatApplyPeriod(policy: PolicyDetailData): string {
  if (policy.isAlwaysOpen) {
    return '상시 신청';
  }

  if (policy.applyStart !== null && policy.applyEnd !== null) {
    return `${policy.applyStart} ~ ${policy.applyEnd}`;
  }

  if (policy.applyEnd !== null) {
    return `마감 ${policy.applyEnd}`;
  }

  return '기간 확인 필요';
}

function formatAgeCondition(condition: PolicyConditions['age']): string {
  if (condition.kind === 'ANY') {
    return '제한 없음';
  }

  if (condition.kind === 'UNKNOWN') {
    return '직접 확인 필요';
  }

  const { min, max, basis } = condition.value;
  const range = formatRange(min, max, basis.kind === 'BIRTH_YEAR' ? '년생' : '세');

  return basis.kind === 'BIRTH_YEAR' ? range : `만 ${range}`;
}

function formatRegionCondition(condition: PolicyConditions['region']): string {
  if (condition.kind === 'ANY') {
    return '전국';
  }

  if (condition.kind === 'UNKNOWN') {
    return '직접 확인 필요';
  }

  if (condition.value.includes('KR')) {
    return '전국';
  }

  return `지역 코드 ${condition.value.join(', ')}`;
}

function formatStatusCondition(condition: PolicyConditions['status']): string {
  if (condition.kind === 'ANY') {
    return '제한 없음';
  }

  if (condition.kind === 'UNKNOWN') {
    return '직접 확인 필요';
  }

  return condition.value.map((status) => statusLabels[status]).join(', ');
}

function formatIncomeCondition(condition: PolicyConditions['income']): string {
  if (condition.kind === 'ANY') {
    return '제한 없음';
  }

  if (condition.kind === 'UNKNOWN') {
    return '직접 확인 필요';
  }

  return formatRange(condition.value.min, condition.value.max, '%', '기준 중위소득 ');
}

function formatHouseholdSizeCondition(condition: PolicyConditions['householdSize']): string {
  if (condition.kind === 'ANY') {
    return '제한 없음';
  }

  if (condition.kind === 'UNKNOWN') {
    return '직접 확인 필요';
  }

  return formatRange(condition.value.min, condition.value.max, '명');
}

function formatRange(min: number | null, max: number | null, unit: string, prefix = ''): string {
  if (min !== null && max !== null) {
    return `${prefix}${min}~${max}${unit}`;
  }

  if (min !== null) {
    return `${prefix}${min}${unit} 이상`;
  }

  if (max !== null) {
    return `${prefix}${max}${unit} 이하`;
  }

  return '제한 없음';
}
