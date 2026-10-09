import type { PolicyCard as PolicyCardData } from '@kkultong/contracts';

const categoryLabels = {
  HOUSING: '주거',
  FINANCE: '금융',
  JOB: '일자리',
  EDUCATION: '교육',
  WELFARE: '복지',
  ETC: '기타',
} as const;

interface PolicyCardProps {
  policy: PolicyCardData;
}

/** 일반 목록에서 정책의 핵심 지원 내용과 기본 자격 기준을 보여 준다. */
export function PolicyCard({ policy }: PolicyCardProps): React.ReactElement {
  return (
    <article className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800">
          {categoryLabels[policy.category]}
        </span>
        <span className="text-sm text-slate-500">{formatApplyPeriod(policy)}</span>
      </div>

      <h2 className="mt-5 text-xl font-bold text-slate-950">{policy.title}</h2>
      <p className="mt-3 leading-7 text-slate-700">{policy.benefitSummary}</p>

      <dl className="mt-6 grid gap-3 border-t border-slate-100 pt-5 text-sm">
        <InfoRow label="지역" value={formatRegion(policy)} />
        <InfoRow label="나이" value={formatAge(policy)} />
        <InfoRow label="기관" value={policy.agency} />
      </dl>

      <a
        className="mt-7 inline-flex w-fit items-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 focus:outline-2 focus:outline-offset-2 focus:outline-slate-900"
        href={`/policies/${policy.id}`}
      >
        상세 보기
      </a>
    </article>
  );
}

function InfoRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="grid grid-cols-[3rem_1fr] gap-3">
      <dt className="font-medium text-slate-500">{label}</dt>
      <dd className="m-0 text-slate-800">{value}</dd>
    </div>
  );
}

function formatApplyPeriod(policy: PolicyCardData): string {
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

function formatRegion(policy: PolicyCardData): string {
  if (policy.regionCondition.kind === 'ANY') {
    return '전국';
  }

  if (policy.regionCondition.kind === 'UNKNOWN') {
    return '지역 기준 확인 필요';
  }

  if (policy.regionCondition.value.includes('KR')) {
    return '전국';
  }

  return `지역 코드 ${policy.regionCondition.value.join(', ')}`;
}

function formatAge(policy: PolicyCardData): string {
  if (policy.ageCondition.kind === 'ANY') {
    return '제한 없음';
  }

  if (policy.ageCondition.kind === 'UNKNOWN') {
    return '나이 기준 확인 필요';
  }

  const { min, max, basis } = policy.ageCondition.value;
  const range = formatRange(min, max, basis.kind === 'BIRTH_YEAR' ? '년생' : '세');
  return basis.kind === 'BIRTH_YEAR' ? range : `만 ${range}`;
}

function formatRange(min: number | null, max: number | null, unit: string): string {
  if (min !== null && max !== null) {
    return `${min}~${max}${unit}`;
  }

  if (min !== null) {
    return `${min}${unit} 이상`;
  }

  if (max !== null) {
    return `${max}${unit} 이하`;
  }

  return '제한 없음';
}
