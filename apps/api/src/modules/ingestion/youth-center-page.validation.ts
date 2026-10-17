import type { YouthCenterListResponse } from './youth-center-response.schema';

/** 페이지 불일치·건수 오류·중복 정책의 위치와 원인을 전달한다. */
export class YouthCenterPageValidationError extends Error {
  /** 검증 실패 단계 */
  readonly stage = 'PAGE_VALIDATION';

  constructor(
    readonly pageNum: number,
    readonly attempts: number,
    readonly reason: 'PAGE_NUMBER_MISMATCH' | 'PAGE_SIZE_MISMATCH' | 'PAGE_SIZE_EXCEEDED'
      | 'PAGE_COUNT_MISMATCH' | 'DUPLICATE_POLICY_ID',
    readonly field: string,
    readonly details: { expected?: number; actual?: number; policyId?: string },
  ) {
    super(`온통청년 ${pageNum}페이지 검증에 실패했습니다 (${reason}, 필드: ${field}).`);
    this.name = 'YouthCenterPageValidationError';
  }
}

/** 구조 검증을 통과한 페이지의 요청 일치 여부·건수·정책 ID 중복을 검사한다. */
export function validateYouthCenterPage(
  body: YouthCenterListResponse,
  pageNum: number,
  pageSize: number,
  seenIds: Set<string>,
  attempts = 1,
): void {
  const { pagging, youthPolicyList } = body.result;

  // 요청·응답 페이지 번호와 크기 비교
  if (pagging.pageNum !== pageNum) {
    throw new YouthCenterPageValidationError(pageNum, attempts, 'PAGE_NUMBER_MISMATCH', 'result.pagging.pageNum', {
      expected: pageNum, actual: pagging.pageNum,
    });
  }
  if (pagging.pageSize !== pageSize) {
    throw new YouthCenterPageValidationError(pageNum, attempts, 'PAGE_SIZE_MISMATCH', 'result.pagging.pageSize', {
      expected: pageSize, actual: pagging.pageSize,
    });
  }

  // 페이지 최대 건수와 총 건수에 따른 예상 반환 건수 확인
  const count = youthPolicyList.length;
  if (count > pageSize) {
    throw new YouthCenterPageValidationError(pageNum, attempts, 'PAGE_SIZE_EXCEEDED', 'result.youthPolicyList', {
      expected: pageSize, actual: count,
    });
  }
  const expectedCount = Math.min(pageSize, Math.max(0, pagging.totCount - (pageNum - 1) * pageSize));
  if (count !== expectedCount) {
    throw new YouthCenterPageValidationError(pageNum, attempts, 'PAGE_COUNT_MISMATCH', 'result.youthPolicyList', {
      expected: expectedCount, actual: count,
    });
  }

  // 같은 페이지 및 앞서 통과한 페이지의 정책 ID 중복 검사
  const pageIds = new Set<string>();
  for (const [index, policy] of youthPolicyList.entries()) {
    if (pageIds.has(policy.plcyNo) || seenIds.has(policy.plcyNo)) {
      throw new YouthCenterPageValidationError(pageNum, attempts, 'DUPLICATE_POLICY_ID', `result.youthPolicyList.${index}.plcyNo`, {
        policyId: policy.plcyNo,
      });
    }
    pageIds.add(policy.plcyNo);
  }

  // 페이지 전체가 유효할 때만 수집 작업의 ID 집합에 반영
  for (const policyId of pageIds) seenIds.add(policyId);
}
