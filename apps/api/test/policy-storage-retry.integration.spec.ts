import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { DataSource, QueryRunner } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import { createDataSource } from '../src/database/data-source';
import { CreatePolicies1792162800000 } from '../src/database/migrations/1792162800000-create-policies';
import { IngestionLockService } from '../src/modules/ingestion/services/ingestion-lock.service';
import { IngestionLogService } from '../src/modules/ingestion/services/ingestion-log.service';
import { IngestionService } from '../src/modules/ingestion/services/ingestion.service';
import { YouthCenterClient } from '../src/modules/ingestion/youth-center/youth-center.client';
import { createYouthCenterPolicyContentHash } from '../src/modules/ingestion/youth-center/youth-center-policy.hash';
import { transformYouthCenterPolicy } from '../src/modules/ingestion/youth-center/youth-center-policy.transform';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { PoliciesWriteService } from '../src/modules/policies/policies-write.service';
import type { PolicyWriteInput } from '../src/modules/policies/policies-write.service';
import { PolicyRepository } from '../src/modules/policies/policy.repository';

/** 원본 변환과 해시 계산을 마친 테스트 정책 생성 */
function candidate(id: string, title = '검증 정책', views = '10'): PolicyWriteInput {
  const raw = { plcyNo: id, plcyNm: title, inqCnt: views };
  return { ...transformYouthCenterPolicy(raw), contentHash: createYouthCenterPolicyContentHash(raw) };
}

