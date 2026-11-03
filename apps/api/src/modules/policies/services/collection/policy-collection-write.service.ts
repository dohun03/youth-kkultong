import { Inject, Injectable } from '@nestjs/common';
import type { CollectionResult, JsonValue } from '@youth-kkultong/shared';
import { QueryFailedError } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import { ENVIRONMENT } from '../../../../common/environment';
import type { Environment } from '../../../../common/environment';
import { classifyPolicyCollection } from '../../rules/collection/policy-collection';
import { decidePolicyReview } from '../../rules/reviews/policy-review-decision';
import { SourcePolicyRepository } from '../../repositories/source-policy.repository';
import { PolicyRepository } from '../../repositories/policy.repository';
import type { PublicPolicySnapshot } from '../../repositories/policy.repository';
import { PolicyReviewRepository } from '../../repositories/policy-review.repository';
import type { SupersededReviewInput } from '../../repositories/policy-review.repository';
import { PolicyReviewsWriteService } from '../reviews/policy-reviews-write.service';
import type { ReviewCandidateInput } from '../reviews/policy-reviews-write.service';
import type { PolicyWriteInput } from '../../types/policy-write.types';

/** 한 번의 정상 전체 수집에서 DB에 확정된 판정과 검수 및 공개 조회수 갱신 건수 */
export interface PolicyCollectionSaveResult {
  counts: Record<CollectionResult, number>;
  reviewCreatedCount: number;
  reviewSupersededCount: number;
  publicViewUpdatedCount: number;
}

/** COMMIT 응답을 확인하지 못해 실제 DB 확정 여부를 알 수 없는 오류 */
export class PolicyCollectionCommitError extends Error {
  constructor(cause: unknown) {
    super('수집 저장의 COMMIT 결과를 확인할 수 없습니다.', { cause });
    this.name = 'PolicyCollectionCommitError';
  }
}

