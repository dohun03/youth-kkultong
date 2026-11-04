import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { IngestionModule } from './ingestion.module';
import { PolicyScheduleService } from './services/policy-schedule.service';

/** HTTP 서버에서만 일일 수집 설정을 검사하고 필요한 타이머를 등록 */
@Module({})
export class IngestionScheduleModule {
  /** 기본은 비활성화. 정확한 true/false 문자열만 허용 */
  static forHttp(values: Record<string, unknown>): DynamicModule {
    const enabled = values.POLICY_SCHEDULE_ENABLED === undefined ? 'false' : values.POLICY_SCHEDULE_ENABLED;
    if (enabled !== 'true' && enabled !== 'false') {
      throw new Error('POLICY_SCHEDULE_ENABLED는 true 또는 false 문자열이어야 합니다.');
    }
    return {
      module: IngestionScheduleModule,
      imports: enabled === 'true' ? [ScheduleModule.forRoot(), IngestionModule] : [],
      providers: enabled === 'true' ? [PolicyScheduleService] : [],
    };
  }
}
