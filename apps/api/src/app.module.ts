import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DatabaseModule } from './database/database.module';
import { PoliciesModule } from './modules/policies/policies.module';
import { MetaModule } from './modules/meta/meta.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';

@Module({
  imports: [DatabaseModule, PoliciesModule, MetaModule, IngestionModule],
  controllers: [HealthController],
})
export class AppModule {}
