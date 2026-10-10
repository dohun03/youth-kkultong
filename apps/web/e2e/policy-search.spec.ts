import { expect, test, type Page } from '@playwright/test';

const policyId = '00000000-0000-4000-8000-000000000001';

const basePolicy = {
  id: policyId,
  title: '서울 청년 주거 지원',
  agency: '서울청년정책과',
  category: 'HOUSING',
  benefitSummary: '월 20만 원을 지원합니다.',
  benefitAmount: { kind: 'MONTHLY', amountWon: 200000, months: 12, text: '월 20만 원' },
  applyStart: '2026-10-01',
  applyEnd: '2026-12-31',
  isAlwaysOpen: false,
  regionCondition: { kind: 'RULE', value: ['11'] },
  ageCondition: { kind: 'RULE', value: { min: 19, max: 34, basis: { kind: 'TODAY' } } },
  requiresManualCheck: true,
};

test.beforeEach(async ({ page }) => {
  await mockPolicyApi(page);
});

test('나이·지역·상태 검색 결과에서 추가 확인 정책을 상세와 공식 공고까지 확인한다', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('현재 신청 가능한 정책 2개를 확인해 보세요.')).toBeVisible();
  await page.getByLabel('시·도').selectOption('11');
  await page.getByLabel('나이').fill('27');
  await page.getByLabel('취업 준비 중').check();
  await page.getByRole('button', { name: '결과 보기' }).click();

  await expect(page.getByText('조건에 맞지 않는 정책을 제외한 결과 1개')).toBeVisible();
  await expect(page.getByText('추가 조건 확인 필요')).toBeVisible();
  await page.getByRole('link', { name: '상세 보기' }).click();

  await expect(page.getByRole('heading', { name: basePolicy.title })).toBeVisible();
  await expect(page.getByText('고용 형태는 공식 공고에서 확인해야 합니다.')).toBeVisible();
  const officialLink = page.getByRole('link', { name: '공식 공고 보기 (새 창)' });
  await expect(officialLink).toHaveAttribute('href', 'https://example.go.kr/policies/housing');
  await expect(officialLink).toHaveAttribute('target', '_blank');
  await expect(officialLink).toHaveAttribute('rel', 'noreferrer');
});

/** 브라우저 흐름은 안정된 fixture로 검증하고, 실제 HTTP·PostgreSQL 계약은 서버 통합 테스트가 맡는다. */
async function mockPolicyApi(page: Page): Promise<void> {
  // API Origin 설정과 무관하게 브라우저 흐름만 고정 fixture로 검증한다.
  await page.route('**/api/v1/meta/regions', (route) => route.fulfill({ json: [{ code: '11', name: '서울특별시' }] }));
  await page.route('**/api/v1/meta/categories', (route) => route.fulfill({ json: ['HOUSING'] }));
  await page.route('**/api/v1/meta/statuses', (route) => route.fulfill({ json: ['JOB_SEEKER'] }));
  await page.route('**/api/v1/policies?*', (route) => route.fulfill({
    json: { items: [basePolicy, { ...basePolicy, id: '00000000-0000-4000-8000-000000000002', title: '전체 정책' }], page: 1, size: 20, total: 2, totalPages: 1 },
  }));
  await page.route('**/api/v1/policies/search', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ age: 27, regionCode: '11', statuses: ['JOB_SEEKER'], page: 1 });
    await route.fulfill({
      json: {
        items: [{ policy: basePolicy, matchSummary: 'NEEDS_CHECK', requiresManualCheck: true }],
        page: 1,
        size: 20,
        total: 1,
        totalPages: 1,
        appliedCriteria: { age: true, region: true, status: true, householdSize: false, income: false },
      },
    });
  });
  await page.route(`**/api/v1/policies/${policyId}`, (route) => route.fulfill({
    json: {
      ...basePolicy,
      statusCondition: { kind: 'RULE', value: ['JOB_SEEKER'] },
      incomeCondition: { kind: 'ANY' },
      householdSizeCondition: { kind: 'ANY' },
      manualCheckNote: '고용 형태는 공식 공고에서 확인해야 합니다.',
      requiredDocs: [],
      officialUrl: 'https://example.go.kr/policies/housing',
      lastVerifiedAt: '2026-10-10T00:00:00.000Z',
    },
  }));
}
