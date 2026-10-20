import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { DataSource, QueryRunner } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import * as database from '../src/database/data-source';
import { CreatePolicies1792162800000 } from '../src/database/migrations/1792162800000-create-policies';
import { importPolicies } from '../src/import-policies';
import { IngestionLockService } from '../src/modules/ingestion/services/ingestion-lock.service';
import { IngestionLogService } from '../src/modules/ingestion/services/ingestion-log.service';

describe('독립 NestJS 수집 CLI와 실제 PostgreSQL 연결', () => {
  const schema = `step25_test_${randomUUID().replaceAll('-', '')}`;
  const environment = loadEnvironment();
  const createDataSource = database.createDataSource;
  let admin: DataSource;
  let cliDataSource: DataSource;
  let directory: string;
  let schemaCreated = false;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let stdout: jest.SpiedFunction<typeof console.log>;
  const events: string[] = [];

  /** 임시 로그 파일에서 마지막 실행 결과를 읽는다. */
  async function finalRecord() {
    const lines = (await readFile(join(directory, 'policies-import.jsonl'), 'utf8')).trimEnd().split('\n');
    return JSON.parse(lines.at(-1)!);
  }

  beforeAll(async () => {
    admin = createDataSource(environment).setOptions({ entities: [], migrations: [] });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const migration = createDataSource(environment).setOptions({
      schema, migrations: [CreatePolicies1792162800000],
      extra: { options: `-c timezone=${environment.TZ} -c search_path=${schema}` },
    });
    try {
      await migration.initialize();
      await migration.runMigrations();
    } finally {
      if (migration.isInitialized) await migration.destroy();
    }
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'policy-cli-'));
    events.length = 0;
    jest.replaceProperty(process, 'env', { ...process.env, YOUTH_CENTER_API_KEY: 'cli-test-secret', YOUTH_CENTER_PAGE_SIZE: '50' });
    // 실제 모듈·서비스·종료 훅은 유지하고 DB 쓰기와 로그 경로만 검증 전용으로 격리한다.
    jest.spyOn(database, 'createDataSource').mockImplementation((settings) => {
      cliDataSource = createDataSource(settings).setOptions({
        schema,
        extra: { options: `-c timezone=${settings.TZ} -c search_path=${schema}` },
      });
      const createRunner = cliDataSource.createQueryRunner.bind(cliDataSource);
      jest.spyOn(cliDataSource, 'createQueryRunner').mockImplementation((mode) => {
        const runner = createRunner(mode);
        const query = runner.query.bind(runner);
        jest.spyOn(runner, 'query').mockImplementation((async (sql, parameters, structured) => {
          if (sql.includes('pg_try_advisory_lock')) events.push('LOCK');
          if (sql.startsWith('INSERT INTO') && sql.includes('"policies"')) events.push('SAVE');
          if (sql.includes('pg_advisory_unlock')) events.push('UNLOCK');
          return query(sql, parameters, structured);
        }) as QueryRunner['query']);
        const release = runner.release.bind(runner);
        jest.spyOn(runner, 'release').mockImplementation(async () => { events.push('RELEASE'); await release(); });
        return runner;
      });
      const destroy = cliDataSource.destroy.bind(cliDataSource);
      jest.spyOn(cliDataSource, 'destroy').mockImplementation(async () => { await destroy(); events.push('CLOSE'); });
      return cliDataSource;
    });
    const write = IngestionLogService.prototype.write;
    const logger = new IngestionLogService({ ...environment, YOUTH_CENTER_API_KEY: 'cli-test-secret' }, directory);
    jest.spyOn(IngestionLogService.prototype, 'write').mockImplementation(async (entry) => {
      events.push(entry.event);
      await write.call(logger, entry);
    });
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      events.push('API');
      return Response.json({ resultCode: 200, resultMessage: '성공', result: {
        pagging: { totCount: 1, pageNum: 1, pageSize: 50 },
        youthPolicyList: [{ plcyNo: randomUUID(), plcyNm: 'CLI 검증 정책' }],
      } });
    });
    jest.spyOn(NestFactory, 'create');
    stdout = jest.spyOn(console, 'log').mockImplementation(() => { events.push('OUTPUT'); });
    jest.spyOn(console, 'error').mockImplementation(() => { events.push('OUTPUT'); });
  });

  afterEach(async () => {
    try {
      if (cliDataSource?.isInitialized) await cliDataSource.destroy();
      if (directory) await rm(directory, { recursive: true, force: true });
    } finally {
      jest.restoreAllMocks();
      Logger.overrideLogger(new ConsoleLogger());
    }
  });

  afterAll(async () => {
    try {
      if (schemaCreated && admin?.isInitialized) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      if (admin?.isInitialized) await admin.destroy();
    }
  });

  it('잠금→API→저장→기록→잠금 해제→연결 반환→풀 종료 뒤 성공을 출력한다', async () => {
    await expect(importPolicies()).resolves.toBe(0);
    expect(NestFactory.create).not.toHaveBeenCalled();
    expect(cliDataSource.isInitialized).toBe(false);
    expect(events.filter((event) => ['LOCK', 'API', 'SAVE', 'WORK_FINISHED', 'UNLOCK', 'RUN_FINISHED', 'CLOSE', 'OUTPUT'].includes(event)))
      .toEqual(['LOCK', 'API', 'SAVE', 'WORK_FINISHED', 'UNLOCK', 'RUN_FINISHED', 'CLOSE', 'OUTPUT']);
    expect(events.lastIndexOf('RELEASE')).toBeLessThan(events.indexOf('RUN_FINISHED'));
    expect(await finalRecord()).toMatchObject({ status: 'SUCCESS', saved: true, counts: { NEW: 1, CHANGED: 0, UNCHANGED: 0 } });
    expect(await admin.query(`SELECT count(*)::int AS count FROM "${schema}".policies`)).toEqual([{ count: 1 }]);
  });

  it('API 최종 실패도 로그·연결 풀을 정리하고 다음 실행에서 잠금을 획득한다', async () => {
    fetchMock.mockResolvedValue(Response.json({}, { status: 403 }));
    await expect(importPolicies()).resolves.toBe(1);
    expect(cliDataSource.isInitialized).toBe(false);
    expect(stdout).not.toHaveBeenCalled();
    expect(await finalRecord()).toMatchObject({ status: 'FAILED', saved: false });
    await expect(new IngestionLockService(admin).runWithLock(async () => true))
      .resolves.toEqual({ status: 'COMPLETED', value: true });
  });

  it('다른 연결에서 수집 중이면 API 호출 없이 코드 2로 종료하고 파일에 기록한다', async () => {
    await new IngestionLockService(admin).runWithLock(async () => {
      await expect(importPolicies()).resolves.toBe(2);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(cliDataSource.isInitialized).toBe(false);
      expect(await finalRecord()).toMatchObject({ status: 'ALREADY_RUNNING', saved: false });
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('이미 실행 중'));
    });
  });
});
