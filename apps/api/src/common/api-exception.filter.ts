import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import { CannotExecuteNotConnectedError, QueryFailedError } from 'typeorm';

// HTTP 503으로 처리할 PostgreSQL·네트워크 연결 오류 코드.
const connectionErrorCodes = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN',
  'ETIMEDOUT', 'EPIPE', '08000', '08001', '08003', '08004', '08006', '08007',
  '08P01', '53300', '57P01', '57P02', '57P03',
]);

// 오류 코드 없이 발생하는 pg·pg-pool의 연결 종료·시간 초과 메시지.
const connectionErrorMessages = new Set([
  'Connection terminated', 'Connection terminated unexpectedly',
  'Connection terminated due to connection timeout', 'Client was closed and is not queryable',
  'Cannot use a pool after calling end on the pool', 'timeout exceeded when trying to connect',
]);

/** DB 연결 오류인지 확인해 HTTP 503 처리 여부를 판정한다. */
function isDatabaseUnavailable(error: unknown): boolean {
  const cause: unknown = error instanceof QueryFailedError ? error.driverError : error;
  if (typeof cause !== 'object' || cause === null) return false;
  if ('code' in cause && typeof cause.code === 'string' && connectionErrorCodes.has(cause.code)) {
    return true;
  }
  return error instanceof CannotExecuteNotConnectedError
    || (cause instanceof Error && connectionErrorMessages.has(cause.message));
}

/** 발생한 예외를 공통 API 오류 응답으로 변환하는 전역 필터. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  /** 예외의 HTTP 상태를 결정하고 { code, message } 형식의 JSON 응답을 전송한다. */
  catch(error: unknown, host: ArgumentsHost): void {
    const status = error instanceof HttpException
      ? error.getStatus()
      : isDatabaseUnavailable(error) ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.INTERNAL_SERVER_ERROR;
    const messages: Record<number, string> = {
      400: '요청값이 올바르지 않습니다.',
      404: '요청한 대상을 찾을 수 없습니다.',
      500: '서버 내부 오류가 발생했습니다.',
      503: 'DB에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    };
    const code = (STATUS_CODES[status] ?? 'HTTP_ERROR').toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_');
    // 접속 정보와 사용자 입력이 노출되지 않도록 오류 원문은 기록하지 않는다.
    if (status >= 500) this.logger.error(`요청 처리 실패: ${code} (${status})`);
    host.switchToHttp().getResponse().status(status).json({
      code,
      message: messages[status] ?? '요청을 처리할 수 없습니다.',
    });
  }
}
