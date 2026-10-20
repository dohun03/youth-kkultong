import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { YouthCenterClient } from './youth-center/youth-center.client';
import { IngestionService } from './services/ingestion.service';
import { IngestionLockService } from './services/ingestion-lock.service';
import { IngestionLogService } from './services/ingestion-log.service';
import { PoliciesModule } from '../policies/policies.module';

/** 외부 API 클라이언트·전체 수집·중복 실행 잠금 서비스를 제공한다. */
@Module({
  imports: [DatabaseModule, PoliciesModule],
  providers: [YouthCenterClient, IngestionService, IngestionLockService, IngestionLogService],
  exports: [YouthCenterClient, IngestionService, IngestionLockService],
})
export class IngestionModule {}
