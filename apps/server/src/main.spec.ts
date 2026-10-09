import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { HttpErrorFilter } from './common/errors/http-error.filter';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://kkultong:kkultong_local@localhost:5432/youth_kkultong';
process.env.WEB_ORIGIN = 'http://localhost:3001';
process.env.API_ORIGIN = 'http://localhost:3000';
process.env.HIDE_DAYS = '30';
process.env.MAX_HOUSEHOLD_SIZE = '8';

const { PUBLIC_API_PREFIX, configurePublicApi, createCorsOptions } = require('./main') as typeof import('./main');

describe('공개 API HTTP 설정', () => {
  const webOrigin = 'http://localhost:3001';

  it('허용된 웹 Origin과 Origin 헤더가 없는 요청만 CORS에서 허용한다', () => {
    const corsOptions = createCorsOptions(webOrigin);
    const origin = corsOptions.origin;

    if (typeof origin !== 'function') {
      throw new Error('CORS Origin 설정이 함수여야 합니다.');
    }

    const callback = jest.fn();
    origin(webOrigin, callback);
    expect(callback).toHaveBeenLastCalledWith(null, true);

    origin('https://untrusted.example', callback);
    expect(callback).toHaveBeenLastCalledWith(null, false);

    origin(undefined, callback);
    expect(callback).toHaveBeenLastCalledWith(null, true);
  });

  it('prefix, 보안 헤더, 공통 오류 filter를 등록한다', () => {
    const app = {
      setGlobalPrefix: jest.fn(),
      enableCors: jest.fn(),
      use: jest.fn(),
      useGlobalFilters: jest.fn(),
    };

    configurePublicApi(app as Parameters<typeof configurePublicApi>[0], webOrigin);

    expect(app.setGlobalPrefix).toHaveBeenCalledWith(PUBLIC_API_PREFIX);
    expect(app.enableCors).toHaveBeenCalledWith(expect.objectContaining<CorsOptions>({ origin: expect.any(Function) }));
    expect(app.useGlobalFilters).toHaveBeenCalledWith(expect.any(HttpErrorFilter));

    const securityHeaderMiddleware = app.use.mock.calls[0]?.[0] as (
      request: unknown,
      response: { setHeader: jest.Mock },
      next: jest.Mock,
    ) => void;
    const response = { setHeader: jest.fn() };
    const next = jest.fn();
    securityHeaderMiddleware({}, response, next);

    expect(response.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(response.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
