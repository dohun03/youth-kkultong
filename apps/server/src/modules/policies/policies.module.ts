import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { dataSource } from '../../database/datasource';
import { PoliciesController } from './controllers/policies.controller';
import { PolicyRepository } from './repositories/policy.repository';
import { PolicySearchCacheService } from './services/policy-search-cache.service';
import { PolicyQueryService } from './services/policy-query.service';

const dataSourceProvider = {
  provide: DataSource,
  useFactory: async (): Promise<DataSource> => {
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }

    return dataSource;
  },
};

@Module({
  controllers: [PoliciesController],
  providers: [
    dataSourceProvider,
    {
      provide: PolicyRepository,
      inject: [DataSource],
      useFactory: (connection: DataSource) => new PolicyRepository(connection),
    },
    {
      provide: PolicySearchCacheService,
      inject: [PolicyRepository],
      useFactory: (policyRepository: PolicyRepository) => new PolicySearchCacheService(policyRepository),
    },
    {
      provide: PolicyQueryService,
      inject: [PolicySearchCacheService, ConfigService],
      useFactory: (policySearchCache: PolicySearchCacheService, configService: ConfigService) =>
        new PolicyQueryService(policySearchCache, configService.getOrThrow<number>('HIDE_DAYS')),
    },
  ],
  // Meta API도 같은 연결을 사용해 초기화 경쟁 없이 하나의 TypeORM DataSource를 공유한다.
  exports: [DataSource],
})
export class PoliciesModule {}
