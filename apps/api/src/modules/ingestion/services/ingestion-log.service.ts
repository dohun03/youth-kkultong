import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { appendFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ENVIRONMENT } from '../../../common/environment';
import type { Environment } from '../../../common/environment';
import type { PreparedPolicyBatches } from '../../policies/services/policies-write.service';

/** 테스트에서 로그를 임시 폴더에 저장할 때 사용하는 설정 이름 */
export const INGESTION_LOG_DIRECTORY = Symbol('INGESTION_LOG_DIRECTORY');

/** 수집 실패 위치 구분 */
export type IngestionStage = 'LOCK' | 'API' | 'PAGE_VALIDATION' | 'COLLECTION_VALIDATION'
  | 'TRANSFORMATION' | 'HASH' | 'DATABASE' | 'LOCK_RELEASE' | 'LOG' | 'COMPLETE';

/** 원본 오류 대신 기록할 실패 원인과 위치 */
export interface IngestionFailure {
  stage: IngestionStage;
  reason: string;
  pageNum?: number;
  attempts?: number;
  policyId?: string;
  fields?: string[];
  code?: string;
  httpStatus?: number;
}

/** 한 줄에 기록할 수집 진행 상황과 결과 */
export interface IngestionLogEntry {
  runId: string;
  event: 'RUN_STARTED' | 'PAGE_ATTEMPT' | 'SAVE_ATTEMPT' | 'WORK_FINISHED' | 'RUN_FINISHED';
  stage: IngestionStage;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'ALREADY_RUNNING';
  counts: PreparedPolicyBatches['counts'];
  pageNum?: number;
  attempts?: number;
  saveAttempts: number;
  saved: boolean;
  failures?: IngestionFailure[];
}

/** 파일과 기본 로그에 모두 기록하지 못했음을 알리는 오류 */
export class IngestionLogError extends Error {
  constructor() {
    super('수집 결과를 파일과 기본 로그에 기록하지 못했습니다.');
    this.name = 'IngestionLogError';
  }
}

/** 수집 기록을 파일에 추가하고 파일 기록 실패 시 기본 로그로 대체 */
@Injectable()
export class IngestionLogService {
  private readonly logger = new Logger(IngestionLogService.name);

  constructor(
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Optional() @Inject(INGESTION_LOG_DIRECTORY) private readonly directory = resolve(__dirname, '../../../../../../logs'),
  ) {}

  /** 원본·SQL·오류 메시지를 제외한 기록만 JSON 한 줄로 저장 */
  async write(entry: IngestionLogEntry): Promise<void> {
    // 허용한 항목만 복사해 실수로 원본 응답이나 DB 오류를 넘겨도 기록하지 않음
    const record = {
      timestamp: new Date().toISOString(), runId: entry.runId, event: entry.event,
      stage: entry.stage, status: entry.status,
      counts: { NEW: entry.counts.NEW, CHANGED: entry.counts.CHANGED, UNCHANGED: entry.counts.UNCHANGED },
      pageNum: entry.pageNum, attempts: entry.attempts, saveAttempts: entry.saveAttempts, saved: entry.saved,
      failures: entry.failures?.map((failure) => ({
        stage: failure.stage, reason: failure.reason, pageNum: failure.pageNum, attempts: failure.attempts,
        policyId: failure.policyId, fields: failure.fields, code: failure.code, httpStatus: failure.httpStatus,
      })),
    };
    // 정책 ID·필드명에 비밀값이 섞여 들어온 경우도 파일과 기본 로그에서 제거
    const password = new URL(this.environment.DATABASE_URL).password;
    const secrets = [this.environment.YOUTH_CENTER_API_KEY, this.environment.DATABASE_URL, password];
    try { secrets.push(decodeURIComponent(password)); } catch { /* 잘못 인코딩된 비밀번호는 원문으로 제거 */ }
    const line = JSON.stringify(record, (_key, value: unknown) => {
      if (typeof value !== 'string') return value;
      return secrets.reduce<string>((text, secret) => secret ? text.replaceAll(secret, '[REDACTED]') : text, value);
    });

    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await appendFile(resolve(this.directory, 'policies-import.jsonl'), `${line}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch {
      // 파일 경로나 원본 오류를 출력하지 않고 같은 기록을 기본 로그에 남김
      try {
        this.logger.warn(`FILE_LOG_FAILED ${line}`);
      } catch {
        throw new IngestionLogError();
      }
    }
  }
}
