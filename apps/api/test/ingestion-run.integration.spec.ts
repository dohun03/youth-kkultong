import { SourcePolicy } from '../src/modules/policies/entities/source-policy.entity';
import { PolicyReview } from '../src/modules/policies/entities/policy-review.entity';
import { CreatePolicyReviewTables1793199600000 } from '../src/database/migrations/1793199600000-create-policy-review-tables';
import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { DataSource, QueryRunner } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import { createDataSource } from '../src/database/data-source';
import { CreatePolicies1792162800000 } from '../src/database/migrations/1792162800000-create-policies';
import { IngestionLockService } from '../src/modules/ingestion/services/ingestion-lock.service';
import { IngestionLogService } from '../src/modules/ingestion/services/ingestion-log.service';
import type { IngestionLogEntry } from '../src/modules/ingestion/services/ingestion-log.service';
import { IngestionService } from '../src/modules/ingestion/services/ingestion.service';
import { YouthCenterClient } from '../src/modules/ingestion/youth-center/youth-center.client';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { PolicyCollectionWriteService } from '../src/modules/policies/services/collection/policy-collection-write.service';
import { createCollectionWriter, clearPolicyTables, seedMigratedPolicies } from './helpers/policy-collection';
import { PolicyRepository } from '../src/modules/policies/repositories/policy.repository';

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
  let writer: PolicyCollectionWriteService;
  let service: IngestionService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let schemaCreated = false;

  /** 임시 파일에 기록된 JSON 행 목록 읽기 */
  async function records(): Promise<IngestionLogEntry[]> {
    return (await readFile(join(directory, 'policies-import.jsonl'), 'utf8')).trimEnd().split('\n').map((line) => JSON.parse(line));
  }

  /** 별도 연결에서 확정된 원본과 검수, 공개 정책의 전체 행을 정렬 조회 */
  async function state() {
    return {
      sources: await dataSource.getRepository(SourcePolicy).find({ order: { externalId: 'ASC' } }),
      reviews: await dataSource.getRepository(PolicyReview).find({ order: { id: 'ASC' } }),
      policies: await dataSource.getRepository(Policy).find({ order: { externalId: 'ASC' } }),
    };
  }

  /** 이번 테스트가 확보한 수집 전용 세션만 서버에서 종료하고 클라이언트 통지를 확인 */
  async function disconnect(runner: QueryRunner): Promise<void> {
    const connection: EventEmitter = await runner.connect();
    const [{ pid }] = await runner.query('SELECT pg_backend_pid() AS pid');
    await new Promise<void>((resolve, reject) => {
      const onError = () => { cleanup(); resolve(); };
      const cleanup = () => { clearTimeout(timer); connection.off('error', onError); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('DB 세션 종료 통지가 도착하지 않았습니다.')); }, 5000);
      connection.once('error', onError);
      void admin.query('SELECT pg_terminate_backend($1) AS terminated', [pid])
        .then(([row]) => { if (row.terminated !== true) throw new Error('테스트 DB 세션을 종료하지 못했습니다.'); })
        .catch((error: unknown) => { cleanup(); reject(error); });
    });
  }

  beforeAll(async () => {
    admin = createDataSource(environment).setOptions({ entities: [], migrations: [] });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    dataSource = createDataSource(environment).setOptions({
      schema, entities: [Policy, SourcePolicy, PolicyReview], migrations: [CreatePolicies1792162800000, CreatePolicyReviewTables1793199600000],
      extra: { options: `-c timezone=${environment.TZ} -c search_path=${schema}` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  beforeEach(async () => {
    await clearPolicyTables(dataSource);
    directory = await mkdtemp(join(tmpdir(), 'ingestion-run-'));
    lock = new IngestionLockService(dataSource);
    log = new IngestionLogService(environment, directory);
    repository = new PolicyRepository();
    writer = createCollectionWriter({ ...environment, POLICY_IMPORT_BATCH_SIZE: 2 }, repository);
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
    await expect(service.importPolicies()).resolves.toMatchObject({ status: 'COMPLETED', value: { counts: { NEW: 3, CHANGED: 0, UNCHANGED: 0 } } });
    await expect(service.importPolicies()).resolves.toMatchObject({ status: 'COMPLETED', value: { counts: { NEW: 0, CHANGED: 0, UNCHANGED: 3 } } });
    const all = await records();
    const results = all.filter((entry) => entry.event === 'RUN_FINISHED');
    expect(results).toHaveLength(2);
    expect(results[0].runId).not.toBe(results[1].runId);
    expect(results[0]).toMatchObject({ status: 'SUCCESS', saved: true, counts: { NEW: 3, CHANGED: 0, UNCHANGED: 0 } });
    expect(results[1]).toMatchObject({ status: 'SUCCESS', saved: true, counts: { NEW: 0, CHANGED: 0, UNCHANGED: 3 } });
    expect(all.filter((entry) => entry.event === 'PAGE_ATTEMPT').map((entry) => entry.pageNum)).toEqual([1, 2, 1, 2]);
    expect(JSON.stringify(all)).not.toContain(environment.YOUTH_CENTER_API_KEY);
    expect(await dataSource.getRepository(SourcePolicy).count()).toBe(3);
    await expect(lock.runWithLock(async () => true)).resolves.toEqual({ status: 'COMPLETED', value: true });
  });

  it.each(['API', 'TRANSFORMATION', 'HASH', 'DATABASE'] as const)('%s 실패 후 기존 DB·실패 로그·잠금 해제를 확인한다', async (stage) => {
    const table = dataSource.getRepository(Policy);
    await seedMigratedPolicies(dataSource, [{ plcyNo: 'outside', plcyNm: '기존 정책' }]);
    const before = await table.find();
    const sourceBefore = await dataSource.getRepository(SourcePolicy).find();
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
      const sourceWriter = writer['sources'];
    const upsert = sourceWriter.upsertCollectedPolicies.bind(sourceWriter);
      let batch = 0;
      jest.spyOn(sourceWriter, 'upsertCollectedPolicies').mockImplementation(async (manager, policies, collectedAt) => {
        batch += 1;
        await upsert(manager, policies.map((policy, index) => index === 2 ? { ...policy, viewCount: -1 } : policy), collectedAt);
      });
    }
    await expect(service.importPolicies()).rejects.toBeInstanceOf(Error);
    expect((await records()).at(-1)).toMatchObject({ event: 'RUN_FINISHED', status: 'FAILED', saved: false, failures: [expect.objectContaining({ stage })] });
    expect(await table.find()).toEqual(before);
    expect(await dataSource.getRepository(SourcePolicy).find()).toEqual(sourceBefore);
    expect(await dataSource.getRepository(PolicyReview).count()).toBe(0);
    await expect(lock.runWithLock(async () => true)).resolves.toEqual({ status: 'COMPLETED', value: true });
  });

  it('API·DB 재시도 횟수와 이전 실패 원인을 기록하고 성공 건수는 한 번만 센다', async () => {
    let requests = 0;
    fetchMock.mockImplementation(async (input) => {
      requests += 1;
      return requests === 1 ? Response.json({}, { status: 503, headers: { 'Retry-After': '0' } })
        : Response.json(page(Number(new URL(String(input)).searchParams.get('pageNum'))));
    });
    const sourceWriter = writer['sources'];
    const upsert = sourceWriter.upsertCollectedPolicies.bind(sourceWriter);
    let first = true;
    jest.spyOn(sourceWriter, 'upsertCollectedPolicies').mockImplementation(async (manager, policies, collectedAt) => {
      if (first) {
        first = false;
        await manager.sql`DO $$ BEGIN RAISE EXCEPTION '검증용 충돌' USING ERRCODE = '40P01'; END; $$`;
      }
      await upsert(manager, policies, collectedAt);
    });
    await expect(service.importPolicies()).resolves.toMatchObject({ value: { counts: { NEW: 3, CHANGED: 0, UNCHANGED: 0 } } });
    const all = await records();
    expect(all.filter((entry) => entry.event === 'PAGE_ATTEMPT').map((entry) => [entry.pageNum, entry.attempts])).toEqual([[1, 1], [1, 2], [2, 1]]);
    expect(all.find((entry) => entry.event === 'PAGE_ATTEMPT' && entry.attempts === 2)?.failures)
      .toMatchObject([{ stage: 'API', reason: 'HTTP', httpStatus: 503, attempts: 1 }]);
    expect(all.filter((entry) => entry.event === 'SAVE_ATTEMPT').map((entry) => entry.saveAttempts)).toEqual([1, 2]);
    expect(all.find((entry) => entry.event === 'SAVE_ATTEMPT' && entry.saveAttempts === 2)?.failures)
      .toMatchObject([{ stage: 'DATABASE', code: '40P01' }]);
    expect(all.at(-1)).toMatchObject({ status: 'SUCCESS', saved: true, saveAttempts: 2, counts: { NEW: 3 } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await dataSource.getRepository(SourcePolicy).count()).toBe(3);
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
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => { throw new Error(environment.YOUTH_CENTER_API_KEY); });
    const attempted: IngestionLogEntry[] = [];
    const writes = jest.spyOn(log, 'write').mockImplementation((entry) => {
      attempted.push(structuredClone(entry));
      return entry.event === event ? failedLog.write(entry) : write(entry);
    });
    const runner = dataSource.createQueryRunner();
    jest.spyOn(dataSource, 'createQueryRunner').mockReturnValueOnce(runner);
    const starts = jest.spyOn(runner, 'startTransaction');
    const commits = jest.spyOn(runner, 'commitTransaction');
    const release = jest.spyOn(runner, 'release');
    const committed = ['WORK_FINISHED', 'RUN_FINISHED'].includes(event);
    await expect(service.importPolicies()).rejects.toBeInstanceOf(Error);
    expect(attempted.at(-1)).toMatchObject({ event: 'RUN_FINISHED', saved: committed,
      commitOutcome: committed ? 'COMMITTED' : 'NOT_COMMITTED',
      counts: { NEW: committed ? 3 : 0, CHANGED: 0, UNCHANGED: 0 },
      missingCount: 0, reviewCreatedCount: committed ? 3 : 0, reviewSupersededCount: 0, publicViewUpdatedCount: 0,
    });
    expect(starts).toHaveBeenCalledTimes(committed ? 1 : 0);
    expect(commits).toHaveBeenCalledTimes(committed ? 1 : 0);
    expect(release).toHaveBeenCalledTimes(1);
    expect(runner.isReleased).toBe(true);
    const after = await state();
    expect(after.sources).toHaveLength(committed ? 3 : 0);
    expect(after.reviews).toHaveLength(committed ? 3 : 0);
    expect(after.policies).toEqual([]);
    await expect(lock.runWithLock(async () => true)).resolves.toEqual({ status: 'COMPLETED', value: true });
    writes.mockRestore();
    warn.mockRestore();
    await expect(service.importPolicies()).resolves.toMatchObject({ value: {
      counts: { NEW: committed ? 0 : 3, UNCHANGED: committed ? 3 : 0 }, reviewCreatedCount: committed ? 0 : 3,
    } });
    if (committed) expect((await state()).reviews).toEqual(after.reviews);
  });

  it.each(['DURING_SAVE', 'BEFORE_COMMIT', 'AFTER_COMMIT'] as const)('%s 실제 연결 종료 후 확정 여부와 정리 결과를 구분하고 다음 수집을 실행한다', async (stage) => {
    await seedMigratedPolicies(dataSource, [{ plcyNo: 'outside', plcyNm: '기존 정책' }]);
    const before = await state();
    const runner = dataSource.createQueryRunner();
    jest.spyOn(dataSource, 'createQueryRunner').mockReturnValueOnce(runner);
    const starts = jest.spyOn(runner, 'startTransaction');
    if (stage === 'DURING_SAVE') {
      const refresh = repository.refreshViewCounts.bind(repository);
      jest.spyOn(repository, 'refreshViewCounts').mockImplementationOnce(async (manager, values) => {
        await refresh(manager, values);
        await disconnect(runner);
        // 실제 연결을 잃은 저장 쿼리의 실패가 전체 저장 취소로 이어지는지 확인
        return manager.query('SELECT 1');
      });
    }
    const commit = runner.commitTransaction.bind(runner);
    const commits = jest.spyOn(runner, 'commitTransaction').mockImplementationOnce(async () => {
      // 모든 원본과 후보 저장이 끝난 시점에 실제 서버 세션 종료를 재현
      expect(await runner.manager.getRepository(PolicyReview).count()).toBe(3);
      if (stage === 'AFTER_COMMIT') await commit();
      await disconnect(runner);
      if (stage === 'BEFORE_COMMIT') await commit();
    });
    const release = jest.spyOn(runner, 'release');
    await expect(service.importPolicies()).rejects.toBeInstanceOf(Error);
    const committed = stage === 'AFTER_COMMIT';
    const unknown = stage === 'BEFORE_COMMIT';
    expect((await records()).at(-1)).toMatchObject({ status: 'FAILED', saved: unknown ? null : committed,
      commitOutcome: unknown ? 'UNKNOWN' : committed ? 'COMMITTED' : 'NOT_COMMITTED',
      counts: unknown ? null : { NEW: committed ? 3 : 0, CHANGED: 0, UNCHANGED: 0 },
      missingCount: unknown ? null : committed ? 1 : 0, reviewCreatedCount: unknown ? null : committed ? 3 : 0,
      reviewSupersededCount: unknown ? null : 0, publicViewUpdatedCount: unknown ? null : 0,
    });
    expect(starts).toHaveBeenCalledTimes(1);
    expect(commits).toHaveBeenCalledTimes(stage === 'DURING_SAVE' ? 0 : 1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(runner.isReleased).toBe(true);
    if (!committed) expect(await state()).toEqual(before);
    const reviews = (await state()).reviews;
    await expect(lock.runWithLock(async () => true)).resolves.toEqual({ status: 'COMPLETED', value: true });
    await expect(service.importPolicies()).resolves.toMatchObject({ value: {
      counts: { NEW: committed ? 0 : 3, UNCHANGED: committed ? 3 : 0, MISSING: 1 }, reviewCreatedCount: committed ? 0 : 3,
    } });
    if (committed) expect((await state()).reviews).toEqual(reviews);
    expect((await state()).sources.find(({ externalId }) => externalId === 'outside')?.missingCount).toBe(committed ? 2 : 1);
  });

  it.each([false, true])('실제 COMMIT 확정 %s의 응답 유실과 로그 이중 실패가 겹쳐도 결과 불명을 보존하고 저장을 반복하지 않는다', async (committed) => {
    const before = await state();
    const runner = dataSource.createQueryRunner();
    jest.spyOn(dataSource, 'createQueryRunner').mockReturnValueOnce(runner);
    const starts = jest.spyOn(runner, 'startTransaction');
    const commit = runner.commitTransaction.bind(runner);
    const commits = jest.spyOn(runner, 'commitTransaction').mockImplementationOnce(async () => {
      if (committed) await commit();
      // 서버의 실제 반영 여부와 무관하게 호출자는 COMMIT 성공 응답을 받지 못한 상황
      await disconnect(runner);
      throw new Error('검증용 COMMIT 응답 유실');
    });
    const blocked = join(directory, 'blocked');
    await writeFile(blocked, '폴더 대신 파일');
    const failedLog = new IngestionLogService(environment, blocked);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => { throw new Error('검증용 기본 로그 실패'); });
    const write = log.write.bind(log);
    let workLogFailed = false;
    const writes = jest.spyOn(log, 'write').mockImplementation((entry) => {
      if (entry.event === 'WORK_FINISHED' && !workLogFailed) {
        workLogFailed = true;
        return failedLog.write(entry);
      }
      return write(entry);
    });
    await expect(service.importPolicies()).rejects.toBeInstanceOf(AggregateError);
    expect((await records()).at(-1)).toMatchObject({ status: 'FAILED', saved: null, commitOutcome: 'UNKNOWN', counts: null,
      missingCount: null, reviewCreatedCount: null, reviewSupersededCount: null, publicViewUpdatedCount: null,
      failures: expect.arrayContaining([
        { stage: 'DATABASE', reason: 'COMMIT_OUTCOME_UNKNOWN' },
        { stage: 'LOG', reason: 'FILE_AND_FALLBACK_FAILED' },
        { stage: 'LOCK_RELEASE', reason: 'UNLOCK_FAILED' },
      ]),
    });
    expect(starts).toHaveBeenCalledTimes(1);
    expect(commits).toHaveBeenCalledTimes(1);
    expect(runner.isReleased).toBe(true);
    expect(workLogFailed).toBe(true);
    if (!committed) expect(await state()).toEqual(before);
    const reviews = (await state()).reviews;
    await expect(lock.runWithLock(async () => true)).resolves.toEqual({ status: 'COMPLETED', value: true });
    writes.mockRestore();
    warn.mockRestore();
    await expect(service.importPolicies()).resolves.toMatchObject({ value: {
      counts: { NEW: committed ? 0 : 3, UNCHANGED: committed ? 3 : 0 }, reviewCreatedCount: committed ? 0 : 3,
    } });
    if (committed) expect((await state()).reviews).toEqual(reviews);
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

  it('COMMIT 응답이 유실되면 저장을 반복하지 않고 결과 불명으로 기록하며 다음 실행은 실제 상태로 비교한다', async () => {
    const runner = dataSource.createQueryRunner();
    const commit = runner.commitTransaction.bind(runner);
    jest.spyOn(runner, 'commitTransaction').mockImplementationOnce(async () => {
      await commit();
      throw new Error('COMMIT 응답 유실');
    });
    jest.spyOn(dataSource, 'createQueryRunner').mockReturnValueOnce(runner);
    await expect(service.importPolicies()).rejects.toMatchObject({ name: 'PolicyCollectionCommitError' });
    expect((await records()).at(-1)).toMatchObject({ saved: null, counts: null, commitOutcome: 'UNKNOWN',
      missingCount: null, reviewCreatedCount: null, reviewSupersededCount: null, publicViewUpdatedCount: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(runner.isReleased).toBe(true);
    const pending = await dataSource.getRepository(PolicyReview).find({ order: { id: 'ASC' } });
    expect(pending).toHaveLength(3);
    expect(await dataSource.getRepository(Policy).count()).toBe(0);
    await expect(service.importPolicies()).resolves.toMatchObject({ value: {
      counts: { NEW: 0, CHANGED: 0, UNCHANGED: 3, MISSING: 0 }, reviewCreatedCount: 0,
    } });
    expect(await dataSource.getRepository(PolicyReview).find({ order: { id: 'ASC' } })).toEqual(pending);
  });
});
