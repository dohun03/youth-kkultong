import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { QueryFailedError } from 'typeorm';
import { PoliciesWriteService } from '../../policies/services/policies-write.service';
import type { PolicyWriteInput, PreparedPolicyBatches } from '../../policies/services/policies-write.service';
import { IngestionLockError, IngestionLockService } from './ingestion-lock.service';
import type { IngestionLockResult } from './ingestion-lock.service';
import { IngestionLogError, IngestionLogService } from './ingestion-log.service';
import type { IngestionFailure, IngestionLogEntry, IngestionStage } from './ingestion-log.service';
import { YouthCenterClient, YouthCenterPageError, YouthCenterRequestError } from '../youth-center/youth-center.client';
import type { YouthCenterAttemptObserver } from '../youth-center/youth-center.client';
import { YouthCenterResponseValidationError } from '../youth-center/youth-center-response.schema';
import { YouthCenterPageValidationError } from '../youth-center/youth-center-page.validation';
import { transformYouthCenterPolicy, YouthCenterPolicyTransformError } from '../youth-center/youth-center-policy.transform';
import { createYouthCenterPolicyContentHash, YouthCenterPolicyHashError } from '../youth-center/youth-center-policy.hash';
import type { YouthCenterRawPolicy } from '../youth-center/youth-center-response.schema';

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

/** 수집·검증·변환·저장을 실행하고 결과 기록과 잠금 정리를 연결 */
@Injectable()
export class IngestionService {
  constructor(
    @Inject(YouthCenterClient) private readonly youthCenterClient: YouthCenterClient,
    @Inject(IngestionLockService) private readonly lockService: IngestionLockService,
    @Inject(PoliciesWriteService) private readonly writeService: PoliciesWriteService,
    @Inject(IngestionLogService) private readonly logService: IngestionLogService,
  ) {}

