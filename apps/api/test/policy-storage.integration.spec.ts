import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { DataSource, QueryRunner } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import { createDataSource } from '../src/database/data-source';
import { CreatePolicies1792162800000 } from '../src/database/migrations/1792162800000-create-policies';
import { IngestionLockService } from '../src/modules/ingestion/services/ingestion-lock.service';
import { createYouthCenterPolicyContentHash } from '../src/modules/ingestion/youth-center/youth-center-policy.hash';
import { transformYouthCenterPolicy } from '../src/modules/ingestion/youth-center/youth-center-policy.transform';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { PoliciesWriteService } from '../src/modules/policies/policies-write.service';
import type { PolicyWriteInput } from '../src/modules/policies/policies-write.service';
import { PolicyRepository } from '../src/modules/policies/policy.repository';

/** 원본 변환과 해시 계산을 마친 테스트 정책 생성 */
function candidate(id: string, title = '검증 정책', views = '10', fields: Record<string, unknown> = {}): PolicyWriteInput {
  const raw = { plcyNo: id, plcyNm: title, inqCnt: views, ...fields };
  return { ...transformYouthCenterPolicy(raw), contentHash: createYouthCenterPolicyContentHash(raw) };
}

describe('정책 전체 트랜잭션의 실제 PostgreSQL 검증', () => {
  const schema = `step22_test_${randomUUID().replaceAll('-', '')}`;
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
    repository = new PolicyRepository();
    service = new PoliciesWriteService(repository, { ...environment, POLICY_IMPORT_BATCH_SIZE: 200 });
  });

  beforeEach(async () => {
    // 테스트 전용 테이블만 비우고 새 연결 준비
    await dataSource.getRepository(Policy).clear();
    runner = dataSource.createQueryRunner();
    await runner.connect();
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

  it('401건을 세 번의 벌크 저장으로 반영하고 마지막에 한 번만 확정한다', async () => {
    const incoming = Array.from({ length: 401 }, (_, index) => candidate(`policy-${index}`));
    const before = structuredClone(incoming);
    const commit = runner.commitTransaction.bind(runner);
    jest.spyOn(runner, 'commitTransaction').mockImplementation(async () => {
      // 확정 전에는 다른 연결에서 첫 번째 묶음조차 보이지 않아야 함
      expect(await dataSource.getRepository(Policy).count()).toBe(0);
      await commit();
    });
    const query = jest.spyOn(runner, 'query');
    await expect(service.savePolicies(runner, incoming)).resolves.toEqual({ NEW: 401, CHANGED: 0, UNCHANGED: 0 });
    expect(await dataSource.getRepository(Policy).count()).toBe(401);
    const inserts = query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO'));
    expect(inserts.map(([, parameters]) => (parameters?.length ?? 0) / 26)).toEqual([200, 200, 1]);
    expect(query.mock.calls.filter(([sql]) => sql === 'START TRANSACTION')).toHaveLength(1);
    expect(query.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(1);
    expect(query.mock.calls.some(([sql]) => sql.includes('SAVEPOINT'))).toBe(false);
    expect(runner.isTransactionActive).toBe(false);
    expect(runner.isReleased).toBe(false);
    expect(incoming).toEqual(before);
  });

  it('401건의 내용 변경과 조회수 갱신도 각각 세 번의 벌크 쿼리로 저장한다', async () => {
    const incoming = Array.from({ length: 401 }, (_, index) => candidate(`policy-${index}`));
    await service.savePolicies(runner, incoming);
    const changed = incoming.map((policy) => candidate(policy.externalId, '변경된 제목'));
    const query = jest.spyOn(runner, 'query');
    await expect(service.savePolicies(runner, changed)).resolves.toEqual({ NEW: 0, CHANGED: 401, UNCHANGED: 0 });
    expect(query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO'))
      .map(([, parameters]) => (parameters?.length ?? 0) / 26)).toEqual([200, 200, 1]);

    query.mockClear();
    const refreshed = changed.map((policy) => ({ ...policy, viewCount: 100, rawJson: { ...policy.rawJson, inqCnt: '100' } }));
    await expect(service.savePolicies(runner, refreshed)).resolves.toEqual({ NEW: 0, CHANGED: 0, UNCHANGED: 401 });
    expect(query.mock.calls.filter(([sql]) => sql.includes('UPDATE '))
      .map(([, parameters]) => {
        if (!Array.isArray(parameters)) throw new Error('갱신 매개변수가 배열이 아닙니다.');
        expect(parameters).toHaveLength(1);
        return JSON.parse(parameters[0]).length;
      })).toEqual([200, 200, 1]);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO'))).toBe(false);
    expect(await dataSource.getRepository(Policy).countBy({ title: '변경된 제목', viewCount: 100 })).toBe(401);
  });

  it.each(['UTC', 'America/New_York'])('호스트 시간대가 %s여도 원본 시각·날짜·전체 컬럼을 보존한다', async (timezone) => {
    const policy = candidate('all-fields', '전체 컬럼 정책', '0', {
      lclsfNm: '일자리', mclsfNm: '취업', plcyExplnCn: ' 설명\n보존 ', plcySprtCn: '지원 내용',
      aplyUrlAddr: 'https://example.com/apply', refUrlAddr1: 'https://example.com/1', refUrlAddr2: 'https://example.com/2',
      frstRegDt: '2026-03-08 02:30:00', lastMdfcnDt: '2026-10-19 00:30:00',
      aplyPrdSeCd: '0057001', aplyYmd: '20261001 ~ 20261031',
      sprtTrgtMinAge: '0', sprtTrgtMaxAge: '34', jobCd: '0013001,0013010', schoolCd: '0049010',
      zipCd: '11000,11110', addAplyQlfcCndCn: '추가 자격', ptcpPrpTrgtCn: '참여 제한',
      unknown: { list: ['', 0, null, { inqCnt: '중첩 값' }] },
    });
    const previousTimezone = process.env.TZ;
    try {
      process.env.TZ = timezone;
      await service.savePolicies(runner, [policy]);
      const { sourceRegisteredAt, sourceModifiedAt, ...fields } = policy;
      expect(await dataSource.getRepository(Policy).findOneByOrFail({ externalId: policy.externalId })).toMatchObject(fields);
      expect(await runner.query(`
        SELECT to_char(source_registered_at, 'YYYY-MM-DD HH24:MI:SS') AS registered,
               to_char(source_modified_at, 'YYYY-MM-DD HH24:MI:SS') AS modified
        FROM "${schema}".policies
      `)).toEqual([{ registered: sourceRegisteredAt, modified: sourceModifiedAt }]);
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it.each(['0', '해석 불가'])('재수집에서 신규·변경을 저장하고 동일 정책의 조회수 %s만 최신화한다', async (views) => {
    const existing = [candidate('changed', '이전 제목', '5', { plcyExplnCn: '이전 설명' }), candidate('views'), candidate('same'), candidate('outside')];
    await service.savePolicies(runner, existing);
    await runner.query(`UPDATE "${schema}".policies SET created_at = '2000-01-01T00:00:00Z', updated_at = '2000-01-01T00:00:00Z'`);
    // 동일 정책의 본문은 갱신 대상에 포함되지 않는지 확인
    await runner.manager.getRepository(Policy).update({ externalId: 'same' }, { title: 'DB에 보관 중인 제목' });
    const before = await runner.manager.getRepository(Policy).find({ order: { externalId: 'ASC' } });
    const incoming = [candidate('new'), candidate('changed', '새 제목', '15', { plcyExplnCn: '' }), candidate('views', '검증 정책', views), candidate('same')];
    await expect(service.savePolicies(runner, incoming)).resolves.toEqual({ NEW: 1, CHANGED: 1, UNCHANGED: 2 });
    const after = await dataSource.getRepository(Policy).find({ order: { externalId: 'ASC' } });
    expect(after).toHaveLength(5);
    expect(after.find((policy) => policy.externalId === 'changed')).toMatchObject({
      title: '새 제목', description: null, contentHash: incoming[1].contentHash, rawJson: incoming[1].rawJson, viewCount: 15,
    });
    expect(after.find((policy) => policy.externalId === 'views')).toMatchObject({ viewCount: views === '0' ? 0 : null, rawJson: incoming[2].rawJson });
    expect(after.find((policy) => policy.externalId === 'same')?.title).toBe('DB에 보관 중인 제목');
    for (const original of before) {
      const updated = after.find((policy) => policy.id === original.id)!;
      expect(updated.createdAt).toEqual(original.createdAt);
      if (original.externalId === 'outside') expect(updated).toEqual(original);
      else expect(updated.updatedAt.getTime()).toBeGreaterThan(new Date('2000-01-01T00:00:00Z').getTime());
    }
    await expect(service.savePolicies(runner, incoming)).resolves.toEqual({ NEW: 0, CHANGED: 0, UNCHANGED: 4 });
    expect(await dataSource.getRepository(Policy).count()).toBe(5);
  });

  it('같은 외부 ID도 출처별로 저장하며 특수 문자와 원본 JSON을 보존한다', async () => {
    const incoming = [
      { ...candidate("id' OR 1=1 --", '제목 \' " \\ 한글', '0', { extra: { values: ['\n', null, 0] } }), source: 'first' },
      { ...candidate("id' OR 1=1 --", '다른 출처', '1'), source: 'second' },
    ];
    await expect(service.savePolicies(runner, incoming)).resolves.toEqual({ NEW: 2, CHANGED: 0, UNCHANGED: 0 });
    incoming[0] = { ...incoming[0], viewCount: null, rawJson: { ...incoming[0].rawJson, inqCnt: '' } };
    await expect(service.savePolicies(runner, incoming)).resolves.toEqual({ NEW: 0, CHANGED: 0, UNCHANGED: 2 });
    for (const policy of incoming) {
      expect(await dataSource.getRepository(Policy).findOneByOrFail({ source: policy.source, externalId: policy.externalId }))
        .toMatchObject({ title: policy.title, rawJson: policy.rawJson, viewCount: policy.viewCount });
    }
  });

  it('2,000번째 정책의 DB 제약 오류로 앞의 모든 묶음과 기존 정책 변경도 취소한다', async () => {
    await service.savePolicies(runner, [candidate('existing', '기존 제목'), candidate('outside')]);
    const table = dataSource.getRepository(Policy);
    const before = await table.find({ order: { externalId: 'ASC' } });
    const incoming = Array.from({ length: 2100 }, (_, index) => candidate(`policy-${index}`));
    incoming[0] = candidate('existing', '바뀌면 안 되는 제목');
    // 10번째 묶음에서 실제 varchar 길이 제약 오류 발생
    incoming[1999].category = 'x'.repeat(101);
    const query = jest.spyOn(runner, 'query');
    await expect(service.savePolicies(runner, incoming)).rejects.toMatchObject({ driverError: { code: '22001' } });
    expect(query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO'))).toHaveLength(10);
    expect(query.mock.calls.filter(([sql]) => sql === 'ROLLBACK')).toHaveLength(1);
    expect(query.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(0);
    expect(await table.find({ order: { externalId: 'ASC' } })).toEqual(before);
    expect(runner.isTransactionActive).toBe(false);
    expect(runner.isReleased).toBe(false);
  });

  it('뒤 묶음이 실패하면 앞 묶음에서 갱신한 동일 정책의 조회수·원본도 되돌린다', async () => {
    await service.savePolicies(runner, [candidate('views')]);
    const table = dataSource.getRepository(Policy);
    const before = await table.find();
    const incoming = [candidate('views', '검증 정책', '99'), ...Array.from({ length: 200 }, (_, index) => candidate(`policy-${index}`))];
    incoming[200].category = 'x'.repeat(101);
    const refresh = repository.refreshPolicies.bind(repository);
    const refreshed = jest.spyOn(repository, 'refreshPolicies').mockImplementation(async (manager, policies) => {
      await refresh(manager, policies);
      expect((await manager.getRepository(Policy).findOneByOrFail({ externalId: 'views' })).viewCount).toBe(99);
    });
    await expect(service.savePolicies(runner, incoming)).rejects.toMatchObject({ driverError: { code: '22001' } });
    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(await table.find()).toEqual(before);
  });

  it('저장 확정·취소 뒤에도 수집 잠금과 같은 연결을 유지한다', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const lock = new IngestionLockService(dataSource);
    await expect(lock.runWithLock(async (lockedRunner) => {
      const pid = (await lockedRunner.query('SELECT pg_backend_pid() AS pid'))[0].pid;
      await service.savePolicies(lockedRunner, [candidate('locked')]);
      await expect(lock.runWithLock(async () => '중복 실행')).resolves.toEqual({ status: 'ALREADY_RUNNING' });
      const invalid = { ...candidate('invalid'), category: 'x'.repeat(101) };
      await expect(service.savePolicies(lockedRunner, [invalid])).rejects.toMatchObject({ driverError: { code: '22001' } });
      await expect(lock.runWithLock(async () => '중복 실행')).resolves.toEqual({ status: 'ALREADY_RUNNING' });
      expect((await lockedRunner.query('SELECT pg_backend_pid() AS pid'))[0].pid).toBe(pid);
      expect(lockedRunner.isTransactionActive).toBe(false);
      return '저장 검증 완료';
    })).resolves.toEqual({ status: 'COMPLETED', value: '저장 검증 완료' });
    await expect(lock.runWithLock(async () => true)).resolves.toEqual({ status: 'COMPLETED', value: true });
  });
});
