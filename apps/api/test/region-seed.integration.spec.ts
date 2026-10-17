import { randomUUID } from 'node:crypto';
import type { DataSource, Repository } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import { createDataSource } from '../src/database/data-source';
import { CreateRegions1792162801000 } from '../src/database/migrations/1792162801000-create-regions';
import { seedRegions } from '../src/database/seeds/regions.seed';
import snapshot from '../src/database/seeds/regions.json';
import { Region } from '../src/modules/meta/entities/region.entity';

describe('공식 지역 시드의 실제 PostgreSQL 반영', () => {
  const schema = `step9_test_${randomUUID().replaceAll('-', '')}`;
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
      schema, entities: [Region], migrations: [CreateRegions1792162801000],
      extra: { options: `-c timezone=${environment.TZ} -c search_path=${schema}` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
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

  it('자식부터 나열한 실제 537개 자료도 부모 외래키를 지키며 묶음 저장한다', async () => {
    expect(await seedRegions(dataSource, [...snapshot.regions].reverse())).toBe(537);
    expect(await repository.count()).toBe(537);
    expect(await repository.countBy({ isActive: true })).toBe(284);
    expect(await repository.countBy({ isActive: false })).toBe(253);
    const child = await repository.findOneOrFail({ where: { code: '41111' }, relations: { parent: true } });
    expect(child.parent).toMatchObject({ code: '41110', name: '경기도 수원시' });
    expect(await repository.findOneByOrFail({ code: '28110' })).toMatchObject({ isActive: false });
  });

  it('같은 자료를 재실행해도 코드·명칭·부모 관계가 변하거나 중복되지 않는다', async () => {
    expect(await seedRegions(dataSource, snapshot.regions)).toBe(537);
    expect(await repository.count()).toBe(537);
    const rows = (await repository.find({ order: { code: 'ASC' } })).map(({ code, name, provinceName, parentCode, isActive }) =>
      ({ code, name, provinceName, parentCode, isActive }));
    expect(rows).toEqual(snapshot.regions);
  });

  it('공식 값은 갱신하고 이번 자료에 없는 기존 행은 삭제하지 않는다', async () => {
    await repository.update({ code: '41111' }, { isActive: false });
    await repository.insert({ code: '99999', name: '검증도', provinceName: '검증도', parentCode: null, isActive: false });
    await seedRegions(dataSource, snapshot.regions);
    expect((await repository.findOneByOrFail({ code: '41111' })).isActive).toBe(true);
    expect(await repository.count()).toBe(538);
    expect(await repository.findOneByOrFail({ code: '99999' })).toMatchObject({ isActive: false });
  });

  it('입력 검증 실패는 기존 DB를 변경하지 않는다', async () => {
    const before = await repository.find({ order: { code: 'ASC' } });
    await expect(seedRegions(dataSource, [...snapshot.regions, snapshot.regions[0]])).rejects.toThrow('지역 코드 중복');
    expect(await repository.find({ order: { code: 'ASC' } })).toEqual(before);
  });

  it('저장 중 DB 오류가 발생하면 기존 값 갱신과 신규 입력을 모두 취소한다', async () => {
    // 이 테스트가 만든 스키마에만 실패 제약을 추가한다.
    await dataSource.query(`ALTER TABLE "${schema}".regions ADD CONSTRAINT "CHK_step9_reject" CHECK (code <> '99998')`);
    try {
      await expect(seedRegions(dataSource, [
        { ...snapshot.regions[0], isActive: false },
        { code: '99998', name: '검증도', provinceName: '검증도', parentCode: null, isActive: true },
      ])).rejects.toMatchObject({ driverError: { code: '23514' } });
      expect((await repository.findOneByOrFail({ code: '11000' })).isActive).toBe(true);
      expect(await repository.countBy({ code: '99998' })).toBe(0);
      expect(await repository.count()).toBe(538);
    } finally {
      await dataSource.query(`ALTER TABLE "${schema}".regions DROP CONSTRAINT "CHK_step9_reject"`);
    }
  });
});
