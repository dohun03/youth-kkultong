import { dataSource } from '../database/datasource';
import { PolicyRepository } from '../modules/policies/repositories/policy.repository';
import { PolicyWriteService } from '../modules/policies/services/policy-write.service';

const MAX_DATABASE_CONNECTION_ATTEMPTS = 2;

/** 정책 import CLI가 DB 연결과 저장 서비스를 일관되게 사용하도록 묶은 전용 module이다. */
export interface PolicyImportModule {
  policyWriteService: PolicyWriteService;
  close: () => Promise<void>;
}

/** 정책 import에 필요한 DB 연결과 PolicyWriteService를 생성한다. */
export async function createPolicyImportModule(): Promise<PolicyImportModule> {
  try {
    await initializeDataSource();

    const repository = new PolicyRepository(dataSource);

    return {
      policyWriteService: new PolicyWriteService(dataSource, repository),
      close: closeDataSource,
    };
  } catch (error) {
    // 초기화 도중 일부 연결이 남아도 다음 CLI 실행에 영향을 주지 않도록 정리한다.
    await closeDataSource();
    throw error;
  }
}

/** 일시적인 DB 연결 오류는 한 번 더 시도해 CLI 실행 실패를 줄인다. */
async function initializeDataSource(): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_DATABASE_CONNECTION_ATTEMPTS; attempt += 1) {
    if (dataSource.isInitialized) {
      return;
    }

    try {
      await dataSource.initialize();
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

/** CLI 실행이 끝난 뒤 열린 TypeORM 연결만 정리한다. */
async function closeDataSource(): Promise<void> {
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
}
