import type { ReviewActionRequest } from '@youth-kkultong/shared';
import { getPolicyReviewConflict } from '../src/modules/policies/policy-review-eligibility';
import type { PolicyReviewEligibilityContext } from '../src/modules/policies/policy-review-eligibility';

/** 공개 A를 기준으로 최신 원본 B를 검수하는 대기 후보 준비 */
function context(isNew = false): PolicyReviewEligibilityContext {
  return {
    review: { status: 'PENDING', kind: isNew ? 'NEW' : 'CHANGED', contentHash: 'b'.repeat(64),
      basePolicyId: isNew ? null : 'public-id', baseContentHash: isNew ? null : 'a'.repeat(64) },
    sourcePolicy: { contentHash: 'b'.repeat(64) },
    publicPolicy: isNew ? null : { id: 'public-id', contentHash: 'a'.repeat(64) },
  };
}

/** 화면이 후보 상세에서 확인한 두 해시를 처리 요청으로 준비 */
function requestFor(input: PolicyReviewEligibilityContext): ReviewActionRequest {
  return { contentHash: input.review.contentHash, baseContentHash: input.review.baseContentHash };
}

/** 상세의 처리 가능 여부와 승인 및 거절에서 공통으로 사용할 충돌 판정 검증 */
describe('검수 가능 여부와 충돌 판단', () => {
  it.each([false, true])('신규 여부 %s에서 일치하는 후보는 조회와 처리 모두 가능하다', (isNew) => {
    const input = context(isNew);
    expect(getPolicyReviewConflict(input)).toBeNull();
    expect(getPolicyReviewConflict(input, requestFor(input))).toBeNull();
  });

  it.each(['APPROVED', 'REJECTED', 'SUPERSEDED'] as const)('종료 상태 %s는 재처리를 막는다', (status) => {
    const input = context();
    input.review.status = status;
    expect(getPolicyReviewConflict(input)).toBe('REVIEW_NOT_PENDING');
    expect(getPolicyReviewConflict(input, requestFor(input))).toBe('REVIEW_NOT_PENDING');
  });

  it('화면의 변경본 해시가 후보와 다르면 내용 충돌이다 (T2-26)', () => {
    const input = context();
    expect(getPolicyReviewConflict(input, { ...requestFor(input), contentHash: 'c'.repeat(64) }))
      .toBe('REVIEW_CONTENT_CONFLICT');
  });

  it.each([false, true])('신규 여부 %s에서 후보와 최신 원본이 다르면 조회와 처리 모두 막는다 (T2-26)', (isNew) => {
    const input = context(isNew);
    input.sourcePolicy.contentHash = 'c'.repeat(64);
    expect(getPolicyReviewConflict(input)).toBe('REVIEW_CONTENT_CONFLICT');
    expect(getPolicyReviewConflict(input, requestFor(input))).toBe('REVIEW_CONTENT_CONFLICT');
    // 화면 해시를 최신 원본에 맞추더라도 후보 자체가 오래됐으면 충돌
    expect(getPolicyReviewConflict(input, { ...requestFor(input), contentHash: input.sourcePolicy.contentHash }))
      .toBe('REVIEW_CONTENT_CONFLICT');
  });

  it.each([null, 'c'.repeat(64)])('변경 후보의 화면 기준 해시 %s가 저장된 기준과 다르면 충돌이다', (baseContentHash) => {
    const input = context();
    expect(getPolicyReviewConflict(input, { ...requestFor(input), baseContentHash }))
      .toBe('REVIEW_BASE_CONFLICT');
  });

  it('신규 후보의 화면 기준 해시도 NULL이어야 한다', () => {
    const input = context(true);
    expect(getPolicyReviewConflict(input, { ...requestFor(input), baseContentHash: 'a'.repeat(64) }))
      .toBe('REVIEW_BASE_CONFLICT');
  });

  it.each(['UUID', '해시', '둘 다', '삭제'])('현재 공개본의 %s가 바뀌면 조회와 처리 모두 기준 충돌이다 (T2-27)', (change) => {
    const input = context();
    if (change === '삭제') input.publicPolicy = null;
    else {
      if (change !== '해시') input.publicPolicy!.id = 'different-id';
      if (change !== 'UUID') input.publicPolicy!.contentHash = 'c'.repeat(64);
    }
    expect(getPolicyReviewConflict(input)).toBe('REVIEW_BASE_CONFLICT');
    expect(getPolicyReviewConflict(input, requestFor(input))).toBe('REVIEW_BASE_CONFLICT');
  });

  it('신규 후보 이후 공개본이 생기면 해시가 같아도 충돌이다 (T2-27)', () => {
    const input = context(true);
    input.publicPolicy = { id: 'new-public-id', contentHash: input.review.contentHash };
    expect(getPolicyReviewConflict(input)).toBe('REVIEW_BASE_CONFLICT');
    expect(getPolicyReviewConflict(input, requestFor(input))).toBe('REVIEW_BASE_CONFLICT');
  });

  it.each(['basePolicyId', 'baseContentHash'] as const)('신규 후보에 %s가 저장돼 있으면 기준 충돌이다', (field) => {
    const input = context(true);
    input.review[field] = field === 'basePolicyId' ? 'public-id' : 'a'.repeat(64);
    expect(getPolicyReviewConflict(input)).toBe('REVIEW_BASE_CONFLICT');
  });

  it.each(['basePolicyId', 'baseContentHash'] as const)('변경 후보의 %s가 비어 있으면 기준 충돌이다', (field) => {
    const input = context();
    input.review[field] = null;
    expect(getPolicyReviewConflict(input)).toBe('REVIEW_BASE_CONFLICT');
  });

  it.each([false, true])('신규 여부 %s에서 누락과 수집 시각 없음 및 조회수 변경만으로 검수를 막지 않는다 (T2-32)', (isNew) => {
    const input = context(isNew);
    const sourcePolicy = { ...input.sourcePolicy, missingCount: 10, lastCollectedAt: null, viewCount: 999 };
    const missingInput = { ...input, sourcePolicy };
    expect(getPolicyReviewConflict(missingInput)).toBeNull();
    expect(getPolicyReviewConflict(missingInput, requestFor(input))).toBeNull();
    sourcePolicy.contentHash = 'c'.repeat(64);
    expect(getPolicyReviewConflict(missingInput)).toBe('REVIEW_CONTENT_CONFLICT');
  });

  it('여러 조건이 어긋나면 종료 상태와 내용 및 기준 순서로 충돌을 판정한다', () => {
    const input = context();
    input.review.status = 'APPROVED';
    input.sourcePolicy.contentHash = 'c'.repeat(64);
    input.publicPolicy = null;
    expect(getPolicyReviewConflict(input, requestFor(input))).toBe('REVIEW_NOT_PENDING');
    input.review.status = 'PENDING';
    expect(getPolicyReviewConflict(input, requestFor(input))).toBe('REVIEW_CONTENT_CONFLICT');
    input.sourcePolicy.contentHash = input.review.contentHash;
    expect(getPolicyReviewConflict(input, requestFor(input))).toBe('REVIEW_BASE_CONFLICT');
  });

  it('정상과 충돌 판정 모두 전달받은 데이터와 요청을 변경하지 않는다', () => {
    const input = context();
    const request = requestFor(input);
    const original = structuredClone({ input, request });
    Object.freeze(input.review);
    Object.freeze(input.sourcePolicy);
    Object.freeze(input.publicPolicy);
    Object.freeze(input);
    Object.freeze(request);
    expect(getPolicyReviewConflict(input, request)).toBeNull();
    expect(getPolicyReviewConflict(input, { ...request, contentHash: 'c'.repeat(64) }))
      .toBe('REVIEW_CONTENT_CONFLICT');
    expect({ input, request }).toEqual(original);
  });
});
