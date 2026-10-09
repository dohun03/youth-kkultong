import { validateEnv } from './env.schema';

const validEnvironment = {
  DATABASE_URL: 'postgresql://kkultong:kkultong_local@localhost:5432/youth_kkultong',
  WEB_ORIGIN: 'http://localhost:3001',
  API_ORIGIN: 'http://localhost:3000',
  HIDE_DAYS: '30',
  MAX_HOUSEHOLD_SIZE: '8',
};

describe('validateEnv', () => {
  it('기본 NODE_ENV와 숫자형 가구원 수를 정규화한다', () => {
    expect(validateEnv(validEnvironment)).toEqual({
      NODE_ENV: 'development',
      DATABASE_URL: validEnvironment.DATABASE_URL,
      WEB_ORIGIN: validEnvironment.WEB_ORIGIN,
      API_ORIGIN: validEnvironment.API_ORIGIN,
      HIDE_DAYS: 30,
      MAX_HOUSEHOLD_SIZE: 8,
    });
  });

  it('PostgreSQL이 아닌 DATABASE_URL을 거부한다', () => {
    expect(() =>
      validateEnv({
        ...validEnvironment,
        DATABASE_URL: 'mysql://localhost:3306/youth_kkultong',
      }),
    ).toThrow('DATABASE_URL은 PostgreSQL 연결 URL이어야 합니다.');
  });

  it('형식이 잘못된 DATABASE_URL을 거부한다', () => {
    expect(() =>
      validateEnv({
        ...validEnvironment,
        DATABASE_URL: 'not-a-url',
      }),
    ).toThrow('DATABASE_URL은 유효한 URL이어야 합니다.');
  });

  it('양수가 아닌 MAX_HOUSEHOLD_SIZE를 거부한다', () => {
    expect(() =>
      validateEnv({
        ...validEnvironment,
        MAX_HOUSEHOLD_SIZE: '0',
      }),
    ).toThrow('MAX_HOUSEHOLD_SIZE는 1 이상이어야 합니다.');
  });

  it('경로가 포함된 Origin을 거부한다', () => {
    expect(() =>
      validateEnv({
        ...validEnvironment,
        WEB_ORIGIN: 'http://localhost:3001/admin',
      }),
    ).toThrow('Origin에는 경로, 쿼리, hash를 포함할 수 없습니다.');
  });

  it('음수 HIDE_DAYS를 거부한다', () => {
    expect(() =>
      validateEnv({
        ...validEnvironment,
        HIDE_DAYS: '-1',
      }),
    ).toThrow('HIDE_DAYS는 0 이상이어야 합니다.');
  });
});
