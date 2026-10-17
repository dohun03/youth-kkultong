import { parseEnvironment } from '../src/common/environment';
import validPage from './fixtures/youth-center-list.json';
import { YouthCenterClient, YouthCenterPageError } from '../src/modules/ingestion/youth-center.client';

/** 재시도 테스트 전용 인증키 */
const apiKey = 'retry-unit-secret';

/** 재시도·페이지 간 대기 시간을 실제 대기 없이 검증하는 클라이언트를 만든다. */
function createClient(values: Record<string, string | undefined> = {}): YouthCenterClient {
  return new YouthCenterClient(parseEnvironment({
    DATABASE_URL: 'postgresql://tester:unit-secret@localhost:5432/example',
    YOUTH_CENTER_API_KEY: apiKey,
    ...values,
  }));
}

/** 실제 단일 호출 함수와 모의 fetch를 연결해 재시도·중단·호출 간격을 검증한다. */
describe('온통청년 페이지의 일시 오류 재시도', () => {
  let client: YouthCenterClient;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-17T00:00:00Z') });
    client = createClient();
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('첫 성공은 대기 없이 한 번만 반환한다', async () => {
    fetchMock.mockResolvedValue(Response.json(validPage));
    await expect(client.fetchPageWithRetry(1)).resolves.toMatchObject({ attempts: 1, httpStatus: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([429, 500, 502, 503, 599])('HTTP %i 이후 1초·2초 대기로 같은 페이지를 최대 세 번 요청한다', async (status) => {
    fetchMock.mockResolvedValueOnce(Response.json({ resultCode: status }, { status }))
      .mockResolvedValueOnce(Response.json({ resultCode: status }, { status }))
      .mockResolvedValueOnce(Response.json(validPage));
    const pending = client.fetchPageWithRetry(7);
    await jest.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ attempts: 3, apiSuccess: true });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      String(fetchMock.mock.calls[0][0]), String(fetchMock.mock.calls[0][0]), String(fetchMock.mock.calls[0][0]),
    ]);
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('pageNum')).toBe('7');
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_SOCKET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'])(
    '일시 연결·시간 초과 오류 %s 이후 같은 페이지만 재시도한다', async (code) => {
      const cause = Object.assign(new Error(`비공개 원본 ${apiKey}`), { code });
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed', { cause }))
        .mockResolvedValueOnce(Response.json(validPage));
      const pending = client.fetchPageWithRetry(2);
      await jest.advanceTimersByTimeAsync(1000);
      await expect(pending).resolves.toMatchObject({ attempts: 2 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('AbortSignal 시간 초과도 재시도한다', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('모의 시간 초과', 'TimeoutError'))
      .mockResolvedValueOnce(Response.json(validPage));
    const pending = client.fetchPageWithRetry(1);
    await jest.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toMatchObject({ attempts: 2 });
  });

  it('응답 본문을 읽던 소켓 연결이 끊겨도 재시도한다', async () => {
    const response = Response.json(validPage);
    jest.spyOn(response, 'text').mockRejectedValue(Object.assign(new Error(apiKey), { code: 'EPIPE' }));
    fetchMock.mockResolvedValueOnce(response).mockResolvedValueOnce(Response.json(validPage));
    const pending = client.fetchPageWithRetry(1);
    await jest.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toMatchObject({ attempts: 2 });
  });

  it.each([1, 2, 3])('설정한 최대 %i회에 도달하면 추가 대기 없이 한도 초과 오류를 반환한다', async (maxAttempts) => {
    client = createClient({ YOUTH_CENTER_MAX_ATTEMPTS: String(maxAttempts) });
    fetchMock.mockImplementation(async () => Response.json({ resultCode: 503 }, { status: 503 }));
    const outcome = client.fetchPageWithRetry(4).catch((error: unknown) => error);
    await jest.runAllTimersAsync();
    expect(await outcome).toBeInstanceOf(YouthCenterPageError);
    expect(await outcome).toMatchObject({
      pageNum: 4, attempts: maxAttempts, reason: 'RETRY_EXHAUSTED', failure: 'HTTP', httpStatus: 503,
    });
    expect(fetchMock).toHaveBeenCalledTimes(maxAttempts);
    expect(Date.now()).toBe(Date.parse('2026-10-17T00:00:00Z') + (maxAttempts === 3 ? 3000 : (maxAttempts - 1) * 1000));
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([400, 401, 403, 404, 422])('HTTP %i는 Retry-After가 있어도 즉시 실패한다', async (status) => {
    fetchMock.mockResolvedValue(Response.json({ errorCode: 'other' }, { status, headers: { 'Retry-After': '10' } }));
    await expect(client.fetchPageWithRetry(3)).rejects.toMatchObject({
      pageNum: 3, attempts: 1, reason: 'NON_RETRYABLE', failure: 'HTTP', httpStatus: status,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([200, 400, 429, 500, 503])('e003은 HTTP %i에서도 재시도하지 않는다', async (status) => {
    fetchMock.mockResolvedValue(Response.json({ errorCode: 'e003', errorMsg: apiKey }, { status }));
    await expect(client.fetchPageWithRetry(2)).rejects.toMatchObject({ attempts: 1, reason: 'NON_RETRYABLE', failure: 'E003' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([{ resultCode: 'e003' }, { resultCode: 200, errorCode: 'e003' }])('본문 성공 값과 충돌하는 e003도 즉시 실패한다: %j', async (body) => {
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(client.fetchPageWithRetry(1)).rejects.toMatchObject({ failure: 'E003', reason: 'NON_RETRYABLE' });
  });

  it.each(['<html>오류</html>', '{broken-json', '', 'null', '[]', '{"resultCode":"200"}', '{"resultCode":400}'])(
    'HTTP 200의 형식·API 오류는 반복하지 않는다: %s', async (body) => {
      fetchMock.mockResolvedValue(new Response(body));
      await expect(client.fetchPageWithRetry(1)).rejects.toMatchObject({ attempts: 1, reason: 'NON_RETRYABLE', failure: 'API' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('서버 5xx의 HTML 본문은 HTTP 일시 오류로 재시도한다', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>일시 오류</html>', { status: 502 }))
      .mockResolvedValueOnce(Response.json(validPage));
    const pending = client.fetchPageWithRetry(1);
    await jest.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toMatchObject({ attempts: 2 });
  });

  it.each(['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_INVALID_URL', 'Z_DATA_ERROR', undefined])(
    '인증서·요청 설정·미분류 오류 %s는 재시도하지 않는다', async (code) => {
      fetchMock.mockRejectedValue(new TypeError(`민감 URL ${apiKey}`, {
        cause: Object.assign(new Error('원본 연결 실패'), { code }),
      }));
      await expect(client.fetchPageWithRetry(1)).rejects.toMatchObject({ attempts: 1, reason: 'NON_RETRYABLE', failure: 'REQUEST' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['7', ' 7 ', '0007'])('Retry-After 정수 초 %s를 기본 재시도 대기보다 우선한다', async (retryAfter) => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 429, headers: { 'Retry-After': retryAfter } }))
      .mockResolvedValueOnce(Response.json(validPage));
    const pending = client.fetchPageWithRetry(1);
    await jest.advanceTimersByTimeAsync(6999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ attempts: 2 });
  });

  it('Retry-After가 두 번째 실패에서 바뀌면 새 값을 사용한다', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 429, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(Response.json({}, { status: 503, headers: { 'Retry-After': '5' } }))
      .mockResolvedValueOnce(Response.json(validPage));
    const pending = client.fetchPageWithRetry(1);
    await jest.advanceTimersByTimeAsync(5999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ attempts: 3 });
  });

  it.each(['Sat, 17 Oct 2026 00:00:05 GMT', 'Saturday, 17-Oct-26 00:00:05 GMT', 'Sat Oct 17 00:00:05 2026'])(
    'Retry-After HTTP 날짜까지 기다린다: %s', async (retryAfter) => {
      fetchMock.mockResolvedValueOnce(Response.json({}, { status: 503, headers: { 'Retry-After': retryAfter } }))
        .mockResolvedValueOnce(Response.json(validPage));
      const pending = client.fetchPageWithRetry(1);
      await jest.advanceTimersByTimeAsync(4999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({ attempts: 2 });
    },
  );

  it.each(['0', 'Fri, 16 Oct 2026 23:59:00 GMT'])('Retry-After가 %s이면 추가 대기 없이 재시도한다', async (retryAfter) => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 503, headers: { 'Retry-After': retryAfter } }))
      .mockResolvedValueOnce(Response.json(validPage));
    await expect(client.fetchPageWithRetry(1)).resolves.toMatchObject({ attempts: 2 });
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['', 'invalid', '-1', '1.5', '+1', 'Infinity', '999999999999999999999999999999', 'Sat invalid GMT'])(
    '잘못된 Retry-After %s는 기본 1초 대기를 사용한다', async (retryAfter) => {
      fetchMock.mockResolvedValueOnce(Response.json({}, { status: 503, headers: { 'Retry-After': retryAfter } }))
        .mockResolvedValueOnce(Response.json(validPage));
      const pending = client.fetchPageWithRetry(1);
      await jest.advanceTimersByTimeAsync(999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({ attempts: 2 });
    },
  );

  it('타이머 상한보다 긴 Retry-After도 짧게 잘리지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 503, headers: { 'Retry-After': '2147484' } }))
      .mockResolvedValueOnce(Response.json(validPage));
    const pending = client.fetchPageWithRetry(1);
    await jest.advanceTimersByTimeAsync(2_147_483_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ attempts: 2 });
  });

  it('정상 페이지는 재요청하지 않고 다음 페이지는 앞 응답 완료 후 3초 뒤 호출한다', async () => {
    fetchMock.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      return Response.json(validPage);
    }).mockImplementation(async () => Response.json(validPage));
    const first = client.fetchPageWithRetry(1);
    await jest.advanceTimersByTimeAsync(500);
    await first;
    const second = client.fetchPageWithRetry(2);
    await jest.advanceTimersByTimeAsync(2999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(second).resolves.toMatchObject({ attempts: 1 });
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('pageNum'))).toEqual(['1', '2']);
  });

  it('페이지 호출 전 이미 지난 시간은 페이지 간 대기에서 뺀다', async () => {
    fetchMock.mockImplementation(async () => Response.json(validPage));
    await client.fetchPageWithRetry(1);
    await jest.advanceTimersByTimeAsync(1000);
    const second = client.fetchPageWithRetry(2);
    await jest.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await second;
    await jest.advanceTimersByTimeAsync(4000);
    await client.fetchPageWithRetry(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(['0', '5000'])('페이지 간 간격 %sms 설정을 적용한다', async (delay) => {
    client = createClient({ YOUTH_CENTER_REQUEST_DELAY_MS: delay });
    fetchMock.mockImplementation(async () => Response.json(validPage));
    await client.fetchPageWithRetry(1);
    const second = client.fetchPageWithRetry(2);
    if (Number(delay) > 0) {
      await jest.advanceTimersByTimeAsync(Number(delay) - 1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
    }
    await second;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('실패한 작업 뒤 새 페이지 요청도 간격을 지키고 시도 횟수는 새로 센다', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 401 }))
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(Response.json(validPage));
    await expect(client.fetchPageWithRetry(1)).rejects.toMatchObject({ attempts: 1 });
    const next = client.fetchPageWithRetry(2);
    await jest.advanceTimersByTimeAsync(2999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1001);
    await expect(next).resolves.toMatchObject({ attempts: 2 });
  });

  it('잘못된 페이지와 키 누락은 fetch 없이 실패한다', async () => {
    await expect(client.fetchPageWithRetry(0)).rejects.toThrow(RangeError);
    client = createClient({ YOUTH_CENTER_API_KEY: undefined });
    await expect(client.fetchPageWithRetry(1)).rejects.toThrow('YOUTH_CENTER_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('최종 통신 오류에 횟수·페이지·종류만 남기고 키·원본 오류를 숨긴다', async () => {
    fetchMock.mockRejectedValue(new TypeError(`https://example.com/?apiKeyNm=${apiKey}`, {
      cause: Object.assign(new Error(apiKey), { code: 'ECONNRESET' }),
    }));
    const outcome = client.fetchPageWithRetry(5).catch((error: unknown) => error);
    await jest.runAllTimersAsync();
    const error = await outcome;
    expect(error).toBeInstanceOf(YouthCenterPageError);
    expect(error).toMatchObject({ pageNum: 5, attempts: 3, reason: 'RETRY_EXHAUSTED', failure: 'NETWORK' });
    expect(String(error) + JSON.stringify(error) + (error as Error).stack).not.toMatch(/retry-unit-secret|apiKeyNm|https:\/\/|example\.com/);
    expect(error).not.toHaveProperty('cause');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
