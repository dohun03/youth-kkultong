import { QueryFailedError } from 'typeorm';
import type { EntityManager, QueryRunner } from 'typeorm';
import { parseEnvironment } from '../src/common/environment';
import { transformYouthCenterPolicy } from '../src/modules/ingestion/youth-center/youth-center-policy.transform';
import { createYouthCenterPolicyContentHash } from '../src/modules/ingestion/youth-center/youth-center-policy.hash';
import { PolicyCollectionCommitError } from '../src/modules/policies/services/collection/policy-collection-write.service';
import { createCollectionWriter } from './helpers/policy-collection';
import type { SourcePolicy } from '../src/modules/policies/entities/source-policy.entity';

/** PostgreSQL 오류 코드를 갖는 저장 실패를 준비 */
function databaseError(code: string): QueryFailedError {
  return new QueryFailedError('검증용 SQL', [], Object.assign(new Error('검증 오류'), { code }));
}

describe('새 수집 저장의 트랜잭션과 재시도 경계', () => {
  const environment = parseEnvironment({ DATABASE_URL: 'postgresql://test@db/test' });
  const rawJson = { plcyNo: 'p', plcyNm: '검증 정책', inqCnt: '10' };
  const input = { ...transformYouthCenterPolicy(rawJson), contentHash: createYouthCenterPolicyContentHash(rawJson) };
  const observedAt = new Date('2026-10-30T04:00:00Z');
  let runner: QueryRunner;
  let manager: EntityManager;
  let service: ReturnType<typeof createCollectionWriter>;
  let stored: boolean;
  let flags: { active: boolean; released: boolean };
  beforeEach(() => {
    stored = false;
    flags = { active: false, released: false };
    manager = { sql: jest.fn().mockResolvedValue([{ connected: true }]) } as unknown as EntityManager;
    runner = { manager, get isTransactionActive() { return flags.active; }, get isReleased() { return flags.released; },
      startTransaction: jest.fn(async () => { flags.active = true; }),
      commitTransaction: jest.fn(async () => { flags.active = false; }),
      rollbackTransaction: jest.fn(async () => { stored = false; flags.active = false; }), release: jest.fn(),
    } as unknown as QueryRunner;
    service = createCollectionWriter(environment);
    const original: SourcePolicy = { ...input, id: '00000000-0000-4000-8000-000000000001', rawJson,
      firstCollectedAt: observedAt, lastCollectedAt: observedAt, lastCollectionResult: 'NEW', missingCount: 0,
      createdAt: observedAt, updatedAt: observedAt };
    jest.spyOn(service['sources'], 'findBySourceForUpdate').mockImplementation(async () => stored ? [original] : []);
    jest.spyOn(service['sources'], 'upsertCollectedPolicies').mockImplementation(async () => { stored = true; });
    jest.spyOn(service['sources'], 'updateMissingPolicies').mockResolvedValue();
    jest.spyOn(service['policies'], 'findPublicSnapshots').mockResolvedValue([]);
    jest.spyOn(service['policies'], 'refreshViewCounts').mockResolvedValue(0);
    jest.spyOn(service['reviews'], 'findPendingReviews').mockResolvedValue([]);
    jest.spyOn(service['reviews'], 'findRejectedHashes').mockResolvedValue([]);
    jest.spyOn(service['reviewWriter'], 'saveReviewChanges').mockResolvedValue();
  });
  afterEach(() => jest.restoreAllMocks());

  /** 준비된 정상 전체 수집 한 건을 저장 */
  function save(observer?: (attempt: number, error?: unknown) => Promise<void>) {
    return service.saveCollection(runner, 'youthcenter', [input], observedAt, observer);
  }

  it('같은 관리자로 저장한 뒤 한 번만 확정하고 연결을 유지한다', async () => {
    expect(await save()).toEqual({ counts: { NEW: 1, CHANGED: 0, UNCHANGED: 0, MISSING: 0 },
      reviewCreatedCount: 1, reviewSupersededCount: 0, publicViewUpdatedCount: 0 });
    expect(runner.startTransaction).toHaveBeenCalledWith('READ COMMITTED');
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(runner.release).not.toHaveBeenCalled();
    expect(service['sources'].upsertCollectedPolicies).toHaveBeenCalledWith(manager,
      [expect.objectContaining({ rawJson, lastCollectionResult: 'NEW' })], observedAt);
  });
  it.each(['조회', '원본', '검수', '조회수'])('%s 실패는 전체 취소하고 원래 오류를 전달한다', async (stage) => {
    const error = new Error(stage);
    if (stage === '조회') jest.mocked(service['sources'].findBySourceForUpdate).mockRejectedValueOnce(error);
    if (stage === '원본') jest.mocked(service['sources'].upsertCollectedPolicies).mockRejectedValueOnce(error);
    if (stage === '검수') jest.mocked(service['reviewWriter'].saveReviewChanges).mockRejectedValueOnce(error);
    if (stage === '조회수') jest.mocked(service['policies'].refreshViewCounts).mockRejectedValueOnce(error);
    await expect(save()).rejects.toBe(error);
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(runner.commitTransaction).not.toHaveBeenCalled();
    expect(stored).toBe(false);
  });
  it.each([false, true])('트랜잭션 시작 실패 시 활성 상태 %s에 맞춰 취소한다', async (active) => {
    jest.mocked(runner.startTransaction).mockImplementationOnce(async () => { flags.active = active; throw new Error('시작 실패'); });
    await expect(save()).rejects.toThrow('시작 실패');
    expect(service['sources'].findBySourceForUpdate).not.toHaveBeenCalled();
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(active ? 1 : 0);
  });
  it.each(['진행 중', '반환됨'])('%s 연결은 새 트랜잭션에 사용하지 않는다', async (state) => {
    flags.active = state === '진행 중'; flags.released = state === '반환됨';
    await expect(save()).rejects.toThrow('새 트랜잭션 연결');
    expect(runner.startTransaction).not.toHaveBeenCalled(); expect(runner.rollbackTransaction).not.toHaveBeenCalled();
  });
  it.each(['40P01', '40001'])('%s는 한 번만 재시도하고 판정을 다시 계산한다', async (code) => {
    const error = databaseError(code);
    jest.mocked(service['policies'].refreshViewCounts).mockRejectedValueOnce(error);
    const observer = jest.fn(async () => {});
    expect(await save(observer)).toMatchObject({ counts: { NEW: 1 }, reviewCreatedCount: 1 });
    expect(runner.startTransaction).toHaveBeenCalledTimes(2);
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenNthCalledWith(2, 2, error);
  });
  it.each(['40P01', '40001'])('%s가 두 번 발생하면 두 번 모두 취소하고 멈춘다', async (code) => {
    const error = databaseError(code); jest.mocked(service['policies'].refreshViewCounts).mockRejectedValue(error);
    await expect(save()).rejects.toBe(error);
    expect(runner.startTransaction).toHaveBeenCalledTimes(2); expect(runner.rollbackTransaction).toHaveBeenCalledTimes(2);
  });
  it.each(['23505', '22001', '08006', '57014', '40000', 'ECONNRESET'])('%s는 재시도하지 않는다', async (code) => {
    const error = databaseError(code); jest.mocked(service['policies'].refreshViewCounts).mockRejectedValueOnce(error);
    await expect(save()).rejects.toBe(error); expect(runner.startTransaction).toHaveBeenCalledTimes(1);
  });
  it('일반 오류의 충돌 코드는 재시도 대상으로 취급하지 않는다', async () => {
    const error = Object.assign(new Error('일반 오류'), { code: '40001' });
    jest.mocked(service['policies'].refreshViewCounts).mockRejectedValueOnce(error);
    await expect(save()).rejects.toBe(error); expect(runner.startTransaction).toHaveBeenCalledTimes(1);
  });
  it.each(['조회', 'COMMIT'])('%s의 직렬화 충돌도 전체 재시도한다', async (stage) => {
    const error = databaseError('40001');
    if (stage === '조회') jest.mocked(service['sources'].findBySourceForUpdate).mockRejectedValueOnce(error);
    else jest.mocked(runner.commitTransaction).mockRejectedValueOnce(error);
    expect(await save()).toMatchObject({ counts: { NEW: 1 } }); expect(runner.startTransaction).toHaveBeenCalledTimes(2);
  });
  it('COMMIT 응답 유실은 확정 불명 오류로 전달하고 저장을 반복하지 않는다', async () => {
    const error = new Error('응답 유실'); jest.mocked(runner.commitTransaction).mockRejectedValueOnce(error);
    await expect(save()).rejects.toMatchObject({ name: PolicyCollectionCommitError.name, cause: error });
    expect(runner.startTransaction).toHaveBeenCalledTimes(1);
  });
  it('취소 실패는 원래 오류와 함께 보존한다', async () => {
    const error = databaseError('40P01'); const rollbackError = new Error('취소 실패');
    jest.mocked(service['policies'].refreshViewCounts).mockRejectedValueOnce(error);
    jest.mocked(runner.rollbackTransaction).mockRejectedValueOnce(rollbackError);
    await expect(save()).rejects.toMatchObject({ errors: [error, rollbackError] }); expect(runner.startTransaction).toHaveBeenCalledTimes(1);
  });
  it.each(['활성 상태', '반환됨'])('충돌 취소 뒤 %s 연결은 재시도하지 않는다', async (state) => {
    const error = databaseError('40P01'); jest.mocked(service['policies'].refreshViewCounts).mockRejectedValueOnce(error);
    jest.mocked(runner.rollbackTransaction).mockImplementationOnce(async () => {
      flags.active = state === '활성 상태'; flags.released = state === '반환됨';
    });
    await expect(save()).rejects.toBe(error); expect(runner.startTransaction).toHaveBeenCalledTimes(1);
  });
  it('같은 연결 확인 실패는 두 오류를 보존하고 재시도를 중단한다', async () => {
    const error = databaseError('40001'); const connectionError = new Error('연결 끊김');
    jest.mocked(service['policies'].refreshViewCounts).mockRejectedValueOnce(error);
    jest.mocked(manager.sql).mockRejectedValueOnce(connectionError);
    await expect(save()).rejects.toMatchObject({ errors: [error, connectionError] }); expect(runner.startTransaction).toHaveBeenCalledTimes(1);
  });
  it('저장 시도 로그 실패는 트랜잭션을 열지 않는다', async () => {
    await expect(save(async () => { throw new Error('로그 실패'); })).rejects.toThrow('로그 실패');
    expect(runner.startTransaction).not.toHaveBeenCalled();
  });
});
