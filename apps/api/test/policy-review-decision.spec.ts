import { randomUUID } from 'node:crypto';
import { createYouthCenterPolicyContentHash } from '../src/modules/ingestion/youth-center/youth-center-policy.hash';
import { decidePolicyReview } from '../src/modules/policies/policy-review-decision';
import type { PolicyReviewContext } from '../src/modules/policies/policy-review-decision';

/** 내용이 서로 다른 정책 원문의 실제 해시 생성 */
function hash(title: string, views = '10'): string {
  return createYouthCenterPolicyContentHash({ plcyNo: 'policy', plcyNm: title, inqCnt: views });
}

/** 공개 A에 변경 B가 수집된 기본 검수 상황을 준비 */
function context(): PolicyReviewContext {
  return {
    collectionResult: 'CHANGED',
    sourcePolicy: { id: randomUUID(), source: 'youthcenter', externalId: 'policy', contentHash: hash('B') },
    publicPolicy: { id: randomUUID(), source: 'youthcenter', externalId: 'policy', contentHash: hash('A') },
    pendingReview: null, rejectedHashes: [],
  };
}

/** 현재 원본과 공개 기준을 담은 기존 대기 후보를 준비 */
function pending(input: PolicyReviewContext): NonNullable<PolicyReviewContext['pendingReview']> {
  return { id: randomUUID(), sourcePolicyId: input.sourcePolicy.id, status: 'PENDING',
    contentHash: input.sourcePolicy.contentHash, basePolicyId: input.publicPolicy?.id ?? null,
    baseContentHash: input.publicPolicy?.contentHash ?? null };
}

