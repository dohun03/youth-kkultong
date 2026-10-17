import { Inject, Injectable } from '@nestjs/common';
import { ENVIRONMENT } from '../../common/environment';
import type { Environment } from '../../common/environment';
import { parseYouthCenterPageResponse } from './youth-center-response.schema';
import type { YouthCenterListResponse } from './youth-center-response.schema';

/** HTTP 상태와 온통청년의 성공 여부를 분리한 단일 페이지 응답 */
export interface YouthCenterPageResponse {
  httpStatus: number;
  httpOk: boolean;
  apiSuccess: boolean;
  body: unknown;
  retryAfter: string | null;
}

/** 재시도와 구조 검증을 통과한 페이지 응답과 실제 시도 횟수다. */
export interface YouthCenterValidatedPageResponse extends YouthCenterPageResponse {
  body: YouthCenterListResponse;
  attempts: number;
}

/** 일시적 에러: 통신 오류가 발생한 페이지와 실패 종류만 전달한다. */
export class YouthCenterRequestError extends Error {
  constructor(
    readonly pageNum: number,
    readonly kind: 'NETWORK' | 'TIMEOUT' | 'REQUEST',
  ) {
    super(`온통청년 ${pageNum}페이지 ${kind === 'TIMEOUT' ? '요청 시간이 초과되었습니다.' : '통신에 실패했습니다.'}`);
    this.name = 'YouthCenterRequestError';
  }
}

/** 최종 실패 에러: 재시도 종료 사유와 실제 시도 횟수만 전달하고 응답 원문은 오류에 담지 않는다. */
export class YouthCenterPageError extends Error {
  constructor(
    readonly pageNum: number,
    readonly attempts: number,
    readonly reason: 'RETRY_EXHAUSTED' | 'NON_RETRYABLE',
    readonly failure: 'NETWORK' | 'TIMEOUT' | 'REQUEST' | 'HTTP' | 'API' | 'E003',
    readonly httpStatus?: number,
  ) {
    super(`온통청년 ${pageNum}페이지 ${attempts}회 시도 후 실패했습니다 (${reason}, ${failure}).`);
    this.name = 'YouthCenterPageError';
  }
}

/** 온통청년 목록 API의 지정한 한 페이지만 호출 */
@Injectable()
export class YouthCenterClient {
  // 마지막 페이지 수집 시간 기록
  private lastPageFinishedAt?: number;

  constructor(@Inject(ENVIRONMENT) private readonly environment: Environment) {}

  /** 현재 페이지의 일시 오류를 재시도하고 성공 응답의 구조를 검증한다. */
  async fetchPageWithRetry(pageNum: number): Promise<YouthCenterValidatedPageResponse> {
    // 이전 페이지 종료 후 요청 간격 유지
    if (this.lastPageFinishedAt !== undefined) {
      const elapsed = performance.now() - this.lastPageFinishedAt;
      await this.wait(this.environment.YOUTH_CENTER_REQUEST_DELAY_MS - elapsed);
    }

    try {
      for (let attempt = 1; ; attempt += 1) {
        // 현재 시도의 HTTP 응답 또는 통신 오류 보관
        let response: YouthCenterPageResponse | undefined;
        let requestError: YouthCenterRequestError | undefined;
        try {
          response = await this.fetchPage(pageNum);
        } catch (error) {
          // 일시 오류가 아니면 반복하지 않는다.
          if (!(error instanceof YouthCenterRequestError)) throw error;
          requestError = error;
        }

        const body = response?.body;

        // E003 에러 확인
        const isE003 = typeof body === 'object' && body !== null
          && (('errorCode' in body && body.errorCode === 'e003')
            || ('resultCode' in body && body.resultCode === 'e003'));

        if (response?.httpOk && response.apiSuccess && !isE003) {
          // 성공 응답의 구조 검증. 실패하면 재시도 없이 호출자에게 전달한다.
          const validatedBody = parseYouthCenterPageResponse(response.body, pageNum, attempt);
          return { ...response, body: validatedBody, attempts: attempt };
        }

        // 재시도 대상과 최종 실패 원인 분류
        const status = response?.httpStatus;
        const retryable = !isE003 && (requestError
          ? requestError.kind !== 'REQUEST'
          : status === 429 || (status !== undefined && status >= 500 && status <= 599));
        const failure = isE003 ? 'E003'
          : requestError ? requestError.kind : response?.httpOk ? 'API' : 'HTTP';
        if (!retryable || attempt >= this.environment.YOUTH_CENTER_MAX_ATTEMPTS) {
          throw new YouthCenterPageError(
            pageNum, attempt, retryable ? 'RETRY_EXHAUSTED' : 'NON_RETRYABLE', failure, status,
          );
        }
        // 재시도 전 대기 후 다음 시도로 진행
        await this.wait(this.retryDelay(response?.retryAfter ?? null, attempt));
      }
    } finally {
      // 성공·실패와 관계없이 페이지 종료 시각 갱신
      this.lastPageFinishedAt = performance.now();
    }
  }

