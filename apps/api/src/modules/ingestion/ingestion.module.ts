import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { YouthCenterClient } from './youth-center.client';
import { IngestionService } from './ingestion.service';
import { IngestionLockService } from './ingestion-lock.service';

/** 외부 API 클라이언트·전체 수집·중복 실행 잠금 서비스를 제공한다. */
@Module({
  imports: [DatabaseModule],
  providers: [YouthCenterClient, IngestionService, IngestionLockService],
  exports: [YouthCenterClient, IngestionService, IngestionLockService],
})
export class IngestionModule {}
