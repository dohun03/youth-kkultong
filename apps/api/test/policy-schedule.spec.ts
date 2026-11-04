import { IngestionScheduleModule } from '../src/modules/ingestion/ingestion-schedule.module';
import { createApplication } from '../src/main';
import { testAdminValues } from './helpers/admin';
import * as database from '../src/database/data-source';

describe('HTTP 전용 자동 수집 설정', () => {
  it.each([undefined, 'false'])('설정 %s는 스케줄 모듈과 제공자를 등록하지 않는다', (value) => {
    const module = IngestionScheduleModule.forHttp({ POLICY_SCHEDULE_ENABLED: value });
    expect(module.imports).toEqual([]);
    expect(module.providers).toEqual([]);
  });

  it.each(['', 'TRUE', 'False', '1', ' true ', true, false, null, 1, {}, 'secret-input'])(
    '잘못된 설정 %p는 DB 연결 전에 거부하고 입력 원문을 숨긴다', async (value) => {
      const factory = jest.spyOn(database, 'createDataSource');
      try {
        await expect(createApplication({ ...testAdminValues, POLICY_SCHEDULE_ENABLED: value }))
          .rejects.toThrow('POLICY_SCHEDULE_ENABLED는 true 또는 false 문자열이어야 합니다.');
        expect(factory).not.toHaveBeenCalled();
      } finally { factory.mockRestore(); }
    },
  );
});
