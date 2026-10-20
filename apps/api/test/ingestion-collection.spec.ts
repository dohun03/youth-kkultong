import { parseEnvironment } from '../src/common/environment';
import { DataSource } from 'typeorm';
import { IngestionLockService } from '../src/modules/ingestion/services/ingestion-lock.service';
import { IngestionLogService } from '../src/modules/ingestion/services/ingestion-log.service';
import { PoliciesWriteService } from '../src/modules/policies/services/policies-write.service';
import { PolicyRepository } from '../src/modules/policies/repositories/policy.repository';
import { IngestionService, validateYouthCenterCollection, YouthCenterCollectionValidationError } from '../src/modules/ingestion/services/ingestion.service';
import { YouthCenterClient } from '../src/modules/ingestion/youth-center/youth-center.client';
import type { YouthCenterListResponse, YouthCenterRawPolicy } from '../src/modules/ingestion/youth-center/youth-center-response.schema';

/** 요청 페이지의 정책 건수와 고유 ID를 포함한 모의 원본 응답을 만든다. */
function createPage(pageNum: number, totalCount = 5, pageSize = 2): YouthCenterListResponse {
  const offset = (pageNum - 1) * pageSize;
  const count = Math.min(pageSize, Math.max(0, totalCount - offset));
  return {
    resultCode: 200,
    resultMessage: '성공',
    result: {
      pagging: { pageNum, pageSize, totCount: totalCount },
      youthPolicyList: Array.from({ length: count }, (_, index) => ({
        plcyNo: `policy-${offset + index}`, plcyNm: ` 원문 제목 ${offset + index} `,
        extra: { nullable: null, codes: ['0013010', '0049010'] },
      })),
    },
  };
}

