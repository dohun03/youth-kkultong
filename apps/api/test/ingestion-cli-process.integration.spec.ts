import { testAdminValues } from './helpers/admin';
import { clearPolicyTables, seedMigratedPolicies } from './helpers/policy-collection';
import { SourcePolicy } from '../src/modules/policies/entities/source-policy.entity';
import { PolicyReview } from '../src/modules/policies/entities/policy-review.entity';
import { CreatePolicyReviewTables1793199600000 } from '../src/database/migrations/1793199600000-create-policy-review-tables';
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
    const child = spawn(process.execPath, ['--require', join(__dirname, 'fixtures/ingestion-cli.preload.cjs'), join(__dirname, '../src/cli/import-policies.ts')], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, NODE_OPTIONS: '', DATABASE_URL: environment.DATABASE_URL,
        ADMIN_USERNAME: '', ADMIN_PASSWORD_HASH: '', ADMIN_AUTH_SECRET: '', ADMIN_WEB_ORIGIN: '',
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

  /** 공개 데이터뿐 아니라 원본과 검수의 부분 확정도 비교할 수 있도록 전체 행 조회 */
  async function state() {
    return {
      sources: await dataSource.getRepository(SourcePolicy).find({ order: { externalId: 'ASC' } }),
      reviews: await dataSource.getRepository(PolicyReview).find({ order: { id: 'ASC' } }),
      policies: await dataSource.getRepository(Policy).find({ order: { externalId: 'ASC' } }),
    };
  }

  /** 정상 CLI 수집 뒤 원본과 후보, 누락, 공개 조회수의 확정 결과 확인 */
  async function expectCollected(before: Awaited<ReturnType<typeof state>>, missingCount = 1) {
    const after = await state();
    expect(after.sources).toHaveLength(3);
    expect(after.reviews).toHaveLength(2);
    expect(after.policies).toEqual(before.policies.map((policy) => policy.externalId === 'policy-0'
      ? { ...policy, viewCount: 20, updatedAt: expect.any(Date) } : policy));
    expect(after.sources.find(({ externalId }) => externalId === 'outside')).toEqual({
      ...before.sources.find(({ externalId }) => externalId === 'outside'),
      missingCount, lastCollectionResult: 'MISSING', updatedAt: expect.any(Date),
    });
    for (const [externalId, kind, title] of [
      ['policy-0', 'CHANGED', 'CLI가 변경한 제목'], ['policy-1', 'NEW', 'CLI가 추가한 정책'],
    ]) {
      const source = after.sources.find((policy) => policy.externalId === externalId)!;
      expect(source).toMatchObject({ title, missingCount: 0, firstCollectedAt: expect.any(Date), lastCollectedAt: expect.any(Date) });
      expect(after.reviews.find(({ sourcePolicyId }) => sourcePolicyId === source.id))
        .toMatchObject({ status: 'PENDING', kind, contentHash: source.contentHash, rawSnapshot: source.rawJson });
    }
    return after;
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
    dataSource = createDataSource(environment).setOptions({ schema, entities: [Policy, SourcePolicy, PolicyReview],
      migrations: [CreatePolicies1792162800000, CreateRegions1792162801000, CreatePolicyReviewTables1793199600000],
      extra: { options: `-c timezone=${environment.TZ} -c search_path=${schema}` } });
    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ingestion-cli-'));
    processes.length = 0;
    await clearPolicyTables(dataSource);
    await seedMigratedPolicies(dataSource, [
      { plcyNo: 'policy-0', plcyNm: '이전 제목' },
      { plcyNo: 'outside', plcyNm: '수집 밖의 기존 정책' },
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

  it.each(['API_PAUSE', 'SAVE_PAUSE', 'REVIEW_PAUSE', 'COMMIT_PAUSE'])(
    'T2-23: %s 중인 CLI만 API를 호출하고 다른 CLI는 종료 코드 2로 종료한다', async (mode) => {
    const before = await state();
    const first = startCli('first', mode); processes.push(first);
    await first.waitFor(mode.replace('_PAUSE', '_PAUSED'));
    const second = startCli('second'); processes.push(second);
    const skipped = await second.finished;
    expect(skipped).toMatchObject({ code: 2, signal: null });
    expect(skipped.stdout).toContain('이미 실행 중');
    expect(second.events).not.toContain('API_REQUEST');
    expect((await records(second)).at(-1)).toMatchObject({ status: 'ALREADY_RUNNING', saved: false,
      commitOutcome: 'NOT_COMMITTED', saveAttempts: 0, counts: { NEW: 0, CHANGED: 0, UNCHANGED: 0 },
      missingCount: 0, reviewCreatedCount: 0, reviewSupersededCount: 0, publicViewUpdatedCount: 0 });
    first.child.send('RESUME');
    const completed = await first.finished;
    expect(completed).toMatchObject({ code: 0, signal: null });
    expect((await records(first)).at(-1)).toMatchObject({ status: 'SUCCESS', saved: true, commitOutcome: 'COMMITTED',
      counts: { NEW: 1, CHANGED: 1, UNCHANGED: 0 }, missingCount: 1,
      reviewCreatedCount: 2, reviewSupersededCount: 0, publicViewUpdatedCount: 1 });
    await expectCollected(before);
    expect(first.events.filter((event) => event === 'API_REQUEST')).toHaveLength(1);
    await expectUnlocked();
  }, 30000);

  it.each(['API_PAUSE', 'SAVE_PAUSE', 'REVIEW_PAUSE'])(
    'T2-23: %s 중인 CLI를 강제 종료하면 세 테이블 모두 보존되고 다음 CLI가 성공한다', async (mode) => {
    const before = await state();
    const interrupted = startCli('interrupted', mode); processes.push(interrupted);
    await interrupted.waitFor(mode.replace('_PAUSE', '_PAUSED'));
    expect(await state()).toEqual(before);
    interrupted.child.kill('SIGKILL');
    expect(await interrupted.finished).toMatchObject({ code: null, signal: 'SIGKILL' });
    await expectUnlocked();
    expect(await state()).toEqual(before);
    expect((await records(interrupted)).some((entry) => entry.event === 'RUN_FINISHED')).toBe(false);
    const next = startCli('next'); processes.push(next);
    expect(await next.finished).toMatchObject({ code: 0, signal: null });
    expect((await records(next)).at(-1)).toMatchObject({ status: 'SUCCESS', saved: true, counts: { NEW: 1, CHANGED: 1, UNCHANGED: 0 } });
    await expectCollected(before);
    await expectUnlocked();
  }, 30000);

  it('T2-23: COMMIT 직후 강제 종료해도 확정 데이터를 보존하고 다음 CLI는 후보를 중복 생성하지 않는다', async () => {
    const before = await state();
    const interrupted = startCli('committed', 'COMMIT_PAUSE'); processes.push(interrupted);
    await interrupted.waitFor('COMMIT_PAUSED');
    const committed = await expectCollected(before);
    interrupted.child.kill('SIGKILL');
    expect(await interrupted.finished).toMatchObject({ code: null, signal: 'SIGKILL' });
    await expectUnlocked();
    expect(await state()).toEqual(committed);
    expect((await records(interrupted)).some((entry) => entry.event === 'RUN_FINISHED')).toBe(false);
    const next = startCli('after-commit'); processes.push(next);
    expect(await next.finished).toMatchObject({ code: 0, signal: null });
    expect((await records(next)).at(-1)).toMatchObject({ status: 'SUCCESS', saved: true,
      counts: { NEW: 0, CHANGED: 0, UNCHANGED: 2 }, missingCount: 1, reviewCreatedCount: 0, reviewSupersededCount: 0 });
    const after = await expectCollected(before, 2);
    expect(after.reviews).toEqual(committed.reviews);
    await expectUnlocked();
  }, 30000);

  it('T2-23: 외부 API 오류로 종료 코드 1을 반환한 뒤에도 다음 CLI가 정상 수집한다', async () => {
    const before = await state();
    const failed = startCli('api-failed', 'API_FAIL'); processes.push(failed);
    expect(await failed.finished).toMatchObject({ code: 1, signal: null });
    expect((await records(failed)).at(-1)).toMatchObject({ status: 'FAILED', saved: false,
      commitOutcome: 'NOT_COMMITTED', saveAttempts: 0, counts: { NEW: 0, CHANGED: 0, UNCHANGED: 0 } });
    expect(await state()).toEqual(before);
    await expectUnlocked();
    const next = startCli('after-failure'); processes.push(next);
    expect(await next.finished).toMatchObject({ code: 0, signal: null });
    await expectCollected(before);
    await expectUnlocked();
  }, 30000);

  it.each(['API_PAUSE', 'SAVE_PAUSE', 'REVIEW_PAUSE'])(
    'T2-45: 독립 CLI의 %s 중에도 실제 검색과 상세 API가 기존 정책을 제공한다', async (mode) => {
      // 읽기 API는 CLI와 다른 DB 연결을 사용하되 같은 임시 스키마의 자료를 읽는다.
      const apiDataSource = createDataSource(environment).setOptions({ schema,
        extra: { options: `-c timezone=${environment.TZ} -c search_path=${schema}` } });
      const factory = jest.spyOn(database, 'createDataSource').mockReturnValue(apiDataSource);
      let app: Awaited<ReturnType<typeof createApplication>> | undefined;
      try {
        try { app = await createApplication(testAdminValues); } finally { factory.mockRestore(); }
        await app.listen(0, '127.0.0.1');
        const beforeState = await state();
        const before = await request(app.getHttpServer()).post('/api/v1/policies/search').send({}).expect(200);
        expect(before.body.items.map((item: { title: string }) => item.title).sort())
          .toEqual(['수집 밖의 기존 정책', '이전 제목']);
        const details = await Promise.all(beforeState.policies.map(async ({ id }) => ({
          id, body: (await request(app!.getHttpServer()).get(`/api/v1/policies/${id}`).expect(200)).body,
        })));
        const run = startCli(`search-${mode}`, mode); processes.push(run);
        await run.waitFor(mode.replace('_PAUSE', '_PAUSED'));
        // CLI가 원본과 후보를 잠그거나 저장해도 공개 조회는 대기 없이 이전 확정본을 제공
        const during = await request(app.getHttpServer()).post('/api/v1/policies/search').send({})
          .timeout({ response: 2000, deadline: 5000 }).expect(200);
        expect(during.body).toEqual(before.body);
        for (const detail of details) {
          await request(app.getHttpServer()).get(`/api/v1/policies/${detail.id}`)
            .timeout({ response: 2000, deadline: 5000 }).expect(200).expect(detail.body);
        }
        expect(await state()).toEqual(beforeState);
        run.child.send('RESUME');
        expect(await run.finished).toMatchObject({ code: 0, signal: null });
        const after = await request(app.getHttpServer()).post('/api/v1/policies/search').send({}).expect(200);
        expect(after.body.items.map((item: { title: string }) => item.title).sort())
          .toEqual(['수집 밖의 기존 정책', '이전 제목']);
        const collected = await expectCollected(beforeState);
        for (const detail of details) {
          const policy = collected.policies.find(({ id }) => id === detail.id)!;
          // 수집 완료 후에도 공개 본문과 UUID는 유지하고 조회수만 최신 값을 반환
          await request(app.getHttpServer()).get(`/api/v1/policies/${detail.id}`).expect(200)
            .expect({ ...detail.body, viewCount: policy.viewCount });
        }
        const unpublished = collected.sources.find(({ externalId }) => externalId === 'policy-1')!;
        await request(app.getHttpServer()).get(`/api/v1/policies/${unpublished.id}`).expect(404);
        const pendingSearch = await request(app.getHttpServer()).post('/api/v1/policies/search')
          .send({ keyword: 'CLI가' }).expect(200);
        expect(pendingSearch.body.items).toEqual([]);
        expect(await state()).toEqual(collected);
        expect((await records(run)).at(-1)).toMatchObject({ status: 'SUCCESS', saved: true });
        await expectUnlocked();
      } finally {
        if (app) await app.close();
        else if (apiDataSource.isInitialized) await apiDataSource.destroy();
      }
    }, 30000,
  );
});
