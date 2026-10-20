import { parseEnvironment } from '../src/common/environment';
import { YouthCenterClient } from '../src/modules/ingestion/youth-center/youth-center.client';
import { parseYouthCenterPageResponse, YouthCenterResponseValidationError } from '../src/modules/ingestion/youth-center/youth-center-response.schema';
import validPage from './fixtures/youth-center-list.json';

/** 기존 조사 응답에서 봉투·페이지 정보·정책 ID·제목·조회수를 발췌한 정상 자료를 검증한다. */
describe('온통청년 목록 응답 구조 검증', () => {
  it('실제 응답 발췌본의 정책 5건과 pagging 철자를 그대로 통과시킨다', () => {
    const result = parseYouthCenterPageResponse(validPage, 1);
    expect(result).toEqual(validPage);
    expect(result.result.youthPolicyList).toHaveLength(5);
    expect(result.result.pagging).toEqual({ totCount: 3255, pageNum: 1, pageSize: 5 });
  });

  it('추가 필드·중첩 값과 원문 공백을 변경하거나 제거하지 않는다', () => {
    const body = {
      ...validPage,
      extra: { nested: [null, true, '원문'] },
      result: {
        ...validPage.result,
        extraResult: '원본 결과',
        pagging: { ...validPage.result.pagging, extraPaging: 100 },
        youthPolicyList: [{ plcyNo: '  original-id  ', plcyNm: ' 원문 제목 ', nullable: null, extraPolicy: ['a', 'b'] }],
      },
    };
    const before = structuredClone(body);
    expect(parseYouthCenterPageResponse(body, 1)).toEqual(before);
    expect(body).toEqual(before);
  });

  it('총 0건과 빈 정책 배열도 유효한 응답으로 처리한다', () => {
    const body = { ...validPage, result: {
      pagging: { totCount: 0, pageNum: 1, pageSize: 50 }, youthPolicyList: [],
    } };
    expect(parseYouthCenterPageResponse(body, 1)).toEqual(body);
  });

  it.each([undefined, null, [], '', 200])('객체가 아닌 응답은 루트 필드 오류로 변환한다: %j', (body) => {
    expect(() => parseYouthCenterPageResponse(body, 4)).toThrow(YouthCenterResponseValidationError);
    try {
      parseYouthCenterPageResponse(body, 4);
    } catch (error) {
      expect(error).toMatchObject({ pageNum: 4, attempts: 1, fields: ['$'], stage: 'PAGE_VALIDATION' });
    }
  });

  it.each(['resultCode', 'resultMessage', 'result'])('누락된 응답 봉투 필드 %s를 식별한다', (field) => {
    const body = structuredClone(validPage);
    Reflect.deleteProperty(body, field);
    expect(() => parseYouthCenterPageResponse(body, 2)).toThrow(`필드: ${field}`);
  });

  it.each([['resultCode', '200'], ['resultCode', 400], ['resultCode', null], ['resultMessage', 123], ['resultMessage', null], ['result', []], ['result', null]])(
    '응답 봉투의 %s 자료형·성공 값 오류를 거부한다: %j', (field, value) => {
      expect(() => parseYouthCenterPageResponse({ ...validPage, [field as string]: value }, 1)).toThrow(YouthCenterResponseValidationError);
    },
  );

  it.each(['youthPolicyList', 'pagging'])('누락된 result.%s를 식별한다', (field) => {
    const body = structuredClone(validPage);
    Reflect.deleteProperty(body.result, field);
    expect(() => parseYouthCenterPageResponse(body, 1)).toThrow(`필드: result.${field}`);
  });

  it('paging은 실제 필드 pagging의 대체 이름으로 허용하지 않는다', () => {
    const body = { ...validPage, result: { youthPolicyList: [], paging: validPage.result.pagging } };
    expect(() => parseYouthCenterPageResponse(body, 1)).toThrow('result.pagging');
  });

  it.each([null, {}, '', 5])('배열이 아닌 youthPolicyList를 거부한다: %j', (value) => {
    const body = { ...validPage, result: { ...validPage.result, youthPolicyList: value } };
    expect(() => parseYouthCenterPageResponse(body, 1)).toThrow('result.youthPolicyList');
  });

  it.each([null, [], '정책', 1])('객체가 아닌 정책 항목을 식별한다: %j', (value) => {
    const body = { ...validPage, result: { ...validPage.result, youthPolicyList: [value] } };
    expect(() => parseYouthCenterPageResponse(body, 3)).toThrow('result.youthPolicyList.0');
  });

  it.each([null, [], '', 1])('객체가 아닌 pagging을 거부한다: %j', (value) => {
    const body = { ...validPage, result: { ...validPage.result, pagging: value } };
    expect(() => parseYouthCenterPageResponse(body, 1)).toThrow('result.pagging');
  });

  it.each(['totCount', 'pageNum', 'pageSize'])('누락된 페이지 필드 %s를 식별한다', (field) => {
    const body = structuredClone(validPage);
    Reflect.deleteProperty(body.result.pagging, field);
    expect(() => parseYouthCenterPageResponse(body, 1)).toThrow(`result.pagging.${field}`);
  });

  it.each([
    ['totCount', '3255'], ['totCount', null], ['totCount', -1], ['totCount', 1.5],
    ['totCount', Number.MAX_SAFE_INTEGER + 1], ['pageNum', '1'], ['pageNum', 0],
    ['pageNum', 1.5], ['pageSize', '5'], ['pageSize', 0], ['pageSize', -1], ['pageSize', 1.5],
  ])('페이지 필드 %s의 잘못된 숫자·자료형을 거부한다: %j', (field, value) => {
    const body = { ...validPage, result: { ...validPage.result, pagging: { ...validPage.result.pagging, [field as string]: value } } };
    expect(() => parseYouthCenterPageResponse(body, 1)).toThrow(`result.pagging.${field}`);
  });

  it.each(['plcyNo', 'plcyNm'])('필수 정책 필드 %s 누락을 거부한다', (field) => {
    const body = structuredClone(validPage);
    Reflect.deleteProperty(body.result.youthPolicyList[0], field);
    expect(() => parseYouthCenterPageResponse(body, 1)).toThrow(`result.youthPolicyList.0.${field}`);
  });

  it.each(['plcyNo', 'plcyNm'])('정책 필드 %s의 빈 값·공백·자료형 오류를 거부한다', (field) => {
    for (const value of ['', '  \t\n', null, 0, {}, []]) {
      const body = { ...validPage, result: { ...validPage.result, youthPolicyList: [{ plcyNo: 'id', plcyNm: '제목', [field]: value }] } };
      expect(() => parseYouthCenterPageResponse(body, 1)).toThrow(`result.youthPolicyList.0.${field}`);
    }
  });

  it('여러 실패 필드와 정책의 배열 위치를 함께 전달한다', () => {
    const body = { ...validPage, result: { ...validPage.result, youthPolicyList: [
      { plcyNo: '', plcyNm: '' }, { plcyNo: '정상ID' },
    ] } };
    try {
      parseYouthCenterPageResponse(body, 7, 2);
      throw new Error('잘못된 정책을 허용했습니다.');
    } catch (error) {
      expect(error).toMatchObject({ pageNum: 7, attempts: 2, fields: [
        'result.youthPolicyList.0.plcyNo', 'result.youthPolicyList.0.plcyNm', 'result.youthPolicyList.1.plcyNm',
      ] });
      expect((error as Error).message).toContain('7페이지');
    }
  });

  it('검증 오류에 입력 원문·키·URL·Zod 원본 오류를 포함하지 않는다', () => {
    const secret = 'response-unit-secret';
    const body = { ...validPage, result: { ...validPage.result, youthPolicyList: [
      { plcyNo: { [secret]: `https://example.com/?apiKeyNm=${secret}` }, plcyNm: secret },
    ] } };
    try {
      parseYouthCenterPageResponse(body, 2);
      throw new Error('잘못된 정책을 허용했습니다.');
    } catch (error) {
      expect(error).toBeInstanceOf(YouthCenterResponseValidationError);
      expect(String(error) + JSON.stringify(error) + (error as Error).stack).not.toMatch(/response-unit-secret|apiKeyNm|https:\/\/|example\.com/);
      expect(error).not.toHaveProperty('cause');
      expect(error).not.toHaveProperty('issues');
    }
  });
});

