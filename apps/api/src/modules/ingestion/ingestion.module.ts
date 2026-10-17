import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { YouthCenterClient } from './youth-center.client';

/** 정책 수집에서 사용할 외부 API 클라이언트를 제공한다. */
@Module({
  imports: [DatabaseModule],
  providers: [YouthCenterClient],
  exports: [YouthCenterClient],
})
export class IngestionModule {}
