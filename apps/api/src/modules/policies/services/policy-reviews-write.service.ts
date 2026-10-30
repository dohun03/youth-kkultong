import { Inject, Injectable } from '@nestjs/common';
import type { JsonValue } from '@youth-kkultong/shared';
import type { EntityManager } from 'typeorm';
import { createYouthCenterPolicyContentHash } from '../../ingestion/youth-center/youth-center-policy.hash';
import type { Policy } from '../entities/policy.entity';
import type { SourcePolicy } from '../entities/source-policy.entity';
import { PolicyReviewRepository } from '../repositories/policy-review.repository';
import type { PendingReviewInsert, SupersededReviewInput } from '../repositories/policy-review.repository';

/** 새로 수집한 원본 + 현재 공개된 정책 */
export interface ReviewCandidateInput {
  sourcePolicy: Pick<SourcePolicy, 'id' | 'source' | 'externalId' | 'contentHash' | 'rawJson'>;
  basePolicy: Pick<Policy, 'id' | 'source' | 'externalId' | 'contentHash' | 'rawJson'> | null;
}

/** 검수(review) 스냅샷을 검증하고 기존 대기 대체와 새 후보 저장 순서를 관리 */
@Injectable()
export class PolicyReviewsWriteService {
  constructor(@Inject(PolicyReviewRepository) private readonly reviewRepository: PolicyReviewRepository) {}

  /** 같은 트랜잭션에서 기존 '대기'를 먼저 '대체' 후 새 스냅샷 후보를 저장 */
  async saveReviewChanges(
    manager: EntityManager,
    superseded: readonly SupersededReviewInput[],
    candidates: readonly ReviewCandidateInput[],
    closedAt: Date,
  ): Promise<void> {
    // 전체 입력의 중복을 먼저 확인해 동일 후보의 반복 종료와 원본당 중복 대기를 예방
    if (new Set(superseded.map(({ id }) => id)).size !== superseded.length) {
      throw new Error('대체할 검수 후보의 ID가 중복되었습니다.');
    }
    if (new Set(candidates.map(({ sourcePolicy }) => sourcePolicy.id)).size !== candidates.length) {
      throw new Error('새 검수 후보의 원본 ID가 중복되었습니다.');
    }

    // 쓰기 전에 전체 스냅샷을 검증하고 복사해 검수 당시 내용을 고정
    const preparedReviews: PendingReviewInsert[] = candidates.map(({ sourcePolicy, basePolicy }) => {
      if (basePolicy && (basePolicy.source !== sourcePolicy.source || basePolicy.externalId !== sourcePolicy.externalId)) {
        throw new Error('검수 원본과 공개 기준본의 출처 또는 외부 ID가 다릅니다.');
      }

      return {
        sourcePolicyId: sourcePolicy.id,
        kind: basePolicy === null ? 'NEW' : 'CHANGED',
        contentHash: sourcePolicy.contentHash,
        rawSnapshot: this.copySnapshot(sourcePolicy.rawJson, sourcePolicy.contentHash),
        basePolicyId: basePolicy?.id ?? null,
        baseContentHash: basePolicy?.contentHash ?? null,
        baseRawSnapshot: basePolicy === null ? null : this.copySnapshot(basePolicy.rawJson, basePolicy.contentHash),
      };
    });

    // 원본당 대기 한 건 제약을 지키기 위해 모든 기존 대기를 종료한 뒤 새 후보를 추가
    await this.reviewRepository.supersedePendingReviews(manager, superseded, closedAt);
    await this.reviewRepository.insertPendingReviews(manager, preparedReviews);
  }

  /** 원본 객체와 내용 해시의 일치를 확인한 뒤 독립적인 스냅샷으로 복사 */
  private copySnapshot(raw: Record<string, unknown>, contentHash: string): Record<string, JsonValue> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || typeof raw.plcyNo !== 'string' || typeof raw.plcyNm !== 'string') {
      throw new Error('검수 스냅샷에 올바른 원본 정책 객체가 필요합니다.');
    }
    const hash = createYouthCenterPolicyContentHash({ ...raw, plcyNo: raw.plcyNo, plcyNm: raw.plcyNm });
    if (hash !== contentHash) throw new Error('검수 스냅샷의 내용과 해시가 일치하지 않습니다.');

    // 해시 계산으로 유효한 JSON 값임을 확인한 원문을 깊은 복사
    return JSON.parse(JSON.stringify(raw)) as Record<string, JsonValue>;
  }
}
