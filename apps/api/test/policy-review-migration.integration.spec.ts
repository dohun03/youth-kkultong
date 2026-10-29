import { randomUUID } from 'node:crypto';
import { MigrationExecutor } from 'typeorm';
import type { DataSource } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import { createDataSource } from '../src/database/data-source';
import { CreatePolicies1792162800000 } from '../src/database/migrations/1792162800000-create-policies';
import { CreateRegions1792162801000 } from '../src/database/migrations/1792162801000-create-regions';
import { CreatePolicyReviewTables1793199600000 } from '../src/database/migrations/1793199600000-create-policy-review-tables';
import { createYouthCenterPolicyContentHash } from '../src/modules/ingestion/youth-center/youth-center-policy.hash';
import { transformYouthCenterPolicy } from '../src/modules/ingestion/youth-center/youth-center-policy.transform';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { SourcePolicy } from '../src/modules/policies/entities/source-policy.entity';
import { PolicyReview } from '../src/modules/policies/entities/policy-review.entity';
import { Region } from '../src/modules/meta/entities/region.entity';
import { PolicyRepository } from '../src/modules/policies/repositories/policy.repository';

describe('별도 PostgreSQL DB의 원본·검수 Migration', () => {
  const environment = loadEnvironment();
  const database = `mvp2_step4_${randomUUID().replaceAll('-', '')}`;
  const testUrl = new URL(environment.DATABASE_URL);
  testUrl.pathname = `/${database}`;
  const testEnvironment = { ...environment, DATABASE_URL: testUrl.href };
  let host: DataSource;
  let admin: DataSource;
  let connection: DataSource;
  let databaseCreated = false;
  let schema: string;
  let schemaCreated = false;

  beforeAll(async () => {
    // 기존 DB는 새 검증 DB 생성·정리에만 사용한다. 제품 테이블·볼륨은 수정하지 않는다.
    host = createDataSource(environment).setOptions({ entities: [], migrations: [] });
    await host.initialize();
    await host.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    databaseCreated = true;
    admin = createDataSource(testEnvironment).setOptions({ entities: [], migrations: [] });
    await admin.initialize();
  });

  beforeEach(async () => {
    schemaCreated = false;
    schema = `step4_test_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    connection = createDataSource(testEnvironment).setOptions({
      schema, entities: [Policy, Region, SourcePolicy, PolicyReview],
      migrations: [CreatePolicies1792162800000, CreateRegions1792162801000],
      extra: { options: `-c timezone=Asia/Seoul -c search_path=${schema}` },
    });
    await connection.initialize();
    await connection.runMigrations();
    // 각 사례는 MVP1 스키마와 가상 정책·지역에서 시작한다. 원문·조회수 NULL·미확인 필드도 보존한다.
    const policies = [
      { plcyNo: 'one', plcyNm: '첫 정책', inqCnt: '10', nested: { b: [null, false], a: ' 원문\n ' } },
      { plcyNo: 'two', plcyNm: '둘째 정책', inqCnt: '해석 불가' },
    ].map((raw) => ({ ...transformYouthCenterPolicy(raw), contentHash: createYouthCenterPolicyContentHash(raw) }));
    await new PolicyRepository().upsertPolicies(connection.manager, policies);
    await connection.getRepository(Region).insert({ code: '00001', name: '검증 지역', provinceName: '검증 시도', parentCode: null, isActive: true });
    connection.migrations.push(new CreatePolicyReviewTables1793199600000());
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    try { if (connection?.isInitialized) await connection.destroy(); }
    finally { if (schemaCreated && admin?.isInitialized) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
  });

  afterAll(async () => {
    try { if (admin?.isInitialized) await admin.destroy(); }
    finally {
      try { if (databaseCreated && host?.isInitialized) await host.query(`DROP DATABASE "${database}"`); }
      finally { if (host?.isInitialized) await host.destroy(); }
    }
  });

  /** 기존 공개 정책·지역·Migration 행의 순서가 고정된 전체 값으로 보존 여부를 확인한다. */
  async function snapshot(): Promise<unknown[]> {
    const result: unknown[] = [];
    for (const [table, key] of [['policies', 'id'], ['regions', 'code'], ['migrations', 'id']]) {
      result.push(...await connection.query(`SELECT count(*)::int AS count, md5(string_agg(row_to_json(t)::text, '' ORDER BY "${key}")) AS checksum FROM "${schema}"."${table}" t`));
    }
    return result;
  }

  /** 잘못된 값도 DB까지 전달해 실제 제약을 검사하며, 입력 객체에 생성된 ID가 섞이지 않게 한다. */
  async function insertReview(values: Record<string, unknown>): Promise<void> {
    await connection.query(`
      INSERT INTO "${schema}".policy_reviews
        (source_policy_id, kind, status, content_hash, raw_snapshot, base_policy_id,
         base_content_hash, base_raw_snapshot, reviewed_by, rejection_reason, superseded_reason, closed_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9, $10, $11, $12)
    `, [values.sourcePolicyId, values.kind, values.status ?? 'PENDING', values.contentHash,
      values.rawSnapshot == null ? null : JSON.stringify(values.rawSnapshot), values.basePolicyId ?? null,
      values.baseContentHash ?? null, values.baseRawSnapshot == null ? null : JSON.stringify(values.baseRawSnapshot),
      values.reviewedBy ?? null, values.rejectionReason ?? null, values.supersededReason ?? null, values.closedAt ?? null]);
  }

  /** 실패 후 새 테이블·부분 이관·Migration 기록이 전혀 남지 않았는지 확인한다. */
  async function expectRolledBack(before: unknown[]): Promise<void> {
    expect(await snapshot()).toEqual(before);
    expect(await connection.query('SELECT to_regclass($1)::text AS source, to_regclass($2)::text AS review',
      [`${schema}.source_policies`, `${schema}.policy_reviews`])).toEqual([{ source: null, review: null }]);
    expect(await connection.showMigrations()).toBe(true);
  }

  it('공개 UUID·전체 행·지역을 보존하고 원본만 새 UUID로 복사한다', async () => {
    const before = await snapshot();
    const published = await connection.getRepository(Policy).find({ order: { externalId: 'ASC' } });
    const applied = await connection.runMigrations();
    expect(applied.map(({ name }) => name)).toEqual(['CreatePolicyReviewTables1793199600000']);
    expect((await snapshot()).slice(0, 2)).toEqual(before.slice(0, 2));
    const sources = await connection.getRepository(SourcePolicy).find({ order: { externalId: 'ASC' } });
    expect(sources).toHaveLength(published.length);
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index], policy = published[index];
      expect(source.id).not.toBe(policy.id);
      expect(source).toMatchObject({ source: policy.source, externalId: policy.externalId, title: policy.title,
        rawJson: policy.rawJson, contentHash: policy.contentHash, viewCount: policy.viewCount,
        firstCollectedAt: null, lastCollectedAt: null, lastCollectionResult: null, missingCount: 0 });
      expect(source.createdAt).toEqual(source.updatedAt);
      expect(source.createdAt).toEqual(sources[0].createdAt);
    }
    expect(await connection.getRepository(PolicyReview).count()).toBe(0);
    expect(await connection.runMigrations()).toEqual([]);
    expect(await connection.getRepository(SourcePolicy).find({ order: { externalId: 'ASC' } })).toEqual(sources);
  });

  it('기존 정책이 없는 빈 DB도 이관하고 새 엔티티 전체와 스키마 차이가 없다', async () => {
    await connection.getRepository(Policy).clear();
    await connection.runMigrations();
    expect(await connection.getRepository(SourcePolicy).count()).toBe(0);
    expect(await connection.getRepository(PolicyReview).count()).toBe(0);
    const diff = await connection.driver.createSchemaBuilder().log();
    expect(diff.upQueries.map(({ query }) => query)).toEqual([]);
  });

  it('이관한 DB에서 6개 인덱스의 키·정렬 방향·부분 조건·유일성이 명세와 같다', async () => {
    await connection.runMigrations();
    const indexes: { name: string; unique: boolean; columns: string[]; options: number[]; predicate: string | null }[] = await connection.query(`
      SELECT c.relname AS name, i.indisunique AS unique, i.indoption::smallint[] AS options,
        ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(attnum, position)
          JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum ORDER BY k.position) AS columns,
        pg_get_expr(i.indpred, i.indrelid) AS predicate
      FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1
    `, [schema]);
    const expected: [string, string[], number[], boolean, RegExp | null][] = [
      ['IDX_source_policies_missing', ['missing_count', 'id'], [1, 0], false, /missing_count.*>.*0/],
      ['UQ_policy_reviews_pending', ['source_policy_id'], [0], true, /status.*=.*PENDING/],
      ['IDX_policy_reviews_processed', ['closed_at', 'id'], [1, 0], false, /status.*<>.*PENDING/],
      ['IDX_policy_reviews_status_created', ['status', 'created_at', 'id'], [0, 1, 0], false, null],
      ['IDX_policy_reviews_source_created', ['source_policy_id', 'created_at', 'id'], [0, 1, 0], false, null],
      ['IDX_policy_reviews_rejected_hash', ['source_policy_id', 'content_hash'], [0, 0], false, /status.*=.*REJECTED/],
    ];
    for (const [name, columns, descending, unique, predicate] of expected) {
      const index = indexes.find((index) => index.name === name)!;
      expect(index).toBeDefined();
      expect(index.columns).toEqual(columns);
      expect(index.options.map((option) => option & 1)).toEqual(descending);
      expect(index.unique).toBe(unique);
      if (predicate) expect(index.predicate).toMatch(predicate);
      else expect(index.predicate).toBeNull();
    }
    expect((await connection.driver.createSchemaBuilder().log()).upQueries.map(({ query }) => query)).toEqual([]);
  });

  it('해시가 맞지 않으면 전체 이관을 취소한다', async () => {
    await connection.query(`UPDATE "${schema}".policies SET content_hash=$1 WHERE external_id='one'`, ['b'.repeat(64)]);
    const before = await snapshot();
    await expect(connection.runMigrations()).rejects.toThrow('내용 해시가 일치하지 않아');
    await expectRolledBack(before);
  });

  it('기존 식별자가 중복이면 새 제약을 만들기 전에 중단한다', async () => {
    // 손상된 이전 스키마를 이 검증 DB 안에서만 재현한다.
    await connection.query(`ALTER TABLE "${schema}".policies DROP CONSTRAINT "UQ_policies_source_external_id"`);
    await connection.query(`INSERT INTO "${schema}".policies (source, external_id, title, raw_json, content_hash)
      SELECT source, external_id, title, raw_json, content_hash FROM "${schema}".policies WHERE external_id='one'`);
    const before = await snapshot();
    await expect(connection.runMigrations()).rejects.toThrow('식별자가 중복되어');
    await expectRolledBack(before);
  });

  it('원본 복사까지 실행한 뒤 DB 오류가 나도 테이블·복사·이력을 모두 취소한다', async () => {
    const before = await snapshot();
    const runner = connection.createQueryRunner();
    const execute = runner.query.bind(runner);
    let copied = 0;
    jest.spyOn(runner, 'query').mockImplementation(async (query, parameters, structured?: true) => {
      const result = structured ? await execute(query, parameters, true) : await execute(query, parameters);
      if (query.includes('INSERT INTO') && query.includes('"source_policies"')) {
        copied = (await execute(`SELECT count(*)::int AS count FROM "${schema}".source_policies`))[0].count;
        await execute('SELECT 1 / 0');
      }
      return result;
    });
    try {
      await expect(new MigrationExecutor(connection, runner).executePendingMigrations()).rejects.toMatchObject({ driverError: { code: '22012' } });
      expect(copied).toBe(2);
      await expectRolledBack(before);
    } finally { await runner.release(); }
  });

  it('한 원본의 PENDING은 하나만 허용하고 종료된 같은 해시 이력은 여러 건 허용한다', async () => {
    await connection.runMigrations();
    const source = await connection.getRepository(SourcePolicy).findOneByOrFail({ externalId: 'one' });
    const candidate = { sourcePolicyId: source.id, kind: 'NEW' as const, contentHash: source.contentHash, rawSnapshot: source.rawJson };
    const reviews = connection.getRepository(PolicyReview);
    await insertReview(candidate);
    await expect(insertReview(candidate)).rejects.toMatchObject({ driverError: { code: '23505', constraint: 'UQ_policy_reviews_pending' } });
    await connection.query(`UPDATE "${schema}".policy_reviews SET status='APPROVED', reviewed_by='admin', closed_at=now() WHERE source_policy_id=$1`, [source.id]);
    await insertReview({ ...candidate, status: 'REJECTED', reviewedBy: 'admin', rejectionReason: '검증 사유', closedAt: new Date() });
    await insertReview(candidate);
    expect(await reviews.count()).toBe(3);
  });

  it('실제 FK는 잘못된 원본 참조와 원본·공개 기준본 삭제를 거부한다', async () => {
    await connection.runMigrations();
    const source = await connection.getRepository(SourcePolicy).findOneByOrFail({ externalId: 'one' });
    const policy = await connection.getRepository(Policy).findOneByOrFail({ externalId: 'one' });
    const candidate = { sourcePolicyId: source.id, kind: 'CHANGED' as const, contentHash: source.contentHash,
      rawSnapshot: source.rawJson, basePolicyId: policy.id, baseContentHash: policy.contentHash, baseRawSnapshot: source.rawJson };
    const reviews = connection.getRepository(PolicyReview);
    await expect(insertReview({ ...candidate, sourcePolicyId: randomUUID() })).rejects.toMatchObject({ driverError: { code: '23503' } });
    await insertReview(candidate);
    await expect(connection.getRepository(SourcePolicy).delete(source.id)).rejects.toMatchObject({ driverError: { code: '23503' } });
    await expect(connection.getRepository(Policy).delete(policy.id)).rejects.toMatchObject({ driverError: { code: '23503' } });
    expect(await reviews.count()).toBe(1);
  });

  it.each([
    { status: 'APPROVED' as const }, { status: 'REJECTED' as const, reviewedBy: 'admin', rejectionReason: ' \n ', closedAt: new Date() },
    { status: 'SUPERSEDED' as const, closedAt: new Date() }, { kind: 'CHANGED' as const },
    { contentHash: 'A'.repeat(64) }, { rawSnapshot: [] },
  ])('실제 테이블 CHECK가 잘못된 검수 값을 거부한다: %j', async (changes) => {
    await connection.runMigrations();
    const source = await connection.getRepository(SourcePolicy).findOneByOrFail({ externalId: 'one' });
    await expect(insertReview({
      sourcePolicyId: source.id, kind: 'NEW', contentHash: source.contentHash, rawSnapshot: source.rawJson, ...changes,
    })).rejects.toMatchObject({ driverError: { code: '23514' } });
  });

  it('트랜잭션 없는 이관과 자동 역이관은 데이터 삭제 없이 거부한다', async () => {
    const runner = connection.createQueryRunner();
    try { await expect(new CreatePolicyReviewTables1793199600000().up(runner)).rejects.toThrow('트랜잭션 안에서만'); }
    finally { await runner.release(); }
    await connection.runMigrations();
    const before = await connection.getRepository(SourcePolicy).find();
    await expect(connection.undoLastMigration()).rejects.toThrow('백업 복원 절차');
    expect(await connection.getRepository(SourcePolicy).find()).toEqual(before);
    expect(await connection.showMigrations()).toBe(false);
  });
});
