import { SourcePolicy } from '../src/modules/policies/entities/source-policy.entity';
import { PolicyReview } from '../src/modules/policies/entities/policy-review.entity';
import { CreatePolicyReviewTables1793199600000 } from '../src/database/migrations/1793199600000-create-policy-review-tables';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource, QueryRunner } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import { createDataSource } from '../src/database/data-source';
import { CreatePolicies1792162800000 } from '../src/database/migrations/1792162800000-create-policies';
import { IngestionLockService } from '../src/modules/ingestion/services/ingestion-lock.service';
import { IngestionLogService } from '../src/modules/ingestion/services/ingestion-log.service';
import type { IngestionLogEntry } from '../src/modules/ingestion/services/ingestion-log.service';
import { IngestionService } from '../src/modules/ingestion/services/ingestion.service';
import { YouthCenterClient } from '../src/modules/ingestion/youth-center/youth-center.client';
import type { YouthCenterRawPolicy } from '../src/modules/ingestion/youth-center/youth-center-response.schema';
import * as hashing from '../src/modules/ingestion/youth-center/youth-center-policy.hash';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { PolicyCollectionWriteService } from '../src/modules/policies/services/collection/policy-collection-write.service';
import { createCollectionWriter, clearPolicyTables, seedMigratedPolicies } from './helpers/policy-collection';
import { PolicyRepository } from '../src/modules/policies/repositories/policy.repository';