/** 수집 원본과 누락 정보, 검수 후보, 공개 조회수를 한 트랜잭션으로 저장 */
@Injectable()
export class PolicyCollectionWriteService {
  constructor(
    @Inject(SourcePolicyRepository) private readonly sources: SourcePolicyRepository,
    @Inject(PolicyRepository) private readonly policies: PolicyRepository,
    @Inject(PolicyReviewRepository) private readonly reviews: PolicyReviewRepository,
    @Inject(PolicyReviewsWriteService) private readonly reviewWriter: PolicyReviewsWriteService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  /** 수집 잠금에 사용한 연결에서 전체 저장을 실행하고 DB 충돌은 한 번 재시도 */
  async saveCollection(
    runner: QueryRunner,
    source: string,
    incoming: readonly PolicyWriteInput[],
    collectedAt: Date,
    onAttempt?: (attempts: number, previousError?: unknown) => Promise<void>,
  ): Promise<PolicyCollectionSaveResult> {
    if (runner.isTransactionActive || runner.isReleased) throw new Error('수집 저장에는 사용 가능한 새 트랜잭션 연결이 필요합니다.');
    await onAttempt?.(1);
    try {
      // 메인 로직 시작
      return await this.saveTransaction(runner, source, incoming, collectedAt);
    } catch (error) {
      // 재시도할 수 있는지 확인 후 재시도
      const code = error instanceof QueryFailedError && 'code' in error.driverError ? error.driverError.code : undefined;
      if ((code !== '40P01' && code !== '40001') || runner.isTransactionActive || runner.isReleased) throw error;
      try {
        await runner.manager.sql`SELECT 1`;
      } catch (connectionError) {
        throw new AggregateError([error, connectionError], 'DB 연결 확인에 실패해 수집 저장 재시도를 중단했습니다.');
      }
      await onAttempt?.(2, error);
      return this.saveTransaction(runner, source, incoming, collectedAt);
    }
  }

  /** 원본 잠금부터 모든 저장의 확정 또는 취소까지 같은 DB 관리자로 처리 */
  private async saveTransaction(
    runner: QueryRunner,
    source: string,
    incoming: readonly PolicyWriteInput[],
    collectedAt: Date,
  ): Promise<PolicyCollectionSaveResult> {
    try {
      await runner.startTransaction('READ COMMITTED');
      const manager = runner.manager;

      // 기존 원본을 조회하고 수정 잠금
      const previous = await this.sources.findBySourceForUpdate(manager, source);
      // 위에서 조회한 기존 원본(previous) vs 수집(incoming) 비교 후 (신규 / 변경 / 동일 / 누락) 판정
      const plan = classifyPolicyCollection(source, previous, incoming);
      // (정책 외부 ID + 판정)을 Map 형태로 저장
      const results = new Map(plan.collected.map((policy) => [policy.externalId, policy.lastCollectionResult]));

      // 위에서 판정 끝내고 sources 테이블에 반영
      await this.sources.upsertCollectedPolicies(manager, incoming.map((policy) => ({
        source: policy.source,
        externalId: policy.externalId,
        title: policy.title,
        rawJson: policy.rawJson as Record<string, JsonValue>,
        contentHash: policy.contentHash,
        viewCount: policy.viewCount,
        lastCollectionResult: results.get(policy.externalId)!,
      })), collectedAt);
      // 누락 횟수도 반영
      await this.sources.updateMissingPolicies(manager, plan.missing);

      // 새로 저장한 원본의 저장 결과를 UUID까지 다시 일괄 조회
      const current = await this.sources.findBySourceForUpdate(manager, source);
      const originals = new Map(current.map((policy) => [policy.externalId, policy]));
      const observed = plan.collected.map(({ externalId }) => {
        const original = originals.get(externalId);
        if (!original) throw new Error('저장한 수집 원본을 찾을 수 없습니다.');
        return original;
      });

      // 현재 공개본 조회
      const publicPolicies: PublicPolicySnapshot[] = [];
      const batchSize = this.environment.POLICY_IMPORT_BATCH_SIZE;
      for (let offset = 0; offset < observed.length; offset += batchSize) {
        publicPolicies.push(...await this.policies.findPublicSnapshots(manager, observed.slice(offset, offset + batchSize)));
      }

      // 대기, 거절 상태의 정책 리뷰들 묶음 조회
      const ids = observed.map(({ id }) => id);
      const pending = await this.reviews.findPendingReviews(manager, ids);
      const rejected = await this.reviews.findRejectedHashes(manager, ids);

      // 위에서 조회한 정책들을 Map으로 저장
      const publicByExternalId = new Map(publicPolicies.map((policy) => [policy.externalId, policy]));
      const pendingBySourceId = new Map(pending.map((review) => [review.sourcePolicyId, review]));
      const rejectedBySourceId = new Map<string, typeof rejected>();
      for (const review of rejected) {
        const history = rejectedBySourceId.get(review.sourcePolicyId) ?? [];
        history.push(review);
        rejectedBySourceId.set(review.sourcePolicyId, history);
      }

      // 아까 다시 조회한 원본(observed)을 순회 -> 원본 vs 공개본 스냅샷 비교 -> review에 저장 준비
      const superseded: SupersededReviewInput[] = [];
      const candidates: ReviewCandidateInput[] = [];
      for (const original of observed) {
        const publicPolicy = publicByExternalId.get(original.externalId) ?? null;
        // 각 정책의 후보 (생성 / 유지 / 대체) 판단
        const decision = decidePolicyReview({
          sourcePolicy: original, publicPolicy,
          collectionResult: results.get(original.externalId)!,
          pendingReview: pendingBySourceId.get(original.id) ?? null,
          rejectedHashes: rejectedBySourceId.get(original.id) ?? []
        });
        if (decision.action === 'KEEP') continue;
        if (decision.superseded) superseded.push(decision.superseded);
        if (decision.action === 'CREATE') candidates.push({ sourcePolicy: original, basePolicy: publicPolicy });
      }

      // 기존 review 테이블의 대기를 모두 대체 후 새 후보 스냅샷을 저장
      await this.reviewWriter.saveReviewChanges(manager, superseded, candidates, new Date());

      // 수집된 정책 중 공개 행이 있는 정책의 조회수만 묶음으로 갱신
      let publicViewUpdatedCount = 0;
      for (let offset = 0; offset < observed.length; offset += batchSize) {
        publicViewUpdatedCount += await this.policies.refreshViewCounts(manager, observed.slice(offset, offset + batchSize));
      }

      // 커밋
      try {
        await runner.commitTransaction();
      } catch (error) {
        // DB가 취소를 확정한 충돌 외에는 확정 여부 불명으로 전달해 저장 재실행을 예방
        const code = error instanceof QueryFailedError && 'code' in error.driverError ? error.driverError.code : undefined;
        if (code === '40P01' || code === '40001') throw error;
        throw new PolicyCollectionCommitError(error);
      }

      // 실제 반영 건수를 반환
      return {
        counts: plan.counts,
        reviewCreatedCount: candidates.length,
        reviewSupersededCount: superseded.length,
        publicViewUpdatedCount
      };
    } catch (error) {
      if (runner.isTransactionActive) {
        try {
          await runner.rollbackTransaction();
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], '수집 저장과 트랜잭션 취소에 모두 실패했습니다.');
        }
      }
      throw error;
    }
  }
}
