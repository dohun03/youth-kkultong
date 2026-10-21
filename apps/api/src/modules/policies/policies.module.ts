import { forwardRef, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { PoliciesWriteService } from './services/policies-write.service';
import { PolicyRepository } from './repositories/policy.repository';
import { MetaModule } from '../meta/meta.module';
import { PoliciesController } from './controllers/policies.controller';
import { PoliciesSearchService } from './services/policies-search.service';

/** 정책 조회 클래스와 저장 서비스를 등록하는 모듈 */
@Module({
  // 메타의 분야 조회는 정책 저장소를, 정책 검색은 메타의 지역 저장소를 사용한다.
  imports: [DatabaseModule, forwardRef(() => MetaModule)],
  controllers: [PoliciesController],
  providers: [PolicyRepository, PoliciesWriteService, PoliciesSearchService],
  exports: [PolicyRepository, PoliciesWriteService],
})
export class PoliciesModule {}
