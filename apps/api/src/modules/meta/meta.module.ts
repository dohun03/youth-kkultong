import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { PoliciesModule } from '../policies/policies.module';
import { MetaController } from './controllers/meta.controller';
import { RegionRepository } from './repositories/region.repository';

/** 지역 조회와 사용자 조건 선택용 메타 API를 등록하는 모듈 */
@Module({
  imports: [DatabaseModule, PoliciesModule],
  controllers: [MetaController],
  providers: [RegionRepository],
  exports: [RegionRepository],
})
export class MetaModule {}
