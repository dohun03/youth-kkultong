import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { dataSource } from '../../database/datasource';
import { PoliciesController } from './controllers/policies.controller';
import { PolicyRepository } from './repositories/policy.repository';
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
      provide: PolicyQueryService,
      inject: [PolicyRepository, ConfigService],
      useFactory: (policyRepository: PolicyRepository, configService: ConfigService) =>
        new PolicyQueryService(policyRepository, configService.getOrThrow<number>('HIDE_DAYS')),
    },
  ],
})
export class PoliciesModule {}
