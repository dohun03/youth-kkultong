import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronTime } from 'cron';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { ENVIRONMENT, loadEnvironment } from '../src/common/environment';
import * as database from '../src/database/data-source';
import { createApplication } from '../src/main';
import { IngestionLockService } from '../src/modules/ingestion/services/ingestion-lock.service';
import { IngestionLogService } from '../src/modules/ingestion/services/ingestion-log.service';
import type { IngestionLogEntry } from '../src/modules/ingestion/services/ingestion-log.service';
import { PolicyScheduleService } from '../src/modules/ingestion/services/policy-schedule.service';
import { CreatePolicies1792162800000 } from '../src/database/migrations/1792162800000-create-policies';
import { CreateRegions1792162801000 } from '../src/database/migrations/1792162801000-create-regions';
import { CreatePolicyReviewTables1793199600000 } from '../src/database/migrations/1793199600000-create-policy-review-tables';
import { testAdminValues } from './helpers/admin';

describe('HTTP 자동 수집의 등록된 타이머와 실패 복구', () => {
  const schema = `schedule_test_${randomUUID().replaceAll('-', '')}`;
  const environment = loadEnvironment();
  let admin: DataSource;
  let app: INestApplication | undefined;
  let directory: string;
  let created = false;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let log: jest.SpiedFunction<IngestionLogService['write']>;
  let consoleError: jest.SpiedFunction<Logger['error']>;

  /** 테스트가 소유한 스키마에 연결한 실제 HTTP 서버를 생성 */
  async function start(enabled?: string): Promise<INestApplication> {
    const source = database.createDataSource(environment).setOptions({ schema,
      extra: { options: `-c timezone=${environment.TZ} -c search_path=${schema}` } });
    const factory = jest.spyOn(database, 'createDataSource').mockReturnValue(source);
    try {
      const result = await createApplication({ ...testAdminValues, POLICY_SCHEDULE_ENABLED: enabled });
      app = result;
      // 검증용 키와 짧은 시험 간격을 적용하고 실제 외부 API는 아래 응답으로 대체
      Object.assign(result.get(ENVIRONMENT), { YOUTH_CENTER_API_KEY: 'schedule-test-key', YOUTH_CENTER_REQUEST_DELAY_MS: 0 });
      await result.listen(0, '127.0.0.1');
      return result;
    } finally {
      factory.mockRestore();
      if (!app && source.isInitialized) await source.destroy();
    }
  }

  /** 실제 파일 로그에서 최종 실행 결과만 읽어 비동기 작업의 종료를 확인 */
  async function finished(): Promise<IngestionLogEntry[]> {
    try {
      // appendFile이 쓰는 도중에는 마지막 미완성 줄을 다음 조회에서 확인
      return (await readFile(join(directory, 'policies-import.jsonl'), 'utf8')).split('\n').slice(0, -1).filter(Boolean)
        .map((line) => JSON.parse(line) as IngestionLogEntry).filter(({ event }) => event === 'RUN_FINISHED');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  /** 핸들러를 직접 호출하지 않고 등록된 타이머의 다음 실행을 최대 5초 대기 */
  async function waitForRuns(count: number): Promise<IngestionLogEntry[]> {
    for (let attempt = 0; attempt < 250; attempt++) {
      const records = await finished();
      if (records.length >= count) return records;
      await delay(20);
    }
    throw new Error('자동 수집 타이머의 최종 로그가 도착하지 않았습니다.');
  }

  beforeAll(async () => {
    admin = database.createDataSource(environment).setOptions({ entities: [], migrations: [] });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    const source = database.createDataSource(environment).setOptions({ schema,
      migrations: [CreatePolicies1792162800000, CreateRegions1792162801000, CreatePolicyReviewTables1793199600000],
      extra: { options: `-c timezone=${environment.TZ} -c search_path=${schema}` } });
    try { await source.initialize(); await source.runMigrations(); }
    finally { if (source.isInitialized) await source.destroy(); }
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'policy-schedule-'));
    const original = IngestionLogService.prototype.write;
    log = jest.spyOn(IngestionLogService.prototype, 'write').mockImplementation(function (this: IngestionLogService, entry) {
      // 파일 기록 방식은 유지하고 이 테스트가 만든 임시 폴더만 사용
      Object.assign(this, { directory });
      return original.call(this, entry);
    });
    consoleError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ resultCode: 200, resultMessage: '성공',
      result: { pagging: { totCount: 0, pageNum: 1, pageSize: environment.YOUTH_CENTER_PAGE_SIZE }, youthPolicyList: [] } }));
  });

  afterEach(async () => {
    try { if (app) await app.close(); }
    finally { app = undefined; jest.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); }
  });

  afterAll(async () => {
    try { if (created && admin?.isInitialized) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
    finally { if (admin?.isInitialized) await admin.destroy(); }
  });

  it.each([undefined, 'false'])('T2-43: 설정 %s의 실제 HTTP 서버에는 스케줄러와 타이머가 없다', async (enabled) => {
    const server = await start(enabled);
    expect(() => server.get(SchedulerRegistry)).toThrow();
    expect(() => server.get(PolicyScheduleService)).toThrow();
    await request(server.getHttpServer()).get('/api/v1/health').expect(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('T2-43: 04:00 시간대와 다음 실행을 확인하고 재시작 뒤 놓친 수집을 보충하지 않는다', async () => {
    // 서버 중지 사이에 한국 04:00을 지난 상황을 시각 계산에만 적용
    const clock = jest.spyOn(Date, 'now');
    for (let restart = 0; restart < 2; restart++) {
      clock.mockReturnValue(new Date(restart === 0 ? '2026-11-03T18:59:59Z' : '2026-11-03T19:00:01Z').getTime());
      const server = await start('true');
      const registry = server.get(SchedulerRegistry);
      expect([...registry.getCronJobs().keys()]).toEqual(['policy-daily-import']);
      expect(registry.getIntervals()).toEqual([]);
      expect(registry.getTimeouts()).toEqual([]);
      const job = registry.getCronJob('policy-daily-import');
      expect(job.isActive).toBe(true);
      expect(job.cronTime.source).toBe('0 0 4 * * *');
      expect(job.cronTime.timeZone).toBe('Asia/Seoul');
      expect(job.cronTime.getNextDateFrom(new Date('2026-11-03T18:59:59Z')).toISO()).toBe('2026-11-04T04:00:00.000+09:00');
      expect(job.cronTime.getNextDateFrom(new Date('2026-11-03T19:00:01Z')).toISO()).toBe('2026-11-05T04:00:00.000+09:00');
      expect(job.nextDate().hour).toBe(4);
      expect(job.nextDate().toISO()).toBe(restart === 0 ? '2026-11-04T04:00:00.000+09:00' : '2026-11-05T04:00:00.000+09:00');
      expect(job.nextDate().toMillis()).toBeGreaterThan(Date.now());
      await delay(80);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      await server.close(); app = undefined;
      expect(registry.getCronJobs().size).toBe(0);
      expect(job.isActive).toBe(false);
    }
  });

  it('T2-43: 실제 타이머 수집 실패 후 API와 다음 예약 및 결과 로그를 유지한다', async () => {
    const server = await start('true');
    const job = server.get(SchedulerRegistry).getCronJob('policy-daily-import');
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 403 }));
    // 검증용 서버의 등록된 작업만 1초 간격으로 당겨 실제 setTimeout 경로를 실행
    job.setTime(new CronTime('* * * * * *', 'Asia/Seoul'));
    const [failed] = await waitForRuns(1);
    expect(failed).toMatchObject({ status: 'FAILED', saved: false, stage: 'API', commitOutcome: 'NOT_COMMITTED' });
    expect(failed.failures).toEqual(expect.arrayContaining([expect.objectContaining({ httpStatus: 403 })]));
    await request(server.getHttpServer()).get('/api/v1/health').expect(200);
    expect(job.isActive).toBe(true);
    expect(job.nextDate().toMillis()).toBeGreaterThan(Date.now());
    const [, success] = await waitForRuns(2);
    await job.stop();
    expect(success).toMatchObject({ status: 'SUCCESS', saved: true, commitOutcome: 'COMMITTED' });
    expect(success.runId).not.toBe(failed.runId);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('다음 예약 실행은 유지됩니다.'));
    expect(await server.get(IngestionLockService).runWithLock(async () => true)).toMatchObject({ status: 'COMPLETED' });
    await request(server.getHttpServer()).get('/api/v1/health').expect(200);
  });
});