describe('수집 중간 실패와 전체 롤백의 실제 PostgreSQL 검증', () => {
  const schema = `step27_test_${randomUUID().replaceAll('-', '')}`;
  const environment = { ...loadEnvironment(), YOUTH_CENTER_API_KEY: 'step27-test-key', YOUTH_CENTER_PAGE_SIZE: 2, YOUTH_CENTER_REQUEST_DELAY_MS: 0 };
  let admin: DataSource;
  let dataSource: DataSource;
  let schemaCreated = false;
  let directory: string;
  let raw: YouthCenterRawPolicy[];
  let lock: IngestionLockService;
  let repository: PolicyRepository;
  let service: IngestionService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let save: jest.SpiedFunction<PolicyCollectionWriteService['saveCollection']>;

  /** 조회용 연결에서 기존 행과 시각을 읽어 실패 전후를 비교한다. */
  async function rows() {
    return { policies: await dataSource.getRepository(Policy).find({ order: { externalId: 'ASC' } }),
      sources: await dataSource.getRepository(SourcePolicy).find({ order: { externalId: 'ASC' } }),
      reviews: await dataSource.getRepository(PolicyReview).find({ order: { id: 'ASC' } }) };
  }

  /** 요청한 페이지에 맞는 정상 HTTP 응답을 만든다. 외부 API는 호출하지 않는다. */
  function response(input: Parameters<typeof fetch>[0]): Response {
    const url = new URL(String(input));
    const pageNum = Number(url.searchParams.get('pageNum'));
    const pageSize = Number(url.searchParams.get('pageSize'));
    return Response.json({ resultCode: 200, resultMessage: '성공', result: {
      pagging: { totCount: raw.length, pageNum, pageSize },
      youthPolicyList: raw.slice((pageNum - 1) * pageSize, pageNum * pageSize),
    } });
  }

  /** 실패 결과·미확정 건수·DB 보존·잠금 재획득을 함께 확인한다. */
  async function expectPreserved(before: Awaited<ReturnType<typeof rows>>, stage: string): Promise<IngestionLogEntry> {
    expect(await rows()).toEqual(before);
    const logs: IngestionLogEntry[] = (await readFile(join(directory, 'policies-import.jsonl'), 'utf8'))
      .trimEnd().split('\n').map((line) => JSON.parse(line));
    const final = logs.at(-1)!;
    expect(final).toMatchObject({ event: 'RUN_FINISHED', status: 'FAILED', saved: false,
      counts: { NEW: 0, CHANGED: 0, UNCHANGED: 0 }, failures: expect.arrayContaining([expect.objectContaining({ stage })]) });
    await expect(lock.runWithLock(async () => true)).resolves.toEqual({ status: 'COMPLETED', value: true });
    return final;
  }

  beforeAll(async () => {
    // 실제 개발 테이블과 분리된 검증 스키마에서만 실패·제약조건을 재현한다.
    admin = createDataSource(environment).setOptions({ entities: [], migrations: [] });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    dataSource = createDataSource(environment).setOptions({ schema, entities: [Policy, SourcePolicy, PolicyReview], migrations: [CreatePolicies1792162800000, CreatePolicyReviewTables1793199600000],
      extra: { options: `-c timezone=${environment.TZ} -c search_path=${schema}` } });
    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  beforeEach(async () => {
    const table = dataSource.getRepository(Policy);
    await clearPolicyTables(dataSource);
    await seedMigratedPolicies(dataSource, [
      { plcyNo: 'policy-0', plcyNm: '이전 제목' },
      { plcyNo: 'outside', plcyNm: '수집 밖의 기존 정책' },
    ]);
    directory = await mkdtemp(join(tmpdir(), 'ingestion-failure-'));
    raw = Array.from({ length: 3 }, (_, index) => ({ plcyNo: `policy-${index}`, plcyNm: `변경 제목 ${index}`, inqCnt: '20' }));
    lock = new IngestionLockService(dataSource);
    repository = new PolicyRepository();
    const writer = createCollectionWriter({ ...environment, POLICY_IMPORT_BATCH_SIZE: 200 }, repository);
    save = jest.spyOn(writer, 'saveCollection');
    service = new IngestionService(new YouthCenterClient(environment), lock, writer, new IngestionLogService(environment, directory));
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => response(input));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  afterAll(async () => {
    try { if (dataSource?.isInitialized) await dataSource.destroy(); }
    finally {
      try { if (schemaCreated && admin?.isInitialized) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
      finally { if (admin?.isInitialized) await admin.destroy(); }
    }
  });

  it('T-18: 중간 페이지 타임아웃은 그 페이지만 재시도하고 전체 검증 후 저장한다', async () => {
    let failed = false;
    fetchMock.mockImplementation(async (input) => {
      if (!failed && new URL(String(input)).searchParams.get('pageNum') === '2') {
        failed = true;
        throw new DOMException('모의 타임아웃', 'TimeoutError');
      }
      return response(input);
    });
    await expect(service.importPolicies()).resolves.toMatchObject({ status: 'COMPLETED', value: { counts: { NEW: 2, CHANGED: 1, UNCHANGED: 0, MISSING: 1 } } });
    expect(fetchMock.mock.calls.map(([input]) => Number(new URL(String(input)).searchParams.get('pageNum')))).toEqual([1, 2, 2]);
    expect(save).toHaveBeenCalledTimes(1);
    const logs = (await readFile(join(directory, 'policies-import.jsonl'), 'utf8')).trimEnd().split('\n').map((line) => JSON.parse(line));
    expect(logs.find((entry) => entry.pageNum === 2 && entry.attempts === 2)).toMatchObject({ failures: [{ stage: 'API', reason: 'TIMEOUT', pageNum: 2, attempts: 1 }] });
    expect(await dataSource.getRepository(SourcePolicy).count()).toBe(4);
  });

  it.each(['e003', 429, 503] as const)('T-18a: 중간 페이지 %s 최종 실패는 저장하지 않고 원인·횟수를 남긴다', async (failure) => {
    const before = await rows();
    fetchMock.mockImplementation(async (input) => {
      if (new URL(String(input)).searchParams.get('pageNum') === '1') return response(input);
      return failure === 'e003' ? Response.json({ errorCode: 'e003' })
        : Response.json({}, { status: failure, headers: { 'Retry-After': '0' } });
    });
    await expect(service.importPolicies()).rejects.toMatchObject({ pageNum: 2, attempts: failure === 'e003' ? 1 : 3 });
    expect(fetchMock).toHaveBeenCalledTimes(failure === 'e003' ? 2 : 4);
    expect(save).not.toHaveBeenCalled();
    const final = await expectPreserved(before, 'API');
    expect(final.failures).toEqual([expect.objectContaining({ pageNum: 2, attempts: failure === 'e003' ? 1 : 3,
      reason: failure === 'e003' ? 'NON_RETRYABLE_E003' : 'RETRY_EXHAUSTED_HTTP' })]);
  });

  it('T-19: 다음 페이지에 같은 정책 ID가 나오면 부분 수집 결과를 저장하지 않는다', async () => {
    const before = await rows();
    raw[2] = { ...raw[2], plcyNo: raw[0].plcyNo };
    await expect(service.importPolicies()).rejects.toMatchObject({ pageNum: 2 });
    expect(save).not.toHaveBeenCalled();
    await expectPreserved(before, 'PAGE_VALIDATION');
  });

  it.each(['TRANSFORMATION', 'HASH'] as const)('T-27b: %s 실패는 전체 수집 후라도 DB 저장 전에 종료한다', async (stage) => {
    const before = await rows();
    if (stage === 'TRANSFORMATION') raw[2] = { ...raw[2], sprtTrgtMinAge: '잘못된 나이' };
    else {
      const hash = hashing.createYouthCenterPolicyContentHash;
      jest.spyOn(hashing, 'createYouthCenterPolicyContentHash').mockImplementation((policy) => {
        if (policy.plcyNo === 'policy-2') throw new hashing.YouthCenterPolicyHashError(policy.plcyNo, '$', 'HASH_FAILED');
        return hash(policy);
      });
    }
    await expect(service.importPolicies()).rejects.toMatchObject({ stage });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
    await expectPreserved(before, stage);
  });

  it('T-27: 2,000번째 정책의 실제 CHECK 위반은 앞선 9개 묶음과 기존 정책 변경을 모두 롤백한다', async () => {
    const before = await rows();
    raw = Array.from({ length: 2000 }, (_, index) => ({ plcyNo: index === 0 ? 'policy-0' : `policy-${String(index).padStart(4, '0')}`, plcyNm: index === 1999 ? 'DB 제약 오류' : `새 제목 ${index}` }));
    const originalCreate = dataSource.createQueryRunner.bind(dataSource);
    const completedBatches: number[] = [];
    let writes = 0;
    jest.spyOn(dataSource, 'createQueryRunner').mockImplementation((mode) => {
      const runner = originalCreate(mode);
      const query = runner.query.bind(runner);
      jest.spyOn(runner, 'query').mockImplementation(async (sql: string, parameters?: Parameters<QueryRunner['query']>[1], structured = false) => {
        const isSource = sql.includes('INSERT INTO') && sql.includes('source_policies');
        if (isSource) writes += 1;
        const result = structured ? await query(sql, parameters, true) : await query(sql, parameters);
        if (isSource && Array.isArray(parameters)) completedBatches.push(JSON.parse(parameters[2]).length);
        return result;
      });
      return runner;
    });
    // 정상 변환 가능한 자료가 DB에서만 실패하도록 테스트 테이블에만 제약을 추가한다.
    await dataSource.query(`ALTER TABLE "${schema}".source_policies ADD CONSTRAINT step27_title_check CHECK (title <> 'DB 제약 오류')`);
    try {
      await expect(service.importPolicies()).rejects.toMatchObject({ driverError: { code: '23514' } });
      expect(completedBatches).toEqual(Array(9).fill(200));
      expect(writes).toBe(10);
      expect(fetchMock).toHaveBeenCalledTimes(1000);
      expect(save).toHaveBeenCalledTimes(1);
      const final = await expectPreserved(before, 'DATABASE');
      expect(final.saveAttempts).toBe(1);
      expect(final.failures).toEqual([{ stage: 'DATABASE', reason: 'QUERY_FAILED', code: '23514' }]);
    } finally {
      await dataSource.query(`ALTER TABLE "${schema}".source_policies DROP CONSTRAINT step27_title_check`);
    }
  });

  it('T-27d: 첫 묶음 저장 뒤 실제 연결이 끊기면 새 연결로 재시도하지 않고 롤백된다', async () => {
    const before = await rows();
    const originalCreate = dataSource.createQueryRunner.bind(dataSource);
    const runners: QueryRunner[] = [];
    let closed = false;
    const create = originalCreate;
    jest.spyOn(dataSource, 'createQueryRunner').mockImplementation((mode) => {
      const runner = create(mode);
      runners.push(runner);
      const query = runner.query.bind(runner);
      jest.spyOn(runner, 'query').mockImplementation(async (sql: string, parameters?: Parameters<QueryRunner['query']>[1], structured = false) => {
        const result = structured ? await query(sql, parameters, true) : await query(sql, parameters);
        if (!closed && sql.includes('INSERT INTO') && sql.includes('source_policies')) {
          closed = true;
          const connection: { end(): Promise<void> } = await runner.connect();
          await connection.end();
        }
        return result;
      });
      return runner;
    });
    await expect(service.importPolicies()).rejects.toBeInstanceOf(Error);
    expect(save).toHaveBeenCalledTimes(1);
    expect(runners).toHaveLength(1);
    expect(runners[0].isReleased).toBe(true);
    await expectPreserved(before, 'DATABASE');
  });
});
