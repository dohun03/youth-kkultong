import { Logger } from '@nestjs/common';
import type { DataSource, QueryRunner } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import { createDataSource } from '../src/database/data-source';
import { IngestionLockService } from '../src/modules/ingestion/ingestion-lock.service';
import { IngestionService } from '../src/modules/ingestion/ingestion.service';
import { YouthCenterClient } from '../src/modules/ingestion/youth-center.client';

/** 작업 중간에서 잠금 보유 여부를 확인하기 위한 수동 완료 신호를 만든다. */
function createGate(): { promise: Promise<void>; resume: () => void } {
  let resume!: () => void;
  const promise = new Promise<void>((resolve) => { resume = resolve; });
  return { promise, resume };
}

/** 실제 PostgreSQL 세션으로 동시 실행·잠금 유지·반환·불확실한 연결 폐기를 검증한다. */
describe('수집 잠금의 실제 PostgreSQL 검증', () => {
  let firstSource: DataSource;
  let secondSource: DataSource;
  let firstService: IngestionLockService;
  let secondService: IngestionLockService;

  beforeAll(async () => {
    const environment = loadEnvironment();
    firstSource = createDataSource(environment).setOptions({ entities: [], migrations: [] });
    secondSource = createDataSource(environment).setOptions({ entities: [], migrations: [] });
    await firstSource.initialize();
    await secondSource.initialize();
    firstService = new IngestionLockService(firstSource);
    secondService = new IngestionLockService(secondSource);
  });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    try {
      if (firstSource?.isInitialized) await firstSource.destroy();
    } finally {
      if (secondSource?.isInitialized) await secondSource.destroy();
    }
  });

  it('독립 연결의 두 번째 수집은 API 호출 전 건너뛰고 첫 작업 종료 후 다시 실행된다', async () => {
    const environment = { ...loadEnvironment(), YOUTH_CENTER_API_KEY: 'lock-integration-placeholder', YOUTH_CENTER_REQUEST_DELAY_MS: 0 };
    const collector = new IngestionService(new YouthCenterClient(environment));
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({
      resultCode: 200, resultMessage: '성공', result: {
        pagging: { totCount: 1, pageNum: 1, pageSize: environment.YOUTH_CENTER_PAGE_SIZE },
        youthPolicyList: [{ plcyNo: 'lock-test-policy', plcyNm: '잠금 검증 정책' }],
      },
    }));
    const started = createGate();
    const finish = createGate();
    let firstRunner: QueryRunner | undefined;
    let firstPid: number | undefined;
    const first = firstService.runWithLock(async (runner) => {
      firstRunner = runner;
      firstPid = (await runner.manager.query('SELECT pg_backend_pid() AS pid'))[0].pid;
      expect(runner.isTransactionActive).toBe(false);
      const policies = await collector.collectPolicies();
      started.resume();
      // 수집 이후 처리까지 작업 경계 안에 있으므로 잠금과 같은 연결을 계속 유지한다.
      await finish.promise;
      expect((await runner.manager.query('SELECT pg_backend_pid() AS pid'))[0].pid).toBe(firstPid);
      return policies;
    });
    // 앞 작업이 시작 전에 실패해도 대기 중인 테스트를 풀어 최종 결과에서 실패를 확인한다.
    void first.then(started.resume, started.resume);
    try {
      await started.promise;
      const secondPid = (await secondSource.query('SELECT pg_backend_pid() AS pid'))[0].pid;
      expect(secondPid).not.toBe(firstPid);
      expect(firstRunner?.isReleased).toBe(false);
      const secondWork = jest.fn(async () => collector.collectPolicies());
      await expect(secondService.runWithLock(secondWork)).resolves.toEqual({ status: 'ALREADY_RUNNING' });
      expect(secondWork).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      finish.resume();
      await first;
    }
    expect(firstRunner?.isReleased).toBe(true);
    await expect(secondService.runWithLock(async () => collector.collectPolicies())).resolves.toMatchObject({
      status: 'COMPLETED', value: [{ plcyNo: 'lock-test-policy' }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('같은 서비스의 중첩 실행도 별도 연결에서 잠금을 시도해 건너뛴다', async () => {
    await expect(firstService.runWithLock(async () => {
      const nested = jest.fn(async () => '중복 작업');
      await expect(firstService.runWithLock(nested)).resolves.toEqual({ status: 'ALREADY_RUNNING' });
      expect(nested).not.toHaveBeenCalled();
      return '첫 작업';
    })).resolves.toEqual({ status: 'COMPLETED', value: '첫 작업' });
  });

  it('세션 잠금은 같은 QueryRunner의 COMMIT·ROLLBACK 이후에도 유지된다', async () => {
    await firstService.runWithLock(async (runner) => {
      await runner.startTransaction();
      await runner.rollbackTransaction();
      await expect(secondService.runWithLock(jest.fn())).resolves.toEqual({ status: 'ALREADY_RUNNING' });
      await runner.startTransaction();
      await runner.commitTransaction();
      await expect(secondService.runWithLock(jest.fn())).resolves.toEqual({ status: 'ALREADY_RUNNING' });
    });
    await expect(secondService.runWithLock(async () => true)).resolves.toEqual({ status: 'COMPLETED', value: true });
  });

  it('작업 실패와 반복 실행 후에도 다른 연결에서 재획득할 수 있다', async () => {
    const failure = new Error('모의 수집 실패');
    await expect(firstService.runWithLock(async () => { throw failure; })).rejects.toBe(failure);
    await expect(secondService.runWithLock(async () => 1)).resolves.toEqual({ status: 'COMPLETED', value: 1 });
    await firstService.runWithLock(async () => 2);
    await firstService.runWithLock(async () => 3);
    await expect(secondService.runWithLock(async () => 4)).resolves.toEqual({ status: 'COMPLETED', value: 4 });
  });

  it('작업이 트랜잭션을 끝내지 않으면 롤백하고 연결을 반환한다', async () => {
    let retained: QueryRunner | undefined;
    await expect(firstService.runWithLock(async (runner) => {
      retained = runner;
      await runner.startTransaction();
      return 1;
    })).rejects.toMatchObject({ reason: 'TRANSACTION_NOT_FINISHED' });
    expect(retained?.isTransactionActive).toBe(false);
    expect(retained?.isReleased).toBe(true);
    await expect(secondService.runWithLock(async () => 2)).resolves.toEqual({ status: 'COMPLETED', value: 2 });
  });

  it('서버에서 획득했으나 응답 확인에 실패한 세션도 종료해 잠금이 남지 않는다', async () => {
    const runner = firstSource.createQueryRunner();
    const originalQuery = runner.query.bind(runner);
    const createRunner = jest.spyOn(firstSource, 'createQueryRunner').mockReturnValue(runner);
    jest.spyOn(runner, 'query').mockImplementationOnce(async (sql, parameters) => {
      await originalQuery(sql, parameters);
      throw new Error('획득 응답 유실');
    });
    const work = jest.fn();
    try {
      await expect(firstService.runWithLock(work)).rejects.toMatchObject({ reason: 'ACQUIRE_FAILED' });
      expect(work).not.toHaveBeenCalled();
      expect(runner.isReleased).toBe(true);
      await expect(secondService.runWithLock(async () => 1)).resolves.toEqual({ status: 'COMPLETED', value: 1 });
    } finally {
      createRunner.mockRestore();
      await runner.release();
    }
  });

  it('해제 쿼리가 실패하면 실제 세션을 종료해 잠금과 해당 풀 연결을 폐기한다', async () => {
    let pid: number | undefined;
    await expect(firstService.runWithLock(async (runner) => {
      pid = (await runner.query('SELECT pg_backend_pid() AS pid'))[0].pid;
      jest.spyOn(runner, 'query').mockRejectedValueOnce(new Error('모의 해제 실패'));
      return 1;
    })).rejects.toMatchObject({ reason: 'UNLOCK_FAILED' });
    await expect(secondService.runWithLock(async () => 2)).resolves.toEqual({ status: 'COMPLETED', value: 2 });
    await firstService.runWithLock(async (runner) => {
      expect((await runner.query('SELECT pg_backend_pid() AS pid'))[0].pid).not.toBe(pid);
    });
  });
});
