import { Inject, Injectable } from '@nestjs/common';
import { ENVIRONMENT } from '../../common/environment';
import type { Environment } from '../../common/environment';

/** HTTP 상태와 온통청년의 성공 여부를 분리한 단일 페이지 응답 */
export interface YouthCenterPageResponse {
  httpStatus: number;
  httpOk: boolean;
  apiSuccess: boolean;
  body: unknown;
  retryAfter: string | null;
}

/** 페이지와 통신 실패 종류만 전달 */
export class YouthCenterRequestError extends Error {
  constructor(
    readonly pageNum: number,
    readonly kind: 'NETWORK' | 'TIMEOUT',
  ) {
    super(`온통청년 ${pageNum}페이지 ${kind === 'TIMEOUT' ? '요청 시간이 초과되었습니다.' : '통신에 실패했습니다.'}`);
    this.name = 'YouthCenterRequestError';
  }
}

/** 온통청년 목록 API의 지정한 한 페이지만 호출 */
@Injectable()
export class YouthCenterClient {
  constructor(@Inject(ENVIRONMENT) private readonly environment: Environment) {}

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
      const timedOut = signal.aborted || (error instanceof Error && error.name === 'TimeoutError');
      throw new YouthCenterRequestError(pageNum, timedOut ? 'TIMEOUT' : 'NETWORK');
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
}
