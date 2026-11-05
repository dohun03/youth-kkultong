const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { randomUUID, randomBytes, scryptSync, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const { Client } = require('pg');

const root = path.resolve(__dirname, '../../..');
const image = 'postgres:17.11-bookworm';
const tables = [['policies', 'id'], ['source_policies', 'id'], ['policy_reviews', 'id'],
  ['regions', 'code'], ['migrations', 'id']];

/** 명령 실패 시 인증정보가 포함될 수 있는 원문 대신 작업 이름만 출력 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, maxBuffer: 32 * 1024 * 1024,
    timeout: 60000, ...options });
  assert.equal(result.status, 0, `${command} ${args[0]} 실행 실패 (종료 ${result.status})`);
  return result.stdout;
}

/** Docker 조회 결과를 메모리에서만 해석 */
function inspect(name) {
  return JSON.parse(run('docker', ['inspect', name]).toString())[0];
}

/** 파일 내용의 SHA-256으로 백업 및 복원 로그 보존 확인 */
function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** 정렬된 전체 행과 제약 및 인덱스, Migration 시퀀스의 비교 기준 수집 */
async function snapshot(client) {
  const rows = {};
  for (const [table, key] of tables) {
    rows[table] = (await client.query(`SELECT count(*)::int AS count,
      md5(coalesce(string_agg(to_jsonb(t)::text, '' ORDER BY "${key}"), '')) AS checksum
      FROM public."${table}" t`)).rows[0];
  }
  const statuses = (await client.query('SELECT status, count(*)::int AS count FROM policy_reviews GROUP BY status ORDER BY status')).rows;
  // 복원 과정에서 CHECK의 배열 형변환 표기가 바뀔 수 있어 이름과 적용 상태를 비교
  // 실제 CHECK와 외래키의 오류 거부는 복원 DB의 롤백 테스트로 별도 확인
  const constraints = (await client.query(`SELECT c.relname AS "table", k.conname AS name,
    k.contype AS type, k.convalidated AS validated,
    CASE WHEN k.contype='c' THEN NULL ELSE pg_get_constraintdef(k.oid) END AS definition FROM pg_constraint k
    JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' ORDER BY c.relname,k.conname`)).rows;
  const indexes = (await client.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname")).rows;
  const sequence = (await client.query('SELECT last_value::text, is_called FROM migrations_id_seq')).rows;
  return { rows, statuses, constraints, indexes, sequence };
}

/** 원문을 출력하지 않고 공개본, 원본과 두 종류의 검수 스냅샷 해시를 재계산 */
async function verifyHashes(client) {
  const { createYouthCenterPolicyContentHash: hash } = require('../dist/modules/ingestion/youth-center/youth-center-policy.hash.js');
  for (const table of ['policies', 'source_policies']) {
    for (const row of (await client.query(`SELECT id,raw_json,content_hash FROM ${table}`)).rows) {
      assert.equal(hash(row.raw_json), row.content_hash, `${table} ${row.id} 해시 불일치`);
    }
  }
  for (const row of (await client.query('SELECT id,raw_snapshot,content_hash,base_raw_snapshot,base_content_hash FROM policy_reviews')).rows) {
    assert.equal(hash(row.raw_snapshot), row.content_hash, `${row.id} 변경본 해시 불일치`);
    if (row.base_raw_snapshot !== null) assert.equal(hash(row.base_raw_snapshot), row.base_content_hash, `${row.id} 기준본 해시 불일치`);
  }
}

/** 복원된 CHECK, 외래키와 대기 유일성이 잘못된 쓰기를 거부하는지 확인하고 모두 롤백 */
async function verifyConstraints(url) {
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.query('BEGIN');
    const checks = [
      ["UPDATE source_policies SET missing_count=-1", '23514'],
      ["UPDATE source_policies SET last_collection_result='INVALID'", '23514'],
      ["UPDATE source_policies SET content_hash='invalid'", '23514'],
      ["UPDATE source_policies SET raw_json='[]'::jsonb", '23514'],
      ["UPDATE policy_reviews SET status='INVALID'", '23514'],
      ["UPDATE policy_reviews SET superseded_reason='INVALID'", '23514'],
      ["UPDATE policy_reviews SET status='APPROVED',reviewed_by=NULL", '23514'],
      ["UPDATE policy_reviews SET source_policy_id='00000000-0000-0000-0000-000000000000' WHERE id=(SELECT id FROM policy_reviews LIMIT 1)", '23503'],
    ];
    const columns = (await client.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='policy_reviews' AND column_name<>'id' ORDER BY ordinal_position`))
      .rows.map((row) => `"${row.column_name}"`).join(',');
    checks.push([`INSERT INTO policy_reviews (${columns}) SELECT ${columns} FROM policy_reviews WHERE status='PENDING' LIMIT 1`, '23505']);
    for (const [sql, code] of checks) {
      await client.query('SAVEPOINT invalid_write');
      let rejected;
      try { await client.query(sql); } catch (error) { rejected = error.code; }
      await client.query('ROLLBACK TO SAVEPOINT invalid_write');
      assert.equal(rejected, code, '복원 DB의 제약 오류 거부 실패');
    }
  } finally {
    try { await client.query('ROLLBACK'); } finally { await client.end(); }
  }
}

/** 임시 폴더에 복원된 모든 로그 파일의 상대 경로와 해시 수집 */
function logFiles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) return logFiles(path.join(directory, entry.name), relative);
    assert.ok(entry.isFile(), '로그 백업에는 일반 파일과 디렉터리만 허용합니다.');
    return [{ path: relative, sha256: sha(fs.readFileSync(path.join(directory, entry.name))) }];
  });
}

/** 자동 수집을 끈 실제 NestJS HTTP 서버에서 공개 및 관리자 조회 결과 수집 */
async function apiSnapshot(url, client) {
  const database = require('../dist/database/data-source.js');
  const { createApplication } = require('../dist/main.js');
  const { loadEnvironment } = require('../dist/common/environment.js');
  const { Logger } = require('@nestjs/common');
  Logger.overrideLogger(false);
  process.env.DATABASE_URL = url;
  const original = database.createDataSource;
  // 테스트 서버의 모든 연결을 읽기 전용으로 설정해 원본과 복원본의 업무 데이터 보존
  database.createDataSource = () => original(loadEnvironment()).setOptions({
    extra: { options: '-c timezone=Asia/Seoul -c default_transaction_read_only=on' },
  });
  const password = randomBytes(24).toString('base64url');
  const salt = randomBytes(16);
  const origin = 'http://localhost:3000';
  let app;
  try {
    app = await createApplication({ ADMIN_USERNAME: 'restore-check',
      ADMIN_PASSWORD_HASH: `scrypt$16384$8$1$${salt.toString('base64')}$${scryptSync(password, salt, 64).toString('base64')}`,
      ADMIN_AUTH_SECRET: randomBytes(32).toString('base64'), ADMIN_WEB_ORIGIN: origin,
      POLICY_SCHEDULE_ENABLED: 'false' });
  } finally { database.createDataSource = original; }
  try {
    await app.listen(0, '127.0.0.1');
    const base = `${await app.getUrl()}/api/v1`;
    /** 응답 원문 대신 경로와 상태 코드로 실패 위치 확인 */
    async function get(route, options = {}) {
      const response = await fetch(`${base}${route}`, options);
      assert.equal(response.status, 200, `${route} HTTP 조회 실패`);
      return response.json();
    }
    const login = await fetch(`${base}/admin/auth/login`, { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'restore-check', password }) });
    assert.equal(login.status, 200, '복원 검증용 관리자 로그인 실패');
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const headers = { Cookie: cookie };
    assert.equal((await fetch(`${base}/admin/reviews`)).status, 401);
    const result = {
      health: await get('/health'),
      search: await get('/policies/search', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ includeClosed: true }) }),
      regions: await get('/meta/regions'), categories: await get('/meta/categories'),
      pending: await get('/admin/reviews?status=PENDING&limit=50', { headers }),
      processed: await get('/admin/reviews?status=PROCESSED&limit=50', { headers }),
      missing: await get('/admin/source-policies/missing?limit=50', { headers }),
      reviewDetails: [], policyDetails: [],
    };
    // 검수 4상태의 대표 상세를 읽어 스냅샷, 사유, 현재 공개본, canReview까지 대조
    const reviews = (await client.query('SELECT DISTINCT ON (status) id FROM policy_reviews ORDER BY status,id')).rows;
    for (const row of reviews) result.reviewDetails.push(await get(`/admin/reviews/${row.id}`, { headers }));
    const policies = (await client.query('SELECT id FROM policies ORDER BY id LIMIT 2')).rows;
    for (const row of policies) result.policyDetails.push(await get(`/policies/${row.id}`));
    assert.equal(result.search.pagination.total, (await client.query('SELECT count(*)::int AS n FROM policies')).rows[0].n);
    assert.equal(result.pending.pagination.total, (await client.query("SELECT count(*)::int AS n FROM policy_reviews WHERE status='PENDING'")).rows[0].n);
    assert.equal(result.processed.pagination.total, (await client.query("SELECT count(*)::int AS n FROM policy_reviews WHERE status<>'PENDING'")).rows[0].n);
    assert.equal(result.missing.pagination.total, (await client.query('SELECT count(*)::int AS n FROM source_policies WHERE missing_count>0')).rows[0].n);
    return result;
  } finally { await app.close(); }
}

/** 실행 중인 DB 작업을 발견하면 DB와 로그의 시점이 달라질 수 있는 백업을 중단 */
async function assertIdle(client, sourceApi) {
  assert.equal(inspect(sourceApi).State.Running, false, 'API를 중지하고 수동 수집과 검수 처리를 마친 뒤 실행하세요.');
  const active = (await client.query(`SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE datname=current_database() AND pid<>pg_backend_pid() AND state<>'idle'`)).rows[0].n;
  assert.equal(active, 0, '다른 DB 처리가 실행 중입니다.');
}

test('T2-49: 실제 백업을 별도 빈 DB에 복원해 전체 행, 공개 및 관리자 API와 로그 보존 확인', { timeout: 180000 }, async () => {
  process.umask(0o077);
  const sourceDb = process.env.BACKUP_SOURCE_DB ?? 'youth-kkultong-db-1';
  const sourceApi = process.env.BACKUP_SOURCE_API ?? 'youth-kkultong-api-1';
  const sourceInfo = inspect(sourceApi);
  const values = Object.fromEntries(sourceInfo.Config.Env.map((value) => {
    const position = value.indexOf('=');
    return [value.slice(0, position), value.slice(position + 1)];
  }));
  assert.equal(sourceInfo.State.Running, false, '백업 전에 원본 API를 중지해야 합니다.');
  const logVolume = sourceInfo.Mounts.find((mount) => mount.Destination === '/app/logs' && mount.Type === 'volume')?.Name;
  assert.ok(logVolume, '원본 로그 볼륨이 필요합니다.');
  const sourceUrl = new URL(values.DATABASE_URL);
  const port = run('docker', ['port', sourceDb, '5432']).toString().trim();
  assert.match(port, /^127\.0\.0\.1:\d+$/, '원본 DB의 로컬 전용 공개 포트가 필요합니다.');
  sourceUrl.hostname = '127.0.0.1';
  sourceUrl.port = port.split(':')[1];
  const backup = process.env.BACKUP_DIRECTORY ?? path.join(root, 'backups', `mvp2-step37-${Date.now()}-${randomUUID().slice(0, 8)}`);
  fs.mkdirSync(backup, { mode: 0o700 });
  const temporary = fs.mkdtempSync('/tmp/mvp2-step37-');
  const restoreName = `mvp2-step37-${randomUUID().slice(0, 8)}`;
  const source = new Client({ connectionString: sourceUrl.href, options: '-c timezone=Asia/Seoul -c default_transaction_read_only=on' });
  let restored;
  let restoreCreated = false;
  let verification;
  try {
    await source.connect();
    await assertIdle(source, sourceApi);
    // 백업 동안 공통 수집 잠금을 유지해 새 수동 수집의 진입도 차단
    assert.equal((await source.query('SELECT pg_try_advisory_lock(202610180001::bigint) AS acquired')).rows[0].acquired, true,
      '실행 중인 수집이 있습니다. 완료 후 다시 실행하세요.');
    const before = await snapshot(source);
    await verifyHashes(source);
    fs.writeFileSync(path.join(backup, 'source.json'), JSON.stringify(before, null, 2));
    const dump = path.join(backup, 'production.dump');
    const output = fs.openSync(`${dump}.partial`, 'wx', 0o600);
    try {
      run('docker', ['exec', sourceDb, 'pg_dump', '-U', sourceUrl.username, '-d', sourceUrl.pathname.slice(1),
        '-Fc', '--no-owner', '--no-acl'], { stdio: ['ignore', output, 'pipe'] });
    } finally { fs.closeSync(output); }
    fs.renameSync(`${dump}.partial`, dump);
    /** 원본 로그 볼륨을 읽기 전용으로 연결해 tar 백업 */
    const readLogs = () => run('docker', ['run', '--rm', '--network', 'none',
      '--mount', `type=volume,src=${logVolume},dst=/source,readonly`, image, 'tar', '-C', '/source', '-cf', '-', '.']);
    const sourceLogs = run('docker', ['run', '--rm', '--network', 'none',
      '--mount', `type=volume,src=${logVolume},dst=/source,readonly`, image,
      'sh', '-c', 'cd /source && find . -type f -exec sha256sum {} \\;']).toString().trim()
      .split('\n').filter(Boolean).map((line) => {
        const match = /^([a-f0-9]{64})  \.\/(.*)$/.exec(line);
        assert.ok(match, '로그 파일 해시 형식 확인 실패');
        return { path: match[2], sha256: match[1] };
      }).sort((a, b) => a.path.localeCompare(b.path));
    const archive = readLogs();
    fs.writeFileSync(path.join(backup, 'ingestion-logs.tar.partial'), archive);
    fs.renameSync(path.join(backup, 'ingestion-logs.tar.partial'), path.join(backup, 'ingestion-logs.tar'));
    const files = ['production.dump', 'ingestion-logs.tar', 'source.json'];
    fs.writeFileSync(path.join(backup, 'SHA256SUMS'), files.map((file) => `${sha(fs.readFileSync(path.join(backup, file)))}  ${file}\n`).join(''));
    run('sha256sum', ['-c', 'SHA256SUMS'], { cwd: backup });

    // 새 컨테이너의 임시 메모리 디스크만 사용하고 기존 DB 및 로그 볼륨과 분리
    const restorePassword = randomBytes(24).toString('hex');
    run('docker', ['run', '--detach', '--name', restoreName, '--env', 'POSTGRES_PASSWORD',
      '--env', 'POSTGRES_USER=youth_kkultong', '--env', 'POSTGRES_DB=youth_restore',
      '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data', image],
    { env: { ...process.env, POSTGRES_PASSWORD: restorePassword } });
    restoreCreated = true;
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const result = spawnSync('docker', ['exec', restoreName, 'pg_isready', '-h', '127.0.0.1', '-U', 'youth_kkultong', '-d', 'youth_restore'], { timeout: 5000 });
      if (result.status === 0) { ready = true; break; }
      await delay(500);
    }
    assert.ok(ready, '복원 검증용 PostgreSQL 준비 실패');
    const restorePort = run('docker', ['port', restoreName, '5432']).toString().trim().split(':')[1];
    const restoreUrl = new URL(`postgresql://youth_kkultong:${restorePassword}@127.0.0.1:${restorePort}/youth_restore`);
    restored = new Client({ connectionString: restoreUrl.href, options: '-c timezone=Asia/Seoul -c default_transaction_read_only=on' });
    await restored.connect();
    assert.equal((await restored.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);
    const input = fs.openSync(dump, 'r');
    try {
      run('docker', ['exec', '-i', restoreName, 'pg_restore', '-U', 'youth_kkultong', '-d', 'youth_restore',
        '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl'], { stdio: [input, 'pipe', 'pipe'] });
    } finally { fs.closeSync(input); }
    assert.deepEqual(await snapshot(restored), before, '전체 행, UUID, 상태, 제약, 인덱스 또는 시퀀스 불일치');
    await verifyHashes(restored);
    // 대기가 있는 백업은 제약 거부도 검증하고, 검수 데이터가 없는 백업은 행과 스키마로 확인
    const constraintsTested = before.statuses.some((row) => row.status === 'PENDING');
    if (constraintsTested) await verifyConstraints(restoreUrl.href);
    const beforeApi = await apiSnapshot(sourceUrl.href, source);
    const afterApi = await apiSnapshot(restoreUrl.href, restored);
    assert.ok(isDeepStrictEqual(afterApi, beforeApi), '원본 및 복원 DB의 HTTP 응답 불일치');
    const { createDataSource } = require('../dist/database/data-source.js');
    const { loadEnvironment } = require('../dist/common/environment.js');
    const orm = createDataSource(loadEnvironment());
    try {
      await orm.initialize();
      assert.equal(await orm.showMigrations(), false, '복원 후 적용되지 않은 Migration 존재');
      assert.deepEqual((await orm.driver.createSchemaBuilder().log()).upQueries, [], '복원 스키마와 엔티티 불일치');
    } finally { if (orm.isInitialized) await orm.destroy(); }
    const logs = path.join(temporary, 'logs');
    fs.mkdirSync(logs);
    run('tar', ['-xf', path.resolve(backup, 'ingestion-logs.tar'), '-C', logs]);
    const restoredLogs = logFiles(logs);
    assert.deepEqual(restoredLogs, sourceLogs, '원본 및 복원 로그 파일 해시 불일치');
    assert.equal(sha(readLogs()), sha(archive), '백업 중 원본 로그 변경');
    await assertIdle(source, sourceApi);
    assert.deepEqual(await snapshot(source), before, '원본 DB 변경');
    assert.deepEqual(await snapshot(restored), before, '조회 검증 중 복원 DB 변경');
    verification = { status: 'PASS', source: before.rows, reviewStatuses: before.statuses,
      logs: restoredLogs, api: { pending: afterApi.pending.pagination.total,
        processed: afterApi.processed.pagination.total, missing: afterApi.missing.pagination.total,
        reviewDetails: afterApi.reviewDetails.length, policyDetails: afterApi.policyDetails.length },
      rowAndSchemaEquality: true, contentHashesVerified: true, constraintsTested, originalUnchanged: true };
  } finally {
    // 연결 종료가 실패해도 이번에 생성한 컨테이너와 임시 폴더의 정리를 계속 시도
    const cleanup = await Promise.allSettled([source.end(), restored?.end()]);
    const errors = cleanup.filter((item) => item.status === 'rejected');
    try { if (restoreCreated) run('docker', ['rm', '--force', restoreName]); } catch (error) { errors.push(error); }
    try { fs.rmSync(temporary, { recursive: true, force: true }); } catch (error) { errors.push(error); }
    if (!verification || errors.length) console.error(`복원 검증 실패. 확인할 백업: ${path.relative(root, backup)}`);
    assert.equal(errors.length, 0, '검증 자원 정리 실패');
  }
  // 모든 정리가 끝난 뒤에만 이 백업을 복원 검증 완료로 표시
  fs.writeFileSync(path.join(backup, 'verification.json'), JSON.stringify(verification, null, 2));
  console.log(`복원 검증 통과. 백업과 결과: ${path.relative(root, backup)}`);
});
