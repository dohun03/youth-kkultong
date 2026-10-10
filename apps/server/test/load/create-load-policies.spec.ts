import { PolicyImportArraySchema } from '@kkultong/contracts';
import { createLoadPolicies, LOAD_POLICY_COUNT } from './create-load-policies';

describe('부하 측정 정책 fixture', () => {
  it('서로 다른 외부 식별자를 가진 유효한 공개 정책 1,000건을 만든다', () => {
    const policies = createLoadPolicies(new Date('2026-10-10T00:00:00.000Z'));

    expect(policies).toHaveLength(LOAD_POLICY_COUNT);
    expect(new Set(policies.map((policy) => policy.externalId)).size).toBe(LOAD_POLICY_COUNT);
    expect(PolicyImportArraySchema.safeParse(policies).success).toBe(true);
  });
});
