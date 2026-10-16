import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  /** API 프로세스의 응답 여부를 확인하며 DB 연결 검사는 포함하지 않는다. */
  @Get()
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
