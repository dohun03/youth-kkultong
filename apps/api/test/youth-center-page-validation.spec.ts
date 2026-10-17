import { parseEnvironment } from '../src/common/environment';
import { YouthCenterClient } from '../src/modules/ingestion/youth-center.client';
import { validateYouthCenterPage, YouthCenterPageValidationError } from '../src/modules/ingestion/youth-center-page.validation';
import type { YouthCenterListResponse } from '../src/modules/ingestion/youth-center-response.schema';
import { parseYouthCenterPageResponse } from '../src/modules/ingestion/youth-center-response.schema';
import validPage from './fixtures/youth-center-list.json';

/** 실제 응답 발췌본의 구조를 검증한 테스트 기준 자료 */
const validatedSample = parseYouthCenterPageResponse(validPage, 1);

/** 페이지 정보와 정책 ID를 지정한 모의 정상 구조를 만든다. */
function createPage(pageNum = 1, pageSize = 2, totCount = 4, ids = ['a', 'b']): YouthCenterListResponse {
  return { ...validatedSample, result: {
    pagging: { pageNum, pageSize, totCount },
    youthPolicyList: ids.map((plcyNo) => ({ plcyNo, plcyNm: `정책 ${plcyNo}` })),
  } };
}

/** 페이지별 건수 계산과 수집 작업의 ID 집합 갱신을 검증한다. */
describe('온통청년 페이지 메타데이터·정책 ID 검증', () => {
  it('실제 응답 발췌본을 통과시키고 정책 5건을 ID 집합에 등록한다', () => {
    const seenIds = new Set<string>();
    validateYouthCenterPage(validatedSample, 1, 5, seenIds);
    expect([...seenIds]).toEqual(validPage.result.youthPolicyList.map((policy) => policy.plcyNo));
  });

  it('같은 ID 집합으로 서로 다른 페이지를 순차 검증한다', () => {
    const seenIds = new Set<string>();
    validateYouthCenterPage(createPage(), 1, 2, seenIds);
    validateYouthCenterPage(createPage(2, 2, 4, ['c', 'd']), 2, 2, seenIds);
    expect([...seenIds]).toEqual(['a', 'b', 'c', 'd']);
  });

  it.each([
    [1, 2, 0, []], [1, 2, 1, ['a']], [2, 2, 3, ['c']],
    [2, 2, 4, ['c', 'd']], [3, 2, 3, []],
  ] as [number, number, number, string[]][])(
    '0건·마지막 페이지·범위 밖 빈 페이지의 건수가 맞으면 허용한다: 페이지 %i, 크기 %i, 총 %i',
    (pageNum, pageSize, total, ids) => {
      const seenIds = new Set<string>();
      validateYouthCenterPage(createPage(pageNum, pageSize, total, ids), pageNum, pageSize, seenIds);
      expect([...seenIds]).toEqual(ids);
    },
  );

  it.each([
    ['pageNum', 2, 'PAGE_NUMBER_MISMATCH', 1, 2],
    ['pageSize', 3, 'PAGE_SIZE_MISMATCH', 2, 3],
  ])('응답 %s가 요청과 다르면 원인과 예상·실제 값을 전달한다', (field, value, reason, expected, actual) => {
    const body = createPage();
    Reflect.set(body.result.pagging, String(field), value);
    const seenIds = new Set(['previous']);
    try {
      validateYouthCenterPage(body, 1, 2, seenIds, 2);
      throw new Error('페이지 불일치를 허용했습니다.');
    } catch (error) {
      expect(error).toBeInstanceOf(YouthCenterPageValidationError);
      expect(error).toMatchObject({ pageNum: 1, attempts: 2, stage: 'PAGE_VALIDATION', reason,
        field: `result.pagging.${field}`, details: { expected, actual } });
    }
    expect([...seenIds]).toEqual(['previous']);
  });

  it('정책 배열이 페이지 크기를 초과하면 별도 오류로 구분한다', () => {
    try {
      validateYouthCenterPage(createPage(1, 2, 4, ['a', 'b', 'c']), 1, 2, new Set());
      throw new Error('크기 초과를 허용했습니다.');
    } catch (error) {
      expect(error).toMatchObject({ reason: 'PAGE_SIZE_EXCEEDED', details: { expected: 2, actual: 3 } });
    }
  });

  it.each([
    [1, 4, []], [1, 4, ['a']], [2, 3, []], [2, 3, ['c', 'd']],
    [1, 0, ['a']], [3, 3, ['a']],
  ] as [number, number, string[]][])(
    '총 건수와 해당 페이지 건수가 다르면 거부한다: 페이지 %i, 총 %i, ID %j', (pageNum, total, ids) => {
      const seenIds = new Set(['previous']);
      try {
        validateYouthCenterPage(createPage(pageNum, 2, total, ids), pageNum, 2, seenIds);
        throw new Error('잘못된 반환 건수를 허용했습니다.');
      } catch (error) {
        expect(error).toMatchObject({ reason: 'PAGE_COUNT_MISMATCH', field: 'result.youthPolicyList',
          details: { actual: ids.length } });
      }
      expect([...seenIds]).toEqual(['previous']);
    },
  );

  it('같은 페이지 안의 중복 ID와 배열 위치를 식별하고 ID 집합을 보존한다', () => {
    const seenIds = new Set(['previous']);
    try {
      validateYouthCenterPage(createPage(1, 2, 4, ['new', 'new']), 1, 2, seenIds);
      throw new Error('페이지 안의 중복을 허용했습니다.');
    } catch (error) {
      expect(error).toMatchObject({ reason: 'DUPLICATE_POLICY_ID', field: 'result.youthPolicyList.1.plcyNo',
        details: { policyId: 'new' } });
    }
    expect([...seenIds]).toEqual(['previous']);
  });

  it('이전 페이지와 겹치는 ID를 찾고 그 전에 읽은 새 ID도 집합에 반영하지 않는다', () => {
    const seenIds = new Set<string>();
    validateYouthCenterPage(createPage(), 1, 2, seenIds);
    try {
      validateYouthCenterPage(createPage(2, 2, 4, ['new', 'a']), 2, 2, seenIds);
      throw new Error('페이지 간 중복을 허용했습니다.');
    } catch (error) {
      expect(error).toMatchObject({ pageNum: 2, reason: 'DUPLICATE_POLICY_ID', details: { policyId: 'a' } });
    }
    expect([...seenIds]).toEqual(['a', 'b']);
  });

  it('새 수집의 ID 집합은 이전 수집과 독립적이다', () => {
    const first = new Set<string>();
    const second = new Set<string>();
    validateYouthCenterPage(createPage(), 1, 2, first);
    validateYouthCenterPage(createPage(), 1, 2, second);
    expect([...first]).toEqual([...second]);
  });

  it('제목이 같아도 ID가 다르면 허용하고 원본 응답은 바꾸지 않는다', () => {
    const body = createPage();
    body.result.youthPolicyList[1].plcyNm = body.result.youthPolicyList[0].plcyNm;
    const before = structuredClone(body);
    validateYouthCenterPage(body, 1, 2, new Set());
    expect(body).toEqual(before);
  });

  it('메타데이터 오류에 정책 본문·인증키·URL을 담지 않는다', () => {
    const body = createPage(2);
    body.result.youthPolicyList[0].plcyNm = 'https://example.com/?apiKeyNm=validation-unit-secret';
    try {
      validateYouthCenterPage(body, 1, 2, new Set());
      throw new Error('잘못된 페이지를 허용했습니다.');
    } catch (error) {
      expect(error).toBeInstanceOf(YouthCenterPageValidationError);
      expect(String(error) + JSON.stringify(error) + (error as Error).stack).not.toMatch(/validation-unit-secret|apiKeyNm|https:\/\/|example\.com/);
      expect(error).not.toHaveProperty('cause');
    }
  });
});