  /** 잠금 획득부터 수집 결과 기록까지 실행. CLI에서 이 메서드를 호출 */
  async importPolicies(): Promise<IngestionLockResult<PreparedPolicyBatches['counts']>> {
    // 상태, 에러, 결과를 담을 변수 선언
    const state: IngestionLogEntry = {
      runId: randomUUID(), event: 'RUN_STARTED', stage: 'LOCK', status: 'RUNNING',
      counts: { NEW: 0, CHANGED: 0, UNCHANGED: 0 }, saveAttempts: 0, saved: false,
    };
    const errors: unknown[] = [];
    let result: IngestionLockResult<PreparedPolicyBatches['counts']> = { status: 'ALREADY_RUNNING' };

    // 작업 시작
    try {
      // 첫 로그 기록
      await this.logService.write(state);
      // 락 획득 후 작업 실행
      result = await this.lockService.runWithLock(async (runner) => {
        try {
          // 정책 API 수집
          state.stage = 'API';
          const raw = await this.collectPolicies(async (pageNum, attempts, previousFailure) => {
            state.pageNum = pageNum;
            state.attempts = attempts;
            await this.logService.write({
              ...state, event: 'PAGE_ATTEMPT', failures: previousFailure ? [{
                stage: 'API', reason: previousFailure.failure, httpStatus: previousFailure.httpStatus, pageNum, attempts: attempts - 1,
              }] : [],
            });
          });
          // 전부 검증된 원본만 변환하고 해시 계산
          const policies: PolicyWriteInput[] = [];
          for (const policy of raw) {
            state.stage = 'TRANSFORMATION';
            const transformed = transformYouthCenterPolicy(policy);
            state.stage = 'HASH';
            policies.push({ ...transformed, contentHash: createYouthCenterPolicyContentHash(policy) });
          }
          // 정책 저장
          state.stage = 'DATABASE';
          state.counts = await this.writeService.savePolicies(runner, policies, async (attempts, previousError) => {
            state.saveAttempts = attempts;
            await this.logService.write({
              ...state, event: 'SAVE_ATTEMPT', failures: previousError ? this.describeFailure(previousError, 'DATABASE') : [],
            });
          });
          state.saved = true;
          // 저장 결과를 기록
          await this.logService.write({ ...state, event: 'WORK_FINISHED', status: 'SUCCESS' });
          return state.counts;
        } catch (error) {
          try {
            await this.logService.write({ ...state, event: 'WORK_FINISHED', status: 'FAILED', failures: this.describeFailure(error, state.stage) });
          } catch (logError) {
            throw new AggregateError([error, logError], '정책 수집과 실패 기록에 모두 실패했습니다.');
          }
          throw error;
        }
      });
    } catch (error) {
      errors.push(error);
    } finally {
      // runWithLock의 잠금·연결을 정리한 뒤 최종 기록
      const failures = errors.flatMap((error) => this.describeFailure(error, state.stage));
      try {
        await this.logService.write({
          ...state, event: 'RUN_FINISHED', failures,
          stage: failures[0]?.stage ?? (result.status === 'COMPLETED' ? 'COMPLETE' : 'LOCK'),
          status: errors.length > 0 ? 'FAILED' : result.status === 'COMPLETED' ? 'SUCCESS' : 'ALREADY_RUNNING',
        });
      } catch (logError) {
        errors.push(logError);
      }
    }
    // 작업 오류와 로그 오류가 함께 발생해도 어느 한쪽을 덮어쓰지 않음
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, '수집 실행 또는 최종 결과 기록에 실패했습니다.');
    return result;
  }

  /** 오류 메시지·SQL·원본 대신 정해진 실패 코드와 위치만 추출 */
  private describeFailure(error: unknown, stage: IngestionStage): IngestionFailure[] {
    if (error instanceof AggregateError) return error.errors.flatMap((item: unknown) => this.describeFailure(item, stage));
    if (error instanceof IngestionLogError) return [{ stage: 'LOG', reason: 'FILE_AND_FALLBACK_FAILED' }];
    if (error instanceof IngestionLockError) return [{ stage: error.stage, reason: error.reason }];
    if (error instanceof YouthCenterPageError) return [{
      stage: 'API', reason: `${error.reason}_${error.failure}`, pageNum: error.pageNum, attempts: error.attempts, httpStatus: error.httpStatus,
    }];
    if (error instanceof YouthCenterRequestError) return [{ stage: 'API', reason: error.kind, pageNum: error.pageNum }];
    if (error instanceof YouthCenterResponseValidationError) return [{
      stage: 'PAGE_VALIDATION', reason: 'INVALID_RESPONSE', fields: error.fields, pageNum: error.pageNum, attempts: error.attempts,
    }];
    if (error instanceof YouthCenterPageValidationError) return [{
      stage: 'PAGE_VALIDATION', reason: error.reason, fields: [error.field], policyId: error.details.policyId,
      pageNum: error.pageNum, attempts: error.attempts,
    }];
    if (error instanceof YouthCenterCollectionValidationError) return [{
      stage: 'COLLECTION_VALIDATION', reason: error.reason, policyId: error.details.policyId, pageNum: error.pageNum, attempts: error.attempts,
    }];
    if (error instanceof YouthCenterPolicyTransformError || error instanceof YouthCenterPolicyHashError) return [{
      stage: error.stage, reason: error.reason, policyId: error.policyId, fields: [error.field],
    }];
    if (error instanceof QueryFailedError) {
      const code = 'code' in error.driverError && typeof error.driverError.code === 'string' && /^[0-9A-Z]{5}$/.test(error.driverError.code)
        ? error.driverError.code : undefined;
      return [{ stage: 'DATABASE', reason: 'QUERY_FAILED', code }];
    }
    return [{ stage, reason: 'UNEXPECTED_ERROR' }];
  }

  /** 수집 작업마다 새 ID 집합을 사용하며 중간 실패 시 부분 결과를 반환하지 않는다. */
  async collectPolicies(onAttempt?: YouthCenterAttemptObserver): Promise<YouthCenterRawPolicy[]> {
    // 첫 페이지에서 실제 총 건수와 페이지 크기 확보
    const seenIds = new Set<string>();
    const firstPage = await this.youthCenterClient.fetchPageWithRetry(1, seenIds, onAttempt);
    const { totCount, pageSize } = firstPage.body.result.pagging;
    // 총 0건이어도 이미 요청한 첫 페이지는 검증 대상에 포함한다.
    const totalPages = Math.max(1, Math.ceil(totCount / pageSize));
    const receivedPages = new Set([firstPage.body.result.pagging.pageNum]);
    const policies = [...firstPage.body.result.youthPolicyList];

    // 같은 작업의 ID 집합을 전달하며 남은 페이지 순차 수집
    for (let pageNum = 2; pageNum <= totalPages; pageNum += 1) {
      const page = await this.youthCenterClient.fetchPageWithRetry(pageNum, seenIds, onAttempt);
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