/** 실제 재시도·검증 클라이언트와 모의 HTTP 응답으로 전체 수집 흐름을 확인한다. */
describe('전체 정책 페이지 순차 수집', () => {
  let service: IngestionService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let requestedPages: number[];

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-17T00:00:00Z') });
    const environment = parseEnvironment({
      DATABASE_URL: 'postgresql://tester:unit-secret@localhost:5432/example',
      YOUTH_CENTER_API_KEY: 'collection-unit-secret', YOUTH_CENTER_PAGE_SIZE: '2',
    });
    service = new IngestionService(
      new YouthCenterClient(environment), new IngestionLockService(new DataSource({ type: 'postgres' })),
      new PoliciesWriteService(new PolicyRepository(), environment), new IngestionLogService(environment),
    );
    requestedPages = [];
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const pageNum = Number(new URL(String(input)).searchParams.get('pageNum'));
      requestedPages.push(pageNum);
      return Response.json(createPage(pageNum));
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('첫 응답으로 마지막 페이지를 계산하고 순서대로 원본 정책 5건을 반환한다', async () => {
    const pending = service.collectPolicies();
    await jest.runAllTimersAsync();
    const policies = await pending;
    expect(requestedPages).toEqual([1, 2, 3]);
    expect(policies).toEqual([1, 2, 3].flatMap((pageNum) => createPage(pageNum).result.youthPolicyList));
    expect(policies.map((policy) => policy.plcyNo)).toEqual(['policy-0', 'policy-1', 'policy-2', 'policy-3', 'policy-4']);
    expect(Date.now()).toBe(Date.parse('2026-10-17T00:00:00Z') + 6000);
  });

  it.each([0, 1, 2, 4, 5, 7, 13])('실제 응답 총 %i건에 맞춰 마지막까지만 호출한다', async (totalCount) => {
    fetchMock.mockImplementation(async (input) => {
      const pageNum = Number(new URL(String(input)).searchParams.get('pageNum'));
      requestedPages.push(pageNum);
      return Response.json(createPage(pageNum, totalCount));
    });
    const pending = service.collectPolicies();
    await jest.runAllTimersAsync();
    await expect(pending).resolves.toHaveLength(totalCount);
    expect(requestedPages).toEqual(Array.from({ length: Math.max(1, Math.ceil(totalCount / 2)) }, (_, index) => index + 1));
  });

  it('앞 페이지의 응답과 기본 간격을 기다린 뒤 다음 페이지를 호출한다', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    fetchMock.mockImplementation(async (input) => {
      const pageNum = Number(new URL(String(input)).searchParams.get('pageNum'));
      requestedPages.push(pageNum);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      inFlight -= 1;
      return Response.json(createPage(pageNum));
    });
    const pending = service.collectPolicies();
    await jest.advanceTimersByTimeAsync(3499);
    expect(requestedPages).toEqual([1]);
    await jest.advanceTimersByTimeAsync(1);
    expect(requestedPages).toEqual([1, 2]);
    await jest.runAllTimersAsync();
    await expect(pending).resolves.toHaveLength(5);
    expect(maxInFlight).toBe(1);
  });

  it('중간 페이지 시간 초과 후 해당 페이지만 재시도하고 수집을 계속한다', async () => {
    let failedOnce = false;
    fetchMock.mockImplementation(async (input) => {
      const pageNum = Number(new URL(String(input)).searchParams.get('pageNum'));
      requestedPages.push(pageNum);
      if (pageNum === 2 && !failedOnce) {
        failedOnce = true;
        throw new DOMException('모의 시간 초과', 'TimeoutError');
      }
      return Response.json(createPage(pageNum));
    });
    const pending = service.collectPolicies();
    await jest.runAllTimersAsync();
    await expect(pending).resolves.toHaveLength(5);
    expect(requestedPages).toEqual([1, 2, 2, 3]);
  });

  it('중간 페이지 재시도 한도 초과 시 부분 결과를 다음 처리에 넘기지 않는다', async () => {
    const nextStage = jest.fn();
    fetchMock.mockImplementation(async (input) => {
      const pageNum = Number(new URL(String(input)).searchParams.get('pageNum'));
      requestedPages.push(pageNum);
      return pageNum === 2 ? Response.json({}, { status: 503 }) : Response.json(createPage(pageNum));
    });
    const outcome = service.collectPolicies().then(nextStage).catch((error: unknown) => error);
    await jest.runAllTimersAsync();
    expect(await outcome).toMatchObject({ pageNum: 2, attempts: 3, reason: 'RETRY_EXHAUSTED' });
    expect(requestedPages).toEqual([1, 2, 2, 2]);
    expect(nextStage).not.toHaveBeenCalled();
  });

  it.each([0, 4, 6])('중간 페이지의 총 건수가 %i로 바뀌면 즉시 중단한다', async (changedTotal) => {
    fetchMock.mockImplementation(async (input) => {
      const pageNum = Number(new URL(String(input)).searchParams.get('pageNum'));
      requestedPages.push(pageNum);
      return Response.json(createPage(pageNum, pageNum === 1 ? 5 : changedTotal));
    });
    const nextStage = jest.fn();
    const outcome = service.collectPolicies().then(nextStage).catch((error: unknown) => error);
    await jest.runAllTimersAsync();
    expect(await outcome).toBeInstanceOf(YouthCenterCollectionValidationError);
    expect(await outcome).toMatchObject({ stage: 'COLLECTION_VALIDATION', reason: 'TOTAL_COUNT_CHANGED',
      pageNum: 2, attempts: 1, details: { expected: 5, actual: changedTotal } });
    expect(requestedPages).toEqual([1, 2]);
    expect(nextStage).not.toHaveBeenCalled();
  });

  it.each(['STRUCTURE', 'PAGE_NUMBER', 'COUNT', 'DUPLICATE', 'E003'])(
    '중간 페이지 %s 오류 시 남은 페이지와 다음 처리를 실행하지 않는다', async (failure) => {
      fetchMock.mockImplementation(async (input) => {
        const pageNum = Number(new URL(String(input)).searchParams.get('pageNum'));
        requestedPages.push(pageNum);
        if (pageNum !== 2) return Response.json(createPage(pageNum));
        const body = createPage(pageNum);
        if (failure === 'STRUCTURE') return Response.json({ resultCode: 200 });
        if (failure === 'E003') return Response.json({ errorCode: 'e003' }, { status: 400 });
        if (failure === 'PAGE_NUMBER') body.result.pagging.pageNum = 1;
        if (failure === 'COUNT') body.result.youthPolicyList.pop();
        if (failure === 'DUPLICATE') body.result.youthPolicyList[1].plcyNo = 'policy-0';
        return Response.json(body);
      });
      const nextStage = jest.fn();
      const outcome = service.collectPolicies().then(nextStage).catch((error: unknown) => error);
      await jest.runAllTimersAsync();
      expect(await outcome).toBeInstanceOf(Error);
      expect(await outcome).toMatchObject({ pageNum: 2, attempts: 1 });
      expect(requestedPages).toEqual([1, 2]);
      expect(nextStage).not.toHaveBeenCalled();
    },
  );

  it('반복 실행할 때 첫 페이지부터 새 ID 집합으로 수집한다', async () => {
    const first = service.collectPolicies();
    await jest.runAllTimersAsync();
    const firstResult = await first;
    const second = service.collectPolicies();
    await jest.runAllTimersAsync();
    expect(await second).toEqual(firstResult);
    expect(requestedPages).toEqual([1, 2, 3, 1, 2, 3]);
  });

  it('최종 실패 후 재실행하면 중간 페이지가 아닌 첫 페이지부터 다시 시작한다', async () => {
    const normalFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementationOnce(normalFetch)
      .mockImplementationOnce(async (input) => {
        requestedPages.push(Number(new URL(String(input)).searchParams.get('pageNum')));
        return Response.json({}, { status: 401 });
      });
    const failed = service.collectPolicies().catch((error: unknown) => error);
    await jest.runAllTimersAsync();
    expect(await failed).toMatchObject({ pageNum: 2 });
    const retried = service.collectPolicies();
    await jest.runAllTimersAsync();
    await expect(retried).resolves.toHaveLength(5);
    expect(requestedPages).toEqual([1, 2, 1, 2, 3]);
  });
});

