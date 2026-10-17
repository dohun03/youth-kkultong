import { randomUUID } from 'node:crypto';
import type { DataSource, Repository } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import { createDataSource } from '../src/database/data-source';
import { Policy } from '../src/modules/policies/entities/policy.entity';

const requiredPolicy = (externalId = randomUUID()) => ({
  source: 'youthcenter', externalId, title: '검증용 정책',
  rawJson: { plcyNo: externalId, plcyNm: '검증용 정책' }, contentHash: 'a'.repeat(64),
});

describe('정책 테이블과 엔티티의 실제 DB 검증', () => {
  const schema = `step7_test_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource;
  let dataSource: DataSource;
  let repository: Repository<Policy>;
  let schemaCreated = false;

  beforeAll(async () => {
    const environment = loadEnvironment();
    admin = createDataSource(environment).setOptions({ entities: [], migrations: [] });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    // 실제 Migration 파일을 읽되 모든 연결의 쓰기 대상을 자체 생성한 검증 스키마로 한정한다.
    dataSource = createDataSource(environment).setOptions({
      schema,
      extra: { options: `-c timezone=${environment.TZ} -c search_path=${schema}` },
    });
    await dataSource.initialize();
    expect(await dataSource.showMigrations()).toBe(true);
    expect((await dataSource.runMigrations()).map((migration) => migration.name))
      .toEqual(['CreatePolicies1792162800000']);
    repository = dataSource.getRepository(Policy);
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

  it('SPEC의 29개 컬럼 타입·길이·NULL 허용 여부와 일치한다', async () => {
    const columns = await dataSource.query(`
      SELECT attname AS name, format_type(atttypid, atttypmod) AS type, attnotnull AS required
      FROM pg_attribute
      WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped
      ORDER BY attnum
    `, [`${schema}.policies`]);
    const expected: [string, string, boolean][] = [
      ['id', 'uuid', true], ['source', 'character varying(32)', true],
      ['external_id', 'character varying(64)', true], ['title', 'text', true],
      ['category', 'character varying(100)', false], ['subcategory', 'character varying(100)', false],
      ['description', 'text', false], ['benefit_text', 'text', false], ['apply_url', 'text', false],
      ['reference_url_1', 'text', false], ['reference_url_2', 'text', false],
      ['view_count', 'integer', false], ['source_registered_at', 'timestamp without time zone', false],
      ['source_modified_at', 'timestamp without time zone', false],
      ['application_period_code', 'character varying(20)', false], ['application_period_raw', 'text', false],
      ['application_start_date', 'date', false], ['application_end_date', 'date', false],
      ['age_min', 'integer', false], ['age_max', 'integer', false],
      ['job_codes', 'text[]', false], ['school_codes', 'text[]', false], ['region_codes', 'text[]', false],
      ['extra_qualification', 'text', false], ['participation_restriction', 'text', false],
      ['raw_json', 'jsonb', true], ['content_hash', 'character(64)', true],
      ['created_at', 'timestamp with time zone', true], ['updated_at', 'timestamp with time zone', true],
    ];
    expect(columns).toEqual(expected.map(([name, type, required]) => ({ name, type, required })));
    // 자동 동기화를 실행하지 않고 DB와 엔티티 사이에 변경 SQL이 없는지만 확인한다.
    expect((await dataSource.driver.createSchemaBuilder().log()).upQueries).toEqual([]);
  });

  it('복합 고유 제약과 조회 인덱스 3개의 컬럼·DESC 방향이 일치한다', async () => {
    const indexes: { indexname: string; indexdef: string }[] = await dataSource.query(
      'SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2',
      [schema, 'policies'],
    );
    const definitions = Object.fromEntries(indexes.map((index) => [index.indexname, index.indexdef]));
    expect(indexes).toHaveLength(5);
    expect(definitions.PK_policies).toContain('UNIQUE INDEX');
    expect(definitions.PK_policies).toContain('(id)');
    expect(definitions.UQ_policies_source_external_id).toContain('UNIQUE INDEX');
    expect(definitions.UQ_policies_source_external_id).toContain('(source, external_id)');
    expect(definitions.IDX_policies_category).toContain('(category)');
    expect(definitions.IDX_policies_view_count).toContain('(view_count DESC)');
    expect(definitions.IDX_policies_source_registered_at).toContain('(source_registered_at DESC)');
  });

  it('필수값만 저장하면 UUID·저장일이 생성되고 선택 컬럼은 NULL이다', async () => {
    const saved = await repository.save(requiredPolicy());
    const policy = await repository.findOneByOrFail({ id: saved.id });
    expect(policy.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(policy.createdAt).toBeInstanceOf(Date);
    expect(policy.updatedAt).toBeInstanceOf(Date);
    expect(policy).toMatchObject({ category: null, viewCount: null, ageMin: null, jobCodes: null, applicationStartDate: null });
  });

  it('같은 출처·외부 ID 중복을 거부하고 출처가 다르면 같은 외부 ID를 허용한다', async () => {
    const policy = requiredPolicy();
    // TypeORM이 입력 객체에 생성 ID를 채우므로 각 INSERT에 새 객체를 넘긴다.
    await repository.insert({ ...policy });
    await expect(repository.insert({ ...policy })).rejects.toMatchObject({
      driverError: { code: '23505', constraint: 'UQ_policies_source_external_id' },
    });
    await repository.insert({ ...policy, source: 'other-source' });
    expect(await repository.countBy({ externalId: policy.externalId })).toBe(2);
  });

  it.each(['source', 'external_id', 'title', 'raw_json', 'content_hash'])(
    '필수 컬럼 %s의 NULL을 DB에서 거부한다', async (column) => {
      const columns = ['source', 'external_id', 'title', 'raw_json', 'content_hash'];
      const values: unknown[] = ['youthcenter', randomUUID(), '검증용 정책', {}, 'a'.repeat(64)];
      values[columns.indexOf(column)] = null;
      await expect(dataSource.query(`
        INSERT INTO policies (source, external_id, title, raw_json, content_hash)
        VALUES ($1, $2, $3, $4, $5)
      `, values)).rejects.toMatchObject({ driverError: { code: '23502', column } });
    },
  );

  it.each([
    ['source', 33], ['externalId', 65], ['category', 101], ['subcategory', 101],
    ['applicationPeriodCode', 21], ['contentHash', 65],
  ] as const)('%s의 명세 길이를 초과한 값을 거부한다', async (field, length) => {
    await expect(repository.insert({ ...requiredPolicy(), [field]: 'a'.repeat(length) }))
      .rejects.toMatchObject({ driverError: { code: '22001' } });
  });

  it('원본 JSON·코드의 앞자리 0·숫자 0·날짜와 시각을 보존한다', async () => {
    const rawJson = { plcyNo: '0001', inqCnt: '0', extra: { values: ['', 0, null, '한글'] } };
    const saved = await repository.save({
      ...requiredPolicy(), rawJson, viewCount: 0, ageMin: 0, ageMax: 34,
      jobCodes: ['0013010', '0013001'], schoolCodes: [], regionCodes: ['11000'],
      sourceRegisteredAt: new Date('2026-10-17T00:30:00+09:00'),
      sourceModifiedAt: new Date('2026-10-17T11:12:13+09:00'),
      applicationStartDate: '2026-10-17', applicationEndDate: '2026-10-31',
    });
    expect(await repository.findOneByOrFail({ id: saved.id })).toMatchObject({
      rawJson, viewCount: 0, ageMin: 0, jobCodes: ['0013010', '0013001'],
      schoolCodes: [], regionCodes: ['11000'],
      applicationStartDate: '2026-10-17', applicationEndDate: '2026-10-31',
    });
    expect(await dataSource.query(`
      SELECT to_char(source_registered_at, 'YYYY-MM-DD HH24:MI:SS') AS registered,
             to_char(source_modified_at, 'YYYY-MM-DD HH24:MI:SS') AS modified
      FROM policies WHERE id = $1
    `, [saved.id])).toEqual([{ registered: '2026-10-17 00:30:00', modified: '2026-10-17 11:12:13' }]);
  });

  it('ORM 갱신에서 최초 저장일은 유지하고 마지막 반영일을 갱신한다', async () => {
    const saved = await repository.save(requiredPolicy());
    await dataSource.query('UPDATE policies SET updated_at = $1 WHERE id = $2', ['2000-01-01T00:00:00Z', saved.id]);
    await repository.update(saved.id, { title: '변경된 정책명' });
    const updated = await repository.findOneByOrFail({ id: saved.id });
    expect(updated.createdAt).toEqual(saved.createdAt);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(new Date('2000-01-01T00:00:00Z').getTime());
  });

  it('재실행은 중복 적용하지 않고 테스트 스키마에서 되돌리기·재적용할 수 있다', async () => {
    expect(await dataSource.showMigrations()).toBe(false);
    expect(await dataSource.runMigrations()).toEqual([]);
    await dataSource.undoLastMigration();
    expect(await dataSource.query('SELECT to_regclass($1) AS table_name', [`${schema}.policies`]))
      .toEqual([{ table_name: null }]);
    expect(await dataSource.showMigrations()).toBe(true);
    expect((await dataSource.runMigrations()).map((migration) => migration.name))
      .toEqual(['CreatePolicies1792162800000']);
    expect(await repository.count()).toBe(0);
  });
});
