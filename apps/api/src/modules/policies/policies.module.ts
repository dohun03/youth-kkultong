import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { PoliciesWriteService } from './policies-write.service';
import { PolicyRepository } from './policy.repository';

/** 정책 조회 클래스와 저장 서비스를 등록하는 모듈 */
@Module({
  imports: [DatabaseModule],
  providers: [PolicyRepository, PoliciesWriteService],
  exports: [PolicyRepository, PoliciesWriteService],
})
export class PoliciesModule {}
