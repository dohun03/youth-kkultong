import { Logger } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import { parseEnvironment } from '../src/common/environment';
import { IngestionLockService } from '../src/modules/ingestion/services/ingestion-lock.service';
import { IngestionLogError, IngestionLogService } from '../src/modules/ingestion/services/ingestion-log.service';
import type { IngestionLogEntry } from '../src/modules/ingestion/services/ingestion-log.service';
import { IngestionService, YouthCenterCollectionValidationError } from '../src/modules/ingestion/services/ingestion.service';
import { YouthCenterClient } from '../src/modules/ingestion/youth-center/youth-center.client';
import { PoliciesWriteService } from '../src/modules/policies/policies-write.service';
import { PolicyRepository } from '../src/modules/policies/policy.repository';

describe('수집 실행의 결과 기록과 공통 정리', () => {
  const environment = parseEnvironment({
    DATABASE_URL: 'postgresql://tester:unit-db-secret@db/test', YOUTH_CENTER_API_KEY: 'unit-api-secret',
    YOUTH_CENTER_REQUEST_DELAY_MS: '0', YOUTH_CENTER_MAX_ATTEMPTS: '1',
  });
  let runner: QueryRunner;
  let service: IngestionService;
  let writer: PoliciesWriteService;
  let log: IngestionLogService;
  let records: IngestionLogEntry[];
  let order: string[];
  let end: jest.Mock;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    records = [];
    order = [];
    end = jest.fn().mockResolvedValue(undefined);
    runner = {
      isReleased: false, isTransactionActive: false,
      connect: jest.fn().mockResolvedValue({ end }),
      query: jest.fn(async (sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) return [{ acquired: true }];
        order.push('UNLOCK');
        return [{ released: true }];
      }),
      release: jest.fn(async () => { order.push('RELEASE'); }),
    } as unknown as QueryRunner;
    const source = new DataSource({ type: 'postgres' });
    jest.spyOn(source, 'createQueryRunner').mockReturnValue(runner);
    writer = new PoliciesWriteService(new PolicyRepository(), environment);
    jest.spyOn(writer, 'savePolicies').mockImplementation(async (_runner, _policies, onAttempt) => {
      await onAttempt?.(1);
      return { NEW: 1, CHANGED: 0, UNCHANGED: 0 };
    });
    log = new IngestionLogService(environment);
    jest.spyOn(log, 'write').mockImplementation(async (entry) => {
      records.push(structuredClone(entry));
      order.push(entry.event);
    });
    service = new IngestionService(new YouthCenterClient(environment), new IngestionLockService(source), writer, log);
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      resultCode: 200, resultMessage: '성공', result: {
        pagging: { totCount: 1, pageNum: 1, pageSize: 50 }, youthPolicyList: [{ plcyNo: 'p1', plcyNm: '검증 정책' }],
      },
    }));
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('저장 결과를 잠금 해제 전에 기록하고 정리 이후 최종 성공을 기록한다', async () => {
    await expect(service.importPolicies()).resolves.toEqual({ status: 'COMPLETED', value: { NEW: 1, CHANGED: 0, UNCHANGED: 0 } });
    expect(order).toEqual(['RUN_STARTED', 'PAGE_ATTEMPT', 'SAVE_ATTEMPT', 'WORK_FINISHED', 'UNLOCK', 'RELEASE', 'RUN_FINISHED']);
    expect(records.at(-1)).toMatchObject({ stage: 'COMPLETE', status: 'SUCCESS', saved: true, saveAttempts: 1, counts: { NEW: 1 } });
    expect(new Set(records.map((record) => record.runId)).size).toBe(1);
  });

  it('이미 실행 중이면 API·저장을 호출하지 않고 중복 결과만 기록한다', async () => {
    jest.mocked(runner.query).mockResolvedValueOnce([{ acquired: false }]);
    await expect(service.importPolicies()).resolves.toEqual({ status: 'ALREADY_RUNNING' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writer.savePolicies).not.toHaveBeenCalled();
    expect(records.at(-1)).toMatchObject({ status: 'ALREADY_RUNNING', saved: false, saveAttempts: 0 });
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['API', () => Response.json({}, { status: 503 })],
    ['PAGE_VALIDATION', () => Response.json({ resultCode: 200, resultMessage: '성공', result: {} })],
    ['TRANSFORMATION', () => Response.json({
      resultCode: 200, resultMessage: '성공', result: {
        pagging: { totCount: 1, pageNum: 1, pageSize: 50 }, youthPolicyList: [{ plcyNo: 'p1', plcyNm: '검증', sprtTrgtMinAge: '잘못된 나이' }],
      },
    })],
  ] as const)('%s 오류 후 실패 단계와 원인을 기록하고 잠금·연결을 정리한다', async (stage, response) => {
    fetchMock.mockResolvedValueOnce(response());
    await expect(service.importPolicies()).rejects.toBeInstanceOf(Error);
    expect(records.at(-1)).toMatchObject({ status: 'FAILED', saved: false, failures: [expect.objectContaining({ stage })] });
    expect(writer.savePolicies).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledTimes(1);
    expect(order.indexOf('WORK_FINISHED')).toBeLessThan(order.indexOf('UNLOCK'));
  });

  it('전체 검증 오류를 기록하고 부분 결과를 저장하지 않는다', async () => {
    jest.spyOn(service, 'collectPolicies').mockRejectedValueOnce(new YouthCenterCollectionValidationError('TOTAL_COUNT_MISMATCH', { expected: 2, actual: 1 }));
    await expect(service.importPolicies()).rejects.toBeInstanceOf(YouthCenterCollectionValidationError);
    expect(records.at(-1)?.failures).toMatchObject([{ stage: 'COLLECTION_VALIDATION', reason: 'TOTAL_COUNT_MISMATCH' }]);
    expect(writer.savePolicies).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('해시 오류도 정책 ID·필드만 기록하고 원본은 기록하지 않는다', async () => {
    jest.spyOn(service, 'collectPolicies').mockResolvedValueOnce([{ plcyNo: 'p1', plcyNm: '검증', extra: undefined }]);
    await expect(service.importPolicies()).rejects.toBeInstanceOf(Error);
    expect(records.at(-1)?.failures).toMatchObject([{ stage: 'HASH', reason: 'INVALID_JSON_VALUE', policyId: 'p1' }]);
    expect(writer.savePolicies).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('DB 오류는 SQL·원본 메시지 대신 SQLSTATE만 기록한다', async () => {
    const error = new QueryFailedError('SQL-unit-api-secret', ['private-value'], Object.assign(new Error('unit-db-secret'), { code: '23505' }));
    jest.mocked(writer.savePolicies).mockRejectedValueOnce(error);
    await expect(service.importPolicies()).rejects.toBe(error);
    expect(records.at(-1)?.failures).toEqual([{ stage: 'DATABASE', reason: 'QUERY_FAILED', code: '23505' }]);
    expect(JSON.stringify(records)).not.toMatch(/unit-api-secret|unit-db-secret|private-value|SQL-unit/);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('작업 오류와 잠금 해제 오류를 최종 기록에 함께 남긴다', async () => {
    jest.mocked(writer.savePolicies).mockRejectedValueOnce(new Error('비밀 오류 메시지'));
    jest.mocked(runner.query).mockResolvedValueOnce([{ acquired: true }]).mockRejectedValueOnce(new Error('DB 접속 정보'));
    await expect(service.importPolicies()).rejects.toBeInstanceOf(AggregateError);
    expect(records.at(-1)?.failures).toEqual([
      { stage: 'DATABASE', reason: 'UNEXPECTED_ERROR' }, { stage: 'LOCK_RELEASE', reason: 'UNLOCK_FAILED' },
    ]);
    expect(end).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('요청 기록 실패로 중단돼도 잠금과 연결을 정리한다', async () => {
    const write = jest.mocked(log.write).getMockImplementation()!;
    jest.mocked(log.write).mockImplementation(async (entry) => {
      if (entry.event === 'PAGE_ATTEMPT') throw new IngestionLogError();
      await write(entry);
    });
    await expect(service.importPolicies()).rejects.toBeInstanceOf(IngestionLogError);
    expect(records.at(-1)?.failures).toEqual([{ stage: 'LOG', reason: 'FILE_AND_FALLBACK_FAILED' }]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('저장 이후 기록 실패는 저장 완료 사실을 유지하며 정리 후 실패로 전달한다', async () => {
    const write = jest.mocked(log.write).getMockImplementation()!;
    jest.mocked(log.write).mockImplementation(async (entry) => {
      if (entry.event === 'WORK_FINISHED' && entry.status === 'SUCCESS') throw new IngestionLogError();
      await write(entry);
    });
    await expect(service.importPolicies()).rejects.toBeInstanceOf(IngestionLogError);
    expect(records.at(-1)).toMatchObject({ status: 'FAILED', saved: true, counts: { NEW: 1 } });
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('최종 기록이 실패해도 이미 끝난 잠금·연결 정리는 유지한다', async () => {
    jest.mocked(log.write).mockImplementation(async (entry) => {
      if (entry.event === 'RUN_FINISHED') {
        expect(order).toContain('RELEASE');
        throw new IngestionLogError();
      }
    });
    await expect(service.importPolicies()).rejects.toBeInstanceOf(IngestionLogError);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('시작 기록부터 모두 실패하면 DB 연결을 열지 않고 두 로그 오류를 보존한다', async () => {
    jest.mocked(log.write).mockRejectedValue(new IngestionLogError());
    await expect(service.importPolicies()).rejects.toMatchObject({ errors: [expect.any(IngestionLogError), expect.any(IngestionLogError)] });
    expect(runner.connect).not.toHaveBeenCalled();
  });
});
