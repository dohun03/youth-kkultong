import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import { createDataSource } from '../src/database/data-source';
import { CreatePolicies1792162800000 } from '../src/database/migrations/1792162800000-create-policies';
import { IngestionLockService } from '../src/modules/ingestion/services/ingestion-lock.service';
import { IngestionLogService } from '../src/modules/ingestion/services/ingestion-log.service';
import type { IngestionLogEntry } from '../src/modules/ingestion/services/ingestion-log.service';
import { IngestionService } from '../src/modules/ingestion/services/ingestion.service';
import { YouthCenterClient } from '../src/modules/ingestion/youth-center/youth-center.client';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { PoliciesWriteService } from '../src/modules/policies/policies-write.service';
import { PolicyRepository } from '../src/modules/policies/policy.repository';

/** 2건씩 나눈 3개 정책의 정상 API 응답 생성 */
function page(pageNum: number) {
  return {
    resultCode: 200, resultMessage: '성공', result: {
      pagging: { totCount: 3, pageNum, pageSize: 2 },
      youthPolicyList: Array.from({ length: pageNum === 1 ? 2 : 1 }, (_, index) => ({
        plcyNo: `policy-${(pageNum - 1) * 2 + index}`, plcyNm: '검증 정책', inqCnt: '10',
      })),
    },
  };
}

