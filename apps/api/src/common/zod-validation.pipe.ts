import { BadRequestException } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** 요청 본문(@Body)과 경로값(@Param)을 검사하는 NestJS 검증 파이프. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, Promise<T>> {
  constructor(private readonly schema: z.ZodType<T>) {}

  /** 요청값을 검증해 반환하고, 유효하지 않으면 HTTP 400 오류를 발생시킨다. */
  async transform(value: unknown): Promise<T> {
    const result = await this.schema.safeParseAsync(value);
    if (!result.success) {
      // 사용자 입력 노출을 막기 위해 Zod 오류 원문 대신 고정된 안내 문구를 반환한다.
      throw new BadRequestException('요청값이 올바르지 않습니다.');
    }
    return result.data;
  }
}
