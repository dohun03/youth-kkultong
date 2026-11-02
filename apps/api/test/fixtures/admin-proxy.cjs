const { cp, mkdir, mkdtemp, readFile, writeFile, symlink, rm } = require('node:fs/promises');
const { join, resolve, relative } = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { createServer } = require('node:http');

let project;
let app;
let server;
let building;
let stopping = false;

/** 이번 검증에서 만든 Next 서버와 빌드 프로세스 및 임시 프로젝트 정리 */
async function cleanup() {
  if (building && building.exitCode === null) {
    const active = building;
    await new Promise((resolve) => {
      active.once('close', resolve);
      active.kill('SIGKILL');
    });
  }
  try {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    try { if (app) await app.close(); }
    finally { if (project) await rm(project, { recursive: true, force: true, maxRetries: 3 }); }
  }
}

/** 실제 웹 소스와 설정으로 별도 프로덕션 빌드 -> 실제 Next.js 프록시 시작 */
async function start() {
  const web = resolve(__dirname, '../../../web');
  const root = resolve(web, '../..');
  // 기존 .next 빌드를 보존하고 이번 프로젝트 안에서만 빌드 파일을 생성
  await mkdir(join(web, '.next'), { recursive: true });
  project = await mkdtemp(join(web, '.next/admin-proxy-test-'));
  process.send?.({ event: 'PROJECT', path: project });
  await Promise.all(['app', 'src', 'package.json'].map((name) => cp(join(web, name), join(project, name), { recursive: true })));
  await symlink(join(root, 'node_modules'), join(project, 'node_modules'), 'dir');
  const tsconfig = JSON.parse(await readFile(join(web, 'tsconfig.json'), 'utf8'));
  tsconfig.extends = relative(project, join(root, 'tsconfig.base.json'));
  await writeFile(join(project, 'tsconfig.json'), JSON.stringify(tsconfig));
  // 운영 next.config.ts를 그대로 사용해 rewrites 및 헤더 전달을 실제 구현으로 확인
  await writeFile(join(project, 'next.config.mjs'),
    `import config from ${JSON.stringify(pathToFileURL(join(web, 'next.config.ts')).href)}; export default config;\n`);

  await new Promise((resolve, reject) => {
    building = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'build', project], {
      stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, NODE_ENV: 'production' },
    });
    building.once('error', reject);
    building.once('close', (code) => {
      building = undefined;
      if (code === 0) resolve();
      else reject(new Error('웹 프록시 검증 빌드 실패'));
    });
  });
  const next = require('next');
  app = next({ dev: false, dir: project, hostname: '127.0.0.1', port: Number(process.env.PROXY_TEST_PORT) });
  await app.prepare();
  server = createServer(app.getRequestHandler());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(process.env.PROXY_TEST_PORT), '127.0.0.1', resolve);
  });
  process.send?.({ event: 'READY' });
}

process.once('SIGTERM', () => {
  stopping = true;
  void cleanup().then(() => process.exit(0), () => process.exit(1));
});
void start().catch(async () => {
  if (stopping) return;
  process.stderr.write('웹 프록시 검증 서버 시작 실패\n');
  await cleanup();
  process.exit(1);
});