describe('DB 충돌 재시도의 실제 PostgreSQL 검증', () => {
  const schema = `step23_test_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource;
  let dataSource: DataSource;
  let runner: QueryRunner;
  let repository: PolicyRepository;
  let service: PoliciesWriteService;
  let schemaCreated = false;

  beforeAll(async () => {
    const environment = loadEnvironment();
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
    runner = dataSource.createQueryRunner();
    await runner.connect();
    repository = new PolicyRepository();
    service = new PoliciesWriteService(repository, { ...loadEnvironment(), POLICY_IMPORT_BATCH_SIZE: 200 });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    try {
      if (runner?.isTransactionActive) await runner.rollbackTransaction();
    } finally {
      if (runner && !runner.isReleased) await runner.release();
    }
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

  it('실제 40001 충돌 후 재분류해 저장하고 API는 한 번만 호출하며 잠금·연결을 유지한다', async () => {
    await service.savePolicies(runner, [candidate('same')]);
    const environment = { ...loadEnvironment(), YOUTH_CENTER_API_KEY: 'retry-test', YOUTH_CENTER_REQUEST_DELAY_MS: 0 };
    const rawPolicies = [candidate('new').rawJson, candidate('same', '검증 정책', '20').rawJson];
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      resultCode: 200, resultMessage: '성공', result: {
        pagging: { totCount: 2, pageNum: 1, pageSize: environment.YOUTH_CENTER_PAGE_SIZE }, youthPolicyList: rawPolicies,
      },
    }));
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const collector = new IngestionService(
      new YouthCenterClient(environment), new IngestionLockService(dataSource), service, new IngestionLogService(environment),
    );
    const lock = new IngestionLockService(dataSource);
    const find = repository.findContentHashes.bind(repository);
    const refresh = repository.refreshPolicies.bind(repository);
    const pids: number[] = [];
    let conflict: unknown;

    jest.spyOn(repository, 'findContentHashes').mockImplementation(async (manager, keys) => {
      pids.push((await manager.sql`SELECT pg_backend_pid() AS pid`)[0].pid);
      await expect(lock.runWithLock(async () => '중복 실행')).resolves.toEqual({ status: 'ALREADY_RUNNING' });
      return find(manager, keys);
    });
    jest.spyOn(repository, 'refreshPolicies').mockImplementationOnce(async (manager, policies) => {
      // 첫 조회 뒤 다른 세션이 행을 바꿔 REPEATABLE READ의 실제 직렬화 충돌 발생
      await dataSource.getRepository(Policy).update({ externalId: 'same' }, { title: '경쟁 세션의 제목', contentHash: 'b'.repeat(64) });
      try {
        await refresh(manager, policies);
      } catch (error) {
        conflict = error;
        throw error;
      }
    });

    await expect(lock.runWithLock(async (lockedRunner) => {
      const start = lockedRunner.startTransaction.bind(lockedRunner);
      // 테스트에서만 격리 수준을 높여 두 세션의 충돌을 재현
      const starts = jest.spyOn(lockedRunner, 'startTransaction').mockImplementation(() => start('REPEATABLE READ'));
      const rollbacks = jest.spyOn(lockedRunner, 'rollbackTransaction');
      const raw = await collector.collectPolicies();
      const policies = raw.map((policy) => ({ ...transformYouthCenterPolicy(policy), contentHash: createYouthCenterPolicyContentHash(policy) }));
      const counts = await service.savePolicies(lockedRunner, policies);
      expect(starts).toHaveBeenCalledTimes(2);
      expect(rollbacks).toHaveBeenCalledTimes(1);
      expect(lockedRunner.isTransactionActive).toBe(false);
      return counts;
    })).resolves.toEqual({ status: 'COMPLETED', value: { NEW: 1, CHANGED: 1, UNCHANGED: 0 } });
    expect(conflict).toMatchObject({ driverError: { code: '40001' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pids).toHaveLength(2);
    expect(pids[1]).toBe(pids[0]);
    expect(await dataSource.getRepository(Policy).count()).toBe(2);
    expect(await dataSource.getRepository(Policy).findOneByOrFail({ externalId: 'same' }))
      .toMatchObject({ title: '검증 정책', viewCount: 20, contentHash: candidate('same').contentHash });
    await expect(lock.runWithLock(async () => true)).resolves.toEqual({ status: 'COMPLETED', value: true });
  });

  it('서로 반대 순서로 행을 잠근 실제 40P01 교착 상태에서도 전체 저장만 재시도한다', async () => {
    await service.savePolicies(runner, [candidate('a'), candidate('b')]);
    service = new PoliciesWriteService(repository, { ...loadEnvironment(), POLICY_IMPORT_BATCH_SIZE: 1 });
    const competitor = dataSource.createQueryRunner();
    let competitorWork: Promise<void> | undefined;
    let competitorError: unknown;
    let conflict: unknown;
    const upsert = repository.upsertPolicies.bind(repository);
    const start = runner.startTransaction.bind(runner);
    const starts = jest.spyOn(runner, 'startTransaction').mockImplementation(async () => {
      await start();
      await runner.manager.sql`SET LOCAL deadlock_timeout = '50ms'`;
    });
    let writes = 0;
    try {
      await competitor.connect();
      await competitor.startTransaction();
      await competitor.manager.sql`SET LOCAL deadlock_timeout = '5s'`;
      // 경쟁 세션은 B를 먼저 잠그고 저장 처리는 A→B 순서로 진행
      await competitor.manager.getRepository(Policy).update({ externalId: 'b' }, { title: '경쟁 세션의 B' });
      jest.spyOn(repository, 'upsertPolicies').mockImplementation(async (manager, policies) => {
        writes += 1;
        try {
          await upsert(manager, policies);
        } catch (error) {
          conflict = error;
          throw error;
        }
        if (writes === 1) {
          // 경쟁 세션도 A를 기다리게 해 A↔B 잠금 대기 고리 생성
          competitorWork = competitor.manager.getRepository(Policy).update({ externalId: 'a' }, { title: '경쟁 세션의 A' })
            .then(() => competitor.commitTransaction()).catch((error) => { competitorError = error; });
        }
      });
      const incoming = [candidate('a', '최종 A'), candidate('b', '최종 B')];
      await expect(service.savePolicies(runner, incoming)).resolves.toEqual({ NEW: 0, CHANGED: 2, UNCHANGED: 0 });
      await competitorWork;
      expect(competitorError).toBeUndefined();
      expect(conflict).toMatchObject({ driverError: { code: '40P01' } });
      expect(starts).toHaveBeenCalledTimes(2);
      expect(writes).toBe(4);
      expect((await dataSource.getRepository(Policy).find({ order: { externalId: 'ASC' } })).map((policy) => policy.title))
        .toEqual(['최종 A', '최종 B']);
    } finally {
      // 실패한 테스트도 다른 세션의 잠금과 연결을 남기지 않도록 정리
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await competitorWork;
      try {
        if (competitor.isTransactionActive) await competitor.rollbackTransaction();
      } finally {
        if (!competitor.isReleased) await competitor.release();
      }
    }
  });

  it('두 번째 시도도 DB 충돌이면 두 번 모두 롤백하고 기존 데이터를 유지한다', async () => {
    await service.savePolicies(runner, [candidate('outside')]);
    const table = dataSource.getRepository(Policy);
    const before = await table.find();
    const upsert = repository.upsertPolicies.bind(repository);
    let writes = 0;
    jest.spyOn(repository, 'upsertPolicies').mockImplementation(async (manager, policies) => {
      writes += 1;
      if (writes % 2 === 0) {
        // 실제 DB가 두 시도 모두 충돌 오류를 반환하도록 재현
        await manager.sql`DO $$ BEGIN RAISE EXCEPTION '검증용 충돌' USING ERRCODE = '40P01'; END; $$`;
      }
      await upsert(manager, policies);
    });
    const starts = jest.spyOn(runner, 'startTransaction');
    const rollbacks = jest.spyOn(runner, 'rollbackTransaction');
    const incoming = Array.from({ length: 201 }, (_, index) => candidate(`policy-${index}`));
    await expect(service.savePolicies(runner, incoming)).rejects.toMatchObject({ driverError: { code: '40P01' } });
    expect(starts).toHaveBeenCalledTimes(2);
    expect(rollbacks).toHaveBeenCalledTimes(2);
    expect(writes).toBe(4);
    expect(await table.find()).toEqual(before);
  });

  it('충돌 롤백 뒤 실제 연결이 닫히면 새 연결이나 두 번째 트랜잭션을 만들지 않는다', async () => {
    const connection: { end(): Promise<void> } = await runner.connect();
    const rollback = runner.rollbackTransaction.bind(runner);
    jest.spyOn(runner, 'rollbackTransaction').mockImplementationOnce(async () => {
      await rollback();
      await connection.end();
    });
    jest.spyOn(repository, 'upsertPolicies').mockImplementationOnce(async (manager) => {
      await manager.sql`DO $$ BEGIN RAISE EXCEPTION '검증용 충돌' USING ERRCODE = '40P01'; END; $$`;
    });
    const starts = jest.spyOn(runner, 'startTransaction');
    const createRunner = jest.spyOn(dataSource, 'createQueryRunner');
    await expect(service.savePolicies(runner, [candidate('policy')])).rejects.toBeInstanceOf(AggregateError);
    expect(starts).toHaveBeenCalledTimes(1);
    expect(createRunner).not.toHaveBeenCalled();
    expect(repository.upsertPolicies).toHaveBeenCalledTimes(1);
    expect(await dataSource.getRepository(Policy).count()).toBe(0);
  });
});
