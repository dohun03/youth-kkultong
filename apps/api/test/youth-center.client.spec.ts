import { parseEnvironment } from '../src/common/environment';
import { YouthCenterClient, YouthCenterRequestError } from '../src/modules/ingestion/youth-center/youth-center.client';

const apiKey = 'unit-secret +/&=?한글';

/** 모의 응답만으로 단일 페이지 요청과 실패 구분을 확인한다. */
describe('온통청년 단일 페이지 호출', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let client: YouthCenterClient;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
    client = new YouthCenterClient(parseEnvironment({
      DATABASE_URL: 'postgresql://tester:unit-secret@localhost:5432/example',
      YOUTH_CENTER_API_KEY: apiKey,
    }));
  });

  afterEach(() => jest.restoreAllMocks());

  it('인증키를 인코딩하고 지정한 페이지·기본 50건으로 한 번만 요청한다', async () => {
    const body = {
      resultCode: 200,
      resultMessage: '성공적으로 데이터를 가지고 왔습니다.',
      result: {
        pagging: { totCount: 101, pageNum: 3, pageSize: 50 },
        youthPolicyList: [{ plcyNo: 'mock-policy-101', plcyNm: '모의 정책' }],
      },
    };
    fetchMock.mockResolvedValue(Response.json(body));

    await expect(client.fetchPage(3)).resolves.toEqual({
      httpStatus: 200, httpOk: true, apiSuccess: true, body, retryAfter: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, options] = fetchMock.mock.calls[0];
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe('https://www.youthcenter.go.kr/go/ythip/getPlcy');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      apiKeyNm: apiKey, pageType: '1', rtnType: 'json', pageNum: '3', pageSize: '50',
    });
    expect(options).toMatchObject({ method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error' });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('설정한 페이지 크기를 사용한다', async () => {
    client = new YouthCenterClient(parseEnvironment({
      DATABASE_URL: 'postgresql://tester:unit-secret@localhost:5432/example',
      YOUTH_CENTER_API_KEY: apiKey,
      YOUTH_CENTER_PAGE_SIZE: '5',
    }));
    fetchMock.mockResolvedValue(Response.json({ resultCode: 200 }));
    await client.fetchPage(1);
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('pageSize')).toBe('5');
  });

  it.each([400, 401, 403, 429, 500, 503])('HTTP %i 응답과 오류 본문을 보존하고 재시도하지 않는다', async (status) => {
    const body = { errorCode: 'e003', errorMsg: 'api data invalid.' };
    fetchMock.mockResolvedValue(Response.json(body, { status, headers: { 'Retry-After': '7' } }));
    await expect(client.fetchPage(2)).resolves.toEqual({
      httpStatus: status, httpOk: false, apiSuccess: false, body, retryAfter: '7',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([{ resultCode: 400 }, { resultCode: '200' }, { errorCode: 'e003' }, null, [], 200])(
    'HTTP 200이어도 숫자형 resultCode=200이 아니면 API 성공으로 판단하지 않는다: %j', async (body) => {
      fetchMock.mockResolvedValue(Response.json(body));
      await expect(client.fetchPage(1)).resolves.toMatchObject({ httpOk: true, apiSuccess: false, body });
    },
  );

  it('HTTP 상태와 본문의 API 성공 값은 독립적으로 반환한다', async () => {
    fetchMock.mockResolvedValue(Response.json({ resultCode: 200 }, { status: 503 }));
    await expect(client.fetchPage(1)).resolves.toMatchObject({ httpStatus: 503, httpOk: false, apiSuccess: true });
  });

  it.each(['<html>서버 오류</html>', '{broken-json', '', '일반 텍스트'])('JSON이 아닌 본문도 원문으로 보존한다: %s', async (body) => {
    fetchMock.mockResolvedValue(new Response(body, { status: 502 }));
    await expect(client.fetchPage(1)).resolves.toMatchObject({ httpStatus: 502, apiSuccess: false, body });
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('잘못된 페이지 %s는 요청 전에 거부한다', async (page) => {
    await expect(client.fetchPage(page)).rejects.toThrow(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('인증키 없이 앱의 클라이언트 생성은 가능하지만 실제 호출은 거부한다', async () => {
    client = new YouthCenterClient(parseEnvironment({
      DATABASE_URL: 'postgresql://tester:unit-secret@localhost:5432/example',
    }));
    await expect(client.fetchPage(1)).rejects.toThrow('YOUTH_CENTER_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['NETWORK', 'TIMEOUT'] as const)('통신 오류 %s의 페이지와 종류만 전달하고 URL·키·원본 오류를 숨긴다', async (kind) => {
    const original = new Error(`https://example.com/?apiKeyNm=${apiKey}`);
    original.name = kind === 'TIMEOUT' ? 'TimeoutError' : 'TypeError';
    original.cause = Object.assign(new Error('모의 소켓 연결 종료'), { code: 'ECONNRESET' });
    fetchMock.mockRejectedValue(original);
    let caught: unknown;
    try {
      await client.fetchPage(4);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YouthCenterRequestError);
    expect(caught).toMatchObject({ pageNum: 4, kind });
    expect(String(caught) + JSON.stringify(caught) + (caught as Error).stack)
      .not.toMatch(/unit-secret|apiKeyNm|https:\/\/|example\.com/);
    expect(caught).not.toHaveProperty('cause');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('응답 본문을 읽다 연결이 끊겨도 안전한 통신 오류로 처리한다', async () => {
    const response = Response.json({ resultCode: 200 });
    jest.spyOn(response, 'text').mockRejectedValue(Object.assign(new Error(`연결 종료: ${apiKey}`), { code: 'EPIPE' }));
    fetchMock.mockResolvedValue(response);
    await expect(client.fetchPage(2)).rejects.toMatchObject({ pageNum: 2, kind: 'NETWORK' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('응답 대기 시간이 지나면 실제 AbortSignal로 요청을 중단한다', async () => {
    const controller = new AbortController();
    const timeoutMock = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    fetchMock.mockImplementation(async (_input, options) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    }));
    const request = client.fetchPage(1);
    controller.abort();
    await expect(request).rejects.toMatchObject({ pageNum: 1, kind: 'TIMEOUT' });
    expect(timeoutMock).toHaveBeenCalledWith(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
