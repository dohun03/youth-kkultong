import type { PolicyCard, PolicyListResponse, PolicySearchResponse } from '@kkultong/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPolicies, fetchSearchOptions, searchPolicies } from '../../lib/api/policies';
import { SearchPanel } from './SearchPanel';

vi.mock('../../lib/api/policies', () => ({
  fetchPolicies: vi.fn(),
  fetchSearchOptions: vi.fn(),
  searchPolicies: vi.fn(),
}));

const policy: PolicyCard = {
  id: 'policy-1',
  title: '청년월세 지원사업',
  agency: '국토교통부',
  category: 'HOUSING',
  benefitSummary: '청년의 월세 부담을 지원하는 사업',
  benefitAmount: { kind: 'MONTHLY', amountWon: 200000, months: 24, text: '월 최대 20만원' },
  applyStart: '2026-01-01',
  applyEnd: '2026-12-31',
  isAlwaysOpen: false,
  regionCondition: { kind: 'RULE', value: ['KR'] },
  ageCondition: { kind: 'RULE', value: { min: 19, max: 34, basis: { kind: 'TODAY' } } },
  requiresManualCheck: false,
};

const listResponse: PolicyListResponse = {
  items: [policy],
  page: 1,
  size: 20,
  total: 1,
  totalPages: 1,
};

const searchResponse: PolicySearchResponse = {
  ...listResponse,
  items: [
    {
      policy,
      matchSummary: 'MATCHED',
      fieldEvaluations: {
        age: 'MATCH',
        region: 'MATCH',
        status: 'MATCH',
        income: 'NOT_PROVIDED',
        householdSize: 'NOT_PROVIDED',
      },
      requiresManualCheck: false,
    },
  ],
  appliedCriteria: { age: true, region: true, status: true, householdSize: false, income: false },
};

const mockedFetchPolicies = vi.mocked(fetchPolicies);
const mockedFetchSearchOptions = vi.mocked(fetchSearchOptions);
const mockedSearchPolicies = vi.mocked(searchPolicies);

describe('SearchPanel', () => {
  beforeEach(() => {
    mockedFetchPolicies.mockReset();
    mockedFetchSearchOptions.mockReset();
    mockedSearchPolicies.mockReset();
    mockedFetchPolicies.mockResolvedValue(listResponse);
    mockedFetchSearchOptions.mockResolvedValue({
      categories: ['HOUSING', 'JOB'],
      regions: [{ code: '11', name: '서울특별시' }],
      statuses: ['JOB_SEEKER', 'STUDENT'],
    });
  });

  it('카테고리·시도·나이·현재 상태 기본 입력을 보여 준다', async () => {
    render(<SearchPanel />);

    expect(await screen.findByLabelText('카테고리')).toBeInTheDocument();
    expect(screen.getByLabelText('시·도')).toBeInTheDocument();
    expect(screen.getByLabelText('나이')).toBeInTheDocument();
    expect(screen.getByLabelText('취업 준비 중')).toBeInTheDocument();
  });

  it('목록을 불러오는 동안 검색과 초기화 버튼을 비활성화한다', async () => {
    mockedFetchPolicies.mockImplementation(() => new Promise<PolicyListResponse>(() => undefined));
    render(<SearchPanel />);

    await screen.findByLabelText('카테고리');

    expect(screen.getByRole('button', { name: '검색 중...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '조건 초기화' })).toBeDisabled();
  });

  it('입력한 기본 조건을 body로 검색 요청한다', async () => {
    mockedSearchPolicies.mockResolvedValue(searchResponse);
    render(<SearchPanel />);

    const category = await screen.findByLabelText('카테고리');
    fireEvent.change(category, { target: { value: 'HOUSING' } });
    fireEvent.change(screen.getByLabelText('시·도'), { target: { value: '11' } });
    fireEvent.change(screen.getByLabelText('나이'), { target: { value: '27' } });
    fireEvent.click(screen.getByLabelText('취업 준비 중'));
    fireEvent.click(screen.getByRole('button', { name: '결과 보기' }));

    await waitFor(() => {
      expect(mockedSearchPolicies).toHaveBeenCalledWith(
        { category: ['HOUSING'], regionCode: '11', age: 27, statuses: ['JOB_SEEKER'], page: 1 },
        expect.any(AbortSignal),
      );
    });
  });

  it('추가 조건을 펼치고 가구원 수와 월 가구소득을 body로 검색 요청한다', async () => {
    mockedSearchPolicies.mockResolvedValue(searchResponse);
    render(<SearchPanel />);

    await screen.findByLabelText('카테고리');
    const advancedButton = screen.getByRole('button', { name: '추가 조건 열기' });
    expect(advancedButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(advancedButton);

    expect(screen.getByText('일부 정책은 소득 기준을 자동으로 판단하기 어려울 수 있습니다.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('가구원 수'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('월 가구소득'), { target: { value: '3000000' } });
    fireEvent.click(screen.getByRole('button', { name: '결과 보기' }));

    await waitFor(() => {
      expect(mockedSearchPolicies).toHaveBeenCalledWith(
        { householdSize: 2, householdMonthlyIncome: 3000000, page: 1 },
        expect.any(AbortSignal),
      );
    });
  });

  it('조건 초기화 시 기본 목록 GET을 다시 요청한다', async () => {
    mockedSearchPolicies.mockResolvedValue(searchResponse);
    render(<SearchPanel />);

    await screen.findByLabelText('카테고리');
    fireEvent.click(screen.getByRole('button', { name: '결과 보기' }));
    await screen.findByText('조건에 맞지 않는 정책을 제외한 결과 1개');
    fireEvent.click(screen.getByRole('button', { name: '조건 초기화' }));

    await waitFor(() => expect(mockedFetchPolicies).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('카테고리')).toHaveValue('');
  });

  it('검색 결과의 전체 건수를 확정 표현 없이 보여 준다', async () => {
    mockedSearchPolicies.mockResolvedValue({ ...searchResponse, total: 18 });
    render(<SearchPanel />);

    await screen.findByLabelText('카테고리');
    fireEvent.click(screen.getByRole('button', { name: '결과 보기' }));

    expect(await screen.findByText('조건에 맞지 않는 정책을 제외한 결과 18개')).toBeInTheDocument();
    expect(screen.queryByText(/추천 18개/)).not.toBeInTheDocument();
  });

  it('검색 결과가 없으면 조건을 일부 해제하도록 안내한다', async () => {
    mockedSearchPolicies.mockResolvedValue({ ...searchResponse, items: [], total: 0, totalPages: 0 });
    render(<SearchPanel />);

    await screen.findByLabelText('카테고리');
    fireEvent.click(screen.getByRole('button', { name: '결과 보기' }));

    expect(await screen.findByText('입력한 조건과 명확히 맞지 않는 정책을 제외한 결과가 없습니다.')).toBeInTheDocument();
    expect(screen.getByText('조건을 일부 해제하거나 전체 정책을 확인해 보세요.')).toBeInTheDocument();
  });
});
