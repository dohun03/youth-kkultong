import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApplication } from '../src/main';

describe('상태 확인 API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApplication();
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    if (app) await app.close();
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
    await request(app.getHttpServer()).post('/api/v1/health').expect(404);
  });
});
