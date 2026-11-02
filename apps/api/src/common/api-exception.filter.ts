import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import { CannotExecuteNotConnectedError, QueryFailedError, TypeORMError } from 'typeorm';

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

// 관리자 업무 오류는 정해진 상태와 코드에 해당하는 고정 문구만 외부에 제공
const adminErrors: Record<string, { status: number; message: string }> = {
  ADMIN_UNAUTHORIZED: { status: 401, message: '관리자 인증이 필요합니다.' },
  ADMIN_ORIGIN_FORBIDDEN: { status: 403, message: '허용되지 않은 관리자 요청 출처입니다.' },
  REVIEW_NOT_FOUND: { status: 404, message: '검수 후보를 찾을 수 없습니다.' },
  REVIEW_NOT_PENDING: { status: 409, message: '이미 처리된 검수 후보입니다.' },
  REVIEW_CONTENT_CONFLICT: { status: 409, message: '검수 내용이 변경되었습니다. 다시 조회해 주세요.' },
  REVIEW_BASE_CONFLICT: { status: 409, message: '공개 기준이 변경되었습니다. 다시 조회해 주세요.' },
};

/** DB 연결 오류인지 확인해 HTTP 503 처리 여부를 판정한다. */
function isDatabaseUnavailable(error: unknown): boolean {
  const cause: unknown = error instanceof QueryFailedError ? error.driverError : error;
  if (typeof cause !== 'object' || cause === null) return false;
  if ('code' in cause && typeof cause.code === 'string' && connectionErrorCodes.has(cause.code)) {
    return true;
  }
  return error instanceof CannotExecuteNotConnectedError
    // 연결 풀이 종료된 PostgreSQL 드라이버가 실제 조회 시 발생시키는 오류
    || (cause instanceof TypeORMError && cause.message === 'Driver not Connected')
    || (cause instanceof Error && connectionErrorMessages.has(cause.message));
}

/** 발생한 예외를 공통 API 오류 응답으로 변환하는 전역 필터. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  /** 예외의 HTTP 상태를 결정하고 { code, message } 형식의 JSON 응답을 전송한다. */
  catch(error: unknown, host: ArgumentsHost): void {
    // 본문 파서는 NestJS 예외가 아닌 오류를 전달하므로 알려진 크기·인코딩 오류만 변환한다.
    const parserType = typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
    const parserStatus = parserType === 'entity.too.large' ? 413
      : parserType === 'encoding.unsupported' || parserType === 'charset.unsupported' ? 415 : undefined;
    const status = error instanceof HttpException
      ? error.getStatus()
      : parserStatus ?? (isDatabaseUnavailable(error) ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.INTERNAL_SERVER_ERROR);
    const messages: Record<number, string> = {
      400: '요청값이 올바르지 않습니다.',
      404: '요청한 대상을 찾을 수 없습니다.',
      413: '요청 본문이 너무 큽니다.',
      415: '지원하지 않는 본문 인코딩입니다.',
      500: '서버 내부 오류가 발생했습니다.',
      503: 'DB에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    };
    let code = (STATUS_CODES[status] ?? 'HTTP_ERROR').toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_');
    let message = messages[status] ?? '요청을 처리할 수 없습니다.';
    // 임의의 예외 본문 대신 허용된 관리자 코드와 상태가 일치할 때만 전용 응답 사용
    const body = error instanceof HttpException ? error.getResponse() : undefined;
    if (typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string'
      && Object.hasOwn(adminErrors, body.code) && adminErrors[body.code].status === status) {
      code = body.code;
      message = adminErrors[code].message;
    }
    // 접속 정보와 사용자 입력이 노출되지 않도록 오류 원문은 기록하지 않는다.
    if (status >= 500) this.logger.error(`요청 처리 실패: ${code} (${status})`);
    host.switchToHttp().getResponse().status(status).json({
      code,
      message,
    });
  }
}
