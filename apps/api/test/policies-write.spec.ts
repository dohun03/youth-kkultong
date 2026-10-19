import type { EntityManager } from 'typeorm';
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
