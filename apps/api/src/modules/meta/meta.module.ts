import { forwardRef, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { PoliciesModule } from '../policies/policies.module';
import { MetaController } from './controllers/meta.controller';
import { RegionRepository } from './repositories/region.repository';

/** 지역 조회와 사용자 조건 선택용 메타 API를 등록하는 모듈 */
@Module({
  // 정책 검색에서 지역 저장소를 가져가므로 두 모듈의 등록 순서는 지연 참조로 해결한다.
  imports: [DatabaseModule, forwardRef(() => PoliciesModule)],
  controllers: [MetaController],
  providers: [RegionRepository],
  exports: [RegionRepository],
})
export class MetaModule {}
