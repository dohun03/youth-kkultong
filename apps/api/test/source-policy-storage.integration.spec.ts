import { randomUUID } from 'node:crypto';
import type { DataSource, QueryRunner } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import { createDataSource } from '../src/database/data-source';
import { CreatePolicies1792162800000 } from '../src/database/migrations/1792162800000-create-policies';
import { CreatePolicyReviewTables1793199600000 } from '../src/database/migrations/1793199600000-create-policy-review-tables';
import { createYouthCenterPolicyContentHash } from '../src/modules/ingestion/youth-center/youth-center-policy.hash';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { PolicyReview } from '../src/modules/policies/entities/policy-review.entity';
import { SourcePolicy } from '../src/modules/policies/entities/source-policy.entity';
import { SourcePolicyRepository } from '../src/modules/policies/repositories/source-policy.repository';
import type { CollectedSourcePolicyInput } from '../src/modules/policies/repositories/source-policy.repository';

const firstTime = new Date('2026-10-28T19:00:00.123Z');
const nextTime = new Date('2026-10-29T03:00:00.456Z');

/** 원문과 해시, 수집 결과를 갖춘 테스트용 원본 생성 */
function collected(externalId: string, title = '원본 정책', viewCount: number | null = 10): CollectedSourcePolicyInput {
  const rawJson = { plcyNo: externalId, plcyNm: title, inqCnt: viewCount, nested: { values: [null, false, ' 원문\n '] } };
  return { source: 'youthcenter', externalId, title, rawJson,
    contentHash: createYouthCenterPolicyContentHash(rawJson), viewCount, lastCollectionResult: 'NEW' };
}

/** 묶음 크기를 확인할 수 있도록 SQL 매개변수의 JSON 배열을 읽기 */
function payload<T>(parameters: unknown, index: number): T[] {
  if (!Array.isArray(parameters) || typeof parameters[index] !== 'string') throw new Error('JSON 묶음 매개변수가 없습니다.');
  return JSON.parse(parameters[index]);
}

