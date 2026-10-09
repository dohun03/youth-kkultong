import { ArgumentsHost, Catch, HttpException, HttpStatus, type ExceptionFilter } from '@nestjs/common';

interface HttpErrorResponse {
  statusCode: number;
  message: string;
}

interface HttpResponseWriter {
  status(statusCode: number): HttpResponseWriter;
  json(body: HttpErrorResponse): void;
}

/** HTTP 오류를 브라우저에 안전하고 일관된 형태로 반환한다. */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const response = host.switchToHttp().getResponse<HttpResponseWriter>();

    response.status(statusCode).json({
      statusCode,
      // 예상하지 못한 오류의 상세 내용과 stack은 서버 밖으로 내보내지 않는다.
      message: getPublicErrorMessage(statusCode),
    });
  }
}

function getPublicErrorMessage(statusCode: number): string {
  if (statusCode === HttpStatus.TOO_MANY_REQUESTS) {
    return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  }

  if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
    return '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
  }

  return '요청을 처리할 수 없습니다.';
}
