import type { PolicyCard as PolicyCardData, PolicyListResponse } from '@kkultong/contracts';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPolicies } from '../../lib/api/policies';
import { PolicyCard } from './PolicyCard';
import { PolicyList } from './PolicyList';

vi.mock('../../lib/api/policies', () => ({
  fetchPolicies: vi.fn(),
}));

const policy: PolicyCardData = {
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
  regionCondition: { kind: 'RULE', value: ['KR'] },
  ageCondition: { kind: 'RULE', value: { min: 19, max: 34, basis: { kind: 'TODAY' } } },
  requiresManualCheck: true,
};

const policyList: PolicyListResponse = {
  items: [policy],
  page: 1,
  size: 20,
  total: 1,
  totalPages: 1,
};

const mockedFetchPolicies = vi.mocked(fetchPolicies);

describe('PolicyCard', () => {
  beforeEach(() => {
    mockedFetchPolicies.mockReset();
  });

  it('정책 카드의 필수 정보를 보여 준다', () => {
    render(<PolicyCard policy={policy} />);

    expect(screen.getByRole('heading', { name: '청년월세 지원사업' })).toBeInTheDocument();
    expect(screen.getByText('청년의 월세 부담을 지원하는 사업')).toBeInTheDocument();
    expect(screen.getByText('2026-01-01 ~ 2026-12-31')).toBeInTheDocument();
    expect(screen.getByText('전국')).toBeInTheDocument();
    expect(screen.getByText('만 19~34세')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '상세 보기' })).toHaveAttribute('href', '/policies/policy-1');
  });

  it('정책 목록과 전체 개수를 보여 준다', async () => {
    mockedFetchPolicies.mockResolvedValue(policyList);

    render(<PolicyList />);

    expect(await screen.findByText('현재 신청 가능한 정책 1개를 확인해 보세요.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '청년월세 지원사업' })).toBeInTheDocument();
  });

  it('정책이 없을 때 empty 상태를 보여 준다', async () => {
    mockedFetchPolicies.mockResolvedValue({ ...policyList, items: [], total: 0, totalPages: 0 });

    render(<PolicyList />);

    expect(await screen.findByText('현재 보여 드릴 수 있는 정책이 없습니다.')).toBeInTheDocument();
  });

  it('목록 요청이 실패하면 재시도 안내를 보여 준다', async () => {
    mockedFetchPolicies.mockRejectedValue(new Error('network failure'));

    render(<PolicyList />);

    expect(await screen.findByText('정책을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
  });
});
