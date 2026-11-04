import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IngestionService } from './ingestion.service';

/** 매일 한국 시간 04시에 공통 정책 수집 서비스를 호출 */
@Injectable()
export class PolicyScheduleService {
  private readonly logger = new Logger(PolicyScheduleService.name);

  constructor(@Inject(IngestionService) private readonly ingestionService: IngestionService) {}

  /** 수집 결과 기록과 잠금 정리를 공통 서비스에 맡기고 다음 예약 실행을 유지 */
  @Cron('0 0 4 * * *', { name: 'policy-daily-import', timeZone: 'Asia/Seoul' })
  async importPolicies(): Promise<void> {
    try {
      await this.ingestionService.importPolicies();
    } catch {
      // 공통 서비스가 실패 기록과 자원 정리를 마친 뒤 전달한 오류를 여기서 처리
      this.logger.error('자동 정책 수집에 실패했습니다. 수집 로그와 DB 연결 상태를 확인하세요. 다음 예약 실행은 유지됩니다.');
    }
  }
}
