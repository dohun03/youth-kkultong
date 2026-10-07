import type { PolicyImportInput, SourceStatus } from '@kkultong/contracts';
import type { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { stableJsonStringify } from '../../../common/utils/stable-json.util';
import { PolicyEntity } from '../entities/policy.entity';
import { PolicySourceEntity } from '../entities/policy-source.entity';
import { PolicyRepository } from '../repositories/policy.repository';

const MANUAL_SOURCE_CODE = 'MANUAL';
const ACTIVE_SOURCE_STATUS: SourceStatus = 'ACTIVE';
const NATIONAL_REGION_CODE = 'KR';
const MAX_TRANSACTION_ATTEMPTS = 2;
const RETRYABLE_DATABASE_ERROR_CODES = new Set(['40001', '40P01', '08006', '57P01']);

export type PolicyWriteAction = 'CREATED' | 'UPDATED' | 'UNCHANGED';

export interface ImportSummary {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
}

export interface PolicyWriteErrorDetails {
  index?: number;
  externalId?: string;
  field?: string;
  reason: string;
}

export type PolicyWriteErrorCode =
  | 'MANUAL_SOURCE_NOT_FOUND'
  | 'REGION_NOT_FOUND'
  | 'DB_CONSTRAINT_FAILED';

export class PolicyWriteError extends Error {
  public constructor(
    public readonly code: PolicyWriteErrorCode,
    public readonly details: PolicyWriteErrorDetails,
  ) {
    super(details.reason);
    this.name = 'PolicyWriteError';
  }
}

interface PolicyWritableFields {
  externalId: string;
  title: string;
  agency: string;
  category: PolicyImportInput['category'];
  benefitSummary: string;
  benefitAmount: PolicyImportInput['benefitAmount'];
  conditions: PolicyImportInput['conditions'];
  hasUnresolvedEligibilityCondition: boolean;
  unresolvedConditionNote: string | null;
  requiredDocs: string[];
  applyStart: string | null;
  applyEnd: string | null;
  isAlwaysOpen: boolean;
  officialUrl: string;
  sourceStatus: SourceStatus;
  isPublished: boolean;
  lastVerifiedAt: Date;
}

interface RegionReference {
  index: number;
  externalId: string;
  field: string;
}

/**
 * 수동 정책 JSON을 `policies` 엔티티에 저장하는 유일한 쓰기 진입점이다.
 * `policy_sources`의 MANUAL 출처와 `regions` 참조를 함께 검증해 정책 데이터의 일관성을 유지한다.
 */
export class PolicyWriteService {
  public constructor(
    private readonly dataSource: DataSource,
    private readonly policyRepository: PolicyRepository,
  ) {}

  /** 1. 정책 한 건을 트랜잭션 저장(생성·변경·무변경) */
  public async upsertManual(
    input: PolicyImportInput,
    manager?: EntityManager,
  ): Promise<{ policy: PolicyEntity; action: PolicyWriteAction }> {
    if (manager !== undefined) {
      // batch가 이미 시작한 transaction 안에서는 새 transaction을 만들지 않는다.
      return this.upsertManualWithManager(input, manager);
    }

    // 단건 저장도 출처 확인부터 저장까지 함께 성공하거나 함께 실패하도록 transaction을 연다.
    return this.dataSource.transaction((transactionManager) =>
      this.upsertManualWithManager(input, transactionManager),
    );
  }

  /** 2. 정책 배열 전체를 하나의 트랜잭션 저장하고, dry-run이면 저장 결과만 계산 후 롤백 */
  public async importManualBatch(
    inputs: PolicyImportInput[],
    options: { dryRun?: boolean } = {},
  ): Promise<ImportSummary> {
    let lastError: unknown;

    // 일시적인 DB 오류 재시도
    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        // 배치 단위 트랜잭션. 저장 후 결과 반환.
        return await this.runBatchTransaction(inputs, options.dryRun === true);
      } catch (error) {
        lastError = error;

        // 재시도 대상이 아니거나 최대 횟수에 도달하면 CLI가 해석할 수 있는 도메인 오류로 바꾼다.
        if (!this.isRetryableDatabaseError(error) || attempt === MAX_TRANSACTION_ATTEMPTS) {
          throw this.toPolicyWriteError(error);
        }
      }
    }

    throw this.toPolicyWriteError(lastError);
  }

  /** =================== 내부 사용 메서드들 =================== */

  /** 배치 단위 트랜잭션. QueryRunner의 transaction, commit(또는 rollback)을 한곳에서 보장한다. */
  private async runBatchTransaction(
    inputs: PolicyImportInput[],
    dryRun: boolean,
  ): Promise<ImportSummary> {
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      // QueryRunner 연결 및 트랜잭션 열기
      await queryRunner.connect();
      await queryRunner.startTransaction();

      // QueryRunner의 manager를 써야 이후 Repository 쿼리가 같은 transaction에 속한다.
      const summary = await this.importManualBatchWithManager(inputs, queryRunner.manager);

      // dry-run일 경우 롤백하고, 아니면 그대로 커밋한다.
      if (dryRun) {
        await queryRunner.rollbackTransaction();
      } else {
        await queryRunner.commitTransaction();
      }

      return summary;

    } catch (error) {
      await this.rollbackIfActive(queryRunner); // 하나라도 실패하면 전체 취소
      throw error;
    } finally {
      await queryRunner.release(); // transaction 반환
    }
  }

  /** 이미 열린 transaction에서 "MANUAL 출처 + 지역"을 검증한 뒤 각 정책을 저장한다. */
  private async importManualBatchWithManager(
    inputs: PolicyImportInput[],
    manager: EntityManager,
  ): Promise<ImportSummary> {
    // 저장 전에 batch 전체의 공통 출처와 지역 참조를 먼저 확인한다.
    const source = await this.getManualSource(manager); // DB에서 출처가 수동(MANUAL)인지 검증
    await this.validateRegionReferences(inputs, manager); // DB에서 지역 참조 검증

    // 실행 결과 요약 (디버깅 용)
    const summary: ImportSummary = {
      total: inputs.length,
      created: 0,
      updated: 0,
      unchanged: 0,
    };

    for (const input of inputs) {
      // 각 정책의 저장 결과를 누적해 CLI가 생성·수정·무변경 건수를 보여줄 수 있게 한다.
      const { action } = await this.upsertWithSource(input, source, manager);

      if (action === 'CREATED') {
        summary.created += 1;
      } else if (action === 'UPDATED') {
        summary.updated += 1;
      } else {
        summary.unchanged += 1;
      }
    }

    return summary;
  }

  /** 출처·지역 검증 */
  private async upsertManualWithManager(
    input: PolicyImportInput,
    manager: EntityManager,
  ): Promise<{ policy: PolicyEntity; action: PolicyWriteAction }> {
    // 단건 저장도 batch와 같은 출처 검증 규칙을 적용한다.
    const source = await this.getManualSource(manager);
    // 단건이 참조하는 지역이 regions 테이블에 있는지 먼저 확인한다.
    await this.validateRegionReferences([input], manager);

    // 기존 정책과 비교한 뒤 생성·수정·무변경 결과를 결정한다.
    return this.upsertWithSource(input, source, manager);
  }

  /** 같은 출처의 기존 `PolicyEntity`와 비교해 저장(생성·변경·무변경)한다. */
  private async upsertWithSource(
    input: PolicyImportInput,
    source: PolicySourceEntity,
    manager: EntityManager,
  ): Promise<{ policy: PolicyEntity; action: PolicyWriteAction }> {
    // MANUAL 출처와 externalId 조합은 수동 등록 정책의 안정적인 식별자다.
    const existing = await this.policyRepository.findBySourceIdentity(source.id, input.externalId, manager);
    const writableFields = this.toWritableFields(input);

    if (existing === null) {
      // 기존 정책이 없으면 입력값으로 새 policies 행을 만든다.
      const policy = manager.create(PolicyEntity, { ...writableFields, source });

      return {
        policy: await this.policyRepository.save(policy, manager),
        action: 'CREATED',
      };
    }

    // 기존 내용과 같은 내용인지 비교 (같으면 기존 결과 그대로 반환)
    if (this.hasSameContent(existing, writableFields)) {
      return { policy: existing, action: 'UNCHANGED' };
    }

    // 기존 엔티티를 갱신하면 id와 createdAt은 유지되고 TypeORM이 updatedAt만 변경한다.
    Object.assign(existing, writableFields, { source });

    return {
      policy: await this.policyRepository.save(existing, manager),
      action: 'UPDATED',
    };
  }

  /** 출처가 MANUAL(수동)인지, 즉 `policy_sources.MANUAL` 행이 존재하는지 확인한다. */
  private async getManualSource(manager: EntityManager): Promise<PolicySourceEntity> {
    const source = await this.policyRepository.findSourceByCode(MANUAL_SOURCE_CODE, manager);

    // 없으면 에러 던짐
    if (source === null) {
      throw new PolicyWriteError('MANUAL_SOURCE_NOT_FOUND', {
        field: 'source',
        reason: `${MANUAL_SOURCE_CODE} 정책 출처가 존재하지 않습니다.`,
      });
    }

    return source;
  }

  /** 모든 정책의 지역 RULE에서 전국 코드와 중복을 제거한 뒤 `regions`를 한 번만 조회한다. */
  private async validateRegionReferences(
    inputs: PolicyImportInput[],
    manager: EntityManager,
  ): Promise<void> {
    const references = new Map<string, RegionReference>();

    inputs.forEach((input, index) => {
      // RULE이 아닌 경우, 즉 지역 조건이 없는 ANY와 UNKNOWN은 DB의 특정 지역 코드를 참조하지 않는다.
      if (input.conditions.region.kind !== 'RULE') {
        return;
      }

      input.conditions.region.value.forEach((code, valueIndex) => {
        if (code !== NATIONAL_REGION_CODE && !references.has(code)) {
          // 같은 코드가 여러 번 나와도 최초 위치만 보관해 오류 위치를 명확히 알려준다.
          references.set(code, {
            index,
            externalId: input.externalId,
            field: `conditions.region.value.${valueIndex}`,
          });
        }
      });
    });

    const codes = [...references.keys()];
    // 모든 지역 코드를 한 번에 조회해 import 건수에 비례한 DB 조회 증가를 막는다.
    const existingCodes = new Set(await this.policyRepository.findExistingRegionCodes(codes, manager));
    const missingCode = codes.find((code) => !existingCodes.has(code));

    if (missingCode !== undefined) {
      const reference = references.get(missingCode);

      // 저장 전에 실패시키면 잘못된 지역 조건이 있는 batch 전체를 안전하게 rollback할 수 있다.
      throw new PolicyWriteError('REGION_NOT_FOUND', {
        index: reference?.index,
        externalId: reference?.externalId,
        field: reference?.field,
        reason: `지역 코드 "${missingCode}"가 존재하지 않습니다.`,
      });
    }
  }

  /** JSON 입력을 `PolicyEntity`의 저장 대상 필드로 변환하고 MVP 0 고정값을 적용한다. */
  private toWritableFields(input: PolicyImportInput): PolicyWritableFields {
    // import JSON에 없는 출처 상태는 MVP 0 규칙에 따라 항상 ACTIVE로 저장한다.
    return {
      externalId: input.externalId,
      title: input.title,
      agency: input.agency,
      category: input.category,
      benefitSummary: input.benefitSummary,
      benefitAmount: input.benefitAmount,
      conditions: input.conditions,
      hasUnresolvedEligibilityCondition: input.hasUnresolvedEligibilityCondition,
      unresolvedConditionNote: input.unresolvedConditionNote,
      requiredDocs: input.requiredDocs,
      applyStart: input.applyStart,
      applyEnd: input.applyEnd,
      isAlwaysOpen: input.isAlwaysOpen,
      officialUrl: input.officialUrl,
      sourceStatus: ACTIVE_SOURCE_STATUS,
      isPublished: input.isPublished,
      lastVerifiedAt: new Date(input.lastVerifiedAt),
    };
  }

  /** DB 시스템 필드를 뺀 정책 내용만 안정적으로 비교해 불필요한 UPDATE를 막는다. */
  private hasSameContent(policy: PolicyEntity, fields: PolicyWritableFields): boolean {
    // 중첩 JSON 객체의 키 순서 차이까지 제거한 문자열끼리 비교
    return stableJsonStringify(this.toComparableFields(policy)) === stableJsonStringify(fields);
  }

  /** 기존 `PolicyEntity`를 입력값과 동일한 비교용 형태로 변환한다. */
  private toComparableFields(policy: PolicyEntity): PolicyWritableFields {
    return {
      externalId: policy.externalId ?? '',
      title: policy.title,
      agency: policy.agency,
      category: policy.category,
      benefitSummary: policy.benefitSummary,
      benefitAmount: policy.benefitAmount,
      conditions: policy.conditions,
      hasUnresolvedEligibilityCondition: policy.hasUnresolvedEligibilityCondition,
      unresolvedConditionNote: policy.unresolvedConditionNote,
      requiredDocs: policy.requiredDocs,
      applyStart: policy.applyStart,
      applyEnd: policy.applyEnd,
      isAlwaysOpen: policy.isAlwaysOpen,
      officialUrl: policy.officialUrl,
      sourceStatus: policy.sourceStatus,
      isPublished: policy.isPublished,
      lastVerifiedAt: policy.lastVerifiedAt,
    };
  }

  /** 오류 발생 시 아직 살아 있는 transaction만 되돌려 원래 오류를 보존한다. */
  private async rollbackIfActive(queryRunner: QueryRunner): Promise<void> {
    // transaction이 시작된 뒤에만 rollback을 호출해 연결 단계 오류도 안전하게 처리한다.
    if (queryRunner.isTransactionActive) {
      await queryRunner.rollbackTransaction();
    }
  }

  /** PostgreSQL의 일시적인 연결·교착·직렬화 오류만 전체 batch 재시도 대상으로 판단한다. */
  private isRetryableDatabaseError(error: unknown): boolean {
    // PostgreSQL 오류 객체에만 code가 있으므로 unknown 값을 먼저 안전하게 좁힌다.
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string' &&
      RETRYABLE_DATABASE_ERROR_CODES.has(error.code)
    );
  }

  /** 인프라 오류를 호출자가 처리 가능한 정책 저장 도메인 오류 형식으로 통일한다. */
  private toPolicyWriteError(error: unknown): PolicyWriteError {
    if (error instanceof PolicyWriteError) {
      return error;
    }

    return new PolicyWriteError('DB_CONSTRAINT_FAILED', {
      reason: error instanceof Error ? error.message : '정책 저장 중 알 수 없는 데이터베이스 오류가 발생했습니다.',
    });
  }
}
