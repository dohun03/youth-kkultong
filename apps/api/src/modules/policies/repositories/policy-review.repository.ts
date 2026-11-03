import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { ENVIRONMENT } from '../../../common/environment';
import type { Environment } from '../../../common/environment';
import type { AdminReviewQuery, ReviewListItem, SupersededReason } from '@youth-kkultong/shared';
import { PolicyReview } from '../entities/policy-review.entity';
import { SourcePolicy } from '../entities/source-policy.entity';
import { Policy } from '../entities/policy.entity';

/** 목록의 시각은 DB의 Date로 받고 서비스에서 ISO 문자열로 변환 */
export type PolicyReviewListRow = Omit<ReviewListItem, 'createdAt' | 'closedAt'> & {
  createdAt: Date;
  closedAt: Date | null;
};

/** 새 대기 후보에 저장할 원본과 공개 기준본 스냅샷 */
export type PendingReviewInsert = Pick<PolicyReview,
  'sourcePolicyId' | 'kind' | 'contentHash' | 'rawSnapshot' | 'basePolicyId' | 'baseContentHash' | 'baseRawSnapshot'
>;

/** 기존 대기를 대체할 (검수 ID + 대체 사유) */
export interface SupersededReviewInput {
  id: string;
  reason: SupersededReason;
}

/** 검수 목록과 상세 조회 및 전달받은 트랜잭션에서 후보 묶음 저장을 담당 */
@Injectable()
export class PolicyReviewRepository {
  constructor(@Inject(ENVIRONMENT) private readonly environment: Environment) {}

  /** 필터에 맞는 건수 및 목록 조회 */
  async findReviewList(manager: EntityManager, input: AdminReviewQuery): Promise<{
    rows: PolicyReviewListRow[]; total: number;
  }> {
    const { page = 1, limit = 20, status = 'PENDING', kind, sourcePolicyId, keyword } = input;
    const query = manager.getRepository(PolicyReview).createQueryBuilder('review')
      .innerJoin(SourcePolicy, 'source', 'source.id = review.sourcePolicyId');

    // 종료된 3가지(승인·거절·대체) 상태를 조회 or 지정한 한가지 상태만 조회
    if (status === 'PROCESSED') {
      query.where('review.status <> :pending', { pending: 'PENDING' });
    } else {
      query.where('review.status = :status', { status });
    }
    if (kind) query.andWhere('review.kind = :kind', { kind });
    if (sourcePolicyId) query.andWhere('review.sourcePolicyId = :sourcePolicyId', { sourcePolicyId });
    if (keyword) {
      // LIKE의 와일드카드와 이스케이프 문자를 먼저 보호해 검색어 자체를 부분 검색
      const escaped = keyword.replace(/[\\%_]/g, '\\$&');
      query.andWhere(`review.rawSnapshot ->> 'plcyNm' ILIKE :keyword ESCAPE '\\'`, { keyword: `%${escaped}%` });
    }

    // 목록 및 건수 조회 (긴 원문은 응답 자료에 싣지 않음)
    const total = await query.getCount();
    const rows = await query.select('review.id', 'id')
      .addSelect('review.sourcePolicyId', 'sourcePolicyId')
      .addSelect('source.source', 'source').addSelect('source.externalId', 'externalId')
      .addSelect(`review.rawSnapshot ->> 'plcyNm'`, 'title')
      .addSelect('review.kind', 'kind').addSelect('review.status', 'status')
      .addSelect('review.contentHash', 'contentHash').addSelect('review.baseContentHash', 'baseContentHash')
      .addSelect('review.createdAt', 'createdAt').addSelect('review.closedAt', 'closedAt')
      .addSelect('review.reviewedBy', 'reviewedBy').addSelect('review.rejectionReason', 'rejectionReason')
      .addSelect('review.supersededReason', 'supersededReason')
      .orderBy(status === 'PROCESSED' ? 'review.closedAt' : 'review.createdAt', 'DESC')
      .addOrderBy('review.id', 'ASC').offset((page - 1) * limit).limit(limit)
      .getRawMany<PolicyReviewListRow>();

    return { rows, total };
  }

