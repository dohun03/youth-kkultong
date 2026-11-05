const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawn, spawnSync } = require('node:child_process');
const { createHash, randomBytes, scryptSync } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { Client } = require('pg');

const root = path.resolve(__dirname, '../../..');
const image = 'postgres:17.11-bookworm';
const sourceDb = process.env.REHEARSAL_SOURCE_DB ?? 'youth-kkultong-db-1';
const sourceApi = process.env.REHEARSAL_SOURCE_API ?? 'youth-kkultong-api-1';
const backup = path.resolve(root, process.env.REHEARSAL_BACKUP ?? 'backups/mvp2-step4-20261028225754');
const capture = process.env.REHEARSAL_CAPTURE ? path.resolve(root, process.env.REHEARSAL_CAPTURE) : undefined;
const tables = [['policies', 'id'], ['source_policies', 'id'], ['policy_reviews', 'id'],
  ['regions', 'code'], ['migrations', 'id']];

/** 비밀값이 담길 수 있는 명령의 오류 원문 대신 작업 이름과 종료 상태만 확인 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, timeout: 60000,
    maxBuffer: 64 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${command} ${args[0]} 실패 (종료 ${result.status})`);
  return result.stdout;
}

/** 백업과 수집 로그의 파일 무결성을 계산 */
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

/** 기존 DB에 읽기 전용 쿼리만 보내 전체 행과 기존 로그의 보존 기준 수집 */
function originalSnapshot() {
  const selects = tables.map(([table, key]) => `SELECT '${table}' AS name,count(*)::int AS count,
    md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY "${key}"),'')) AS checksum FROM "${table}" t`);
  const rows = run('docker', ['exec', sourceDb, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', 'youth_kkultong', '-d', 'youth_kkultong', '-Atc',
    `BEGIN READ ONLY; SELECT json_agg(t) FROM (${selects.join(' UNION ALL ')}) t; COMMIT;`]);
  const logs = run('docker', ['exec', sourceApi, 'sh', '-c',
    'cd /app/logs && find . -type f -exec sha256sum {} \\;']).toString().trim().split('\n').sort();
  return { rows: JSON.parse(rows.toString()), logs };
}

/** 비교 순서를 고정한 전체 행 체크섬으로 UUID와 본문 및 지역 보존 확인 */
async function snapshot(client, selected = tables) {
  const result = {};
  for (const [table, key] of selected) {
    result[table] = (await client.query(`SELECT count(*)::int AS count,
      md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY "${key}"),'')) AS checksum FROM "${table}" t`)).rows[0];
  }
  return result;
}

/** pg의 날짜 변환으로 정밀도를 잃지 않도록 전체 행을 JSON으로 읽기 */
async function rows(client, table) {
  return (await client.query(`SELECT to_jsonb(t) AS value FROM "${table}" t ORDER BY id`)).rows.map((row) => row.value);
}

/** 최신 빌드의 실제 CLI를 실행하고 인증값을 가린 출력을 증거 폴더에 보관 */
async function cli(args, environment, output, secrets) {
  const child = spawn(process.execPath, args, { cwd: root, env: environment,
    timeout: 900000, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
    text += String(chunk);
  });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  for (const secret of secrets.filter(Boolean)) text = text.replaceAll(secret, '[REDACTED]');
  fs.writeFileSync(output, text);
  assert.equal(code, 0, `CLI 실패. 확인할 파일: ${path.basename(output)}`);
}

