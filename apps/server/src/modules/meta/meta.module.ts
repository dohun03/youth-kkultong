import { Module } from '@nestjs/common';
import { PoliciesModule } from '../policies/policies.module';
import { MetaController } from './meta.controller';
import { MetaService } from './meta.service';

@Module({
  // 기존 정책 모듈이 소유한 DataSource를 재사용해 DB 연결을 하나만 유지한다.
  imports: [PoliciesModule],
  controllers: [MetaController],
  providers: [MetaService],
})
export class MetaModule {}