/** 페이지별 검증과 별개로 최종 배열·수신 페이지 기록을 다시 검사한다. */
describe('전체 수집 결과 최종 검증', () => {
  const policies: YouthCenterRawPolicy[] = [1, 2, 3].flatMap((pageNum) => createPage(pageNum).result.youthPolicyList);

  it('모든 페이지·총합·ID가 맞는 최종 결과를 변경 없이 통과시킨다', () => {
    const before = structuredClone(policies);
    validateYouthCenterCollection(policies, 5, 3, new Set([1, 2, 3]));
    expect(policies).toEqual(before);
  });

  it('총 0건의 첫 페이지 수집 결과도 통과시킨다', () => {
    expect(() => validateYouthCenterCollection([], 0, 1, new Set([1]))).not.toThrow();
  });

  it.each([{ pages: [] }, { pages: [1, 3] }, { pages: [1, 2] }])('누락된 페이지가 있으면 거부한다: $pages', ({ pages }) => {
    try {
      validateYouthCenterCollection(policies, 5, 3, new Set(pages));
      throw new Error('누락된 페이지를 허용했습니다.');
    } catch (error) {
      expect(error).toBeInstanceOf(YouthCenterCollectionValidationError);
      expect(error).toMatchObject({ reason: 'PAGE_MISSING', stage: 'COLLECTION_VALIDATION' });
    }
  });

  it('예정한 페이지보다 많은 페이지 기록도 거부한다', () => {
    expect(() => validateYouthCenterCollection(policies, 5, 3, new Set([1, 2, 3, 4])))
      .toThrow('PAGE_COUNT_MISMATCH');
  });

  it.each([4, 6])('최종 총합이 첫 응답의 총 %i건과 다르면 거부한다', (totalCount) => {
    try {
      validateYouthCenterCollection(policies, totalCount, 3, new Set([1, 2, 3]));
      throw new Error('건수 불일치를 허용했습니다.');
    } catch (error) {
      expect(error).toMatchObject({ reason: 'TOTAL_COUNT_MISMATCH', details: { expected: totalCount, actual: 5 } });
    }
  });

  it('총합이 같아도 최종 배열의 정책 ID 중복은 거부한다', () => {
    const duplicated = structuredClone(policies);
    duplicated[4].plcyNo = duplicated[0].plcyNo;
    try {
      validateYouthCenterCollection(duplicated, 5, 3, new Set([1, 2, 3]));
      throw new Error('최종 중복을 허용했습니다.');
    } catch (error) {
      expect(error).toMatchObject({ reason: 'DUPLICATE_POLICY_ID', details: { policyId: 'policy-0' } });
    }
  });
});
