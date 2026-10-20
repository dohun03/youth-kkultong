import { Inject, Injectable } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import type { EntityManager, QueryRunner } from 'typeorm';
import { ENVIRONMENT } from '../../common/environment';
import type { Environment } from '../../common/environment';
import type { Policy } from './entities/policy.entity';
import { PolicyRepository } from './policy.repository';

/** DB에 저장할 NEW, CHANGED 정책 데이터 타입 */
export type PolicyWriteInput = Omit<Policy, 'id' | 'createdAt' | 'updatedAt' | 'sourceRegisteredAt' | 'sourceModifiedAt'> & {
  // 원본 등록일과 수정일은 시간대 없는 날짜 문자열로 받음
  sourceRegisteredAt: string | null;
  sourceModifiedAt: string | null;
};

/** UNCHANGED 정책의 원본 JSON과 조회수를 갱신할 데이터 타입 */
export type PolicyRefreshInput = Pick<PolicyWriteInput, 'source' | 'externalId' | 'rawJson' | 'viewCount'>;

/** 정책 하나의 분류 결과와 저장할 데이터 */
export type ClassifiedPolicy =
  | { status: 'NEW' | 'CHANGED'; data: PolicyWriteInput }
  | { status: 'UNCHANGED'; data: PolicyRefreshInput };

/** 분류한 정책 목록과 신규·변경·동일 건수 */
export interface PreparedPolicyBatches {
  batches: ClassifiedPolicy[][]; // 저장할 정책을 최대 200건씩 나눈 목록
  counts: Record<ClassifiedPolicy['status'], number>; // 실제 저장 전 분류별 건수
}

/** 수집한 정책을 분류하고 전체 데이터를 한 트랜잭션으로 저장하는 서비스 */
@Injectable()
export class PoliciesWriteService {
  constructor(
    @Inject(PolicyRepository) private readonly policyRepository: PolicyRepository,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  /** 정책 저장 중 DB 충돌이 나면 전체 저장을 한 번만 재시도 */
  async savePolicies(
    queryRunner: QueryRunner, policies: readonly PolicyWriteInput[], onAttempt?: (attempts: number, previousError?: unknown) => Promise<void>,
  ): Promise<PreparedPolicyBatches['counts']> {
    await onAttempt?.(1);
    try {
      return await this.saveTransaction(queryRunner, policies);
    } catch (error) {
      // PostgreSQL의 교착 상태·직렬화 실패만 재시도
      const code = error instanceof QueryFailedError && 'code' in error.driverError ? error.driverError.code : undefined;
      if ((code !== '40P01' && code !== '40001') || queryRunner.isTransactionActive || queryRunner.isReleased) throw error;

      // 롤백 뒤에도 기존 연결을 사용할 수 있는지 확인. 새 연결은 만들지 않음
      try {
        await queryRunner.manager.sql`SELECT 1`;
      } catch (connectionError) {
        throw new AggregateError([error, connectionError], 'DB 연결 확인에 실패해 정책 저장 재시도를 중단했습니다.');
      }

      // 같은 연결·수집 데이터로 두 번째 실행. 이게 마지막 재시도.
      await onAttempt?.(2, error);
      return this.saveTransaction(queryRunner, policies);
    }
  }

  /** 전체 정책을 트랜잭션 하나로 저장하고 실패하면 롤백 */
  private async saveTransaction(queryRunner: QueryRunner, policies: readonly PolicyWriteInput[]): Promise<PreparedPolicyBatches['counts']> {
    // 진행 중인 다른 트랜잭션 체크
    if (queryRunner.isTransactionActive) throw new Error('이미 트랜잭션이 진행 중인 연결에서는 정책 저장을 시작할 수 없습니다.');

    try {
      await queryRunner.startTransaction();
      const prepared = await this.prepareBatches(queryRunner.manager, policies);

      // 배치 단위 처리
      for (const batch of prepared.batches) {
        const writes: PolicyWriteInput[] = [];
        const refreshes: PolicyRefreshInput[] = [];

        // 배치 내 개별 처리
        for (const policy of batch) {
          if (policy.status === 'UNCHANGED') refreshes.push(policy.data);
          else writes.push(policy.data);
        }

        // 신규·변경은 전체 저장, 동일은 원본과 조회수만 갱신
        await this.policyRepository.upsertPolicies(queryRunner.manager, writes);
        await this.policyRepository.refreshPolicies(queryRunner.manager, refreshes);
      }

      // 트랜잭션 커밋 후 결과 건수 반환
      await queryRunner.commitTransaction();
      return prepared.counts;

    } catch (error) {
      // 오류가 나면 기존 작업까지 전부 롤백
      if (queryRunner.isTransactionActive) {
        try {
          await queryRunner.rollbackTransaction();
        } catch (rollbackError) {
          // 취소도 실패했다면 원래 오류와 취소 오류를 함께 전달
          throw new AggregateError([error, rollbackError], '정책 저장과 트랜잭션 취소에 모두 실패했습니다.');
        }
      }
      throw error;
    }
  }

  /** 기존 DB 해시와 비교해 정책을 분류하고 최대 200건씩 묶어 반환 */
  async prepareBatches(manager: EntityManager, policies: readonly PolicyWriteInput[]): Promise<PreparedPolicyBatches> {
    // 분류한 정책을 담을 목록과 건수
    const result: PreparedPolicyBatches = { batches: [], counts: { NEW: 0, CHANGED: 0, UNCHANGED: 0 } };
    // 배치 단위로 DB 조회
    const batchSize = this.environment.POLICY_IMPORT_BATCH_SIZE;
    for (let offset = 0; offset < policies.length; offset += batchSize) {
      // 이번에 처리할 정책을 잘라내고 DB에 저장된 해시 조회
      const batch = policies.slice(offset, offset + batchSize);
      const existing = await this.policyRepository.findContentHashes(manager, batch);
      // [출처, 외부 ID]를 키로 지정해서 기존 해시를 바로 찾을 수 있는 Map 생성
      const hashes = new Map(existing.map((policy) => [
        JSON.stringify([policy.source, policy.externalId]), policy.contentHash,
      ]));

      const classified: ClassifiedPolicy[] = [];
      for (const policy of batch) {
        // 상태 확정: 기존 정책이 없으면 신규, 해시가 같으면 동일, 다르면 변경
        const prevHash = hashes.get(JSON.stringify([policy.source, policy.externalId]));
        const status = prevHash === undefined ? 'NEW' : prevHash === policy.contentHash ? 'UNCHANGED' : 'CHANGED';
        result.counts[status] += 1;

        if (status === 'UNCHANGED') {
          // 내용이 같으면 원본 JSON과 조회수만 갱신하도록 준비
          const { source, externalId, rawJson, viewCount } = policy;
          classified.push({ status, data: { source, externalId, rawJson, viewCount } });
        } else {
          // 신규·변경 정책은 전체 데이터를 저장하도록 준비
          classified.push({ status, data: policy });
        }
      }
      result.batches.push(classified); // 이번 묶음의 분류 결과 추가
    }
    // DB 저장은 하지 않고 분류한 목록과 건수만 반환
    return result;
  }
}
