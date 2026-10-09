import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { HttpErrorFilter } from './http-error.filter';

function createHost(response: { status: jest.Mock; json: jest.Mock }): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => undefined,
      getResponse: () => response,
      getNext: () => undefined,
    }),
  } as unknown as ArgumentsHost;
}

describe('HttpErrorFilter', () => {
  it('예상하지 못한 오류의 message와 stack을 응답에 노출하지 않는다', () => {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const error = new Error('database password is invalid');
    error.stack = 'Error: database password is invalid\n    at internal-handler';

    new HttpErrorFilter().catch(error, createHost(response));

    expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    });
    expect(JSON.stringify(response.json.mock.calls[0]?.[0])).not.toContain('database password');
    expect(JSON.stringify(response.json.mock.calls[0]?.[0])).not.toContain('internal-handler');
  });

  it('HTTP 오류도 공통 형식으로 응답한다', () => {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    new HttpErrorFilter().catch(
      new HttpException('원본 오류 메시지', HttpStatus.BAD_REQUEST),
      createHost(response),
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      message: '요청을 처리할 수 없습니다.',
    });
  });
});
