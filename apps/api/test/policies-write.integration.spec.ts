import { randomUUID } from 'node:crypto';
import type { DataSource, QueryRunner } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import { createDataSource } from '../src/database/data-source';
import { CreatePolicies1792162800000 } from '../src/database/migrations/1792162800000-create-policies';
import { createYouthCenterPolicyContentHash } from '../src/modules/ingestion/youth-center/youth-center-policy.hash';
import { transformYouthCenterPolicy } from '../src/modules/ingestion/youth-center/youth-center-policy.transform';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { SourcePolicy } from '../src/modules/policies/entities/source-policy.entity';
import { PolicyReview } from '../src/modules/policies/entities/policy-review.entity';
import { SourcePolicyRepository } from '../src/modules/policies/repositories/source-policy.repository';
import { classifyPolicyCollection } from '../src/modules/policies/policy-collection';
import { CreatePolicyReviewTables1793199600000 } from '../src/database/migrations/1793199600000-create-policy-review-tables';
import type { PolicyWriteInput } from '../src/modules/policies/policy-write.types';
import { PolicyRepository } from '../src/modules/policies/repositories/policy.repository';

/** 테스트용 정책 데이터를 만들고 내용 해시 계산 */
function candidate(id: string, title = '검증 정책', views = '10'): PolicyWriteInput {
  const raw = { plcyNo: id, plcyNm: title, inqCnt: views };
  return { ...transformYouthCenterPolicy(raw), contentHash: createYouthCenterPolicyContentHash(raw) };
}

/** 비교할 기존 정책을 테스트 DB에 저장 */
async function seed(runner: QueryRunner, policies: PolicyWriteInput[]): Promise<void> {
  await runner.manager.getRepository(Policy).save(policies.map((policy) => ({
    source: policy.source, externalId: policy.externalId, title: policy.title,
    rawJson: policy.rawJson, viewCount: policy.viewCount, contentHash: policy.contentHash,
  })));
  const schema = runner.manager.getRepository(Policy).metadata.schema!;
  await runner.query(`INSERT INTO "${schema}".source_policies (source, external_id, title, raw_json, content_hash, view_count) SELECT source, external_id, title, raw_json, content_hash, view_count FROM "${schema}".policies ON CONFLICT (source, external_id) DO NOTHING`);
}

describe('정책 저장 준비의 실제 PostgreSQL 검증', () => {
  const schema = `step21_test_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource;
  let dataSource: DataSource;
  let runner: QueryRunner;
  let repository: PolicyRepository;
  let sources: SourcePolicyRepository;
  let schemaCreated = false;

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
    repository = new PolicyRepository();
    sources = new SourcePolicyRepository(environment);
  });

  beforeEach(async () => {
    runner = dataSource.createQueryRunner();
    await runner.connect();
    // 테스트가 끝나면 저장한 데이터를 되돌릴 수 있도록 트랜잭션 시작
    await runner.startTransaction();
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

  it('신규·내용 변경·조회수만 변경·동일 자료를 분류하고 DB 원본은 그대로 둔다', async () => {
    await seed(runner, [candidate('changed', '이전 제목'), candidate('views'), candidate('same')]);
    const table = runner.manager.getRepository(Policy);
    const before = await table.find({ order: { externalId: 'ASC' } });
    const incoming = [candidate('new'), candidate('changed', '새 제목'), candidate('views', '검증 정책', '25'), candidate('same')];
    const previous = await sources.findBySourceForUpdate(runner.manager, 'youthcenter');
    const result = classifyPolicyCollection('youthcenter', previous, incoming);
    expect(result.counts).toEqual({ NEW: 1, CHANGED: 1, UNCHANGED: 2, MISSING: 0 });
    expect(result.collected.map((item) => item.lastCollectionResult)).toEqual(['NEW', 'CHANGED', 'UNCHANGED', 'UNCHANGED']);
    expect(await table.find({ order: { externalId: 'ASC' } })).toEqual(before);
  });

  it('출처·외부 ID를 정확히 쌍으로 조회하고 해시 판정에 필요한 세 컬럼만 읽는다', async () => {
    const rows = [
      { ...candidate('same'), source: 'first' },
      { ...candidate('same', '다른 출처의 제목'), source: 'second' },
      { ...candidate('another'), source: 'first' },
      { ...candidate('another'), source: 'second' },
      candidate("id' OR 1=1 --"),
    ];
    await seed(runner, rows);
    const query = jest.spyOn(runner, 'query');
    const selected = await repository.findContentHashes(runner.manager, [rows[0], rows[3], rows[4]]);
    expect(selected).toHaveLength(3);
    expect(selected).toEqual(expect.arrayContaining([rows[0], rows[3], rows[4]].map((row) => ({
      source: row.source, externalId: row.externalId, contentHash: row.contentHash,
    }))));
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0];
    expect(sql).not.toContain('raw_json');
    expect(sql).not.toContain('description');
    expect(sql).not.toContain(rows[4].externalId);
    expect(parameters).toContain(rows[4].externalId);

    expect(await repository.findPublicSnapshots(runner.manager, [rows[0], rows[3], rows[4]])).toHaveLength(3);
  });

  it('호출자가 전달한 트랜잭션의 미확정 정책을 읽고 연결을 유지한다', async () => {
    const policy = candidate('uncommitted');
    await seed(runner, [policy]);
    // 아직 저장을 확정하지 않았으므로 다른 DB 연결에서는 이 정책이 보이지 않음
    expect(await dataSource.getRepository(Policy).countBy({ externalId: policy.externalId })).toBe(0);
    const previous = await sources.findBySourceForUpdate(runner.manager, 'youthcenter');
    expect(classifyPolicyCollection('youthcenter', previous, [policy]).counts.UNCHANGED).toBe(1);
    expect(runner.isTransactionActive).toBe(true);
    expect(runner.isReleased).toBe(false);
  });

  it('201건을 잠금 조회한 직전 원본과 비교하며 수집되지 않은 기존 정책도 유지한다', async () => {
    const previous = candidate('outside-collection');
    const existing = candidate('policy-200');
    await seed(runner, [previous, existing]);
    const incoming = Array.from({ length: 201 }, (_, index) => candidate(`policy-${index}`));
    const query = jest.spyOn(runner, 'query');
    const originals = await sources.findBySourceForUpdate(runner.manager, 'youthcenter');
    const result = classifyPolicyCollection('youthcenter', originals, incoming);
    expect(result.counts).toEqual({ NEW: 200, CHANGED: 0, UNCHANGED: 1, MISSING: 1 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(await runner.manager.getRepository(Policy).count()).toBe(2);
    expect(await runner.manager.getRepository(Policy).findOneByOrFail({ externalId: previous.externalId }))
      .toMatchObject({ contentHash: previous.contentHash });
  });
});