  /** 상세 비교에 필요한 후보와 원본 및 현재 공개본과 최신 대기를 같은 트랜잭션에서 조회 */
  async findReviewDetail(manager: EntityManager, id: string) {
    this.requireTransaction(manager);

    const review = await manager.getRepository(PolicyReview).findOneBy({ id });
    if (!review) return null;

    const sourcePolicy = await manager.getRepository(SourcePolicy).findOneOrFail({
      select: { id: true, source: true, externalId: true, contentHash: true, viewCount: true, lastCollectedAt: true, missingCount: true },
      where: { id: review.sourcePolicyId },
    });
    const publicPolicy = await manager.getRepository(Policy).findOne({
      select: { id: true, contentHash: true, rawJson: true, viewCount: true },
      where: { source: sourcePolicy.source, externalId: sourcePolicy.externalId },
    });
    const latestPending = await manager.getRepository(PolicyReview).findOne({
      select: { id: true }, where: { sourcePolicyId: sourcePolicy.id, status: 'PENDING' },
    });
    return { review, sourcePolicy, publicPolicy, latestPendingReviewId: latestPending?.id ?? null };
  }

  /** 원본 ID를 먼저 찾고 원본, 후보, 현재 공개본 순서로 잠가 처리할 최신 상태 조회 */
  async findReviewForUpdate(manager: EntityManager, id: string) {
    this.requireTransaction(manager);

    // 후보를 먼저 잠그면 수집의 원본 잠금과 순서가 엇갈리므로 식별자만 일반 조회
    const reference = await manager.getRepository(PolicyReview).findOne({
      select: { sourcePolicyId: true }, where: { id },
    });
    if (!reference) return null;

    // 수집 저장과 같은 원본을 먼저 잠근 뒤 후보를 다시 읽어 대기 상태를 확인할 준비
    const sourcePolicy = await manager.getRepository(SourcePolicy).findOneOrFail({
      where: { id: reference.sourcePolicyId }, lock: { mode: 'pessimistic_write' },
    });
    const review = await manager.getRepository(PolicyReview).findOne({
      where: { id }, lock: { mode: 'pessimistic_write' },
    });
    if (!review) return null;

    // 현재 공개본은 출처와 외부 ID로 찾아 신규 후보에 이미 공개본이 생긴 경우도 확인
    const publicPolicy = await manager.getRepository(Policy).findOne({
      where: { source: sourcePolicy.source, externalId: sourcePolicy.externalId },
      lock: { mode: 'pessimistic_write' },
    });
    return { review, sourcePolicy, publicPolicy };
  }

  /** 대기 상태의 후보의 (상태 / 처리자 / 종료 시각) 저장 */
  async approvePendingReview(
    manager: EntityManager,
    id: string, reviewedBy: string,
    closedAt: Date
  ): Promise<void> {
    this.requireTransaction(manager);
    const result = await manager.getRepository(PolicyReview).update(
      { id, status: 'PENDING' }, // 조건(where)
      { status: 'APPROVED', reviewedBy, closedAt } // 변경할 값(set)
    );
    if (result.affected !== 1) throw new Error('승인할 검수 후보가 없거나 이미 종료되었습니다.');
  }

  /** 잠근 대기 후보에 거절 사유와 처리자 및 종료 시각 저장 */
  async rejectPendingReview(
    manager: EntityManager,
    id: string,
    reviewedBy: string,
    reason: string,
    closedAt: Date,
  ): Promise<void> {
    this.requireTransaction(manager);
    // 대기 상태에만 처리 정보를 기록해 이미 끝난 이력을 보호
    const result = await manager.getRepository(PolicyReview).update({ id, status: 'PENDING' }, {
      status: 'REJECTED', reviewedBy, rejectionReason: reason, closedAt,
    });
    if (result.affected !== 1) throw new Error('거절할 검수 후보가 없거나 이미 종료되었습니다.');
  }

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
