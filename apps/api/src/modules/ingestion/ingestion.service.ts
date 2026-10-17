import { Inject, Injectable } from '@nestjs/common';
import { YouthCenterClient } from './youth-center.client';
import type { YouthCenterRawPolicy } from './youth-center-response.schema';

/** 전체 수집의 총 건수 변화·누락·중복을 구분해 전달한다. */
export class YouthCenterCollectionValidationError extends Error {
  /** 검증 실패 단계 */
  readonly stage = 'COLLECTION_VALIDATION';

  constructor(
    readonly reason: 'TOTAL_COUNT_CHANGED' | 'TOTAL_COUNT_MISMATCH' | 'PAGE_MISSING'
      | 'PAGE_COUNT_MISMATCH' | 'DUPLICATE_POLICY_ID',
    readonly details: { expected?: number; actual?: number; policyId?: string },
    readonly pageNum?: number,
    readonly attempts?: number,
  ) {
    super(`온통청년 전체 수집 검증에 실패했습니다 (${reason}).`);
    this.name = 'YouthCenterCollectionValidationError';
  }
}

/** 반환 직전에 전체 페이지 누락·정책 총합·ID 중복을 다시 검사한다. */
export function validateYouthCenterCollection(
  policies: readonly YouthCenterRawPolicy[],
  totalCount: number,
  totalPages: number,
  receivedPages: ReadonlySet<number>,
): void {
  // 첫 페이지부터 마지막 페이지까지 누락 여부 확인
  for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
    if (!receivedPages.has(pageNum)) {
      throw new YouthCenterCollectionValidationError('PAGE_MISSING', {}, pageNum);
    }
  }
  if (receivedPages.size !== totalPages) {
    throw new YouthCenterCollectionValidationError('PAGE_COUNT_MISMATCH', {
      expected: totalPages, actual: receivedPages.size,
    });
  }

  // 첫 응답의 총 건수와 최종 수집 건수 비교
  if (policies.length !== totalCount) {
    throw new YouthCenterCollectionValidationError('TOTAL_COUNT_MISMATCH', {
      expected: totalCount, actual: policies.length,
    });
  }

  // 최종 정책 배열 자체의 ID 중복 재검증
  const finalIds = new Set<string>();
  for (const policy of policies) {
    if (finalIds.has(policy.plcyNo)) {
      throw new YouthCenterCollectionValidationError('DUPLICATE_POLICY_ID', { policyId: policy.plcyNo });
    }
    finalIds.add(policy.plcyNo);
  }
}

/** 전체 정책을 순차 수집하고 최종 검증에 성공한 원본 배열만 반환한다. */
@Injectable()
export class IngestionService {
  constructor(@Inject(YouthCenterClient) private readonly youthCenterClient: YouthCenterClient) {}

  /** 수집 작업마다 새 ID 집합을 사용하며 중간 실패 시 부분 결과를 반환하지 않는다. */
  async collectPolicies(): Promise<YouthCenterRawPolicy[]> {
    // 첫 페이지에서 실제 총 건수와 페이지 크기 확보
    const seenIds = new Set<string>();
    const firstPage = await this.youthCenterClient.fetchPageWithRetry(1, seenIds);
    const { totCount, pageSize } = firstPage.body.result.pagging;
    // 총 0건이어도 이미 요청한 첫 페이지는 검증 대상에 포함한다.
    const totalPages = Math.max(1, Math.ceil(totCount / pageSize));
    const receivedPages = new Set([firstPage.body.result.pagging.pageNum]);
    const policies = [...firstPage.body.result.youthPolicyList];

    // 같은 작업의 ID 집합을 전달하며 남은 페이지 순차 수집
    for (let pageNum = 2; pageNum <= totalPages; pageNum += 1) {
      const page = await this.youthCenterClient.fetchPageWithRetry(pageNum, seenIds);
      const { pagging, youthPolicyList } = page.body.result;
      if (pagging.totCount !== totCount) {
        throw new YouthCenterCollectionValidationError('TOTAL_COUNT_CHANGED', {
          expected: totCount, actual: pagging.totCount,
        }, pageNum, page.attempts);
      }
      receivedPages.add(pagging.pageNum);
      for (const policy of youthPolicyList) policies.push(policy);
    }

    // 최종 검증을 모두 통과한 결과만 다음 처리로 전달
    validateYouthCenterCollection(policies, totCount, totalPages, receivedPages);
    return policies;
  }
}