describe('검수 후보 생성과 유지, 대체 판단', () => {
  it('공개 A와 다른 B는 CHANGED 후보를 생성한다', () => {
    expect(decidePolicyReview(context())).toEqual({ action: 'CREATE', kind: 'CHANGED', superseded: null });
  });

  it.each(['NEW', 'CHANGED', 'UNCHANGED'] as const)('수집 판정 %s여도 공개본이 없으면 NEW 검수 후보다', (collectionResult) => {
    expect(decidePolicyReview({ ...context(), collectionResult, publicPolicy: null }))
      .toEqual({ action: 'CREATE', kind: 'NEW', superseded: null });
  });

  it.each(['NEW', 'CHANGED', 'UNCHANGED'] as const)('수집 판정 %s여도 공개본이 있으면 CHANGED 검수 후보다', (collectionResult) => {
    expect(decidePolicyReview({ ...context(), collectionResult }))
      .toEqual({ action: 'CREATE', kind: 'CHANGED', superseded: null });
  });

  it('공개본과 같은 원본은 새 후보를 만들지 않는다', () => {
    const input = context();
    input.sourcePolicy.contentHash = input.publicPolicy!.contentHash;
    expect(decidePolicyReview(input)).toEqual({ action: 'SKIP', superseded: null });
  });

  it('공개 A로 복귀하면 B 대기를 MATCHES_PUBLIC로 대체하고 새 후보는 생략한다', () => {
    const input = context();
    input.pendingReview = pending(input);
    input.sourcePolicy.contentHash = input.publicPolicy!.contentHash;
    expect(decidePolicyReview(input)).toEqual({ action: 'SKIP',
      superseded: { id: input.pendingReview.id, reason: 'MATCHES_PUBLIC' } });
  });

  it('공개본 일치와 거절 이력이 모두 있으면 공개본 일치 사유를 먼저 적용한다', () => {
    const input = context();
    input.pendingReview = pending(input);
    input.sourcePolicy.contentHash = input.publicPolicy!.contentHash;
    input.rejectedHashes = [{ sourcePolicyId: input.sourcePolicy.id, contentHash: input.sourcePolicy.contentHash }];
    expect(decidePolicyReview(input)).toEqual({ action: 'SKIP',
      superseded: { id: input.pendingReview.id, reason: 'MATCHES_PUBLIC' } });
  });

  it('같은 원본에서 거절했던 B를 반복 수집하면 새 후보를 만들지 않는다', () => {
    const input = context();
    input.rejectedHashes = [{ sourcePolicyId: input.sourcePolicy.id, contentHash: hash('B') }];
    expect(decidePolicyReview(input)).toEqual({ action: 'SKIP', superseded: null });
  });

  it('다른 내용을 거쳐 거절본 B로 복귀하면 C 대기를 대체하고 새 후보는 생략한다', () => {
    const input = context();
    input.sourcePolicy.contentHash = hash('C');
    input.pendingReview = pending(input);
    input.sourcePolicy.contentHash = hash('B');
    input.rejectedHashes = [{ sourcePolicyId: input.sourcePolicy.id, contentHash: hash('B') }];
    expect(decidePolicyReview(input)).toEqual({ action: 'SKIP',
      superseded: { id: input.pendingReview.id, reason: 'PREVIOUSLY_REJECTED' } });
  });

  it('공개 기준이 바뀌어도 같은 원본의 거절 해시는 재검수를 막는다', () => {
    const input = context();
    input.pendingReview = pending(input);
    input.publicPolicy = { ...input.publicPolicy!, id: randomUUID(), contentHash: hash('C') };
    input.rejectedHashes = [{ sourcePolicyId: input.sourcePolicy.id, contentHash: hash('B') }];
    expect(decidePolicyReview(input)).toEqual({ action: 'SKIP',
      superseded: { id: input.pendingReview.id, reason: 'PREVIOUSLY_REJECTED' } });
  });

  it('거절 이력은 기존 대기가 같은 내용과 기준을 갖고 있어도 먼저 적용한다', () => {
    const input = context();
    input.pendingReview = pending(input);
    input.rejectedHashes = [{ sourcePolicyId: input.sourcePolicy.id, contentHash: hash('B') }];
    expect(decidePolicyReview(input)).toEqual({ action: 'SKIP',
      superseded: { id: input.pendingReview.id, reason: 'PREVIOUSLY_REJECTED' } });
  });

  it('미공개 정책도 과거에 거절한 동일 내용은 새 후보를 만들지 않는다', () => {
    const input = { ...context(), publicPolicy: null };
    input.rejectedHashes = [{ sourcePolicyId: input.sourcePolicy.id, contentHash: hash('B') }];
    expect(decidePolicyReview(input)).toEqual({ action: 'SKIP', superseded: null });
  });

  it('다른 원본에서 같은 해시를 거절한 이력은 현재 원본의 검수를 막지 않는다', () => {
    const input = context();
    input.rejectedHashes = [{ sourcePolicyId: randomUUID(), contentHash: hash('B') }];
    expect(decidePolicyReview(input)).toEqual({ action: 'CREATE', kind: 'CHANGED', superseded: null });
  });

  it('B 거절 후 새로운 C를 수집하면 새 검수 후보를 만든다', () => {
    const input = context();
    input.rejectedHashes = [{ sourcePolicyId: input.sourcePolicy.id, contentHash: hash('B') }];
    input.sourcePolicy.contentHash = hash('C');
    expect(decidePolicyReview(input)).toEqual({ action: 'CREATE', kind: 'CHANGED', superseded: null });
  });

  it.each([true, false])('공개본 존재 여부 %s에서 같은 내용과 기준의 대기는 유지한다', (hasPublic) => {
    const input = context();
    if (!hasPublic) input.publicPolicy = null;
    input.pendingReview = pending(input);
    expect(decidePolicyReview(input)).toEqual({ action: 'KEEP', pendingReviewId: input.pendingReview.id });
  });

  it('조회수만 바뀐 반복 수집은 기존 대기를 유지한다', () => {
    const input = context();
    input.pendingReview = pending(input);
    input.collectionResult = 'UNCHANGED';
    input.sourcePolicy.contentHash = hash('B', '999');
    expect(decidePolicyReview(input)).toEqual({ action: 'KEEP', pendingReviewId: input.pendingReview.id });
  });

  it('B 대기 중 C를 수집하면 기존 대기를 SOURCE_CHANGED로 대체한다', () => {
    const input = context();
    input.pendingReview = pending(input);
    input.sourcePolicy.contentHash = hash('C');
    expect(decidePolicyReview(input)).toEqual({ action: 'CREATE', kind: 'CHANGED',
      superseded: { id: input.pendingReview.id, reason: 'SOURCE_CHANGED' } });
  });

  it.each(['UUID', '해시', '둘 다'])('같은 원본이라도 공개 기준 %s가 바뀌면 기존 대기를 대체한다', (change) => {
    const input = context();
    input.pendingReview = pending(input);
    input.collectionResult = 'UNCHANGED';
    if (change !== '해시') input.publicPolicy!.id = randomUUID();
    if (change !== 'UUID') input.publicPolicy!.contentHash = hash('C');
    expect(decidePolicyReview(input)).toEqual({ action: 'CREATE', kind: 'CHANGED',
      superseded: { id: input.pendingReview.id, reason: 'PUBLIC_BASE_CHANGED' } });
  });

  it('원본과 공개 기준이 모두 바뀌면 SOURCE_CHANGED 사유를 우선한다', () => {
    const input = context();
    input.pendingReview = pending(input);
    input.sourcePolicy.contentHash = hash('C');
    input.publicPolicy!.contentHash = hash('D');
    expect(decidePolicyReview(input)).toEqual({ action: 'CREATE', kind: 'CHANGED',
      superseded: { id: input.pendingReview.id, reason: 'SOURCE_CHANGED' } });
  });

  it('신규 대기 이후 공개본이 생기면 현재 공개본 기준의 CHANGED 후보로 교체한다', () => {
    const input = context();
    const publicPolicy = input.publicPolicy;
    input.publicPolicy = null;
    input.pendingReview = pending(input);
    input.publicPolicy = publicPolicy;
    expect(decidePolicyReview(input)).toEqual({ action: 'CREATE', kind: 'CHANGED',
      superseded: { id: input.pendingReview.id, reason: 'PUBLIC_BASE_CHANGED' } });
  });

  it('변경 대기의 공개 기준본이 사라지면 NEW 후보로 교체한다', () => {
    const input = context();
    input.pendingReview = pending(input);
    input.publicPolicy = null;
    expect(decidePolicyReview(input)).toEqual({ action: 'CREATE', kind: 'NEW',
      superseded: { id: input.pendingReview.id, reason: 'PUBLIC_BASE_CHANGED' } });
  });

  it('과거 승인 A로 돌아와도 현재 공개 B와 다르면 새 후보를 만든다', () => {
    const input = context();
    input.publicPolicy!.contentHash = hash('B');
    input.sourcePolicy.contentHash = hash('A');
    // 거절 이력은 비어 있고 과거 승인 해시로 복귀한 상황
    expect(decidePolicyReview(input)).toEqual({ action: 'CREATE', kind: 'CHANGED', superseded: null });
  });

  it('과거 대체 B로 복귀하면 현재 C 대기를 대체하고 최신 B 후보를 만든다', () => {
    const input = context();
    input.sourcePolicy.contentHash = hash('C');
    input.pendingReview = pending(input);
    input.sourcePolicy.contentHash = hash('B');
    expect(decidePolicyReview(input)).toEqual({ action: 'CREATE', kind: 'CHANGED',
      superseded: { id: input.pendingReview.id, reason: 'SOURCE_CHANGED' } });
  });

  it.each(['공개본 일치', '거절본 일치', '원본 변경', '공개 기준 변경'])('누락 원본은 %s 상황이어도 기존 대기를 유지한다', (condition) => {
    const input = context();
    input.pendingReview = pending(input);
    input.collectionResult = 'MISSING';
    if (condition === '공개본 일치') input.sourcePolicy.contentHash = input.publicPolicy!.contentHash;
    if (condition === '거절본 일치') input.rejectedHashes = [{ sourcePolicyId: input.sourcePolicy.id, contentHash: hash('B') }];
    if (condition === '원본 변경') input.sourcePolicy.contentHash = hash('C');
    if (condition === '공개 기준 변경') input.publicPolicy!.id = randomUUID();
    expect(decidePolicyReview(input)).toEqual({ action: 'KEEP', pendingReviewId: input.pendingReview.id });
  });

  it('누락 원본에 대기가 없으면 후보를 생성하지 않는다', () => {
    expect(decidePolicyReview({ ...context(), collectionResult: 'MISSING' })).toEqual({ action: 'SKIP', superseded: null });
  });

  it.each(['source', 'externalId'] as const)('현재 공개본의 %s가 원본과 다르면 거부한다', (field) => {
    const input = context();
    input.publicPolicy![field] = 'other';
    expect(() => decidePolicyReview(input)).toThrow('출처 또는 외부 ID');
  });

  it('다른 원본의 대기는 비교 대상으로 거부한다', () => {
    const input = context();
    input.pendingReview = { ...pending(input), sourcePolicyId: randomUUID() };
    expect(() => decidePolicyReview(input)).toThrow('같은 원본의 대기');
  });

  it.each(['APPROVED', 'REJECTED', 'SUPERSEDED'] as const)('%s 이력을 현재 대기로 전달하면 거부한다', (status) => {
    const input = context();
    input.pendingReview = { ...pending(input), status };
    expect(() => decidePolicyReview(input)).toThrow('대기 후보');
  });

  it.each(['KEEP', 'SKIP', 'CREATE'] as const)('%s 판단은 원본과 공개본, 기존 대기와 거절 목록을 수정하지 않는다', (action) => {
    const input = context();
    input.pendingReview = pending(input);
    if (action === 'SKIP') input.sourcePolicy.contentHash = input.publicPolicy!.contentHash;
    if (action === 'CREATE') input.sourcePolicy.contentHash = hash('C');
    const before = structuredClone(input);
    Object.freeze(input.sourcePolicy);
    Object.freeze(input.publicPolicy);
    Object.freeze(input.pendingReview);
    Object.freeze(input.rejectedHashes);
    Object.freeze(input);
    expect(decidePolicyReview(input).action).toBe(action);
    expect(input).toEqual(before);
  });
});
