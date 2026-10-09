import type { PolicyDetail as PolicyDetailData } from '@kkultong/contracts';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPolicy } from '../../lib/api/policies';
import { PolicyDetail } from './PolicyDetail';

vi.mock('../../lib/api/policies', () => ({
  fetchPolicy: vi.fn(),
}));

const policy: PolicyDetailData = {
  id: 'policy-1',
  title: '청년월세 지원사업',
  agency: '국토교통부',
  category: 'HOUSING',
  benefitSummary: '청년의 월세 부담을 지원하는 사업',
  benefitAmount: {
    kind: 'MONTHLY',
    amountWon: 200000,
    months: 24,
    text: '월 최대 20만원, 최장 24개월',
  },
  applyStart: '2026-01-01',
  applyEnd: '2026-12-31',
  isAlwaysOpen: false,
  ageCondition: { kind: 'RULE', value: { min: 19, max: 34, basis: { kind: 'TODAY' } } },
  regionCondition: { kind: 'RULE', value: ['KR'] },
  statusCondition: { kind: 'ANY' },
  incomeCondition: { kind: 'UNKNOWN' },
  householdSizeCondition: { kind: 'ANY' },
  requiresManualCheck: true,
  manualCheckNote: '소득 기준은 공식 공고 원문을 확인해야 합니다.',
  requiredDocs: ['신분증', '임대차계약서'],
  officialUrl: 'https://example.go.kr/policies/1',
  lastVerifiedAt: '2026-10-07T00:00:00.000Z',
};

const mockedFetchPolicy = vi.mocked(fetchPolicy);

describe('PolicyDetail', () => {
  beforeEach(() => {
    mockedFetchPolicy.mockReset();
  });

  it('정책 상세와 공식 공고 링크를 보여 준다', async () => {
    mockedFetchPolicy.mockResolvedValue(policy);

    render(<PolicyDetail policyId={policy.id} />);

    expect(await screen.findByRole('heading', { name: '청년월세 지원사업' })).toBeInTheDocument();
    expect(screen.getByText('청년의 월세 부담을 지원하는 사업')).toBeInTheDocument();
    expect(screen.getByText('2026-01-01 ~ 2026-12-31')).toBeInTheDocument();
    expect(screen.getByText('신분증')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '공식 공고 보기' })).toHaveAttribute(
      'href',
      'https://example.go.kr/policies/1',
    );
  });

  it('UNKNOWN 조건을 직접 확인 필요로 표시한다', async () => {
    mockedFetchPolicy.mockResolvedValue(policy);

    render(<PolicyDetail policyId={policy.id} />);

    expect(await screen.findByText('직접 확인 필요')).toBeInTheDocument();
  });

  it('미해결 조건 원문을 추가 확인 조건에 표시한다', async () => {
    mockedFetchPolicy.mockResolvedValue(policy);

    render(<PolicyDetail policyId={policy.id} />);

    expect(await screen.findByText('추가 조건 확인 필요')).toBeInTheDocument();
    expect(screen.getByText('소득 기준은 공식 공고 원문을 확인해야 합니다.')).toBeInTheDocument();
  });

  it('존재하지 않는 정책은 안내 상태를 보여 준다', async () => {
    mockedFetchPolicy.mockResolvedValue(null);

    render(<PolicyDetail policyId="missing-policy" />);

    expect(await screen.findByRole('heading', { name: '정책을 찾을 수 없습니다' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '정책 목록으로 돌아가기' })).toHaveAttribute('href', '/');
  });
});
