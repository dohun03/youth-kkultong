import { validateEnv } from './env.schema';

const validEnvironment = {
  DATABASE_URL: 'postgresql://kkultong:kkultong_local@localhost:5432/youth_kkultong',
  MAX_HOUSEHOLD_SIZE: '8',
};

describe('validateEnv', () => {
  it('기본 NODE_ENV와 숫자형 가구원 수를 정규화한다', () => {
    expect(validateEnv(validEnvironment)).toEqual({
      NODE_ENV: 'development',
      DATABASE_URL: validEnvironment.DATABASE_URL,
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
});
