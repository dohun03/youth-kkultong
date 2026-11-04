// 실제 Migration과 시드 CLI의 저장 대상을 이번 테스트의 격리 스키마로 지정
const schema = process.env.ADMIN_CLI_TEST_SCHEMA;
if (!/^admin_cli_test_[a-f0-9]{32}$/.test(schema ?? '')) throw new Error('CLI 검증 스키마가 필요합니다.');
const database = require('../../dist/database/data-source.js');
const originalCreate = database.createDataSource;
database.createDataSource = (environment) => originalCreate(environment).setOptions({
  schema, extra: { options: `-c timezone=${environment.TZ} -c search_path=${schema}` },
});
// 명시적으로 종료하는 Migration과 자연 종료하는 시드 모두 예약 모듈 미로딩 확인
process.once('exit', () => {
  if (!Object.keys(require.cache).some((path) => path.includes('/@nestjs/schedule/'))) {
    require('node:fs').writeSync(1, 'CLI_SCHEDULE_ABSENT\n');
  }
});
