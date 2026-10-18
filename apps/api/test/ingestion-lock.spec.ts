import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import { IngestionLockError, IngestionLockService, YOUTH_CENTER_INGESTION_LOCK_KEY } from '../src/modules/ingestion/ingestion-lock.service';

/** DB 모의 응답으로 잠금 경계·작업 건너뛰기·모든 자원 정리 경로를 검증한다. */
describe('수집 중복 실행 잠금', () => {
  let service: IngestionLockService;
  let runner: QueryRunner;
  let query: jest.SpiedFunction<QueryRunner['query']>;
  let release: jest.SpiedFunction<QueryRunner['release']>;
  let connect: jest.SpiedFunction<QueryRunner['connect']>;
  let end: jest.Mock<Promise<void>, []>;
  let log: jest.SpiedFunction<Logger['log']>;

  beforeEach(() => {
    const dataSource = new DataSource({ type: 'postgres', url: 'postgresql://unit@localhost/test', entities: [] });
    runner = dataSource.createQueryRunner();
    jest.spyOn(dataSource, 'createQueryRunner').mockReturnValue(runner);
    end = jest.fn(async () => {});
    connect = jest.spyOn(runner, 'connect').mockResolvedValue({ end });
    query = jest.spyOn(runner, 'query').mockResolvedValueOnce([{ acquired: true }]).mockResolvedValueOnce([{ released: true }]);
    release = jest.spyOn(runner, 'release').mockResolvedValue();
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    service = new IngestionLockService(dataSource);
  });

  afterEach(() => jest.restoreAllMocks());

  it('잠금→작업→잠금 반환 확인→연결 반환 순서로 실행한다', async () => {
    const startTransaction = jest.spyOn(runner, 'startTransaction');
    const work = jest.fn(async (received: QueryRunner) => {
      expect(received).toBe(runner);
      expect(received.manager).toBe(runner.manager);
      expect(received.isTransactionActive).toBe(false);
      return ['정책'];
    });
    await expect(service.runWithLock(work)).resolves.toEqual({ status: 'COMPLETED', value: ['정책'] });
    expect(query).toHaveBeenNthCalledWith(1, 'SELECT pg_try_advisory_lock($1::bigint) AS acquired', [YOUTH_CENTER_INGESTION_LOCK_KEY]);
    expect(query).toHaveBeenNthCalledWith(2, 'SELECT pg_advisory_unlock($1::bigint) AS released', [YOUTH_CENTER_INGESTION_LOCK_KEY]);
    expect(connect.mock.invocationCallOrder[0]).toBeLessThan(query.mock.invocationCallOrder[0]);
    expect(query.mock.invocationCallOrder[0]).toBeLessThan(work.mock.invocationCallOrder[0]);
    expect(work.mock.invocationCallOrder[0]).toBeLessThan(query.mock.invocationCallOrder[1]);
    expect(query.mock.invocationCallOrder[1]).toBeLessThan(release.mock.invocationCallOrder[0]);
    expect(startTransaction).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  it('작업이 끝날 때까지 연결과 잠금을 유지한다', async () => {
    let finish!: () => void;
    let started!: () => void;
    const pendingWork = new Promise<void>((resolve) => { finish = resolve; });
    const workStarted = new Promise<void>((resolve) => { started = resolve; });
    const result = service.runWithLock(async () => { started(); await pendingWork; return 1; });
    try {
      await workStarted;
      expect(query).toHaveBeenCalledTimes(1);
      expect(release).not.toHaveBeenCalled();
    } finally {
      finish();
    }
    await expect(result).resolves.toEqual({ status: 'COMPLETED', value: 1 });
  });

  it('이미 잠긴 경우 작업·잠금 해제를 실행하지 않고 중복 로그와 결과만 남긴다', async () => {
    query.mockReset().mockResolvedValueOnce([{ acquired: false }]);
    const work = jest.fn();
    await expect(service.runWithLock(work)).resolves.toEqual({ status: 'ALREADY_RUNNING' });
    expect(work).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('이미 실행 중'));
    expect(release).toHaveBeenCalledTimes(1);
    expect(end).not.toHaveBeenCalled();
  });

  it('작업 오류는 원래 객체를 유지하고 잠금·연결을 정리한다', async () => {
    const error = new Error('수집 오류');
    await expect(service.runWithLock(async () => { throw error; })).rejects.toBe(error);
    expect(query).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(1);
    expect(end).not.toHaveBeenCalled();
  });

  it('완료되지 않은 트랜잭션을 롤백하고 성공으로 처리하지 않는다', async () => {
    const rollback = jest.spyOn(runner, 'rollbackTransaction').mockImplementation(async () => {
      Object.defineProperty(runner, 'isTransactionActive', { value: false, configurable: true });
    });
    await expect(service.runWithLock(async () => {
      Object.defineProperty(runner, 'isTransactionActive', { value: true, configurable: true });
      return 1;
    })).rejects.toMatchObject({ reason: 'TRANSACTION_NOT_FINISHED' });
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(rollback.mock.invocationCallOrder[0]).toBeLessThan(query.mock.invocationCallOrder[1]);
    expect(release).toHaveBeenCalledTimes(1);
    expect(end).not.toHaveBeenCalled();
  });

  it('작업 실패 시 남은 트랜잭션을 롤백하고 원래 오류를 보존한다', async () => {
    const failure = new Error('작업 오류');
    jest.spyOn(runner, 'rollbackTransaction').mockImplementation(async () => {
      Object.defineProperty(runner, 'isTransactionActive', { value: false, configurable: true });
    });
    await expect(service.runWithLock(async () => {
      Object.defineProperty(runner, 'isTransactionActive', { value: true, configurable: true });
      throw failure;
    })).rejects.toBe(failure);
    expect(end).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('롤백이 실패해도 잠금 해제와 세션 종료·연결 반환을 계속 시도한다', async () => {
    jest.spyOn(runner, 'rollbackTransaction').mockRejectedValueOnce(new Error('롤백 오류'));
    const failure = new Error('작업 오류');
    const error = await service.runWithLock(async () => {
      Object.defineProperty(runner, 'isTransactionActive', { value: true, configurable: true });
      throw failure;
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([failure, expect.objectContaining({ reason: 'ROLLBACK_FAILED' })]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(end).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('연결 실패는 안전한 오류로 바꾸고 반환을 시도한다', async () => {
    connect.mockRejectedValueOnce(new Error('비밀 접속 정보'));
    const work = jest.fn();
    await expect(service.runWithLock(work)).rejects.toMatchObject({ stage: 'LOCK', reason: 'CONNECT_FAILED' });
    expect(work).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each([{ rows: [] }, { rows: [{ acquired: null }] }, { rows: [{ acquired: 'true' }] }])('획득 결과를 검증할 수 없으면 연결을 종료하고 작업을 시작하지 않는다: $rows', async ({ rows }) => {
    query.mockReset().mockResolvedValueOnce(rows);
    const work = jest.fn();
    await expect(service.runWithLock(work)).rejects.toMatchObject({ stage: 'LOCK', reason: 'ACQUIRE_FAILED' });
    expect(work).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('획득 쿼리 실패는 재시도하지 않고 세션 종료 후 연결을 반환한다', async () => {
    query.mockReset().mockRejectedValueOnce(new Error('DB 오류'));
    const work = jest.fn();
    await expect(service.runWithLock(work)).rejects.toMatchObject({ stage: 'LOCK', reason: 'ACQUIRE_FAILED' });
    expect(work).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('잠금 해제 실패는 성공 처리하지 않고 세션 종료 후 반환한다', async () => {
    query.mockReset().mockResolvedValueOnce([{ acquired: true }]).mockRejectedValueOnce(new Error('해제 오류'));
    await expect(service.runWithLock(async () => 1)).rejects.toMatchObject({ stage: 'LOCK_RELEASE', reason: 'UNLOCK_FAILED' });
    expect(end).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(end.mock.invocationCallOrder[0]).toBeLessThan(release.mock.invocationCallOrder[0]);
  });

  it('잠금 반환 결과가 false여도 실패로 처리하고 세션을 종료한다', async () => {
    query.mockReset().mockResolvedValueOnce([{ acquired: true }]).mockResolvedValueOnce([{ released: false }]);
    await expect(service.runWithLock(async () => 1)).rejects.toMatchObject({ reason: 'UNLOCK_FAILED' });
    expect(end).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('세션 종료도 실패해도 연결 반환을 계속 시도하고 오류를 모두 전달한다', async () => {
    query.mockReset().mockResolvedValueOnce([{ acquired: true }]).mockRejectedValueOnce(new Error('해제 오류'));
    end.mockRejectedValueOnce(new Error('종료 오류'));
    const error = await service.runWithLock(async () => 1).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toMatchObject([{ reason: 'UNLOCK_FAILED' }, { reason: 'CONNECTION_CLOSE_FAILED' }]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('연결 반환 실패도 세션 종료를 시도하고 오류로 전달한다', async () => {
    release.mockRejectedValueOnce(new Error('반환 오류'));
    await expect(service.runWithLock(async () => 1)).rejects.toMatchObject({ reason: 'CONNECTION_RELEASE_FAILED' });
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('작업과 정리 오류가 함께 나도 원래 수집 오류를 잃지 않는다', async () => {
    const workError = new Error('수집 오류');
    query.mockReset().mockResolvedValueOnce([{ acquired: true }]).mockRejectedValueOnce(new Error('해제 오류'));
    const error = await service.runWithLock(async () => { throw workError; }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors[0]).toBe(workError);
    expect((error as AggregateError).errors[1]).toMatchObject({ reason: 'UNLOCK_FAILED' });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('중복 로그 기록이 실패해도 연결을 반환한다', async () => {
    query.mockReset().mockResolvedValueOnce([{ acquired: false }]);
    const logError = new Error('로그 오류');
    log.mockImplementationOnce(() => { throw logError; });
    await expect(service.runWithLock(jest.fn())).rejects.toBe(logError);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('잠금 오류에 원본 DB 오류·접속 정보·cause를 포함하지 않는다', async () => {
    query.mockReset().mockRejectedValueOnce(new Error('postgresql://unit:lock-unit-secret@db/test'));
    const error = await service.runWithLock(jest.fn()).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(IngestionLockError);
    expect(String(error) + JSON.stringify(error) + (error as Error).stack).not.toMatch(/lock-unit-secret|postgresql:\/\//);
    expect(error).not.toHaveProperty('cause');
  });
});