/** HTTP 재시도와 구조 검증이 연결되고, 잘못된 성공 응답을 다시 요청하지 않는지 검증한다. */
describe('온통청년 호출 이후 구조 검증', () => {
  let client: YouthCenterClient;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    jest.useFakeTimers();
    client = new YouthCenterClient(parseEnvironment({
      DATABASE_URL: 'postgresql://tester:unit-secret@localhost:5432/example',
      YOUTH_CENTER_API_KEY: 'response-unit-secret',
      YOUTH_CENTER_PAGE_SIZE: '5',
    }));
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('정상 호출은 타입이 검증된 본문과 시도 횟수를 반환한다', async () => {
    fetchMock.mockResolvedValue(Response.json(validPage));
    await expect(client.fetchPageWithRetry(1)).resolves.toMatchObject({ body: validPage, attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...validPage, result: null },
    { ...validPage, result: { ...validPage.result, youthPolicyList: [{ plcyNo: '', plcyNm: '제목' }] } },
    { ...validPage, result: { youthPolicyList: [] } },
  ])('HTTP/API 성공 후 구조 검증이 실패하면 즉시 중단한다: %#', async (body) => {
    fetchMock.mockResolvedValueOnce(Response.json(body)).mockResolvedValueOnce(Response.json(validPage));
    await expect(client.fetchPageWithRetry(5)).rejects.toMatchObject({ pageNum: 5, attempts: 1, stage: 'PAGE_VALIDATION' });
    await jest.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('일시 오류 재시도 뒤 구조가 잘못되면 실제 횟수 2회를 기록하고 중단한다', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ...validPage, result: {} }))
      .mockResolvedValueOnce(Response.json(validPage));
    const outcome = client.fetchPageWithRetry(3).catch((error: unknown) => error);
    await jest.runAllTimersAsync();
    expect(await outcome).toMatchObject({ pageNum: 3, attempts: 2, stage: 'PAGE_VALIDATION' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('구조 검증 실패 뒤에도 다음 페이지 요청은 기본 간격을 유지한다', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...validPage, result: {} }))
      .mockResolvedValueOnce(Response.json({ ...validPage, result: {
        ...validPage.result, pagging: { ...validPage.result.pagging, pageNum: 2 },
      } }));
    await expect(client.fetchPageWithRetry(1)).rejects.toBeInstanceOf(YouthCenterResponseValidationError);
    const next = client.fetchPageWithRetry(2);
    await jest.advanceTimersByTimeAsync(2999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(next).resolves.toMatchObject({ attempts: 1 });
  });
});
