import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import { createDataSource } from '../src/database/data-source';
import * as database from '../src/database/data-source';
import { CreatePolicies1792162800000 } from '../src/database/migrations/1792162800000-create-policies';
import { CreateRegions1792162801000 } from '../src/database/migrations/1792162801000-create-regions';
import { createApplication } from '../src/main';
import request from 'supertest';
import { IngestionLockService } from '../src/modules/ingestion/services/ingestion-lock.service';
import type { IngestionLogEntry } from '../src/modules/ingestion/services/ingestion-log.service';
import { Policy } from '../src/modules/policies/entities/policy.entity';

describe('독립 CLI 두 개의 잠금 경쟁과 프로세스 종료 복구', () => {
  const schema = `step27_cli_${randomUUID().replaceAll('-', '')}`;
  const environment = loadEnvironment();
  let admin: DataSource;
  let dataSource: DataSource;
  let schemaCreated = false;
  let directory: string;
  const processes: ReturnType<typeof startCli>[] = [];

  /** 실제 CLI 파일을 새 Node 프로세스로 실행하고 출력·종료 코드·진행 신호를 수집한다. */
  function startCli(name: string, mode = '') {
    const child = spawn(process.execPath, ['--require', join(__dirname, 'fixtures/ingestion-cli.preload.cjs'), join(__dirname, '../src/import-policies.ts')], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, NODE_OPTIONS: '', DATABASE_URL: environment.DATABASE_URL,
        YOUTH_CENTER_API_KEY: 'step27-process-key', YOUTH_CENTER_PAGE_SIZE: '2', YOUTH_CENTER_REQUEST_DELAY_MS: '0', POLICY_IMPORT_BATCH_SIZE: '1',
        INGESTION_TEST_SCHEMA: schema, INGESTION_TEST_LOG_DIRECTORY: join(directory, name), INGESTION_TEST_MODE: mode },
    });
    let stdout = '';
    let stderr = '';
    const events: string[] = [];
    // 위 stdio 설정에서 두 출력을 pipe로 고정했으므로 실제로는 null이 되지 않는다.
    child.stdout!.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr!.on('data', (chunk) => { stderr += String(chunk); });
    child.on('message', (message: { event?: string }) => { if (message.event) events.push(message.event); });
    const finished = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    });

    /** 자식 프로세스가 실제 검증 지점에 도착했다는 알림을 기다린다. */
    function waitFor(event: string): Promise<void> {
      if (events.includes(event)) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error(`CLI 진행 알림이 도착하지 않았습니다: ${event}`)); }, 15000);
        const onMessage = (message: { event?: string }) => { if (message.event === event) { cleanup(); resolve(); } };
        const onExit = () => { cleanup(); reject(new Error(`CLI가 진행 알림 전에 종료됐습니다: ${stdout} ${stderr}`)); };
        const cleanup = () => { clearTimeout(timer); child.off('message', onMessage); child.off('exit', onExit); };
        child.on('message', onMessage);
        child.once('exit', onExit);
      });
    }
    return { child, events, finished, waitFor, logDirectory: join(directory, name) };
  }

  /** 자식 프로세스마다 따로 만든 파일에서 실제 수집 기록을 읽는다. */
  async function records(run: ReturnType<typeof startCli>): Promise<IngestionLogEntry[]> {
    return (await readFile(join(run.logDirectory, 'policies-import.jsonl'), 'utf8')).trimEnd().split('\n').map((line) => JSON.parse(line));
  }

  /** 강제 종료 후 DB가 세션을 정리하면 다른 연결에서 같은 잠금을 다시 획득한다. */
  async function expectUnlocked(): Promise<void> {
    const lock = new IngestionLockService(dataSource);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const result = await lock.runWithLock(async () => true);
      if (result.status === 'COMPLETED') return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('자식 프로세스 종료 후에도 검증용 수집 잠금이 남아 있습니다.');
  }

  beforeAll(async () => {
    admin = createDataSource(environment).setOptions({ entities: [], migrations: [] });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    dataSource = createDataSource(environment).setOptions({ schema, entities: [Policy],
      migrations: [CreatePolicies1792162800000, CreateRegions1792162801000],
      extra: { options: `-c timezone=${environment.TZ} -c search_path=${schema}` } });
    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ingestion-cli-'));
    processes.length = 0;
    const table = dataSource.getRepository(Policy);
    await table.clear();
    await table.save([
      { source: 'youthcenter', externalId: 'policy-0', title: '이전 제목', rawJson: { old: true }, contentHash: 'a'.repeat(64) },
      { source: 'youthcenter', externalId: 'outside', title: '수집 밖의 기존 정책', rawJson: {}, contentHash: 'b'.repeat(64) },
    ]);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    try {
      // 검증 도중 실패해도 이 테스트가 만든 자식 프로세스만 종료하고 연결을 정리한다.
      for (const run of processes) if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill('SIGKILL');
      await Promise.all(processes.map((run) => run.finished));
      if (directory) await rm(directory, { recursive: true, force: true });
    } finally { jest.restoreAllMocks(); }
  });

  afterAll(async () => {
    try { if (dataSource?.isInitialized) await dataSource.destroy(); }
    finally {
      try { if (schemaCreated && admin?.isInitialized) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
      finally { if (admin?.isInitialized) await admin.destroy(); }
    }
  });

  it('T-25: 먼저 시작한 CLI만 API를 호출하고 다른 CLI는 종료 코드 2와 중복 실행을 기록한다', async () => {
    const first = startCli('first', 'API_PAUSE'); processes.push(first);
    await first.waitFor('API_PAUSED');
    const second = startCli('second'); processes.push(second);
    const skipped = await second.finished;
    expect(skipped).toMatchObject({ code: 2, signal: null });
    expect(skipped.stdout).toContain('이미 실행 중');
    expect(second.events).not.toContain('API_REQUEST');
    expect((await records(second)).at(-1)).toMatchObject({ status: 'ALREADY_RUNNING', saved: false });
    first.child.send('RESUME');
    const completed = await first.finished;
    expect(completed).toMatchObject({ code: 0, signal: null });
    expect((await records(first)).at(-1)).toMatchObject({ status: 'SUCCESS', saved: true, counts: { NEW: 1, CHANGED: 1, UNCHANGED: 0 } });
    expect(await dataSource.getRepository(Policy).count()).toBe(3);
    await expectUnlocked();
  }, 30000);

  it('T-26: COMMIT 전 CLI를 강제 종료하면 부분 갱신이 롤백되고 다음 CLI가 성공한다', async () => {
    const table = dataSource.getRepository(Policy);
    const before = await table.find({ order: { externalId: 'ASC' } });
    const interrupted = startCli('interrupted', 'SAVE_PAUSE'); processes.push(interrupted);
    await interrupted.waitFor('SAVE_PAUSED');
    expect(await table.find({ order: { externalId: 'ASC' } })).toEqual(before);
    interrupted.child.kill('SIGKILL');
    expect(await interrupted.finished).toMatchObject({ code: null, signal: 'SIGKILL' });
    await expectUnlocked();
    expect(await table.find({ order: { externalId: 'ASC' } })).toEqual(before);
    expect((await records(interrupted)).some((entry) => entry.event === 'RUN_FINISHED')).toBe(false);
    const next = startCli('next'); processes.push(next);
    expect(await next.finished).toMatchObject({ code: 0, signal: null });
    expect((await records(next)).at(-1)).toMatchObject({ status: 'SUCCESS', saved: true, counts: { NEW: 1, CHANGED: 1, UNCHANGED: 0 } });
    expect(await table.count()).toBe(3);
    await expectUnlocked();
  }, 30000);

  it.each(['API_PAUSE', 'SAVE_PAUSE'])(
    'T-30: 독립 CLI의 %s 중에도 실제 검색 API가 기존 정책을 제공하고 완료 뒤 새 정책을 제공한다', async (mode) => {
      // 읽기 API는 CLI와 다른 DB 연결을 사용하되 같은 임시 스키마의 자료를 읽는다.
      const apiDataSource = createDataSource(environment).setOptions({ schema,
        extra: { options: `-c timezone=${environment.TZ} -c search_path=${schema}` } });
      const factory = jest.spyOn(database, 'createDataSource').mockReturnValue(apiDataSource);
      let app: Awaited<ReturnType<typeof createApplication>> | undefined;
      try {
        try { app = await createApplication(); } finally { factory.mockRestore(); }
        await app.listen(0, '127.0.0.1');
        const before = await request(app.getHttpServer()).post('/api/v1/policies/search').send({}).expect(200);
        expect(before.body.items.map((item: { title: string }) => item.title).sort())
          .toEqual(['수집 밖의 기존 정책', '이전 제목']);
        const run = startCli(`search-${mode}`, mode); processes.push(run);
        await run.waitFor(mode === 'API_PAUSE' ? 'API_PAUSED' : 'SAVE_PAUSED');
        // 외부 API 대기 중과 첫 묶음 저장 후 COMMIT 전 모두 부분 결과가 노출되지 않아야 한다.
        const during = await request(app.getHttpServer()).post('/api/v1/policies/search').send({}).expect(200);
        expect(during.body).toEqual(before.body);
        run.child.send('RESUME');
        expect(await run.finished).toMatchObject({ code: 0, signal: null });
        const after = await request(app.getHttpServer()).post('/api/v1/policies/search').send({}).expect(200);
        expect(after.body.items.map((item: { title: string }) => item.title).sort())
          .toEqual(['CLI가 변경한 제목', 'CLI가 추가한 정책', '수집 밖의 기존 정책']);
        expect((await records(run)).at(-1)).toMatchObject({ status: 'SUCCESS', saved: true });
      } finally {
        if (app) await app.close();
        else if (apiDataSource.isInitialized) await apiDataSource.destroy();
      }
    }, 30000,
  );
});
