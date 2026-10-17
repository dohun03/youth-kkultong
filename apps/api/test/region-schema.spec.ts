import { randomUUID } from 'node:crypto';
import type { DataSource, Repository } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import { createDataSource } from '../src/database/data-source';
import { CreatePolicies1792162800000 } from '../src/database/migrations/1792162800000-create-policies';
import { CreateRegions1792162801000 } from '../src/database/migrations/1792162801000-create-regions';
import { Region } from '../src/modules/meta/entities/region.entity';
import { Policy } from '../src/modules/policies/entities/policy.entity';

// 실제 지역 코드표를 대신하는 시드가 아니라 테스트 스키마에만 넣는 가상 자료다.
let nextCode = 100;
const requiredRegion = (values: Partial<Region> = {}) => ({
  code: String(nextCode++).padStart(5, '0'), name: '검증용 지역', provinceName: '검증용 시도',
  isActive: true, ...values,
});

describe('지역 테이블과 상위 관계의 실제 DB 검증', () => {
  const schema = `step8_test_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource;
  let dataSource: DataSource;
  let repository: Repository<Region>;
  let schemaCreated = false;

  beforeAll(async () => {
    const environment = loadEnvironment();
    admin = createDataSource(environment).setOptions({ entities: [], migrations: [] });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    dataSource = createDataSource(environment).setOptions({
      schema,
      entities: [Policy, Region],
      migrations: [CreatePolicies1792162800000, CreateRegions1792162801000],
      extra: { options: `-c timezone=${environment.TZ} -c search_path=${schema}` },
    });
    await dataSource.initialize();
    expect((await dataSource.runMigrations()).map((migration) => migration.name))
      .toEqual(['CreatePolicies1792162800000', 'CreateRegions1792162801000']);
    repository = dataSource.getRepository(Region);
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

  it('명세의 5개 컬럼·기본키·부모 외래키와 엔티티가 일치한다', async () => {
    const runner = dataSource.createQueryRunner();
    try {
      const table = await runner.getTable(`${schema}.regions`);
      expect(table).toBeDefined();
      expect(table!.columns.map((column) => ({
        name: column.name, type: column.type, length: column.length, nullable: column.isNullable,
      }))).toEqual([
        { name: 'code', type: 'character varying', length: '5', nullable: false },
        { name: 'name', type: 'character varying', length: '100', nullable: false },
        { name: 'province_name', type: 'character varying', length: '100', nullable: false },
        { name: 'parent_code', type: 'character varying', length: '5', nullable: true },
        { name: 'is_active', type: 'boolean', length: '', nullable: false },
      ]);
      expect(table!.primaryColumns.map((column) => column.name)).toEqual(['code']);
      expect(table!.foreignKeys).toHaveLength(1);
      expect(table!.foreignKeys[0]).toMatchObject({
        name: 'FK_regions_parent_code', columnNames: ['parent_code'], referencedColumnNames: ['code'],
        onDelete: 'NO ACTION', onUpdate: 'NO ACTION',
      });
      expect(table!.checks.map((check) => check.name)).toEqual(['CHK_regions_code']);
    } finally {
      await runner.release();
    }
    expect((await dataSource.driver.createSchemaBuilder().log()).upQueries).toEqual([]);
  });

  it('코드의 앞자리 0과 상위 지역 없는 NULL을 보존한다', async () => {
    await repository.insert(requiredRegion({ code: '00001' }));
    expect(await repository.findOneByOrFail({ code: '00001' }))
      .toMatchObject({ code: '00001', parentCode: null, isActive: true });
  });

  it('코드 앞자리가 달라도 명시된 직접 상위 관계로 조회한다', async () => {
    await repository.insert(requiredRegion({ code: '12345', name: '검증용 상위 지역' }));
    await repository.insert(requiredRegion({ code: '67890', parentCode: '12345' }));
    const child = await repository.findOneOrFail({ where: { code: '67890' }, relations: { parent: true } });
    expect(child.parentCode).toBe('12345');
    expect(child.parent).toMatchObject({ code: '12345', name: '검증용 상위 지역' });
  });

  it('폐지 상태도 저장하며 현행 여부로 구분해 조회할 수 있다', async () => {
    const inactive = requiredRegion({ isActive: false });
    await repository.insert(inactive);
    expect((await repository.findOneByOrFail({ code: inactive.code })).isActive).toBe(false);
    expect((await repository.findBy({ isActive: true })).map((region) => region.code)).not.toContain(inactive.code);
  });

  it('중복 코드를 기본키 제약으로 거부한다', async () => {
    const region = requiredRegion();
    await repository.insert({ ...region });
    await expect(repository.insert({ ...region }))
      .rejects.toMatchObject({ driverError: { code: '23505', constraint: 'PK_regions' } });
  });

  it('존재하지 않는 상위 코드를 거부한다', async () => {
    await expect(repository.insert(requiredRegion({ parentCode: '99999' })))
      .rejects.toMatchObject({ driverError: { code: '23503', constraint: 'FK_regions_parent_code' } });
  });

  it('참조 중인 상위 지역 삭제는 거부하고 폐지 상태 전환은 관계를 보존한다', async () => {
    const parent = requiredRegion();
    const child = requiredRegion({ parentCode: parent.code });
    await repository.insert(parent);
    await repository.insert(child);
    await expect(repository.delete({ code: parent.code }))
      .rejects.toMatchObject({ driverError: { code: '23503' } });
    await repository.update({ code: parent.code }, { isActive: false });
    expect(await repository.findOneByOrFail({ code: child.code })).toMatchObject({ parentCode: parent.code });
    expect((await repository.findOneByOrFail({ code: parent.code })).isActive).toBe(false);
  });

  it.each(['', '1234', 'abcde', '12A45', '１２３４５'])('5자리 숫자가 아닌 코드 %s를 거부한다', async (code) => {
    await expect(repository.insert(requiredRegion({ code })))
      .rejects.toMatchObject({ driverError: { code: '23514', constraint: 'CHK_regions_code' } });
  });

  it.each(['code', 'name', 'province_name', 'is_active'])('필수 컬럼 %s의 NULL을 거부한다', async (column) => {
    const columns = ['code', 'name', 'province_name', 'parent_code', 'is_active'];
    const values: unknown[] = ['00999', '검증용 지역', '검증용 시도', null, true];
    values[columns.indexOf(column)] = null;
    await expect(dataSource.query(`
      INSERT INTO regions (code, name, province_name, parent_code, is_active) VALUES ($1, $2, $3, $4, $5)
    `, values)).rejects.toMatchObject({ driverError: { code: '23502', column } });
  });

  it.each([['code', 6], ['name', 101], ['provinceName', 101], ['parentCode', 6]] as const)(
    '%s의 명세 길이를 초과한 값을 거부한다', async (field, length) => {
      await expect(repository.insert(requiredRegion({ [field]: '1'.repeat(length) })))
        .rejects.toMatchObject({ driverError: { code: '22001' } });
    },
  );

  it('현행 여부를 생략하면 임의 기본값을 넣지 않고 거부한다', async () => {
    await expect(repository.insert({ code: '00099', name: '검증용 지역', provinceName: '검증용 시도' }))
      .rejects.toMatchObject({ driverError: { code: '23502', column: 'is_active' } });
  });

  it('지역 Migration만 되돌린 뒤 재적용해도 기존 정책 테이블은 유지된다', async () => {
    const externalId = randomUUID();
    await dataSource.getRepository(Policy).insert({
      source: 'test', externalId, title: '검증용 정책', rawJson: {}, contentHash: 'a'.repeat(64),
    });
    expect(await dataSource.runMigrations()).toEqual([]);
    await dataSource.undoLastMigration();
    expect(await dataSource.query('SELECT to_regclass($1) AS table_name', [`${schema}.regions`]))
      .toEqual([{ table_name: null }]);
    expect(await dataSource.getRepository(Policy).countBy({ externalId })).toBe(1);
    expect((await dataSource.runMigrations()).map((migration) => migration.name))
      .toEqual(['CreateRegions1792162801000']);
    expect(await repository.count()).toBe(0);
  });
});
