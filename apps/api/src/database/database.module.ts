import { Inject, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ENVIRONMENT, loadEnvironment } from '../common/environment';
import type { Environment } from '../common/environment';
import { createDataSource } from './data-source';

@Module({
  providers: [
    // 환경 변수 객체를 주입하기 위해 프로바이더 등록 (ENVIRONMENT는 심볼이라 팩토리 사용)
    { provide: ENVIRONMENT, useFactory: loadEnvironment },
    // 위에서 등록한 ENVIRONMENT를 주입받고, 팩토리 방식으로 DB 연결 후 DataSource 등록
    {
      provide: DataSource,
      inject: [ENVIRONMENT],
      useFactory: async (environment: Environment) => {
        // 환경변수로 TypeORM 설정 객체 생성
        const dataSource = createDataSource(environment);
        try {
          // DB 연결 수행
          return await dataSource.initialize();
        } catch (error) {
          // 민감 정보는 숨기고, 에러 코드만 추출해서 출력
          const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
          const knownCodes = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', '28P01', '28000', '3D000', '53300', '57P03'];
          const reason = typeof code === 'string' && knownCodes.includes(code) ? ` (${code})` : '';

          throw new Error(`DB 연결 초기화에 실패했습니다${reason}. DATABASE_URL, DB 준비 상태와 인증 정보를 확인하세요.`);
        }
      },
    },
  ],
  // 다른 모듈에서도 DataSource와 ENVIRONMENT를 주입받아 사용하도록 Export
  exports: [DataSource, ENVIRONMENT],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  /** 정상 종료·종료 신호에서 DB 연결 풀을 반환한다. */
  async onApplicationShutdown(): Promise<void> {
    if (this.dataSource.isInitialized) await this.dataSource.destroy();
  }
}