/** HTTP 호출의 검증 실패 중단·재시도 횟수·수집 작업별 ID 집합 연결을 확인한다. */
describe('온통청년 호출 이후 페이지 메타데이터·중복 검증', () => {
  let client: YouthCenterClient;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    jest.useFakeTimers();
    client = new YouthCenterClient(parseEnvironment({
      DATABASE_URL: 'postgresql://tester:unit-secret@localhost:5432/example',
      YOUTH_CENTER_API_KEY: 'validation-unit-secret',
      YOUTH_CENTER_PAGE_SIZE: '2',
      YOUTH_CENTER_REQUEST_DELAY_MS: '0',
    }));
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each([
    [createPage(2), 'PAGE_NUMBER_MISMATCH'],
    [createPage(1, 3, 4), 'PAGE_SIZE_MISMATCH'],
    [createPage(1, 2, 4, ['a', 'b', 'c']), 'PAGE_SIZE_EXCEEDED'],
    [createPage(1, 2, 4, ['a']), 'PAGE_COUNT_MISMATCH'],
    [createPage(1, 2, 4, ['a', 'a']), 'DUPLICATE_POLICY_ID'],
  ] as [YouthCenterListResponse, string][])(
    '페이지 검증 오류 %#: 잘못된 응답을 재시도하지 않는다', async (body, reason) => {
      const seenIds = new Set<string>();
      fetchMock.mockResolvedValueOnce(Response.json(body)).mockResolvedValueOnce(Response.json(createPage()));
      await expect(client.fetchPageWithRetry(1, seenIds)).rejects.toMatchObject({ pageNum: 1, attempts: 1, reason });
      await jest.runAllTimersAsync();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(seenIds.size).toBe(0);
    },
  );

  it('공유 ID 집합으로 페이지 간 중복을 검출한다', async () => {
    const seenIds = new Set<string>();
    fetchMock.mockResolvedValueOnce(Response.json(createPage()))
      .mockResolvedValueOnce(Response.json(createPage(2, 2, 4, ['new', 'a'])));
    await client.fetchPageWithRetry(1, seenIds);
    await expect(client.fetchPageWithRetry(2, seenIds)).rejects.toMatchObject({ pageNum: 2, reason: 'DUPLICATE_POLICY_ID' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect([...seenIds]).toEqual(['a', 'b']);
  });

  it('재시도 뒤 페이지 검증이 실패하면 실제 횟수를 전달하고 ID 집합을 보존한다', async () => {
    const seenIds = new Set(['previous']);
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(Response.json(createPage(2)))
      .mockResolvedValueOnce(Response.json(createPage()));
    const outcome = client.fetchPageWithRetry(1, seenIds).catch((error: unknown) => error);
    await jest.runAllTimersAsync();
    expect(await outcome).toMatchObject({ attempts: 2, reason: 'PAGE_NUMBER_MISMATCH' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect([...seenIds]).toEqual(['previous']);
  });

  it('연결 오류 뒤 성공한 페이지의 ID는 한 번만 등록한다', async () => {
    const seenIds = new Set<string>();
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('모의 연결 종료'), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce(Response.json(createPage()));
    const pending = client.fetchPageWithRetry(1, seenIds);
    await jest.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ attempts: 2 });
    expect([...seenIds]).toEqual(['a', 'b']);
  });

  it('ID 집합을 생략한 단일 페이지 요청은 이전 요청의 ID를 이어받지 않는다', async () => {
    fetchMock.mockImplementation(async () => Response.json(createPage()));
    await client.fetchPageWithRetry(1);
    await client.fetchPageWithRetry(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
