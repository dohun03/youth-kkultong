import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { Region } from '../src/modules/meta/entities/region.entity';
import { createApplication } from '../src/main';

describe('상태 확인 API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApplication();
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    if (app) {
      const dataSource = app.get(DataSource);
      await app.close();
      expect(dataSource.isInitialized).toBe(false);
    }
  });

  it('DB 연결을 완료한 애플리케이션에서 SQL을 실행할 수 있다', async () => {
    const dataSource = app.get(DataSource);
    expect(dataSource.hasMetadata(Policy)).toBe(true);
    expect(dataSource.hasMetadata(Region)).toBe(true);
    expect(await dataSource.query('SELECT 1 AS connected')).toEqual([{ connected: 1 }]);
  });

  it('GET /api/v1/health는 정상 상태를 JSON으로 반환한다', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect('Content-Type', /json/)
      .expect({ status: 'ok' });
  });

  it.each(['/health', '/api/health'])(
    '공통 접두사가 빠진 %s는 존재하지 않는다',
    async (path) => {
      await request(app.getHttpServer()).get(path).expect(404);
    },
  );

  it('POST /api/v1/health는 제공하지 않는다', async () => {
    await request(app.getHttpServer()).post('/api/v1/health').expect(404)
      .expect({ code: 'NOT_FOUND', message: '요청한 대상을 찾을 수 없습니다.' });
  });
});
