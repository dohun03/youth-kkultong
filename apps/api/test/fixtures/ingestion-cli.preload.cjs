// 독립 Node 프로세스에서도 기존 개발 의존성으로 TS 소스와 NestJS 데코레이터를 읽는다.
// 사전 빌드나 운영 이미지 없이 실제 CLI 진입점을 실행하기 위한 테스트 전용 로더다.
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true,
  } });
  module._compile(result.outputText, filename);
};

// 검증용 이름이 아니면 시작하지 않는다. 실제 개발 스키마에 쓰는 일을 방지한다.
const schema = process.env.INGESTION_TEST_SCHEMA;
if (!/^step27_cli_[a-f0-9]{32}$/.test(schema ?? '')) throw new Error('CLI 검증 스키마가 필요합니다.');
const database = require('../../src/database/data-source.ts');
const originalCreate = database.createDataSource;
database.createDataSource = (env) => originalCreate(env).setOptions({
  schema, extra: { options: `-c timezone=${env.TZ} -c search_path=${schema}` },
});

// 실제 파일 로그 서비스는 유지하고 이 자식 프로세스의 임시 경로만 지정한다.
const { IngestionLogService } = require('../../src/modules/ingestion/services/ingestion-log.service.ts');
const originalWrite = IngestionLogService.prototype.write;
IngestionLogService.prototype.write = async function (entry) {
  this.directory = process.env.INGESTION_TEST_LOG_DIRECTORY;
  return originalWrite.call(this, entry);
};

let resume;
const gate = new Promise((resolve) => { resume = resolve; });
process.on('message', (message) => { if (message === 'RESUME') resume(); });
// IPC 자체가 CLI의 자연 종료를 붙잡지 않도록 한다. 작업 중에는 DB 연결이 유지된다.
process.channel?.unref();

let firstRequest = true;
globalThis.fetch = async () => {
  process.send?.({ event: 'API_REQUEST' });
  if (firstRequest && process.env.INGESTION_TEST_MODE === 'API_PAUSE') {
    firstRequest = false;
    process.send?.({ event: 'API_PAUSED' });
    await gate;
  }
  return Response.json({ resultCode: 200, resultMessage: '성공', result: {
    pagging: { totCount: 2, pageNum: 1, pageSize: 2 },
    youthPolicyList: [
      { plcyNo: 'policy-0', plcyNm: 'CLI가 변경한 제목', inqCnt: '20' },
      { plcyNo: 'policy-1', plcyNm: 'CLI가 추가한 정책', inqCnt: '1' },
    ],
  } });
};

if (process.env.INGESTION_TEST_MODE === 'SAVE_PAUSE') {
  const { PolicyRepository } = require('../../src/modules/policies/repositories/policy.repository.ts');
  const originalUpsert = PolicyRepository.prototype.upsertPolicies;
  let firstBatch = true;
  PolicyRepository.prototype.upsertPolicies = async function (manager, policies) {
    await originalUpsert.call(this, manager, policies);
    if (firstBatch) {
      firstBatch = false;
      // 첫 묶음은 DB에 보냈지만 COMMIT 전인 상태에서만 부모에게 알린다.
      process.send?.({ event: 'SAVE_PAUSED' });
      await gate;
    }
  };
}