describe('수집 원본 저장소의 실제 PostgreSQL 검증', () => {
  const schema = `mvp2_step5_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource;
  let connection: DataSource;
  let runner: QueryRunner;
  let repository: SourcePolicyRepository;
  let schemaCreated = false;

  beforeAll(async () => {
    const environment = loadEnvironment();
    admin = createDataSource(environment).setOptions({ entities: [], migrations: [] });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    // 테스트 전용 임시 스키마에 실제 Migration을 적용해 원본 저장 테이블을 준비
    connection = createDataSource(environment).setOptions({
      schema, entities: [Policy, SourcePolicy, PolicyReview],
      migrations: [CreatePolicies1792162800000, CreatePolicyReviewTables1793199600000],
      extra: { options: `-c timezone=Asia/Seoul -c search_path=${schema}` },
    });
    await connection.initialize();
    await connection.runMigrations();
    repository = new SourcePolicyRepository({ ...environment, POLICY_IMPORT_BATCH_SIZE: 200 });
  });

  beforeEach(async () => {
    await connection.getRepository(SourcePolicy).deleteAll();
    runner = connection.createQueryRunner();
    await runner.connect();
    await runner.startTransaction('READ COMMITTED');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    try { if (runner?.isTransactionActive) await runner.rollbackTransaction(); }
    finally { if (runner && !runner.isReleased) await runner.release(); }
  });

  afterAll(async () => {
    try { if (connection?.isInitialized) await connection.destroy(); }
    finally {
      try { if (schemaCreated && admin?.isInitialized) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
      finally { if (admin?.isInitialized) await admin.destroy(); }
    }
  });

  /** 행 잠금과 다른 연결의 조회를 검증할 수 있도록 기존 원본을 미리 저장 */
  async function seed(policies: CollectedSourcePolicyInput[]): Promise<void> {
    // 원본을 먼저 저장하고 확정한 뒤 수집 트랜잭션을 시작하는 순서로 테스트 상태를 준비
    await runner.rollbackTransaction();
    await connection.transaction(async (manager) => repository.upsertCollectedPolicies(manager, policies, firstTime));
    await runner.startTransaction('READ COMMITTED');
  }

  /** 실제 수집 시각이 비어 있는 이관 원본을 임시 스키마에 추가 */
  async function insertUnobserved(input: CollectedSourcePolicyInput, missingCount = 0): Promise<void> {
    await runner.query(`
      INSERT INTO "${schema}".source_policies
        (source, external_id, title, raw_json, content_hash, view_count, missing_count, created_at, updated_at)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z')
    `, [input.source, input.externalId, input.title, JSON.stringify(input.rawJson), input.contentHash, input.viewCount, missingCount]);
  }

  /** 테스트 중인 트랜잭션에서 원본 전체를 정렬해 조회 */
  async function originals(): Promise<SourcePolicy[]> {
    return runner.manager.getRepository(SourcePolicy).find({ order: { source: 'ASC', externalId: 'ASC' } });
  }

  it('출처별 원본 전체를 한 번에 정렬해 FOR UPDATE로 잠근다', async () => {
    await seed([collected('z'), { ...collected('other'), source: 'outside' }, collected('a'), collected('m')]);
    const query = jest.spyOn(runner, 'query');
    const rows = await repository.findBySourceForUpdate(runner.manager, 'youthcenter');
    expect(rows.map(({ externalId }) => externalId)).toEqual(['a', 'm', 'z']);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/ORDER BY .*source.* ASC, .*external_id.* ASC FOR UPDATE/);
    expect(query.mock.calls[0][1]).toEqual(['youthcenter']);
  });

  it('실제 행 수정은 잠금 반환까지 막고 다른 출처의 원본과 일반 SELECT는 막지 않는다', async () => {
    await seed([collected('locked'), { ...collected('free'), source: 'outside' }]);
    await repository.findBySourceForUpdate(runner.manager, 'youthcenter');
    const other = connection.createQueryRunner();
    await other.connect();
    try {
      await other.startTransaction();
      await other.query("SET LOCAL lock_timeout = '100ms'");
      expect(await other.manager.getRepository(SourcePolicy).count()).toBe(2);
      await other.manager.getRepository(SourcePolicy).update({ source: 'outside' }, { title: '별도 출처' });
      await expect(other.manager.getRepository(SourcePolicy).update({ externalId: 'locked' }, { title: '잠금 대기' }))
        .rejects.toMatchObject({ driverError: { code: '55P03' } });
      await other.rollbackTransaction();
      await runner.rollbackTransaction();
      // 잠금 반환 후 같은 원본을 갱신할 수 있는지 확인
      await other.manager.getRepository(SourcePolicy).update({ externalId: 'locked' }, { title: '해제 후 갱신' });
      expect((await other.manager.getRepository(SourcePolicy).findOneByOrFail({ externalId: 'locked' })).title).toBe('해제 후 갱신');
    } finally {
      try { if (other.isTransactionActive) await other.rollbackTransaction(); }
      finally { await other.release(); }
    }
  });

  it('빈 출처·빈 쓰기는 자료를 만들지 않는다', async () => {
    expect(await repository.findBySourceForUpdate(runner.manager, 'none')).toEqual([]);
    const query = jest.spyOn(runner, 'query');
    await repository.upsertCollectedPolicies(runner.manager, [], firstTime);
    await repository.updateMissingPolicies(runner.manager, []);
    expect(query).not.toHaveBeenCalled();
  });

  it('새 원본 401건을 정렬된 200·200·1건으로 저장하며 확정은 호출자에게 맡긴다', async () => {
    const incoming = Array.from({ length: 401 }, (_, i) => collected(`policy-${String(i).padStart(3, '0')}`)).reverse();
    const before = structuredClone(incoming);
    const query = jest.spyOn(runner, 'query');
    await repository.upsertCollectedPolicies(runner.manager, incoming, firstTime);
    const writes = query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO'));
    expect(writes.map(([, values]) => payload(values, 2).length)).toEqual([200, 200, 1]);
    expect(writes.flatMap(([, values]) => payload<CollectedSourcePolicyInput>(values, 2).map((row) => row.externalId)))
      .toEqual([...incoming].reverse().map(({ externalId }) => externalId));
    const rows = await originals();
    expect(rows).toHaveLength(401);
    for (const row of rows) expect(row).toMatchObject({
      firstCollectedAt: firstTime, lastCollectedAt: firstTime, lastCollectionResult: 'NEW', missingCount: 0,
    });
    expect(await connection.getRepository(SourcePolicy).count()).toBe(0);
    expect(query.mock.calls.some(([sql]) => /^(START TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT)/.test(sql))).toBe(false);
    expect(runner.isTransactionActive).toBe(true);
    expect(incoming).toEqual(before);
    await runner.commitTransaction();
    expect(await connection.getRepository(SourcePolicy).count()).toBe(401);
  });

  it('묶음 크기는 기존 POLICY_IMPORT_BATCH_SIZE 설정을 사용한다', async () => {
    const small = new SourcePolicyRepository({ ...loadEnvironment(), POLICY_IMPORT_BATCH_SIZE: 2 });
    const query = jest.spyOn(runner, 'query');
    await small.upsertCollectedPolicies(runner.manager, Array.from({ length: 5 }, (_, i) => collected(`${i}`)), firstTime);
    expect(query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO'))
      .map(([, values]) => payload(values, 2).length)).toEqual([2, 2, 1]);
  });

  it('이관 원본의 NULL 수집 시각을 첫 실제 관찰 때 채운다', async () => {
    const input = collected('migrated');
    await insertUnobserved(input, 3);
    const [before] = await originals();
    await repository.upsertCollectedPolicies(runner.manager, [{ ...input, lastCollectionResult: 'UNCHANGED' }], firstTime);
    expect((await originals())[0]).toMatchObject({ ...input, id: before.id, createdAt: before.createdAt,
      firstCollectedAt: firstTime, lastCollectedAt: firstTime, lastCollectionResult: 'UNCHANGED', missingCount: 0 });
    expect((await originals())[0].updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it.each(['CHANGED', 'UNCHANGED'] as const)('%s도 첫 수집·UUID·생성 시각을 유지하고 원본·최근 수집·조회수를 최신화한다', async (result) => {
    await seed([collected('again')]);
    const [before] = await repository.findBySourceForUpdate(runner.manager, 'youthcenter');
    await repository.updateMissingPolicies(runner.manager, [{ id: before.id, missingCount: 5 }]);
    const incoming = result === 'CHANGED' ? collected('again', '최신 제목', null) : collected('again', '원본 정책', null);
    await repository.upsertCollectedPolicies(runner.manager, [{ ...incoming, lastCollectionResult: result }], nextTime);
    expect((await originals())[0]).toMatchObject({ ...incoming, id: before.id, createdAt: before.createdAt,
      firstCollectedAt: firstTime, lastCollectedAt: nextTime, missingCount: 0, lastCollectionResult: result });
    expect((await originals())[0].updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
  });

  it('원문 특수문자와 복합 식별자를 보존하며 다른 출처의 같은 외부 ID는 구분한다', async () => {
    const input = collected("id' OR 1=1 --", '제목 \' " \\ 한글', 0);
    const incoming = [input, { ...input, source: 'other' }];
    await repository.upsertCollectedPolicies(runner.manager, incoming, firstTime);
    expect(await originals()).toHaveLength(2);
    for (const row of await originals()) expect(row).toMatchObject(incoming.find(({ source }) => source === row.source)!);
  });

  it('다른 묶음에 있는 중복 식별자도 첫 쓰기 전에 거부한다', async () => {
    const incoming = [...Array.from({ length: 200 }, (_, i) => collected(`policy-${i}`)), collected('policy-0')];
    const query = jest.spyOn(runner, 'query');
    await expect(repository.upsertCollectedPolicies(runner.manager, incoming, firstTime)).rejects.toThrow('중복 식별자');
    expect(query).not.toHaveBeenCalled();
    expect(await originals()).toEqual([]);
  });

  it('누락 401건도 200·200·1건으로 갱신하고 원문·해시·조회수·실제 수집 시각은 유지한다', async () => {
    await seed(Array.from({ length: 401 }, (_, i) => collected(`policy-${i}`)));
    const before = await repository.findBySourceForUpdate(runner.manager, 'youthcenter');
    const missing = before.map(({ id }, i) => ({ id, missingCount: i === 0 ? 2147483647 : 2 }));
    const query = jest.spyOn(runner, 'query');
    await repository.updateMissingPolicies(runner.manager, missing);
    expect(query.mock.calls.filter(([sql]) => sql.includes('UPDATE '))
      .map(([, values]) => payload(values, 0).length)).toEqual([200, 200, 1]);
    const after = await originals();
    for (let i = 0; i < after.length; i += 1) {
      expect(after[i]).toEqual({ ...before[i], missingCount: missing[i].missingCount,
        lastCollectionResult: 'MISSING', updatedAt: expect.any(Date) });
      expect(after[i].updatedAt.getTime()).toBeGreaterThanOrEqual(before[i].updatedAt.getTime());
    }
  });

  it('한 번도 관찰하지 않은 이관 원본의 누락은 NULL 수집 시각을 유지한다', async () => {
    await insertUnobserved(collected('unseen'));
    const [before] = await originals();
    await repository.updateMissingPolicies(runner.manager, [{ id: before.id, missingCount: 1 }]);
    expect((await originals())[0]).toMatchObject({ firstCollectedAt: null, lastCollectedAt: null,
      lastCollectionResult: 'MISSING', missingCount: 1, rawJson: before.rawJson });
  });

  it('누락 저장도 다른 묶음의 중복 ID를 첫 쓰기 전에 거부한다', async () => {
    const missing = Array.from({ length: 200 }, () => ({ id: randomUUID(), missingCount: 1 }));
    const query = jest.spyOn(runner, 'query');
    await expect(repository.updateMissingPolicies(runner.manager, [...missing, missing[0]])).rejects.toThrow('중복 ID');
    expect(query).not.toHaveBeenCalled();
  });

  it('뒤 묶음의 제약 오류가 나면 앞 묶음의 삽입·변경·누락 모두 호출자 롤백으로 복원된다', async () => {
    await seed([collected('a-existing'), collected('b-missing')]);
    const before = await repository.findBySourceForUpdate(runner.manager, 'youthcenter');
    await repository.updateMissingPolicies(runner.manager, [{ id: before[1].id, missingCount: 3 }]);
    const incoming = [collected('a-existing', '취소될 제목'),
      ...Array.from({ length: 200 }, (_, i) => collected(`new-${String(i).padStart(3, '0')}`))];
    incoming[200].viewCount = -1;
    const query = jest.spyOn(runner, 'query');
    await expect(repository.upsertCollectedPolicies(runner.manager, incoming, nextTime))
      .rejects.toMatchObject({ driverError: { code: '23514' } });
    expect(query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO'))).toHaveLength(2);
    await runner.rollbackTransaction();
    expect(await connection.getRepository(SourcePolicy).find({ order: { source: 'ASC', externalId: 'ASC' } })).toEqual(before);
  });

  it('누락 갱신의 뒤 묶음 오류도 전체 취소할 수 있다', async () => {
    await seed(Array.from({ length: 201 }, (_, i) => collected(`policy-${i}`)));
    const before = await repository.findBySourceForUpdate(runner.manager, 'youthcenter');
    const missing = before.map(({ id }, i) => ({ id, missingCount: i === 200 ? -1 : 3 }));
    await expect(repository.updateMissingPolicies(runner.manager, missing)).rejects.toMatchObject({ driverError: { code: '23514' } });
    await runner.rollbackTransaction();
    expect(await connection.getRepository(SourcePolicy).find({ order: { source: 'ASC', externalId: 'ASC' } })).toEqual(before);
  });

  it('호출자가 취소하면 성공한 삽입·갱신도 모두 이전 상태로 돌아간다', async () => {
    await seed([collected('existing'), collected('missing')]);
    const before = await repository.findBySourceForUpdate(runner.manager, 'youthcenter');
    await repository.upsertCollectedPolicies(runner.manager, [collected('existing', '새 제목'), collected('new')], nextTime);
    await repository.updateMissingPolicies(runner.manager, [{ id: before[1].id, missingCount: 1 }]);
    expect(await originals()).toHaveLength(3);
    await runner.rollbackTransaction();
    expect(await connection.getRepository(SourcePolicy).find({ order: { source: 'ASC', externalId: 'ASC' } })).toEqual(before);
    expect(await connection.getRepository(Policy).count()).toBe(0);
    expect(await connection.getRepository(PolicyReview).count()).toBe(0);
  });

  it('자동 확정 연결의 조회·저장은 거부한다', async () => {
    await expect(repository.findBySourceForUpdate(connection.manager, 'youthcenter')).rejects.toThrow('트랜잭션 관리자');
    await expect(repository.upsertCollectedPolicies(connection.manager, [collected('invalid')], firstTime)).rejects.toThrow('트랜잭션 관리자');
    await expect(repository.updateMissingPolicies(connection.manager, [{ id: randomUUID(), missingCount: 1 }])).rejects.toThrow('트랜잭션 관리자');
    expect(await connection.getRepository(SourcePolicy).count()).toBe(0);
  });
});
