import { Inject, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
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

/** 수집한 정책을 NEW/CHANGED/UNCHANGED 로 나누고 저장할 데이터를 준비하는 서비스 */
@Injectable()
export class PoliciesWriteService {
  constructor(
    @Inject(PolicyRepository) private readonly policyRepository: PolicyRepository,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

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
