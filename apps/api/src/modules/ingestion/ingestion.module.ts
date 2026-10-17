import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { YouthCenterClient } from './youth-center.client';
import { IngestionService } from './ingestion.service';

/** 외부 API 클라이언트와 전체 정책 수집 서비스를 제공한다. */
@Module({
  imports: [DatabaseModule],
  providers: [YouthCenterClient, IngestionService],
  exports: [YouthCenterClient, IngestionService],
})
export class IngestionModule {}
