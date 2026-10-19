import type { EntityManager, QueryRunner } from 'typeorm';
import { parseEnvironment } from '../src/common/environment';
import { createYouthCenterPolicyContentHash } from '../src/modules/ingestion/youth-center-policy.hash';
import { transformYouthCenterPolicy } from '../src/modules/ingestion/youth-center-policy.transform';
import { PoliciesWriteService } from '../src/modules/policies/policies-write.service';
import type { PolicyWriteInput } from '../src/modules/policies/policies-write.service';
import { PolicyRepository } from '../src/modules/policies/policy.repository';

/** 테스트용 정책 데이터를 만들고 내용 해시 계산 */
function candidate(id: string, title = '검증 정책', views: string | null = '10'): PolicyWriteInput {
  const raw = { plcyNo: id, plcyNm: title, inqCnt: views };
  return { ...transformYouthCenterPolicy(raw), contentHash: createYouthCenterPolicyContentHash(raw) };
}

describe('정책 저장 전 변경 분류', () => {
  const manager = {} as EntityManager;
  const environment = parseEnvironment({ DATABASE_URL: 'postgresql://test@db/test' });
  let repository: PolicyRepository;
  let service: PoliciesWriteService;

  beforeEach(() => {
    repository = new PolicyRepository();
    service = new PoliciesWriteService(repository, environment);
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['새 정책', undefined, candidate('policy'), 'NEW'],
    ['내용 변경', candidate('policy', '기존 제목'), candidate('policy', '새 제목'), 'CHANGED'],
    ['조회수만 변경', candidate('policy'), candidate('policy', '검증 정책', '20'), 'UNCHANGED'],
    ['같은 자료', candidate('policy'), candidate('policy'), 'UNCHANGED'],
  ] as const)('%s을 올바르게 분류한다', async (_label, previous, incoming, status) => {
    jest.spyOn(repository, 'findContentHashes').mockResolvedValue(previous ? [previous] : []);
    const result = await service.prepareBatches(manager, [incoming]);
    expect(result.batches[0][0].status).toBe(status);
    expect(result.counts).toEqual({ NEW: 0, CHANGED: 0, UNCHANGED: 0, [status]: 1 });
    if (status !== 'UNCHANGED') expect(result.batches[0][0].data).toEqual(incoming);
  });

  it.each(['0', null])('동일 정책에도 최신 원본과 조회수 %s을 준비하고 내용 컬럼은 제외한다', async (views) => {
    const previous = candidate('policy');
    const incoming = candidate('policy', '검증 정책', views);
    jest.spyOn(repository, 'findContentHashes').mockResolvedValue([previous]);
    const before = structuredClone(incoming);
    expect((await service.prepareBatches(manager, [incoming])).batches).toEqual([[{
      status: 'UNCHANGED', data: {
        source: incoming.source, externalId: incoming.externalId,
        rawJson: incoming.rawJson, viewCount: incoming.viewCount,
      },
    }]]);
    expect(incoming).toEqual(before);
  });

  it('조회수가 그대로여도 제목이 바뀌면 전체 변경 자료를 준비한다', async () => {
    const previous = candidate('policy');
    const incoming = candidate('policy', '변경 제목');
    jest.spyOn(repository, 'findContentHashes').mockResolvedValue([previous]);
    expect((await service.prepareBatches(manager, [incoming])).batches).toEqual([[{
      status: 'CHANGED', data: incoming,
    }]]);
  });

  it('같은 외부 ID라도 출처가 다르면 신규이고, 복합 키의 구분 문자도 충돌하지 않는다', async () => {
    const incoming = [
      { ...candidate('same'), source: 'other' },
      { ...candidate('b:c'), source: 'a' },
      { ...candidate('b","c'), source: 'a' },
    ];
    jest.spyOn(repository, 'findContentHashes').mockResolvedValue([
      candidate('same'),
      { ...candidate('c'), source: 'a:b' },
      { ...candidate('c'), source: 'a","b' },
    ]);
    const result = await service.prepareBatches(manager, incoming);
    expect(result.counts).toEqual({ NEW: 3, CHANGED: 0, UNCHANGED: 0 });
    expect(result.batches[0].map((item) => item.status)).toEqual(['NEW', 'NEW', 'NEW']);
  });

  it.each([
    [0, []], [1, [1]], [199, [199]], [200, [200]], [201, [200, 1]], [401, [200, 200, 1]],
  ])('%i건을 최대 200건씩 준비하고 입력 순서·건수를 유지한다', async (length, sizes) => {
    const incoming = Array.from({ length }, (_, index) => candidate(`policy-${index}`));
    const lookup = jest.spyOn(repository, 'findContentHashes').mockResolvedValue([]);
    const result = await service.prepareBatches(manager, incoming);
    expect(result.batches.map((batch) => batch.length)).toEqual(sizes);
    expect(result.batches.flat().map((item) => item.data.externalId)).toEqual(incoming.map((item) => item.externalId));
    expect(result.counts).toEqual({ NEW: length, CHANGED: 0, UNCHANGED: 0 });
    expect(lookup).toHaveBeenCalledTimes(sizes.length);
    expect(lookup.mock.calls.map((call) => call[1].length)).toEqual(sizes);
    expect(lookup.mock.calls.every((call) => call[0] === manager)).toBe(true);
  });

  it('설정한 작은 묶음 크기로 조회하고 여러 묶음의 분류 건수를 합산한다', async () => {
    service = new PoliciesWriteService(repository, { ...environment, POLICY_IMPORT_BATCH_SIZE: 2 });
    const previous = [candidate('changed', '이전 제목'), candidate('same')];
    const incoming = [candidate('new'), candidate('changed', '새 제목'), candidate('same', '검증 정책', '20')];
    const lookup = jest.spyOn(repository, 'findContentHashes').mockImplementation(async (_manager, keys) => (
      previous.filter((row) => keys.some((key) => key.source === row.source && key.externalId === row.externalId))
    ));
    const result = await service.prepareBatches(manager, incoming);
    expect(result.batches.map((batch) => batch.length)).toEqual([2, 1]);
    expect(result.batches.flat().map((item) => item.status)).toEqual(['NEW', 'CHANGED', 'UNCHANGED']);
    expect(result.counts).toEqual({ NEW: 1, CHANGED: 1, UNCHANGED: 1 });
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('다음 묶음의 조회가 실패하면 부분 결과 없이 오류를 호출자에게 전달한다', async () => {
    service = new PoliciesWriteService(repository, { ...environment, POLICY_IMPORT_BATCH_SIZE: 1 });
    const error = new Error('모의 DB 조회 실패');
    jest.spyOn(repository, 'findContentHashes').mockResolvedValueOnce([]).mockRejectedValueOnce(error);
    await expect(service.prepareBatches(manager, [candidate('first'), candidate('second')])).rejects.toBe(error);
  });

  it('빈 키 목록은 DB에 접근하지 않고 빈 해시 목록을 반환한다', async () => {
    await expect(repository.findContentHashes(manager, [])).resolves.toEqual([]);
  });
});

describe('전체 정책 저장 트랜잭션', () => {
  const manager = {} as EntityManager;
  const environment = parseEnvironment({ DATABASE_URL: 'postgresql://test@db/test' });
  let runner: QueryRunner;
  let transactionActive: boolean;
  let repository: PolicyRepository;
  let service: PoliciesWriteService;

  beforeEach(() => {
    // 실제 DB 없이 트랜잭션 시작·확정·취소 호출 확인
    transactionActive = false;
    runner = {
      manager,
      get isTransactionActive() { return transactionActive; },
      startTransaction: jest.fn(async () => { transactionActive = true; }),
      commitTransaction: jest.fn(async () => { transactionActive = false; }),
      rollbackTransaction: jest.fn(async () => { transactionActive = false; }),
      release: jest.fn(),
    } as unknown as QueryRunner;
    repository = new PolicyRepository();
    jest.spyOn(repository, 'findContentHashes').mockResolvedValue([]);
    jest.spyOn(repository, 'upsertPolicies').mockResolvedValue();
    jest.spyOn(repository, 'refreshPolicies').mockResolvedValue();
    service = new PoliciesWriteService(repository, environment);
  });

  afterEach(() => jest.restoreAllMocks());

  it('401건을 같은 관리자로 저장하고 트랜잭션은 한 번만 확정한다', async () => {
    const policies = Array.from({ length: 401 }, (_, index) => candidate(`policy-${index}`));
    const lookup = jest.mocked(repository.findContentHashes);
    lookup.mockImplementation(async () => {
      expect(runner.isTransactionActive).toBe(true);
      return [];
    });
    await expect(service.savePolicies(runner, policies)).resolves.toEqual({ NEW: 401, CHANGED: 0, UNCHANGED: 0 });
    expect(runner.startTransaction).toHaveBeenCalledTimes(1);
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(runner.rollbackTransaction).not.toHaveBeenCalled();
    expect(jest.mocked(repository.upsertPolicies).mock.calls.map((call) => call[1].length)).toEqual([200, 200, 1]);
    for (const method of [repository.findContentHashes, repository.upsertPolicies, repository.refreshPolicies]) {
      expect(jest.mocked(method).mock.calls.every((call) => call[0] === manager)).toBe(true);
    }
    expect(runner.release).not.toHaveBeenCalled();
  });

  it('동일 정책은 원본·조회수 갱신으로 보내고 신규는 전체 저장으로 보낸다', async () => {
    const same = candidate('same', '검증 정책', '20');
    jest.mocked(repository.findContentHashes).mockResolvedValue([candidate('same')]);
    await expect(service.savePolicies(runner, [same, candidate('new')]))
      .resolves.toEqual({ NEW: 1, CHANGED: 0, UNCHANGED: 1 });
    expect(repository.refreshPolicies).toHaveBeenCalledWith(manager, [{
      source: same.source, externalId: same.externalId, rawJson: same.rawJson, viewCount: 20,
    }]);
    expect(repository.upsertPolicies).toHaveBeenCalledWith(manager, [candidate('new')]);
  });

  it.each(['조회', '전체 저장', '동일 갱신', '확정'] as const)('%s 실패 시 전체 취소하고 원래 오류를 전달한다', async (stage) => {
    const error = new Error(`모의 ${stage} 오류`);
    const method = {
      조회: repository.findContentHashes, '전체 저장': repository.upsertPolicies,
      '동일 갱신': repository.refreshPolicies, 확정: runner.commitTransaction,
    }[stage];
    jest.mocked(method).mockRejectedValueOnce(error);
    await expect(service.savePolicies(runner, [candidate('policy')])).rejects.toBe(error);
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    if (stage !== '확정') expect(runner.commitTransaction).not.toHaveBeenCalled();
    expect(runner.isTransactionActive).toBe(false);
    expect(runner.release).not.toHaveBeenCalled();
  });

  it('트랜잭션 시작이 실패하면 데이터를 조회하거나 저장하지 않는다', async () => {
    const error = new Error('모의 시작 오류');
    jest.mocked(runner.startTransaction).mockRejectedValueOnce(error);
    await expect(service.savePolicies(runner, [candidate('policy')])).rejects.toBe(error);
    expect(repository.findContentHashes).not.toHaveBeenCalled();
    expect(repository.upsertPolicies).not.toHaveBeenCalled();
    expect(runner.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('시작 도중 오류가 나도 트랜잭션이 활성 상태라면 취소를 시도한다', async () => {
    const error = new Error('모의 시작 도중 오류');
    jest.mocked(runner.startTransaction).mockImplementationOnce(async () => {
      transactionActive = true;
      throw error;
    });
    await expect(service.savePolicies(runner, [candidate('policy')])).rejects.toBe(error);
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(repository.findContentHashes).not.toHaveBeenCalled();
  });

  it('저장 취소도 실패하면 저장 오류와 취소 오류를 모두 보존한다', async () => {
    const writeError = new Error('모의 저장 오류');
    const rollbackError = new Error('모의 취소 오류');
    jest.mocked(repository.upsertPolicies).mockRejectedValueOnce(writeError);
    jest.mocked(runner.rollbackTransaction).mockRejectedValueOnce(rollbackError);
    await expect(service.savePolicies(runner, [candidate('policy')])).rejects.toMatchObject({
      errors: [writeError, rollbackError],
    });
    expect(runner.commitTransaction).not.toHaveBeenCalled();
    expect(runner.release).not.toHaveBeenCalled();
  });

  it('이미 열린 트랜잭션은 시작·확정·취소하지 않는다', async () => {
    transactionActive = true;
    await expect(service.savePolicies(runner, [candidate('policy')])).rejects.toThrow('이미 트랜잭션');
    expect(runner.startTransaction).not.toHaveBeenCalled();
    expect(runner.commitTransaction).not.toHaveBeenCalled();
    expect(runner.rollbackTransaction).not.toHaveBeenCalled();
    expect(repository.findContentHashes).not.toHaveBeenCalled();
  });

  it('빈 수집 결과는 0건을 반환하고 기존 정책을 건드리지 않는다', async () => {
    await expect(service.savePolicies(runner, [])).resolves.toEqual({ NEW: 0, CHANGED: 0, UNCHANGED: 0 });
    expect(repository.findContentHashes).not.toHaveBeenCalled();
    expect(repository.upsertPolicies).not.toHaveBeenCalled();
    expect(repository.refreshPolicies).not.toHaveBeenCalled();
  });

  it('빈 저장 목록은 Repository에서도 SQL을 실행하지 않는다', async () => {
    const realRepository = new PolicyRepository();
    await expect(realRepository.upsertPolicies(manager, [])).resolves.toBeUndefined();
    await expect(realRepository.refreshPolicies(manager, [])).resolves.toBeUndefined();
  });
});
