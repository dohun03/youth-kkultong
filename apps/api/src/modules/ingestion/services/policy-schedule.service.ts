import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { IngestionService } from './ingestion.service';

/** 매일 한국 시간 04시에 공통 정책 수집 서비스를 호출 */
@Injectable()
export class PolicyScheduleService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PolicyScheduleService.name);

  constructor(
    @Inject(IngestionService) private readonly ingestionService: IngestionService,
    @Inject(SchedulerRegistry) private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  /** 서버 시작 시: 등록된 수집 작업 + 다음 실행 시각을 로그에 기록 */
  onApplicationBootstrap(): void {
    const jobs = this.schedulerRegistry.getCronJobs();
    const job = this.schedulerRegistry.getCronJob('policy-daily-import');

    this.logger.log(JSON.stringify({
      event: 'POLICY_SCHEDULE_READY',
      jobName: 'policy-daily-import',
      jobCount: jobs.size,
      cron: job.cronTime.source,
      timeZone: job.cronTime.timeZone,
      active: job.isActive,
      nextRunAt: job.nextDate().toISO(),
    }));
  }

  /** 수집 결과 기록과 잠금 정리를 공통 서비스에 맡기고 다음 예약 실행을 유지 */
  @Cron('0 0 4 * * *', { name: 'policy-daily-import', timeZone: 'Asia/Seoul' })
  async importPolicies(): Promise<void> {
    try {
      await this.ingestionService.importPolicies();
    } catch {
      this.logger.error('자동 정책 수집에 실패했습니다. 수집 로그와 DB 연결 상태를 확인하세요. 다음 예약 실행은 유지됩니다.');
    }
  }
}