describe('수집 결과 파일과 실제 DB 자원 정리', () => {
  const schema = `step24_test_${randomUUID().replaceAll('-', '')}`;
  const environment = { ...loadEnvironment(), YOUTH_CENTER_API_KEY: 'run-integration-secret', YOUTH_CENTER_PAGE_SIZE: 2, YOUTH_CENTER_REQUEST_DELAY_MS: 0 };
  let admin: DataSource;
  let dataSource: DataSource;
  let directory: string;
  let lock: IngestionLockService;
  let log: IngestionLogService;
  let repository: PolicyRepository;
  let writer: PoliciesWriteService;
  let service: IngestionService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let schemaCreated = false;

  /** 임시 파일에 기록된 JSON 행 목록 읽기 */
  async function records(): Promise<IngestionLogEntry[]> {
    return (await readFile(join(directory, 'policies-import.jsonl'), 'utf8')).trimEnd().split('\n').map((line) => JSON.parse(line));
  }

  beforeAll(async () => {
    admin = createDataSource(environment).setOptions({ entities: [], migrations: [] });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    dataSource = createDataSource(environment).setOptions({
      schema, entities: [Policy], migrations: [CreatePolicies1792162800000],
      extra: { options: `-c timezone=${environment.TZ} -c search_path=${schema}` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  beforeEach(async () => {
    await dataSource.getRepository(Policy).clear();
    directory = await mkdtemp(join(tmpdir(), 'ingestion-run-'));
    lock = new IngestionLockService(dataSource);
    log = new IngestionLogService(environment, directory);
    repository = new PolicyRepository();
    writer = new PoliciesWriteService(repository, { ...environment, POLICY_IMPORT_BATCH_SIZE: 2 });
    service = new IngestionService(new YouthCenterClient(environment), lock, writer, log);
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => (
      Response.json(page(Number(new URL(String(input)).searchParams.get('pageNum'))))
    ));
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  afterAll(async () => {
    try {
      if (dataSource?.isInitialized) await dataSource.destroy();
    } finally {
      try {
        if (schemaCreated && admin?.isInitialized) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        if (admin?.isInitialized) await admin.destroy();
      }
    }
  });

  it('페이지·실행 ID·신규/동일 건수를 파일에 남기고 종료 후 잠금을 다시 획득한다', async () => {
    await expect(service.importPolicies()).resolves.toEqual({ status: 'COMPLETED', value: { NEW: 3, CHANGED: 0, UNCHANGED: 0 } });
    await expect(service.importPolicies()).resolves.toEqual({ status: 'COMPLETED', value: { NEW: 0, CHANGED: 0, UNCHANGED: 3 } });
    const all = await records();
    const results = all.filter((entry) => entry.event === 'RUN_FINISHED');
    expect(results).toHaveLength(2);
    expect(results[0].runId).not.toBe(results[1].runId);
    expect(results[0]).toMatchObject({ status: 'SUCCESS', saved: true, counts: { NEW: 3, CHANGED: 0, UNCHANGED: 0 } });
    expect(results[1]).toMatchObject({ status: 'SUCCESS', saved: true, counts: { NEW: 0, CHANGED: 0, UNCHANGED: 3 } });
    expect(all.filter((entry) => entry.event === 'PAGE_ATTEMPT').map((entry) => entry.pageNum)).toEqual([1, 2, 1, 2]);
    expect(JSON.stringify(all)).not.toContain(environment.YOUTH_CENTER_API_KEY);
    expect(await dataSource.getRepository(Policy).count()).toBe(3);
    await expect(lock.runWithLock(async () => true)).resolves.toEqual({ status: 'COMPLETED', value: true });
  });

  it.each(['API', 'TRANSFORMATION', 'HASH', 'DATABASE'] as const)('%s 실패 후 기존 DB·실패 로그·잠금 해제를 확인한다', async (stage) => {
    const table = dataSource.getRepository(Policy);
    await table.save({ source: 'youthcenter', externalId: 'outside', title: '기존 정책', rawJson: {}, contentHash: 'a'.repeat(64) });
    const before = await table.find();
    if (stage === 'API') {
      fetchMock.mockImplementation(async (input) => {
        const number = Number(new URL(String(input)).searchParams.get('pageNum'));
        return number === 2 ? Response.json({}, { status: 403 }) : Response.json(page(number));
      });
    } else if (stage === 'TRANSFORMATION') {
      fetchMock.mockImplementation(async (input) => {
        const response = page(Number(new URL(String(input)).searchParams.get('pageNum')));
        return Response.json({ ...response, result: { ...response.result, youthPolicyList: response.result.youthPolicyList.map((policy) => ({ ...policy, sprtTrgtMinAge: '잘못된 나이' })) } });
      });
    } else if (stage === 'HASH') {
      jest.spyOn(service, 'collectPolicies').mockResolvedValueOnce([{ plcyNo: 'invalid', plcyNm: '검증', extra: undefined }]);
    } else {
      const upsert = repository.upsertPolicies.bind(repository);
      let batch = 0;
      jest.spyOn(repository, 'upsertPolicies').mockImplementation(async (manager, policies) => {
        batch += 1;
        await upsert(manager, batch === 2 ? policies.map((policy) => ({ ...policy, category: 'x'.repeat(101) })) : policies);
      });
    }
    await expect(service.importPolicies()).rejects.toBeInstanceOf(Error);
    expect((await records()).at(-1)).toMatchObject({ event: 'RUN_FINISHED', status: 'FAILED', saved: false, failures: [expect.objectContaining({ stage })] });
    expect(await table.find()).toEqual(before);
    await expect(lock.runWithLock(async () => true)).resolves.toEqual({ status: 'COMPLETED', value: true });
  });

  it('API·DB 재시도 횟수와 이전 실패 원인을 기록하고 성공 건수는 한 번만 센다', async () => {
    let requests = 0;
    fetchMock.mockImplementation(async (input) => {
      requests += 1;
      return requests === 1 ? Response.json({}, { status: 503, headers: { 'Retry-After': '0' } })
        : Response.json(page(Number(new URL(String(input)).searchParams.get('pageNum'))));
    });
    const upsert = repository.upsertPolicies.bind(repository);
    let first = true;
    jest.spyOn(repository, 'upsertPolicies').mockImplementation(async (manager, policies) => {
      if (first) {
        first = false;
        await manager.sql`DO $$ BEGIN RAISE EXCEPTION '검증용 충돌' USING ERRCODE = '40P01'; END; $$`;
      }
      await upsert(manager, policies);
    });
    await expect(service.importPolicies()).resolves.toMatchObject({ value: { NEW: 3, CHANGED: 0, UNCHANGED: 0 } });
    const all = await records();
    expect(all.filter((entry) => entry.event === 'PAGE_ATTEMPT').map((entry) => [entry.pageNum, entry.attempts])).toEqual([[1, 1], [1, 2], [2, 1]]);
    expect(all.find((entry) => entry.event === 'PAGE_ATTEMPT' && entry.attempts === 2)?.failures)
      .toMatchObject([{ stage: 'API', reason: 'HTTP', httpStatus: 503, attempts: 1 }]);
    expect(all.filter((entry) => entry.event === 'SAVE_ATTEMPT').map((entry) => entry.saveAttempts)).toEqual([1, 2]);
    expect(all.find((entry) => entry.event === 'SAVE_ATTEMPT' && entry.saveAttempts === 2)?.failures)
      .toMatchObject([{ stage: 'DATABASE', code: '40P01' }]);
    expect(all.at(-1)).toMatchObject({ status: 'SUCCESS', saved: true, saveAttempts: 2, counts: { NEW: 3 } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await dataSource.getRepository(Policy).count()).toBe(3);
  });

  it('파일 기록이 불가능해도 기본 로그에 결과를 남기고 잠금을 해제한다', async () => {
    const blocked = join(directory, 'blocked');
    await writeFile(blocked, '폴더 대신 파일');
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    service = new IngestionService(new YouthCenterClient(environment), lock, writer, new IngestionLogService(environment, blocked));
    await expect(service.importPolicies()).resolves.toMatchObject({ status: 'COMPLETED' });
    const lines = warn.mock.calls.map(([line]) => String(line));
    expect(lines.every((line) => line.startsWith('FILE_LOG_FAILED '))).toBe(true);
    expect(lines.join('')).not.toContain(environment.YOUTH_CENTER_API_KEY);
    expect(JSON.parse(lines.at(-1)!.slice('FILE_LOG_FAILED '.length))).toMatchObject({ event: 'RUN_FINISHED', status: 'SUCCESS', saved: true, counts: { NEW: 3 } });
    await expect(lock.runWithLock(async () => true)).resolves.toEqual({ status: 'COMPLETED', value: true });
  });

  it.each(['PAGE_ATTEMPT', 'SAVE_ATTEMPT', 'WORK_FINISHED', 'RUN_FINISHED'] as const)('%s에서 파일·기본 로그가 모두 실패해도 DB 잠금은 남지 않는다', async (event) => {
    const blocked = join(directory, 'blocked');
    await writeFile(blocked, '폴더 대신 파일');
    const failedLog = new IngestionLogService(environment, blocked);
    const write = log.write.bind(log);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => { throw new Error(environment.YOUTH_CENTER_API_KEY); });
    jest.spyOn(log, 'write').mockImplementation((entry) => entry.event === event ? failedLog.write(entry) : write(entry));
    await expect(service.importPolicies()).rejects.toBeInstanceOf(Error);
    expect(await dataSource.getRepository(Policy).count()).toBe(['WORK_FINISHED', 'RUN_FINISHED'].includes(event) ? 3 : 0);
    await expect(lock.runWithLock(async () => true)).resolves.toEqual({ status: 'COMPLETED', value: true });
  });

  it('저장 뒤 잠금 해제가 실패하면 저장 완료와 정리 실패를 구분해서 기록한다', async () => {
    const runner = dataSource.createQueryRunner();
    const query = runner.query.bind(runner);
    jest.spyOn(runner, 'query').mockImplementation(async (
      sql: string, parameters?: Parameters<typeof runner.query>[1], structured = false,
    ) => {
      if (sql.includes('pg_advisory_unlock')) throw new Error('원본 DB 정보');
      return structured ? query(sql, parameters, true) : query(sql, parameters);
    });
    jest.spyOn(dataSource, 'createQueryRunner').mockReturnValueOnce(runner);
    const release = jest.spyOn(runner, 'release');
    await expect(service.importPolicies()).rejects.toMatchObject({ reason: 'UNLOCK_FAILED' });
    expect((await records()).at(-1)).toMatchObject({
      status: 'FAILED', saved: true, counts: { NEW: 3 }, failures: [{ stage: 'LOCK_RELEASE', reason: 'UNLOCK_FAILED' }],
    });
    expect(release).toHaveBeenCalledTimes(1);
    await expect(lock.runWithLock(async () => true)).resolves.toEqual({ status: 'COMPLETED', value: true });
  });

  it('중복 실행은 파일에 남기고 API·저장을 시작하지 않는다', async () => {
    await lock.runWithLock(async () => {
      await expect(service.importPolicies()).resolves.toEqual({ status: 'ALREADY_RUNNING' });
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await records()).at(-1)).toMatchObject({ status: 'ALREADY_RUNNING', saved: false, saveAttempts: 0 });
    expect(await dataSource.getRepository(Policy).count()).toBe(0);
  });
});