  /** HTTP 오류도 응답으로 반환, 통신 오류만 안전한 예외로 전달한다. */
  async fetchPage(pageNum: number): Promise<YouthCenterPageResponse> {
    if (!Number.isSafeInteger(pageNum) || pageNum < 1) {
      throw new RangeError('온통청년 요청 페이지는 1 이상의 안전한 정수여야 합니다.');
    }

    const apiKey = this.environment.YOUTH_CENTER_API_KEY;
    if (!apiKey) {
      throw new Error('온통청년 호출에 필요한 YOUTH_CENTER_API_KEY가 설정되지 않았습니다.');
    }

    const url = new URL('https://www.youthcenter.go.kr/go/ythip/getPlcy');
    url.search = new URLSearchParams({
      apiKeyNm: apiKey,
      pageType: '1',
      rtnType: 'json',
      pageNum: String(pageNum),
      pageSize: String(this.environment.YOUTH_CENTER_PAGE_SIZE),
    }).toString();

    // 응답 본문 읽기까지 30초로 제한하고, 인증키가 있는 URL의 리다이렉트는 따르지 않는다.
    const signal = AbortSignal.timeout(30_000);
    let response: Response;
    let text: string;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal,
      });
      text = await response.text();
    } catch (error) {
      // 원본 오류에는 URL이 섞일 수 있어 확인된 일시 연결 오류의 종류만 전달한다.
      const cause = typeof error === 'object' && error !== null && 'cause' in error ? error.cause : error;
      const code = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined;
      const timedOut = signal.aborted
        || (typeof error === 'object' && error !== null && 'name' in error && error.name === 'TimeoutError')
        || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(String(code));
      const networkFailure = [
        'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN',
        'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_SOCKET',
      ].includes(String(code));
      throw new YouthCenterRequestError(pageNum, timedOut ? 'TIMEOUT' : networkFailure ? 'NETWORK' : 'REQUEST');
    }

    // HTML·빈 본문·깨진 JSON도 정상 JSON으로 바꾸지 않고 원문으로 반환한다.
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }

    return {
      httpStatus: response.status,
      httpOk: response.ok,
      apiSuccess: typeof body === 'object' && body !== null && 'resultCode' in body && body.resultCode === 200,
      body,
      retryAfter: response.headers.get('retry-after'),
    };
  }

  /** 재시도 딜레이 로직: Retry-After의 값을 우선하고, 해석할 수 없으면 1초·2초를 적용 */
  private retryDelay(retryAfter: string | null, attempt: number): number {
    const value = retryAfter?.trim() ?? '';
    if (/^\d+$/.test(value)) {
      const milliseconds = Number(value) * 1000;
      if (Number.isSafeInteger(milliseconds)) return milliseconds;
    } else if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(value)) {
      // 시간대 표기가 없는 구형 HTTP 날짜(asctime)도 GMT로 해석한다.
      const date = Date.parse(value.endsWith('GMT') ? value : `${value} GMT`);
      if (Number.isFinite(date)) return Math.max(0, date - Date.now());
    }
    return attempt * 1000;
  }

  /** Node.js 타이머 상한을 넘는 대기도 잘라 기다려 즉시 재요청되는 것을 막는다. */
  private async wait(milliseconds: number): Promise<void> {
    let remaining = Math.ceil(milliseconds);
    while (remaining > 0) {
      const delay = Math.min(remaining, 2_147_483_647);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      remaining -= delay;
    }
  }
}
