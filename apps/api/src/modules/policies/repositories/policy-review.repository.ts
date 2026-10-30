import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { ENVIRONMENT } from '../../../common/environment';
import type { Environment } from '../../../common/environment';
import type { SupersededReason } from '@youth-kkultong/shared';
import { PolicyReview } from '../entities/policy-review.entity';

/** 새 대기 후보에 저장할 원본과 공개 기준본 스냅샷 */
export type PendingReviewInsert = Pick<PolicyReview,
  'sourcePolicyId' | 'kind' | 'contentHash' | 'rawSnapshot' | 'basePolicyId' | 'baseContentHash' | 'baseRawSnapshot'
>;

/** 기존 대기를 대체할 (검수 ID + 대체 사유) */
export interface SupersededReviewInput {
  id: string;
  reason: SupersededReason;
}

/** 전달받은 트랜잭션에서 검수 후보 조회와 묶음 저장을 담당 */
@Injectable()
export class PolicyReviewRepository {
  constructor(@Inject(ENVIRONMENT) private readonly environment: Environment) {}

  /** 여러 원본의 대기 후보를 묶음으로 조회 */
  async findPendingReviews(manager: EntityManager, sourcePolicyIds: readonly string[]): Promise<PolicyReview[]> {
    this.requireTransaction(manager);
    const ids = [...new Set(sourcePolicyIds)];
    const result: PolicyReview[] = [];
    const batchSize = this.environment.POLICY_IMPORT_BATCH_SIZE;
    for (let offset = 0; offset < ids.length; offset += batchSize) {
      // 원본마다 조회하는 대신 묶음에 포함된 모든 원본의 대기를 함께 조회
      result.push(...await manager.getRepository(PolicyReview).find({
        where: { sourcePolicyId: In(ids.slice(offset, offset + batchSize)), status: 'PENDING' },
        order: { sourcePolicyId: 'ASC', id: 'ASC' },
      }));
    }
    return result;
  }

  /** 여러 원본에서 거절된 내용 해시를 중복 없이 묶음 조회 */
  async findRejectedHashes(manager: EntityManager, sourcePolicyIds: readonly string[]): Promise<Pick<PolicyReview, 'sourcePolicyId' | 'contentHash'>[]> {
    this.requireTransaction(manager);
    const ids = [...new Set(sourcePolicyIds)];
    const result: Pick<PolicyReview, 'sourcePolicyId' | 'contentHash'>[] = [];
    const batchSize = this.environment.POLICY_IMPORT_BATCH_SIZE;
    for (let offset = 0; offset < ids.length; offset += batchSize) {
      // 거절 여부 판단에 필요한 원본 ID와 해시만 가져와 과거 스냅샷 전송량을 줄임
      result.push(...await manager.getRepository(PolicyReview).createQueryBuilder('review')
        .select('review.sourcePolicyId', 'sourcePolicyId')
        .addSelect('review.contentHash', 'contentHash')
        .distinct(true)
        .where('review.sourcePolicyId IN (:...ids)', { ids: ids.slice(offset, offset + batchSize) })
        .andWhere('review.status = :status', { status: 'REJECTED' })
        .getRawMany<Pick<PolicyReview, 'sourcePolicyId' | 'contentHash'>>());
    }
    return result;
  }

  /** 기존 대기를 사유(reason)별로 묶어 대체 상태, 종료 시각을 갱신 */
  async supersedePendingReviews(
    manager: EntityManager,
    reviews: readonly SupersededReviewInput[],
    closedAt: Date,
  ): Promise<void> {
    this.requireTransaction(manager);

    const groups = new Map<SupersededReason, string[]>();
    for (const review of reviews) {
      const ids = groups.get(review.reason) ?? [];
      ids.push(review.id);
      groups.set(review.reason, ids);
    }

    const batchSize = this.environment.POLICY_IMPORT_BATCH_SIZE;
    for (const [reason, ids] of groups) {
      for (let offset = 0; offset < ids.length; offset += batchSize) {
        const batch = ids.slice(offset, offset + batchSize);
        // 대기(pending) 상태인 행에만 대체 정보를 기록해 이미 종료된 이력을 보호
        const result = await manager.getRepository(PolicyReview).createQueryBuilder().update()
          .set({ status: 'SUPERSEDED', supersededReason: reason, closedAt })
          .where({ id: In(batch), status: 'PENDING' })
          .execute();
        if (result.affected !== batch.length) throw new Error('대체할 검수 후보가 없거나 이미 종료되었습니다.');
      }
    }
  }

  /** 검증된 스냅샷을 새 대기 후보로 추가 */
  async insertPendingReviews(manager: EntityManager, reviews: readonly PendingReviewInsert[]): Promise<void> {
    this.requireTransaction(manager);

    const batchSize = this.environment.POLICY_IMPORT_BATCH_SIZE;
    for (let offset = 0; offset < reviews.length; offset += batchSize) {
      const batch = reviews.slice(offset, offset + batchSize);
      const query = manager.getRepository(PolicyReview).createQueryBuilder().insert();
      const rows = batch.map((review, index) => {
        // 스냅샷을 JSON 매개변수로 전달. 신규 후보의 빈 기준본은 NULL로 저장
        query.setParameters({
          [`raw${index}`]: JSON.stringify(review.rawSnapshot),
          [`base${index}`]: review.baseRawSnapshot === null ? null : JSON.stringify(review.baseRawSnapshot),
        });

        return {
          sourcePolicyId: review.sourcePolicyId, kind: review.kind, contentHash: review.contentHash,
          basePolicyId: review.basePolicyId, baseContentHash: review.baseContentHash,
          rawSnapshot: () => `CAST(:raw${index} AS jsonb)`,
          baseRawSnapshot: () => `CAST(:base${index} AS jsonb)`,
          status: 'PENDING' as const, reviewedBy: null, rejectionReason: null, supersededReason: null, closedAt: null,
        };
      });
      await query.values(rows).updateEntity(false).execute();
    }
  }

  /** 조회와 저장에 사용할 DB 관리자의 트랜잭션 상태를 확인 */
  private requireTransaction(manager: EntityManager): void {
    if (!manager.queryRunner?.isTransactionActive) {
      throw new Error('검수 후보 조회와 저장에는 진행 중인 트랜잭션 관리자가 필요합니다.');
    }
  }
}
