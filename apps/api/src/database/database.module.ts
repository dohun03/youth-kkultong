import { Inject, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ENVIRONMENT, loadEnvironment } from '../common/environment';
import type { Environment } from '../common/environment';
import { createDataSource } from './data-source';

@Module({
  providers: [
    { provide: ENVIRONMENT, useFactory: loadEnvironment },
    {
      provide: DataSource,
      inject: [ENVIRONMENT],
      useFactory: async (environment: Environment) => {
        const dataSource = createDataSource(environment);
        try {
          return await dataSource.initialize();
        } catch (error) {
          // 드라이버의 원본 오류에 접속 정보가 섞일 수 있어 설정값은 출력하지 않는다.
          const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
          const knownCodes = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', '28P01', '28000', '3D000', '53300', '57P03'];
          const reason = typeof code === 'string' && knownCodes.includes(code) ? ` (${code})` : '';
          throw new Error(`DB 연결 초기화에 실패했습니다${reason}. DATABASE_URL, DB 준비 상태와 인증 정보를 확인하세요.`);
        }
      },
    },
  ],
  exports: [DataSource, ENVIRONMENT],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  /** 정상 종료·종료 신호에서 DB 연결 풀을 반환한다. */
  async onApplicationShutdown(): Promise<void> {
    if (this.dataSource.isInitialized) await this.dataSource.destroy();
  }
}
