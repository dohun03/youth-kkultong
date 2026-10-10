import type { PolicyImportInput } from '@kkultong/contracts';

export const LOAD_POLICY_COUNT = 1_000;

/** 1,000건 환경에서도 실제 검색 경로를 측정할 수 있도록 공개 정책 fixture를 만든다. */
export function createLoadPolicies(now: Date): PolicyImportInput[] {
  const date = now.toISOString().slice(0, 10);
  const nextYear = new Date(now);
  nextYear.setUTCFullYear(nextYear.getUTCFullYear() + 1);

  return Array.from({ length: LOAD_POLICY_COUNT }, (_, index) => {
    const number = index + 1;
    const isAgeMismatch = number % 3 === 0;
    const needsManualCheck = number % 10 === 0;

    return {
      externalId: `load-policy-${String(number).padStart(4, '0')}`,
      title: `부하 측정 정책 ${number}`,
      agency: '청년정책과',
      category: number % 2 === 0 ? 'HOUSING' : 'JOB',
      benefitSummary: '부하 측정용 공개 정책입니다.',
      benefitAmount: { kind: 'FIXED', amountWon: 100_000, text: '10만 원 지원' },
      conditions: {
        age: {
          kind: 'RULE',
          value: { min: isAgeMismatch ? 35 : 19, max: isAgeMismatch ? 39 : 34, basis: { kind: 'TODAY' } },
        },
        region: { kind: 'RULE', value: ['11'] },
        income: { kind: 'ANY' },
        status: { kind: 'RULE', value: ['JOB_SEEKER'] },
        householdSize: { kind: 'ANY' },
      },
      hasUnresolvedEligibilityCondition: needsManualCheck,
      unresolvedConditionNote: needsManualCheck ? '고용 형태는 공식 공고에서 확인해야 합니다.' : null,
      requiredDocs: [],
      applyStart: date,
      applyEnd: nextYear.toISOString().slice(0, 10),
      isAlwaysOpen: false,
      officialUrl: `https://example.go.kr/load/${number}`,
      lastVerifiedAt: now.toISOString(),
      isPublished: true,
    };
  });
}
