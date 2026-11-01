import { randomUUID } from 'node:crypto';
import type { DataSource, QueryRunner } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import { createDataSource } from '../src/database/data-source';
import { CreatePolicies1792162800000 } from '../src/database/migrations/1792162800000-create-policies';
import { createYouthCenterPolicyContentHash } from '../src/modules/ingestion/youth-center/youth-center-policy.hash';
import { transformYouthCenterPolicy } from '../src/modules/ingestion/youth-center/youth-center-policy.transform';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { PolicyRepository } from '../src/modules/policies/repositories/policy.repository';
import type { PolicyWriteInput } from '../src/modules/policies/policy-write.types';

/** 원본 변환과 내용 해시 계산을 마친 공개 저장 입력 생성 */
function policy(externalId: string, title = '승인된 제목', views = '10', fields: Record<string, unknown> = {}): PolicyWriteInput {
  const rawJson = { plcyNo: externalId, plcyNm: title, inqCnt: views, ...fields };
  return { ...transformYouthCenterPolicy(rawJson), contentHash: createYouthCenterPolicyContentHash(rawJson) };
}

describe('승인 본문 저장과 공개 조회수 갱신 분리의 PostgreSQL 검증', () => {
  const schema = `mvp2_step7_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource;
  let connection: DataSource;
  let runner: QueryRunner;
  let repository: PolicyRepository;
  let schemaCreated = false;

  beforeAll(async () => {
    const environment = loadEnvironment();
    admin = createDataSource(environment).setOptions({ entities: [], migrations: [] });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    // 테스트 전용 스키마에 기존 공개 정책 테이블을 준비
    connection = createDataSource(environment).setOptions({
      schema, entities: [Policy], migrations: [CreatePolicies1792162800000],
      extra: { options: `-c timezone=Asia/Seoul -c search_path=${schema}` },
    });
    await connection.initialize();
    await connection.runMigrations();
    repository = new PolicyRepository();
  });

  beforeEach(async () => {
    await connection.getRepository(Policy).clear();
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

  /** 현재 트랜잭션의 공개 정책 전체를 고정된 순서로 조회 */
  async function published(): Promise<Policy[]> {
    return runner.manager.getRepository(Policy).find({ order: { source: 'ASC', externalId: 'ASC' } });
  }

  /** 공개 UUID와 생성 시각, 갱신 시각의 보존 여부를 구분할 테스트 상태 준비 */
  async function setOldTimes(): Promise<void> {
    await runner.query(`UPDATE "${schema}".policies
      SET created_at = '2000-01-01T00:00:00Z', updated_at = '2000-01-01T00:00:00Z'`);
  }

  it('최초 승인 저장은 새 UUID를 생성하고 호출자가 확정하기 전까지 다른 연결에 노출하지 않는다', async () => {
    const input = policy('new');
    const before = structuredClone(input);
    const query = jest.spyOn(runner, 'query');
    await repository.saveApprovedPolicy(runner.manager, input, null);
    const [saved] = await published();
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved).toMatchObject(input);
    expect(await connection.getRepository(Policy).count()).toBe(0);
    expect(input).toEqual(before);
    expect(query.mock.calls.some(([sql]) => /^(START TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT)/.test(sql))).toBe(false);
    await runner.commitTransaction();
    expect((await connection.getRepository(Policy).find())[0]).toEqual(saved);
  });

  it('기존 승인 저장은 모든 본문을 갱신하고 공개 UUID와 식별자, 생성 시각을 보존한다', async () => {
    await repository.saveApprovedPolicy(runner.manager, policy('changed'), null);
    await setOldTimes();
    const [before] = await published();
    const input = policy('changed', '새 승인 제목', '22', {
      lclsfNm: '일자리', mclsfNm: '취업', plcyExplnCn: '새 설명', plcySprtCn: '새 지원 내용',
      aplyUrlAddr: 'https://example.com/apply', refUrlAddr1: 'https://example.com/1', refUrlAddr2: 'https://example.com/2',
      frstRegDt: '2026-03-08 02:30:00', lastMdfcnDt: '2026-10-30 00:30:00',
      aplyPrdSeCd: '0057001', aplyYmd: '20261001 ~ 20261031',
      sprtTrgtMinAge: '19', sprtTrgtMaxAge: '34', jobCd: '0013001,0013010', schoolCd: '0049010',
      zipCd: '11000,11110', addAplyQlfcCndCn: '추가 자격', ptcpPrpTrgtCn: '참여 제한',
      unknown: { values: ['', null, false, { inqCnt: '중첩 값' }] },
    });
    const inputBefore = structuredClone(input);
    await repository.saveApprovedPolicy(runner.manager, input, before.id);
    const [saved] = await published();
    const { sourceRegisteredAt, sourceModifiedAt, ...fields } = input;
    expect(saved).toMatchObject({ ...fields, id: before.id, createdAt: before.createdAt });
    expect(saved.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(input).toEqual(inputBefore);
    expect(await runner.query(`SELECT to_char(source_registered_at, 'YYYY-MM-DD HH24:MI:SS') AS registered,
      to_char(source_modified_at, 'YYYY-MM-DD HH24:MI:SS') AS modified FROM "${schema}".policies`))
      .toEqual([{ registered: sourceRegisteredAt, modified: sourceModifiedAt }]);
  });

  it('입력에 추가된 UUID와 생성 시각은 기존 공개 식별자를 덮어쓰지 않는다', async () => {
    await repository.saveApprovedPolicy(runner.manager, policy('protected'), null);
    await setOldTimes();
    const [before] = await published();
    const input = { ...policy('protected', '승인 변경'), id: randomUUID(), createdAt: new Date('2026-01-01T00:00:00Z') };
    await repository.saveApprovedPolicy(runner.manager, input, before.id);
    expect((await published())[0]).toMatchObject({ id: before.id, createdAt: before.createdAt, title: '승인 변경' });
  });

  it('신규 승인 입력의 추가 UUID와 생성 시각도 DB 기본값을 사용한다', async () => {
    const input = { ...policy('new-protected'), id: randomUUID(), createdAt: new Date('2000-01-01T00:00:00Z') };
    await repository.saveApprovedPolicy(runner.manager, input, null);
    const [saved] = await published();
    expect(saved.id).not.toBe(input.id);
    expect(saved.createdAt.getTime()).toBeGreaterThan(input.createdAt.getTime());
  });

  it.each(['없는 UUID', '다른 출처', '다른 외부 ID'])('%s에 대한 기존 승인 저장은 새 행을 만들지 않고 거부한다', async (condition) => {
    await repository.saveApprovedPolicy(runner.manager, policy('target'), null);
    const [before] = await published();
    const input = policy('target', '잘못된 승인');
    if (condition === '다른 출처') input.source = 'other';
    if (condition === '다른 외부 ID') input.externalId = 'other';
    await expect(repository.saveApprovedPolicy(runner.manager, input, condition === '없는 UUID' ? randomUUID() : before.id))
      .rejects.toThrow('공개 기준 정책');
    expect(await published()).toEqual([before]);
  });

  it('신규 승인과 기존 공개 정책의 식별자가 충돌하면 기존 본문을 덮어쓰지 않는다', async () => {
    await repository.saveApprovedPolicy(runner.manager, policy('duplicate'), null);
    await runner.commitTransaction();
    const before = await connection.getRepository(Policy).find();
    await runner.startTransaction('READ COMMITTED');
    await expect(repository.saveApprovedPolicy(runner.manager, policy('duplicate', '덮어쓰면 안 되는 내용'), null))
      .rejects.toMatchObject({ driverError: { code: '23505' } });
    await runner.rollbackTransaction();
    expect(await connection.getRepository(Policy).find()).toEqual(before);
  });

  it('승인 입력의 최신 조회수는 검수 원문에 담긴 과거 조회수와 별도로 저장한다', async () => {
    const input = { ...policy('latest', '검수한 제목', '10'), viewCount: 99 };
    await repository.saveApprovedPolicy(runner.manager, input, null);
    expect((await published())[0]).toMatchObject({ viewCount: 99, rawJson: { inqCnt: '10' }, contentHash: input.contentHash });
  });

  it.each([99, 0, null])('조회수 %s 갱신은 원문과 해시를 포함한 나머지 전체 컬럼을 보존한다', async (viewCount) => {
    const input = policy('views', '승인 제목', '10', {
      plcyExplnCn: '공개 설명', frstRegDt: '2026-10-29 04:00:00', unknown: { nested: [null, '원문'] },
    });
    await repository.saveApprovedPolicy(runner.manager, input, null);
    await setOldTimes();
    const [before] = await published();
    // 미승인 본문이 입력 객체에 섞여도 조회수 갱신용 필드만 사용되는지 확인
    const incoming = { source: input.source, externalId: input.externalId, viewCount,
      title: '미승인 제목', rawJson: { plcyNm: '미승인 원문' }, contentHash: 'a'.repeat(64) };
    expect(await repository.refreshViewCounts(runner.manager, [incoming])).toBe(1);
    const [after] = await published();
    expect(after).toEqual({ ...before, viewCount, updatedAt: expect.any(Date) });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(after.rawJson.inqCnt).toBe('10');
  });

  it('여러 출처의 같은 외부 ID와 특수문자를 구분하고 공개본이 없는 원본은 건너뛴다', async () => {
    const first = policy("id' OR 1=1 --");
    const second = { ...first, source: 'other' };
    await repository.saveApprovedPolicy(runner.manager, first, null);
    await repository.saveApprovedPolicy(runner.manager, second, null);
    const before = await published();
    expect(await repository.refreshViewCounts(runner.manager, [
      { source: first.source, externalId: first.externalId, viewCount: null },
      { source: second.source, externalId: second.externalId, viewCount: 0 },
      { source: first.source, externalId: 'unpublished', viewCount: 999 },
    ])).toBe(2);
    const after = await published();
    expect(after).toHaveLength(2);
    for (const row of after) {
      const original = before.find(({ id }) => id === row.id)!;
      expect(row).toEqual({ ...original, viewCount: row.source === first.source ? null : 0, updatedAt: expect.any(Date) });
    }
  });

  it('공개본이 전혀 없는 조회수 갱신은 0건이며 새 정책을 공개하지 않는다', async () => {
    expect(await repository.refreshViewCounts(runner.manager, [{ source: 'youthcenter', externalId: 'unpublished', viewCount: 10 }])).toBe(0);
    expect(await published()).toEqual([]);
  });

  it('조회수 묶음 200건을 한 번의 UPDATE로 갱신하고 본문은 모두 보존한다', async () => {
    const input = Array.from({ length: 200 }, (_, i) => policy(`policy-${String(i).padStart(3, '0')}`));
    // 공개 정책을 묶음으로 준비하는 테스트 자료 저장
    await repository.upsertPolicies(runner.manager, input);
    const before = await published();
    const query = jest.spyOn(runner, 'query');
    const incoming = input.map(({ source, externalId }, i) => ({ source, externalId, viewCount: i % 2 === 0 ? i : null }));
    expect(await repository.refreshViewCounts(runner.manager, incoming)).toBe(200);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/^\s*UPDATE/);
    const after = await published();
    for (let i = 0; i < after.length; i += 1) {
      expect(after[i]).toEqual({ ...before[i], viewCount: incoming[i].viewCount, updatedAt: expect.any(Date) });
    }
  });

  it('빈 조회수 입력은 DB 쿼리 없이 0건을 반환한다', async () => {
    const query = jest.spyOn(runner, 'query');
    expect(await repository.refreshViewCounts(runner.manager, [])).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('같은 출처와 외부 ID의 중복 조회수 입력은 갱신 전에 거부한다', async () => {
    const item = { source: 'youthcenter', externalId: 'duplicate', viewCount: 10 };
    const query = jest.spyOn(runner, 'query');
    await expect(repository.refreshViewCounts(runner.manager, [item, { ...item, viewCount: 20 }])).rejects.toThrow('중복');
    expect(query).not.toHaveBeenCalled();
  });

  it('조회수 갱신 뒤 본문 저장이 실패하면 전체 트랜잭션 취소로 공개 상태를 복원한다', async () => {
    await repository.saveApprovedPolicy(runner.manager, policy('existing'), null);
    await runner.commitTransaction();
    const before = await connection.getRepository(Policy).find();
    await runner.startTransaction('READ COMMITTED');
    await repository.refreshViewCounts(runner.manager, [{ source: 'youthcenter', externalId: 'existing', viewCount: 99 }]);
    await repository.saveApprovedPolicy(runner.manager, policy('existing', '취소될 승인 본문'), before[0].id);
    await repository.saveApprovedPolicy(runner.manager, policy('new'), null);
    expect(await published()).toHaveLength(2);
    await expect(repository.saveApprovedPolicy(runner.manager, { ...policy('invalid'), category: 'x'.repeat(101) }, null))
      .rejects.toMatchObject({ driverError: { code: '22001' } });
    await runner.rollbackTransaction();
    expect(await connection.getRepository(Policy).find()).toEqual(before);
  });

  it.each([-1, 2147483648, 1.5, NaN, Infinity])('조회수 %s는 새 저장 경로에서 SQL 실행 전에 거부한다', async (viewCount) => {
    await repository.saveApprovedPolicy(runner.manager, policy('invalid-views'), null);
    await runner.commitTransaction();
    const before = await connection.getRepository(Policy).find();
    await runner.startTransaction('READ COMMITTED');
    const query = jest.spyOn(runner, 'query');
    await expect(repository.refreshViewCounts(runner.manager, [{ source: 'youthcenter', externalId: 'invalid-views', viewCount }]))
      .rejects.toThrow('공개 조회수');
    await expect(repository.saveApprovedPolicy(runner.manager, { ...policy('invalid-views'), viewCount }, before[0].id))
      .rejects.toThrow('공개 조회수');
    expect(query).not.toHaveBeenCalled();
    await runner.rollbackTransaction();
    expect(await connection.getRepository(Policy).find()).toEqual(before);
  });

  it('자동 확정 연결의 승인 저장과 조회수 갱신은 거부한다', async () => {
    await expect(repository.saveApprovedPolicy(connection.manager, policy('invalid'), null)).rejects.toThrow('트랜잭션 관리자');
    await expect(repository.refreshViewCounts(connection.manager, [])).rejects.toThrow('트랜잭션 관리자');
    expect(await connection.getRepository(Policy).count()).toBe(0);
  });
});