test(`이관 전 백업 복원 → 최신 Migration → ${capture ? '실제 수집 보관본 재입력' : '실제 온통청년 CLI'} → 관리자 검수`, { timeout: 1200000 }, async () => {
  process.umask(0o077);
  run('sha256sum', ['-c', 'SHA256SUMS'], { cwd: backup });
  const artifact = path.resolve(root, `backups/mvp2-step40-${Date.now()}-${randomBytes(4).toString('hex')}`);
  fs.mkdirSync(artifact, { mode: 0o700 });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mvp2-step40-'));
  const project = path.join(temporary, 'project');
  const dist = path.join(project, 'apps/api/dist');
  const container = `mvp2-step40-${randomBytes(6).toString('hex')}`;
  const password = randomBytes(24).toString('hex');
  const beforeOriginal = originalSnapshot();
  fs.writeFileSync(path.join(artifact, 'original-before.json'), JSON.stringify(beforeOriginal, null, 2));
  const report = { status: 'RUNNING', mode: capture ? 'CAPTURE_REPLAY' : 'LIVE_NETWORK', backup: path.relative(root, backup),
    dumpSha256: sha(fs.readFileSync(path.join(backup, 'production.dump'))), startedAt: new Date().toISOString() };
  let created = false;
  let client;
  let orm;
  let app;
  let successful = false;
  try {
    // 기존 컨테이너 설정은 메모리에서만 읽고 실제 온통청년 키 하나만 검증 환경에 전달
    const originalApi = JSON.parse(run('docker', ['inspect', sourceApi]).toString())[0];
    const settings = Object.fromEntries(originalApi.Config.Env.map((entry) => {
      const index = entry.indexOf('='); return [entry.slice(0, index), entry.slice(index + 1)];
    }));
    assert.equal(settings.POLICY_SCHEDULE_ENABLED, 'false', '원래 환경의 자동 수집 비활성 확인 필요');
    assert.ok(settings.YOUTH_CENTER_API_KEY, '실제 온통청년 API 키 필요');
    run('docker', ['run', '--detach', '--name', container, '--env', 'POSTGRES_PASSWORD',
      '--env', 'POSTGRES_USER=youth_kkultong', '--env', 'POSTGRES_DB=youth_rehearsal',
      '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data', image],
    { env: { ...process.env, POSTGRES_PASSWORD: password } });
    created = true;
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const check = spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1',
        '-U', 'youth_kkultong', '-d', 'youth_rehearsal'], { timeout: 5000 });
      if (check.status === 0) { ready = true; break; }
      await delay(500);
    }
    assert.ok(ready, '별도 PostgreSQL 준비 실패');
    const port = run('docker', ['port', container, '5432']).toString().trim().split(':')[1];
    const url = `postgresql://youth_kkultong:${password}@127.0.0.1:${port}/youth_rehearsal`;
    client = new Client({ connectionString: url, options: '-c timezone=Asia/Seoul' });
    await client.connect();
    assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);
    run('docker', ['exec', '-i', container, 'pg_restore', '-U', 'youth_kkultong', '-d', 'youth_rehearsal',
      '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl'],
    { input: fs.readFileSync(path.join(backup, 'production.dump')) });
    // 옛 코드를 시작하지 않은 복원 환경에서 쓰기 연결이 없는지 확인한 뒤 수집 잠금 유지
    assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()")).rows[0].n, 0);
    assert.equal((await client.query('SELECT pg_try_advisory_lock(202610180001) AS acquired')).rows[0].acquired, true);
    assert.deepEqual((await client.query("SELECT to_regclass('source_policies') AS source,to_regclass('policy_reviews') AS review")).rows[0], { source: null, review: null });
    const legacy = await snapshot(client, [tables[0], tables[3], tables[4]]);
    const baseline = JSON.parse(fs.readFileSync(path.join(backup, 'baseline.json'), 'utf8'));
    assert.equal(legacy.policies.count, baseline.policies.count);
    assert.equal(legacy.regions.count, baseline.regions.count);
    assert.equal(legacy.migrations.count, 2);

    // 빌드와 로그를 임시 프로젝트에 복사해 원래 서비스의 파일과 완전히 분리
    fs.mkdirSync(path.dirname(dist), { recursive: true });
    fs.cpSync(path.join(root, 'apps/api/dist'), dist, { recursive: true });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(project, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(project, 'logs'));
    run('tar', ['-xf', path.join(backup, 'ingestion-logs.tar'), '-C', path.join(project, 'logs')]);
    report.restoredLogsSha256 = sha(fs.readFileSync(path.join(project, 'logs/policies-import.jsonl')));
    const environment = { ...process.env, DATABASE_URL: url, TZ: 'Asia/Seoul', POLICY_SCHEDULE_ENABLED: 'false',
      YOUTH_CENTER_API_KEY: settings.YOUTH_CENTER_API_KEY, YOUTH_CENTER_PAGE_SIZE: '50',
      YOUTH_CENTER_REQUEST_DELAY_MS: '3000', YOUTH_CENTER_MAX_ATTEMPTS: '3', POLICY_IMPORT_BATCH_SIZE: '200' };
    const secrets = [url, password, settings.YOUTH_CENTER_API_KEY];
    await cli([require.resolve('typeorm/cli.js'), 'migration:run', '-d', path.join(dist, 'database/migration-data-source.js')],
      environment, path.join(artifact, 'migration.log'), secrets);
    const migrated = await snapshot(client);
    assert.deepEqual(migrated.policies, legacy.policies, '이관 중 공개 UUID 또는 전체 행 변경');
    assert.deepEqual(migrated.regions, legacy.regions);
    assert.equal(migrated.source_policies.count, legacy.policies.count);
    assert.equal(migrated.policy_reviews.count, 0);
    assert.equal(migrated.migrations.count, 3);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM policies p FULL JOIN source_policies s
      USING(source,external_id) WHERE p.id IS NULL OR s.id IS NULL OR p.id=s.id OR p.title<>s.title
      OR p.raw_json<>s.raw_json OR p.content_hash<>s.content_hash OR p.view_count IS DISTINCT FROM s.view_count
      OR s.first_collected_at IS NOT NULL OR s.last_collected_at IS NOT NULL
      OR s.last_collection_result IS NOT NULL OR s.missing_count<>0`)).rows[0].n, 0);
    assert.equal((await client.query('SELECT pg_advisory_unlock(202610180001) AS released')).rows[0].released, true);
    report.migration = { legacy, migrated, previousWriters: 0, publicRowsAndUuidsPreserved: true };
    console.log('백업 복원 및 이관 통과: 공개 전체 행과 UUID, 지역 보존');

    Object.assign(process.env, environment);
    const load = (name) => require(path.join(dist, name));
    const { Logger } = require('@nestjs/common');
    Logger.overrideLogger(false);
    const { loadEnvironment } = load('common/environment.js');
    orm = load('database/data-source.js').createDataSource(loadEnvironment());
    await orm.initialize();
    assert.equal(await orm.showMigrations(), false);
    assert.deepEqual((await orm.driver.createSchemaBuilder().log()).upQueries, []);
    assert.deepEqual(await orm.runMigrations(), [], '적용된 Migration 재실행');
    const adminPassword = randomBytes(24).toString('base64url');
    const salt = randomBytes(16);
    const origin = 'http://localhost:3000';
    app = await load('main.js').createApplication({ ADMIN_USERNAME: 'rehearsal-reviewer',
      ADMIN_PASSWORD_HASH: `scrypt$16384$8$1$${salt.toString('base64')}$${scryptSync(adminPassword, salt, 64).toString('base64')}`,
      ADMIN_AUTH_SECRET: randomBytes(32).toString('base64'), ADMIN_WEB_ORIGIN: origin, POLICY_SCHEDULE_ENABLED: 'false' });
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    let cookie;
    /** 실제 HTTP API에서 상태를 검사하고 JSON 응답 반환 */
    const request = async (route, body, status = 200) => {
      const response = await fetch(`${base}${route}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      assert.equal(response.status, status, `${route} HTTP 상태 불일치`);
      if (route === '/admin/auth/login') cookie = response.headers.get('set-cookie').split(';')[0];
      return response.json();
    };
    await request('/health');
    await request('/admin/auth/me', undefined, 401);
    await request('/admin/auth/login', { username: 'rehearsal-reviewer', password: adminPassword });
    const { IngestionLockService } = load('modules/ingestion/services/ingestion-lock.service.js');
    const { PolicyCollectionWriteService } = load('modules/policies/services/collection/policy-collection-write.service.js');
    const { transformYouthCenterPolicy: transform } = load('modules/ingestion/youth-center/youth-center-policy.transform.js');
    const { createYouthCenterPolicyContentHash: hash } = load('modules/ingestion/youth-center/youth-center-policy.hash.js');
    /** 보관된 원문을 같은 수집 저장 서비스로 재입력해 동일 판정과 후보 유지 검증 */
    const replay = async (raws) => app.get(IngestionLockService).runWithLock((runner) =>
      app.get(PolicyCollectionWriteService).saveCollection(runner, 'youthcenter',
        raws.map((raw) => ({ ...transform(raw), contentHash: hash(raw) })), new Date()));
    const initialPublic = await rows(client, 'policies');
    const identical = await replay(initialPublic.map((row) => row.raw_json));
    assert.equal(identical.status, 'COMPLETED');
    assert.deepEqual(identical.value.counts, { NEW: 0, CHANGED: 0, UNCHANGED: initialPublic.length, MISSING: 0 });
    assert.equal(identical.value.reviewCreatedCount, 0);
    assert.equal((await snapshot(client)).policy_reviews.count, 0);
    report.identicalBackupReplay = identical.value;
    const priorSources = new Map((await rows(client, 'source_policies')).map((row) => [row.external_id, row]));
    for (const row of priorSources.values()) {
      assert.equal(row.last_collection_result, 'UNCHANGED');
      assert.ok(row.first_collected_at && row.last_collected_at);
      assert.equal(row.first_collected_at, row.last_collected_at);
    }
    report.migration.schemaDifferences = 0;
    report.migration.reappliedMigrations = 0;
    const publicBefore = await rows(client, 'policies');
    const beforeCollection = await snapshot(client);
    const started = Date.now();
    let log;
    let networkElapsedMs;
    let captureSource;
    if (capture) {
      // 전체 수집 성공이 이미 입증된 보관본만 사용하고 원래 실패 상태와 실행 ID도 그대로 보존
      run('sha256sum', ['-c', 'SHA256SUMS'], { cwd: capture });
      const evidence = JSON.parse(fs.readFileSync(path.join(capture, 'verification.json'), 'utf8'));
      assert.equal(evidence.dumpSha256, report.dumpSha256, '수집 보관본과 이관 백업 불일치');
      assert.notEqual(evidence.actualCollection?.networkExecutedThisRun, false, '최초 외부 호출의 증거 폴더 필요');
      assert.equal(evidence.actualCollection?.result?.status, 'SUCCESS');
      assert.equal(evidence.actualCollection.result.saved, true);
      assert.equal(evidence.actualCollection.result.commitOutcome, 'COMMITTED');
      assert.equal(evidence.originalUnchanged, true);
      assert.equal(evidence.cleanupSucceeded, true);
      const rawFile = path.join(capture, 'collected-raw.json');
      const raw = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
      assert.equal(raw.length, evidence.actualCollection.total);
      const saved = await replay(raw);
      assert.equal(saved.status, 'COMPLETED');
      assert.deepEqual(saved.value.counts, evidence.actualCollection.counts);
      log = fs.readFileSync(path.join(capture, 'policies-import.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      assert.deepEqual(log.at(-1), evidence.actualCollection.result);
      networkElapsedMs = evidence.actualCollection.elapsedMs;
      captureSource = { artifact: path.relative(root, capture), status: evidence.status,
        networkRunId: evidence.actualCollection.result.runId, rawSha256: sha(fs.readFileSync(rawFile)) };
      report.captureReplay = { source: captureSource, result: saved.value, elapsedMs: Date.now() - started };
      fs.copyFileSync(rawFile, path.join(artifact, 'collected-raw.json'));
      fs.copyFileSync(path.join(capture, 'policies-import.jsonl'), path.join(artifact, 'captured-network.jsonl'));
      console.log('보관된 실제 수집 원문 재입력 완료: 새 외부 호출 없음, 최초 성공 로그와 별도 대조');
    } else {
      console.log('실제 온통청년 수집 시작: 50건씩 순차 조회, 요청 간 3초');
      const progress = setInterval(() => {
        const file = path.join(project, 'logs/policies-import.jsonl');
        const latest = fs.readFileSync(file, 'utf8').trim().split('\n').at(-1);
        const record = JSON.parse(latest);
        console.log(`실제 수집 진행: ${record.event}, 페이지 ${record.pageNum ?? '-'}, ${Math.round((Date.now() - started) / 1000)}초`);
      }, 30000);
      try {
        await cli([path.join(dist, 'cli/import-policies.js')], environment, path.join(artifact, 'collection-cli.log'), secrets);
      } catch (error) {
        // 실제 응답 오류가 발생해도 확정 전 실패라면 원본과 후보 및 공개 행 전체가 같아야 함
        const records = fs.readFileSync(path.join(project, 'logs/policies-import.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
        const last = records.at(-1);
        report.failedCollection = { result: last };
        if (last.event === 'RUN_FINISHED' && last.commitOutcome === 'NOT_COMMITTED') {
          assert.deepEqual(await snapshot(client), beforeCollection, '수집 확정 전 실패에서 DB 변경');
          report.failedCollection.databaseUnchanged = true;
        }
        throw error;
      } finally { clearInterval(progress); }
      log = fs.readFileSync(path.join(project, 'logs/policies-import.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      networkElapsedMs = Date.now() - started;
    }
    const finished = log.at(-1);
    assert.equal(finished.event, 'RUN_FINISHED');
    assert.equal(finished.status, 'SUCCESS');
    assert.equal(finished.saved, true);
    assert.equal(finished.commitOutcome, 'COMMITTED');
    const observed = await rows(client, 'source_policies');
    const reviews = await rows(client, 'policy_reviews');
    const publicAfter = await rows(client, 'policies');
    const byExternal = new Map(publicBefore.map((row) => [row.external_id, row]));
    const reviewBySource = new Map(reviews.map((row) => [row.source_policy_id, row]));
    const counts = { NEW: 0, CHANGED: 0, UNCHANGED: 0, MISSING: 0 };
    for (const row of observed) {
      const previous = priorSources.get(row.external_id);
      const kind = row.missing_count > 0 ? 'MISSING' : !previous ? 'NEW'
        : previous.content_hash === row.content_hash ? 'UNCHANGED' : 'CHANGED';
      counts[kind]++;
      assert.equal(row.last_collection_result, kind);
      assert.equal(hash(row.raw_json), row.content_hash);
      if (previous) assert.equal(row.id, previous.id);
      if (kind === 'MISSING') {
        assert.equal(row.missing_count, 1);
        assert.equal(row.last_collected_at, previous.last_collected_at);
        assert.deepEqual(row.raw_json, previous.raw_json);
        continue;
      }
      assert.equal(row.missing_count, 0);
      assert.ok(row.first_collected_at && row.last_collected_at);
      if (previous) assert.equal(row.first_collected_at, previous.first_collected_at);
      const review = reviewBySource.get(row.id);
      if (kind === 'UNCHANGED') assert.equal(review, undefined);
      else {
        assert.ok(review);
        assert.equal(review.kind, kind);
        assert.equal(review.status, 'PENDING');
        assert.equal(review.content_hash, row.content_hash);
        assert.deepEqual(review.raw_snapshot, row.raw_json);
        const published = byExternal.get(row.external_id);
        assert.equal(review.base_policy_id, published?.id ?? null);
        assert.equal(review.base_content_hash, published?.content_hash ?? null);
        assert.deepEqual(review.base_raw_snapshot, published?.raw_json ?? null);
      }
    }
    /** 조회수와 그 갱신 시각을 제외한 공개 행 전체로 수집 전후 본문 보존 확인 */
    const bodyOnly = ({ view_count, updated_at, ...body }) => body;
    assert.deepEqual(publicAfter.map(bodyOnly), publicBefore.map(bodyOnly));
    const sourceByExternal = new Map(observed.map((row) => [row.external_id, row]));
    for (const row of publicAfter) {
      const source = sourceByExternal.get(row.external_id);
      if (source.missing_count === 0) assert.equal(row.view_count, source.view_count);
    }
    assert.deepEqual(finished.counts, { NEW: counts.NEW, CHANGED: counts.CHANGED, UNCHANGED: counts.UNCHANGED });
    assert.equal(finished.missingCount, counts.MISSING);
    assert.equal(finished.reviewCreatedCount, counts.NEW + counts.CHANGED);
    assert.equal(reviews.length, counts.NEW + counts.CHANGED);
    const attempts = log.filter((row) => row.runId === finished.runId && row.event === 'PAGE_ATTEMPT');
    const total = counts.NEW + counts.CHANGED + counts.UNCHANGED;
    assert.equal(new Set(attempts.map((row) => row.pageNum)).size, Math.max(1, Math.ceil(total / 50)));
    report.actualCollection = { counts, total, pageCount: new Set(attempts.map((row) => row.pageNum)).size,
      attempts: attempts.length, elapsedMs: networkElapsedMs, result: finished,
      networkExecutedThisRun: !capture, ...(captureSource ? { captureSource } : {}),
      request: { pageType: '1', rtnType: 'json', pageSize: 50, requestDelayMs: 3000, maxAttempts: 3 },
      publicBodyAndUuidsPreserved: true };
    console.log(`${capture ? '보관 수집분 대조' : '실제 수집 완료'}: ${JSON.stringify(counts)}`);

    // 실제 응답이 어느 분류도 제공하지 않으면 조작한 결과로 대신 통과시키지 않음
    for (const kind of ['NEW', 'CHANGED', 'UNCHANGED']) assert.ok(counts[kind] > 0, `실제 수집에서 ${kind} 사례 없음`);
    fs.writeFileSync(path.join(artifact, 'collected-raw.json'), JSON.stringify(observed.filter((row) => row.missing_count === 0).map((row) => row.raw_json)));
    const repeated = await replay(observed.filter((row) => row.missing_count === 0).map((row) => row.raw_json));
    assert.equal(repeated.status, 'COMPLETED');
    assert.deepEqual(repeated.value.counts, { NEW: 0, CHANGED: 0, UNCHANGED: total, MISSING: counts.MISSING });
    assert.equal(repeated.value.reviewCreatedCount, 0);
    assert.equal(repeated.value.reviewSupersededCount, 0);
    assert.deepEqual(await rows(client, 'policy_reviews'), reviews);
    report.identicalActualReplay = repeated.value;
    const listed = await request('/admin/reviews?status=PENDING&limit=1');
    assert.equal(listed.pagination.total, reviews.length);
    const missing = await request('/admin/source-policies/missing?minMissingCount=1&limit=1');
    assert.equal(missing.pagination.total, counts.MISSING);
    report.adminActions = [];
    for (const kind of ['NEW', 'CHANGED']) {
      const candidates = reviews.filter((row) => row.kind === kind);
      assert.ok(candidates.length >= 2, `승인과 거절을 위한 실제 ${kind} 후보 두 건 필요`);
      for (const [index, action] of ['approve', 'reject'].entries()) {
        const candidate = candidates[index];
        const source = observed.find((row) => row.id === candidate.source_policy_id);
        const publicId = candidate.base_policy_id;
        const before = (await rows(client, 'policies')).find((row) => row.external_id === source.external_id) ?? null;
        const detail = await request(`/admin/reviews/${candidate.id}`);
        assert.equal(detail.canReview, true);
        assert.deepEqual(detail.target.raw, candidate.raw_snapshot);
        assert.deepEqual(detail.base?.raw ?? null, candidate.base_raw_snapshot);
        if (kind === 'NEW') assert.equal(detail.currentPublished, null);
        else assert.equal(detail.currentPublished.id, publicId);
        const result = await request(`/admin/reviews/${candidate.id}/${action}`, {
          contentHash: detail.target.contentHash, baseContentHash: detail.base?.contentHash ?? null,
          ...(action === 'reject' ? { reason: '운영 재현: 실제 원문 검수 후 공개 보류' } : {}),
        });
        assert.equal(result.status, action === 'approve' ? 'APPROVED' : 'REJECTED');
        const after = (await rows(client, 'policies')).find((row) => row.external_id === source.external_id) ?? null;
        if (action === 'approve') {
          assert.equal(after.id, result.policyId);
          if (publicId) { assert.equal(after.id, publicId); assert.equal(after.created_at, before.created_at); }
          assert.equal(after.content_hash, source.content_hash);
          assert.equal(after.view_count, source.view_count);
          assert.deepEqual(after.raw_json, candidate.raw_snapshot);
          const publicDetail = await request(`/policies/${after.id}`);
          assert.equal(publicDetail.id, after.id);
          assert.equal(publicDetail.title, after.title);
          assert.equal(publicDetail.description, after.description);
          assert.equal(publicDetail.benefitText, after.benefit_text);
        } else {
          assert.deepEqual(after, before);
          assert.equal(result.policyId, publicId);
        }
        const history = await request(`/admin/reviews/${candidate.id}`);
        assert.equal(history.review.status, result.status);
        assert.equal(history.review.reviewedBy, 'rehearsal-reviewer');
        assert.equal(history.canReview, false);
        if (action === 'reject') assert.equal(history.review.rejectionReason, '운영 재현: 실제 원문 검수 후 공개 보류');
        report.adminActions.push({ kind, action, externalId: source.external_id, reviewId: candidate.id,
          priorPolicyId: publicId, policyId: result.policyId, status: result.status });
      }
    }
    assert.equal((await request('/admin/reviews?status=PROCESSED&limit=1')).pagination.total, 4);
    const finalPublic = new Map((await rows(client, 'policies')).map((row) => [row.external_id, row]));
    for (const row of initialPublic) assert.equal(finalPublic.get(row.external_id).id, row.id);
    report.final = await snapshot(client);
    successful = true;
  } finally {
    // 실패한 실행도 실제 수집 로그를 남기고 이번에 만든 연결과 컨테이너만 정리
    const errors = [];
    try {
      const logfile = path.join(project, 'logs/policies-import.jsonl');
      if (fs.existsSync(logfile)) fs.copyFileSync(logfile, path.join(artifact, 'policies-import.jsonl'));
    } catch (error) { errors.push(error); }
    for (const cleanup of [() => app?.close(), () => orm?.isInitialized ? orm.destroy() : undefined, () => client?.end()]) {
      try { await cleanup(); } catch (error) { errors.push(error); }
    }
    try { if (created) run('docker', ['rm', '--force', container]); } catch (error) { errors.push(error); }
    try { fs.rmSync(temporary, { recursive: true, force: true }); } catch (error) { errors.push(error); }
    try {
      const afterOriginal = originalSnapshot();
      fs.writeFileSync(path.join(artifact, 'original-after.json'), JSON.stringify(afterOriginal, null, 2));
      assert.deepEqual(afterOriginal, beforeOriginal, '기존 DB 또는 수집 로그 변경');
      report.originalUnchanged = true;
    } catch (error) { errors.push(error); }
    report.status = successful && errors.length === 0 ? 'PASS' : 'FAIL';
    report.cleanupSucceeded = errors.length === 0;
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(artifact, 'verification.json'), JSON.stringify(report, null, 2));
    const files = fs.readdirSync(artifact).filter((file) => file !== 'SHA256SUMS').sort();
    fs.writeFileSync(path.join(artifact, 'SHA256SUMS'), files.map((file) => `${sha(fs.readFileSync(path.join(artifact, file)))}  ${file}\n`).join(''));
    console.log(`운영 재현 ${report.status}. 결과: ${path.relative(root, artifact)}`);
    assert.equal(errors.length, 0, '원래 데이터 보존 확인 또는 검증 자원 정리 실패');
  }
});
