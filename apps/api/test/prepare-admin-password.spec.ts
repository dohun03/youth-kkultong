import { mkdtemp, readFile, rm, stat, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { prepareAdminPassword } from '../src/prepare-admin-password';
import { AdminCredentialsService, parseAdminCredentials } from '../src/modules/admin/services/admin-credentials.service';

describe('비밀값을 출력하지 않는 관리자 해시 준비', () => {
  let directory: string;
  let output: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'admin-password-test-'));
    output = join(directory, 'password.hash');
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('분할 UTF-8 입력과 앞뒤 공백을 보존하고 새 파일 권한을 600으로 설정한다', async () => {
    const password = '  한글 비밀번호 🔑  ';
    const bytes = Buffer.from(password);
    await prepareAdminPassword(Readable.from([bytes.subarray(0, 4), bytes.subarray(4)]), output);
    const hash = (await readFile(output, 'utf8')).trimEnd();
    const service = new AdminCredentialsService(parseAdminCredentials({ ADMIN_USERNAME: 'reviewer', ADMIN_PASSWORD_HASH: hash }));
    await expect(service.authenticate('reviewer', password)).resolves.toBe('reviewer');
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    expect(bytes.every((value) => value === 0)).toBe(true);
  });

  it.each(['', 'x'.repeat(257), 'x'.repeat(1025)])('빈 입력과 과도한 입력에는 파일을 생성하지 않는다 (%#)', async (password) => {
    await expect(prepareAdminPassword(Readable.from([Buffer.from(password)]), output)).rejects.toThrow();
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('잘못된 UTF-8 입력은 대체 문자로 바꾸지 않고 거부한다', async () => {
    await expect(prepareAdminPassword(Readable.from([Buffer.from([0xff])]), output)).rejects.toThrow();
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('기존 파일과 심볼릭 링크의 대상 파일을 덮어쓰지 않는다', async () => {
    const target = join(directory, 'existing');
    await writeFile(target, '기존 내용');
    await symlink(target, output);
    for (const path of [target, output]) {
      await expect(prepareAdminPassword(Readable.from(['password']), path)).rejects.toMatchObject({ code: 'EEXIST' });
    }
    expect(await readFile(target, 'utf8')).toBe('기존 내용');
  });

  it('입력 스트림 실패는 파일을 만들지 않고 전달한다', async () => {
    const input = new Readable({ read() { this.destroy(new Error('입력 실패')); } });
    await expect(prepareAdminPassword(input, output)).rejects.toThrow('입력 실패');
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('실제 CLI는 비밀번호와 해시를 표준 출력 및 오류 출력에 남기지 않는다', async () => {
    const password = '  cli-test-secret 🔑  ';
    const result = spawnSync(process.execPath, ['dist/prepare-admin-password.js', output], {
      cwd: join(__dirname, '..'), input: password, encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    const hash = (await readFile(output, 'utf8')).trimEnd();
    const service = new AdminCredentialsService(parseAdminCredentials({ ADMIN_USERNAME: 'reviewer', ADMIN_PASSWORD_HASH: hash }));
    await expect(service.authenticate('reviewer', password)).resolves.toBe('reviewer');
  });

  it('실제 CLI의 저장 실패와 추가 인자 오류에도 비밀값을 출력하지 않는다', async () => {
    await writeFile(output, '기존 내용');
    for (const args of [[output], [output, 'argument-secret']]) {
      const result = spawnSync(process.execPath, ['dist/prepare-admin-password.js', ...args], {
        cwd: join(__dirname, '..'), input: 'stdin-secret', encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).not.toMatch(/argument-secret|stdin-secret|password\.hash/);
    }
    expect(await readFile(output, 'utf8')).toBe('기존 내용');
  });
});
