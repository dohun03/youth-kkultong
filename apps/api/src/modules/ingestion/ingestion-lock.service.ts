import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { QueryRunner } from 'typeorm';

/** 수집 중복 실행 방지 고유 번호 */
export const YOUTH_CENTER_INGESTION_LOCK_KEY = '202610180001';

/** 수집 상태 구분하는 타입 */
export type IngestionLockResult<T> = { status: 'COMPLETED'; value: T } | { status: 'ALREADY_RUNNING' };

/** 락을 잡거나 풀 때 문제가 생겼을 때 원인과 단계를 알려주는 전용 에러 클래스 */
export class IngestionLockError extends Error {
  constructor(
    readonly stage: 'LOCK' | 'LOCK_RELEASE',
    readonly reason: 'CONNECT_FAILED' | 'ACQUIRE_FAILED' | 'UNLOCK_FAILED' | 'TRANSACTION_NOT_FINISHED'
      | 'ROLLBACK_FAILED' | 'CONNECTION_CLOSE_FAILED' | 'CONNECTION_RELEASE_FAILED',
  ) {
    super(`온통청년 수집 잠금 처리에 실패했습니다 (단계: ${stage}, 원인: ${reason}).`);
    this.name = 'IngestionLockError';
  }
}

/** 동시에 여러 크롤러가 돌지 못하도록 DB 락을 걸고, 작업이 끝나거나 에러가 나도 뒷처리를 완벽하게 책임짐 */
@Injectable()
export class IngestionLockService {
  private readonly logger = new Logger(IngestionLockService.name);

  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  /** 락을 먼저 획득한 뒤 전달받은 실제 수집 작업을 실행 */
  async runWithLock<T>(work: (queryRunner: QueryRunner) => Promise<T>): Promise<IngestionLockResult<T>> {
    // DB와 통신할 독립적인 전용 통로(QueryRunner)를 하나 생성
    const queryRunner = this.dataSource.createQueryRunner();

    // 뒤에서 안전하게 연결을 끊기 위해 사용할 변수들 초기화
    let connection: { end(): Promise<void> } | undefined;
    let acquired = false;           // 락을 성공적으로 쥐었는지 여부
    let closeConnection = true;     // 연결을 강제로 끊어야 하는지 여부
    let result: IngestionLockResult<T> = { status: 'ALREADY_RUNNING' }; // 기본값은 '이미 실행 중'
    const errors: unknown[] = [];   // 처리 중 발생한 에러 모음

    try {
      // 데이터베이스 연결 시도
      try {
        connection = await queryRunner.connect();
      } catch {
        throw new IngestionLockError('LOCK', 'CONNECT_FAILED');
      }

      // DB 락 획득
      try {
        const rows: { acquired: boolean }[] = await queryRunner.query(
          'SELECT pg_try_advisory_lock($1::bigint) AS acquired', [YOUTH_CENTER_INGESTION_LOCK_KEY],
        );
        if (typeof rows[0]?.acquired !== 'boolean') throw new Error('잠금 결과 형식 오류');

        acquired = rows[0].acquired;       // 락 획득 성공(true) 또는 실패(false)
        closeConnection = acquired;        // 성공했다면 작업 끝난 뒤 연결 처리 방식을 달리함
      } catch {
        throw new IngestionLockError('LOCK', 'ACQUIRE_FAILED');
      }

      // 락 획득 후 실제 수집 작업 실행, 아니면 스킵
      if (acquired) {
        result = { status: 'COMPLETED', value: await work(queryRunner) };
      } else {
        this.logger.log('온통청년 정책 수집이 이미 실행 중이므로 추가 실행을 건너뜁니다.');
      }
    } catch (error) {
      errors.push(error);
    } finally {
      // 끝나지 않은 트랜잭션이 남아있다면 강제로 롤백해서 DB가 안 멈추게 막기
      if (queryRunner.isTransactionActive) {
        if (errors.length === 0) errors.push(new IngestionLockError('LOCK_RELEASE', 'TRANSACTION_NOT_FINISHED'));

        try {
          await queryRunner.rollbackTransaction();
        } catch {
          errors.push(new IngestionLockError('LOCK_RELEASE', 'ROLLBACK_FAILED'));
        }
      }

      // 내가 쥐고 있던 락 반납
      if (acquired) {
        try {
          const rows: { released: boolean }[] = await queryRunner.query(
            'SELECT pg_advisory_unlock($1::bigint) AS released', [YOUTH_CENTER_INGESTION_LOCK_KEY],
          );
          if (rows[0]?.released !== true) throw new Error('잠금 반환 확인 실패');
          closeConnection = queryRunner.isTransactionActive;
        } catch {
          errors.push(new IngestionLockError('LOCK_RELEASE', 'UNLOCK_FAILED'));
        }
      }

      // 데이터베이스 커넥션 안전하게 닫거나 반환하기
      try {
        if (closeConnection && connection) await connection.end();
      } catch {
        errors.push(new IngestionLockError('LOCK_RELEASE', 'CONNECTION_CLOSE_FAILED'));
      } finally {
        try {
          await queryRunner.release();
        } catch {
          errors.push(new IngestionLockError('LOCK_RELEASE', 'CONNECTION_RELEASE_FAILED'));
          // 반환하다가 실패했어도 연결이 남지 않도록 한 번 더 강제 종료 시도
          if (!closeConnection && connection) {
            try {
              await connection.end();
            } catch {
              errors.push(new IngestionLockError('LOCK_RELEASE', 'CONNECTION_CLOSE_FAILED'));
            }
          }
        }
      }
    }

    // 청소하다가 난 에러나 작업 에러가 있다면 몽땅 모아서 바깥으로 던져주기
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, '온통청년 수집 작업 또는 자원 정리 중 여러 오류가 발생했습니다.');

    return result; // 최종 결과 반환
  }
}
