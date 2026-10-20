import { randomUUID } from 'node:crypto';
import type { DataSource, QueryRunner } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import { createDataSource } from '../src/database/data-source';
import { CreatePolicies1792162800000 } from '../src/database/migrations/1792162800000-create-policies';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { PolicyRepository } from '../src/modules/policies/repositories/policy.repository';

describe('정책 읽기의 실제 PostgreSQL 검증', () => {
  const schema = `step28_test_${randomUUID().replaceAll('-', '')}`;
  const repository = new PolicyRepository();
  let admin: DataSource;
  let dataSource: DataSource;
  let runner: QueryRunner;
  let schemaCreated = false;

  beforeAll(async () => {
    const environment = loadEnvironment();
    admin = createDataSource(environment).setOptions({ entities: [], migrations: [] });
    await admin.initialize();
    // 개발 정책과 섞이지 않도록 이번 테스트만 사용하는 스키마 생성
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
    runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    // 조회 중 예외가 발생해도 테스트 데이터와 전용 연결을 정리
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

  /** 조회 경계를 비교할 수 있도록 긴 본문·원본을 갖는 정책을 임시 테이블에 저장 */
  async function seed(overrides: Partial<Policy> = {}): Promise<Policy> {
    return runner.manager.getRepository(Policy).save({
      source: 'youthcenter', externalId: randomUUID(), title: '읽기 검증 정책',
      rawJson: { nested: { original: '원본'.repeat(1000) } }, contentHash: 'a'.repeat(64),
      description: '긴 설명'.repeat(1000), benefitText: '지원 혜택😀'.repeat(1000),
      ...overrides,
    });
  }

  it('빈 테이블은 빈 후보·분야 배열과 없는 UUID의 null을 반환한다', async () => {
    expect(await repository.findCandidates(runner.manager)).toEqual([]);
    expect(await repository.findCategories(runner.manager)).toEqual([]);
    expect(await repository.findById(runner.manager, randomUUID())).toBeNull();
  });

  it('후보 전체를 한 번에 읽되 원본·긴 본문 없이 판정·정렬 값을 보존한다', async () => {
    const policy = await seed({
      externalId: 'sort-key', category: '주거', subcategory: '임차 지원', viewCount: 0,
      sourceRegisteredAt: new Date('2026-10-20T01:02:03.000Z'),
      applicationPeriodCode: '0057001', applicationPeriodRaw: '20261001 ~ 20261031',
      applicationStartDate: '2026-10-01', applicationEndDate: '2026-10-31',
      ageMin: 0, ageMax: 34, jobCodes: ['0013001', '미확인'], schoolCodes: ['0049010'],
      regionCodes: ['11110'], extraQualification: '추가 서류 확인',
    });
    const nullable = await seed({ benefitText: null });
    await seed({ applicationPeriodCode: '0057003' });
    const query = jest.spyOn(runner, 'query');
    const candidates = await repository.findCandidates(runner.manager);

    // 마감 정책도 후보에 남겨 검색 시점에 상태 계산·전체 정렬 후 페이지를 나누도록 함
    expect(candidates).toHaveLength(3);
    expect(query).toHaveBeenCalledTimes(1);
    const selected = candidates.find(({ id }) => id === policy.id)!;
    expect(selected).toEqual({
      id: policy.id, externalId: policy.externalId, title: policy.title,
      category: '주거', subcategory: '임차 지원', viewCount: 0,
      sourceRegisteredAt: policy.sourceRegisteredAt,
      applicationPeriodCode: '0057001', applicationPeriodRaw: '20261001 ~ 20261031',
      applicationStartDate: '2026-10-01', applicationEndDate: '2026-10-31',
      ageMin: 0, ageMax: 34, jobCodes: ['0013001', '미확인'], schoolCodes: ['0049010'],
      regionCodes: ['11110'], benefitPreview: Array.from(policy.benefitText!).slice(0, 200).join(''),
      hasExtraText: true,
    });
    expect(candidates.find(({ id }) => id === nullable.id)).toMatchObject({
      viewCount: null, sourceRegisteredAt: null, applicationStartDate: null, applicationEndDate: null,
      ageMin: null, ageMax: null, jobCodes: null, schoolCodes: null, regionCodes: null,
      benefitPreview: null, hasExtraText: false,
    });
    const sql = query.mock.calls[0][0];
    for (const column of ['raw_json', 'description', 'content_hash', 'apply_url', 'source_modified_at']) {
      expect(sql).not.toContain(column);
    }
    expect(sql).toContain('LEFT(');
    expect(sql).not.toMatch(/LIMIT|OFFSET/);
  });

  it.each([
    [null, null, false], ['', ' \t\n\r', false], ['자격 설명', null, true], [null, '참여 제한', true],
  ])('추가 자격 %p·참여 제한 %p의 존재 여부를 %p로 조회한다', async (extraQualification, participationRestriction, expected) => {
    await seed({ extraQualification, participationRestriction });
    const [candidate] = await repository.findCandidates(runner.manager);
    expect(candidate.hasExtraText).toBe(expected);
    expect(candidate).not.toHaveProperty('extraQualification');
    expect(candidate).not.toHaveProperty('participationRestriction');
  });

  it('UUID 상세에서만 원본·긴 본문·링크·자격 설명 전체를 반환한다', async () => {
    const policy = await seed({
      extraQualification: '추가 자격'.repeat(1000), participationRestriction: '참여 제한',
      applyUrl: 'https://example.com/apply', referenceUrl1: 'https://example.com/reference',
    });
    await seed({ externalId: policy.externalId, source: 'another' });
    const query = jest.spyOn(runner, 'query');
    expect(await repository.findById(runner.manager, policy.id)).toEqual(policy);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0];
    expect(sql).not.toContain(policy.id);
    expect(parameters).toContain(policy.id);
    expect(await repository.findById(runner.manager, randomUUID())).toBeNull();
  });

  it('분야는 실제 값의 중복을 제거하고 NULL·빈 값·공백을 제외한다', async () => {
    for (const category of [null, '', ' \n\t', '주거', '일자리', '주거', "분야' OR 1=1 --"]) {
      await seed({ category });
    }
    const query = jest.spyOn(runner, 'query');
    const categories = await repository.findCategories(runner.manager);
    expect(categories).toHaveLength(3);
    expect(new Set(categories)).toEqual(new Set(['주거', '일자리', "분야' OR 1=1 --"]));
    expect(await repository.findCategories(runner.manager)).toEqual(categories);
    expect(query.mock.calls[0][0]).not.toContain('raw_json');
    // 호출자가 전달한 트랜잭션을 사용하므로 다른 연결에서는 미확정 정책이 보이지 않음
    expect(await dataSource.getRepository(Policy).count()).toBe(0);
    expect(runner.isTransactionActive).toBe(true);
    expect(runner.isReleased).toBe(false);
  });
});
