import { SourcePolicy } from '../src/modules/policies/entities/source-policy.entity';
import { PolicyReview } from '../src/modules/policies/entities/policy-review.entity';
import { CreatePolicyReviewTables1793199600000 } from '../src/database/migrations/1793199600000-create-policy-review-tables';
import { createCollectionWriter, clearPolicyTables, seedMigratedPolicies } from './helpers/policy-collection';
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
import { PolicyCollectionWriteService } from '../src/modules/policies/services/policy-collection-write.service';
import type { PolicyWriteInput } from '../src/modules/policies/policy-write.types';
import { PolicyRepository } from '../src/modules/policies/repositories/policy.repository';

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
  let service: PolicyCollectionWriteService;
  let schemaCreated = false;

  /** 별도 연결에서 확정된 원본과 검수, 공개 정책의 전체 행을 정렬 조회 */
  async function state() {
    return {
      sources: await dataSource.getRepository(SourcePolicy).find({ order: { externalId: 'ASC' } }),
      reviews: await dataSource.getRepository(PolicyReview).find({ order: { id: 'ASC' } }),
      policies: await dataSource.getRepository(Policy).find({ order: { externalId: 'ASC' } }),
    };
  }

  beforeAll(async () => {
    const environment = loadEnvironment();
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
    runner = dataSource.createQueryRunner();
    await runner.connect();
    repository = new PolicyRepository();
    service = createCollectionWriter({ ...loadEnvironment(), POLICY_IMPORT_BATCH_SIZE: 200 }, repository);
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

  it('실제 40001 충돌 후 공개 기준을 다시 읽고 API는 한 번만 호출한다', async () => {
    await seedMigratedPolicies(dataSource, [{ plcyNo: 'same', plcyNm: '검증 정책', inqCnt: '10' }]);
    const environment = { ...loadEnvironment(), YOUTH_CENTER_API_KEY: 'retry-test', YOUTH_CENTER_REQUEST_DELAY_MS: 0 };
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ resultCode: 200, resultMessage: '성공', result: {
      pagging: { totCount: 2, pageNum: 1, pageSize: environment.YOUTH_CENTER_PAGE_SIZE },
      youthPolicyList: [candidate('new').rawJson, candidate('same', '검증 정책', '20').rawJson],
    } }));
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const lock = new IngestionLockService(dataSource);
    const collector = new IngestionService(new YouthCenterClient(environment), lock, service, new IngestionLogService(environment));
    const refresh = repository.refreshViewCounts.bind(repository);
    const read = repository.findPublicSnapshots.bind(repository);
    const pids: number[] = [];
    jest.spyOn(repository, 'findPublicSnapshots').mockImplementation(async (manager, keys) => {
      pids.push((await manager.sql`SELECT pg_backend_pid() AS pid`)[0].pid);
      await expect(lock.runWithLock(async () => true)).resolves.toEqual({ status: 'ALREADY_RUNNING' });
      return read(manager, keys);
    });
    let conflict: unknown;
    jest.spyOn(repository, 'refreshViewCounts').mockImplementationOnce(async (manager, values) => {
      // 테스트에서만 원본 잠금을 거치지 않는 공개 기준 변경을 재현
      await repository.upsertPolicies(dataSource.manager, [candidate('same', '경쟁 공개 C')]);
      try { return await refresh(manager, values); }
      catch (error) { conflict = error; throw error; }
    });
    await expect(lock.runWithLock(async (lockedRunner) => {
      const start = lockedRunner.startTransaction.bind(lockedRunner);
      // 테스트에서만 격리 수준을 높여 공개 행의 동시 갱신으로 실제 직렬화 충돌을 재현
      const starts = jest.spyOn(lockedRunner, 'startTransaction').mockImplementation(() => start('REPEATABLE READ'));
      const raw = await collector.collectPolicies();
      const values = raw.map((value) => ({ ...transformYouthCenterPolicy(value), contentHash: createYouthCenterPolicyContentHash(value) }));
      const result = await service.saveCollection(lockedRunner, 'youthcenter', values, new Date());
      expect(starts).toHaveBeenCalledTimes(2);
      return result;
    })).resolves.toMatchObject({ value: { counts: { NEW: 1, CHANGED: 0, UNCHANGED: 1 }, reviewCreatedCount: 2 } });
    expect(conflict).toMatchObject({ driverError: { code: '40001' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pids).toHaveLength(2);
    expect(pids[0]).toBe(pids[1]);
    const published = await dataSource.getRepository(Policy).findOneByOrFail({ externalId: 'same' });
    expect(published).toMatchObject({ title: '경쟁 공개 C', viewCount: 20 });
    expect(await dataSource.getRepository(PolicyReview).countBy({ baseContentHash: published.contentHash })).toBe(1);
  });

  it('반대 순서 원본 잠금의 실제 40P01 교착 후 최신 원본으로 판정과 후보를 다시 계산한다', async () => {
    await service.saveCollection(runner, 'youthcenter', [candidate('a'), candidate('b')], new Date());
    const competitor = dataSource.createQueryRunner();
    let work: Promise<void> | undefined;
    let competitorError: unknown;
    let conflict: unknown;
    const sourceWriter = service['sources'];
    const find = sourceWriter.findBySourceForUpdate.bind(sourceWriter);
    const start = runner.startTransaction.bind(runner);
    const starts = jest.spyOn(runner, 'startTransaction').mockImplementation(async (level) => {
      await start(level);
      await runner.query("SET LOCAL deadlock_timeout = '50ms'");
    });
    let reads = 0;
    const incoming = [candidate('a', '최종 A'), candidate('b', '최종 B')];
    /** 경쟁 연결에서 원본 내용과 해시를 함께 갱신 */
    const updateSource = (value: PolicyWriteInput): Promise<unknown> => competitor.query(
      'UPDATE source_policies SET title = $1, raw_json = $2::jsonb, content_hash = $3, view_count = $4 WHERE external_id = $5',
      [value.title, JSON.stringify(value.rawJson), value.contentHash, value.viewCount, value.externalId],
    );
    try {
      await competitor.connect();
      await competitor.startTransaction();
      await competitor.query("SET LOCAL deadlock_timeout = '5s'");
      await updateSource(incoming[1]);
      jest.spyOn(sourceWriter, 'findBySourceForUpdate').mockImplementation(async (manager, source) => {
        reads += 1;
        if (reads === 1) {
          await manager.getRepository(SourcePolicy).createQueryBuilder('original').where({ externalId: 'a' })
            .setLock('pessimistic_write').getMany();
          work = updateSource(incoming[0])
            .then(() => competitor.commitTransaction()).catch((error) => { competitorError = error; });
        }
        try { return await find(manager, source); }
        catch (error) { conflict = error; throw error; }
      });
      // 경쟁 연결이 같은 내용을 먼저 확정하므로 재시도 결과는 CHANGED 대신 UNCHANGED
      expect(await service.saveCollection(runner, 'youthcenter', incoming, new Date()))
        .toEqual({ counts: { NEW: 0, CHANGED: 0, UNCHANGED: 2, MISSING: 0 },
          reviewCreatedCount: 2, reviewSupersededCount: 2, publicViewUpdatedCount: 0 });
      await work;
      expect(competitorError).toBeUndefined();
      expect(conflict).toMatchObject({ driverError: { code: '40P01' } });
      expect(starts).toHaveBeenCalledTimes(2);
      expect(reads).toBe(3);
      expect((await dataSource.getRepository(SourcePolicy).find({ order: { externalId: 'ASC' } })).map(({ title }) => title))
        .toEqual(['최종 A', '최종 B']);
      expect(await dataSource.getRepository(PolicyReview).countBy({ status: 'SUPERSEDED', supersededReason: 'SOURCE_CHANGED' })).toBe(2);
      const pending = await dataSource.getRepository(PolicyReview).find({ where: { status: 'PENDING' } });
      expect(pending.map(({ contentHash }) => contentHash).sort()).toEqual(incoming.map(({ contentHash }) => contentHash).sort());
      expect(await dataSource.getRepository(Policy).count()).toBe(0);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await work;
      try { if (competitor.isTransactionActive) await competitor.rollbackTransaction(); }
      finally { if (!competitor.isReleased) await competitor.release(); }
    }
  });

  it.each(['PENDING', 'REJECTED'] as const)('실제 40001 취소 후 새 원본과 공개 기준, %s 이력을 다시 읽어 후보를 조정한다', async (status) => {
    await seedMigratedPolicies(dataSource, [
      { plcyNo: 'same', plcyNm: '검증 정책', inqCnt: '10' },
      { plcyNo: 'missing', plcyNm: '검증 정책', inqCnt: '10' },
    ]);
    const incoming = candidate('same', '수집 B', '99');
    const refresh = repository.refreshViewCounts.bind(repository);
    let conflict: unknown;
    // 별도 연결이 공개 기준을 갱신하면 첫 시도의 반복 읽기 스냅샷과 충돌
    jest.spyOn(repository, 'refreshViewCounts').mockImplementationOnce(async (manager, values) => {
      await repository.upsertPolicies(dataSource.manager, [candidate('same', '공개 C')]);
      try { return await refresh(manager, values); }
      catch (error) { conflict = error; throw error; }
    });
    const start = runner.startTransaction.bind(runner);
    const starts = jest.spyOn(runner, 'startTransaction').mockImplementation(() => start('REPEATABLE READ'));
    const rollbacks = jest.spyOn(runner, 'rollbackTransaction');
    const commits = jest.spyOn(runner, 'commitTransaction');
    const sourceReads = jest.spyOn(service['sources'], 'findBySourceForUpdate');
    const publicReads = jest.spyOn(repository, 'findPublicSnapshots');
    const pendingReads = jest.spyOn(service['reviews'], 'findPendingReviews');
    const rejectedReads = jest.spyOn(service['reviews'], 'findRejectedHashes');
    const collectedAt = new Date('2026-11-01T01:00:00Z');
    const competitorAt = new Date('2026-11-01T00:00:00Z');
    let competingReviews: PolicyReview[] = [];
    const attempts = jest.fn(async (attempt: number, previousError?: unknown) => {
      if (attempt !== 2) return;
      expect(previousError).toBe(conflict);
      expect(runner.isTransactionActive).toBe(false);
      // 첫 시도에서 쓴 원본과 후보 및 누락 횟수가 모두 취소된 상태를 확인
      expect(await dataSource.getRepository(SourcePolicy).findOneByOrFail({ externalId: 'same' }))
        .toMatchObject({ contentHash: candidate('same').contentHash, firstCollectedAt: null });
      expect(await dataSource.getRepository(SourcePolicy).findOneByOrFail({ externalId: 'missing' }))
        .toMatchObject({ missingCount: 0 });
      expect(await dataSource.getRepository(PolicyReview).count()).toBe(0);

      // 취소와 재시도 사이에 별도 연결로 최신 원본과 후보 이력을 확정
      const competitor = dataSource.createQueryRunner();
      try {
        await competitor.connect();
        await createCollectionWriter(loadEnvironment()).saveCollection(competitor, 'youthcenter', [incoming], competitorAt);
        if (status === 'REJECTED') {
          await dataSource.getRepository(PolicyReview).update({ status: 'PENDING' }, {
            status, reviewedBy: 'test-admin', rejectionReason: '재시도 전 거절', closedAt: competitorAt,
          });
        }
        competingReviews = await dataSource.getRepository(PolicyReview).find({ order: { id: 'ASC' } });
      } finally {
        try { if (competitor.isTransactionActive) await competitor.rollbackTransaction(); }
        finally { await competitor.release(); }
      }
    });
    expect(await service.saveCollection(runner, 'youthcenter', [incoming], collectedAt, attempts)).toEqual({
      counts: { NEW: 0, CHANGED: 0, UNCHANGED: 1, MISSING: 1 },
      reviewCreatedCount: 0, reviewSupersededCount: 0, publicViewUpdatedCount: 1,
    });
    expect(conflict).toMatchObject({ driverError: { code: '40001' } });
    expect(starts).toHaveBeenCalledTimes(2);
    expect(rollbacks).toHaveBeenCalledTimes(1);
    expect(commits).toHaveBeenCalledTimes(1);
    expect(attempts).toHaveBeenCalledTimes(2);
    expect(sourceReads).toHaveBeenCalledTimes(4);
    for (const read of [publicReads, pendingReads, rejectedReads]) expect(read).toHaveBeenCalledTimes(2);
    expect(await dataSource.getRepository(PolicyReview).find({ order: { id: 'ASC' } })).toEqual(competingReviews);
    expect(competingReviews).toEqual([expect.objectContaining({ status, contentHash: incoming.contentHash,
      baseContentHash: candidate('same', '공개 C').contentHash })]);
    expect(await dataSource.getRepository(SourcePolicy).findOneByOrFail({ externalId: 'same' }))
      .toMatchObject({ firstCollectedAt: competitorAt, lastCollectedAt: collectedAt, lastCollectionResult: 'UNCHANGED' });
    expect(await dataSource.getRepository(SourcePolicy).findOneByOrFail({ externalId: 'missing' }))
      .toMatchObject({ missingCount: 2 });
    expect(await dataSource.getRepository(Policy).findOneByOrFail({ externalId: 'same' }))
      .toMatchObject({ title: '공개 C', viewCount: 99, contentHash: candidate('same', '공개 C').contentHash });
  });

  it.each(['40P01', '40001'])('%s가 두 시도 모두 발생하면 원본과 후보, 공개 조회수를 모두 취소하고 멈춘다', async (code) => {
    await seedMigratedPolicies(dataSource, [
      { plcyNo: 'same', plcyNm: '검증 정책', inqCnt: '10' },
      { plcyNo: 'outside', plcyNm: '검증 정책', inqCnt: '10' },
    ]);
    await service.saveCollection(runner, 'youthcenter', [candidate('same', '대기 B')], new Date());
    const before = await state();
    const refresh = repository.refreshViewCounts.bind(repository);
    // 원본과 누락, 기존 대기 대체, 신규 후보와 공개 조회수를 쓴 뒤 DB가 충돌 오류를 반환
    jest.spyOn(repository, 'refreshViewCounts').mockImplementation(async (manager) => {
      await refresh(manager, [candidate('same', '수집 C', '99')]);
      expect(await manager.getRepository(Policy).findOneByOrFail({ externalId: 'same' })).toMatchObject({ viewCount: 99 });
      expect(await manager.getRepository(PolicyReview).countBy({ status: 'SUPERSEDED' })).toBe(1);
      expect(await manager.getRepository(PolicyReview).countBy({ status: 'PENDING' })).toBe(2);
      expect(await state()).toEqual(before);
      await manager.query(`DO $$ BEGIN RAISE EXCEPTION '검증 충돌' USING ERRCODE = '${code}'; END; $$`);
      return 0;
    });
    const starts = jest.spyOn(runner, 'startTransaction');
    const rollbacks = jest.spyOn(runner, 'rollbackTransaction');
    const commits = jest.spyOn(runner, 'commitTransaction');
    const attempts = jest.fn(async () => {});
    await expect(service.saveCollection(runner, 'youthcenter', [candidate('same', '수집 C', '99'), candidate('new')], new Date(), attempts))
      .rejects.toMatchObject({ driverError: { code } });
    expect(starts).toHaveBeenCalledTimes(2);
    expect(rollbacks).toHaveBeenCalledTimes(2);
    expect(commits).not.toHaveBeenCalled();
    expect(attempts).toHaveBeenCalledTimes(2);
    expect(await state()).toEqual(before);
    expect(runner.isTransactionActive).toBe(false);
    expect(runner.isReleased).toBe(false);
  });

  it('충돌 취소 뒤 연결이 끊기면 새 연결로 재시도하지 않는다', async () => {
    const connection: { end(): Promise<void> } = await runner.connect();
    const rollback = runner.rollbackTransaction.bind(runner);
    jest.spyOn(runner, 'rollbackTransaction').mockImplementationOnce(async () => { await rollback(); await connection.end(); });
    const write = jest.spyOn(repository, 'refreshViewCounts').mockImplementation(async (manager) => {
      await manager.sql`DO $$ BEGIN RAISE EXCEPTION '검증 충돌' USING ERRCODE = '40P01'; END; $$`;
      return 0;
    });
    const starts = jest.spyOn(runner, 'startTransaction');
    const create = jest.spyOn(dataSource, 'createQueryRunner');
    await expect(service.saveCollection(runner, 'youthcenter', [candidate('new')], new Date())).rejects.toBeInstanceOf(AggregateError);
    expect(starts).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
    expect(await dataSource.getRepository(SourcePolicy).count()).toBe(0);
  });
});
