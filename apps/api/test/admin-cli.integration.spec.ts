import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { loadEnvironment } from '../src/common/environment';
import { createDataSource } from '../src/database/data-source';

/** 비밀값이 없는 요약 결과로 독립 CLI의 성공 여부를 확인 */
function runCli(args: string[], schema: string, databaseUrl: string, schedule: string): Promise<{ code: number | null; success: boolean; scheduleAbsent: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--require', join(__dirname, 'fixtures/admin-cli.preload.cjs'), ...args], {
      cwd: join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: '', DATABASE_URL: databaseUrl, ADMIN_CLI_TEST_SCHEMA: schema,
        POLICY_SCHEDULE_ENABLED: schedule,
        ADMIN_USERNAME: '', ADMIN_PASSWORD_HASH: '', ADMIN_AUTH_SECRET: '', ADMIN_WEB_ORIGIN: '' },
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    // 드라이버 오류에 접속 정보가 섞일 수 있어 원문을 테스트 결과로 전달하지 않음
    child.stderr.resume();
    const timeout = setTimeout(() => { child.kill('SIGKILL'); }, 20000);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, success: /successfully|공식 지역 시드 완료/.test(output), scheduleAbsent: output.includes('CLI_SCHEDULE_ABSENT') });
    });
  });
}

describe('관리자 자격 없는 실제 Migration 및 시드 CLI', () => {
  it.each(['true', 'invalid-http-only-setting'])('자동 수집 설정 %s와 빈 관리자 자격에도 타이머 없이 실행하고 재실행한다', async (schedule) => {
    const schema = `admin_cli_test_${randomUUID().replaceAll('-', '')}`;
    const environment = loadEnvironment();
    const admin = createDataSource(environment).setOptions({ entities: [], migrations: [] });
    let created = false;
    try {
      await admin.initialize();
      await admin.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      const migration = await runCli(['../../node_modules/typeorm/cli.js', 'migration:run', '-d', 'dist/database/migration-data-source.js'], schema, environment.DATABASE_URL, schedule);
      expect(migration).toEqual({ code: 0, success: true, scheduleAbsent: true });
      expect((await admin.query(`SELECT count(*)::int AS count FROM "${schema}".migrations`))[0].count).toBe(3);
      for (let index = 0; index < 2; index++) {
        expect(await runCli(['dist/database/seeds/regions.seed.js'], schema, environment.DATABASE_URL, schedule)).toEqual({ code: 0, success: true, scheduleAbsent: true });
        expect((await admin.query(`SELECT count(*)::int AS count FROM "${schema}".regions`))[0].count).toBe(537);
      }
    } finally {
      try { if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
      finally { if (admin.isInitialized) await admin.destroy(); }
    }
  }, 60000);
});
