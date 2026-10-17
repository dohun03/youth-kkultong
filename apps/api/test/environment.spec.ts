import { parseEnvironment } from '../src/common/environment';

const databaseUrl = 'postgresql://tester:unit-secret@localhost:5432/example';

describe('환경변수 검증', () => {
  it('필수 DB 주소만 있으면 명세의 기본값과 키 미설정 상태를 반환한다', () => {
    expect(parseEnvironment({ DATABASE_URL: databaseUrl })).toEqual({
      DATABASE_URL: databaseUrl,
      YOUTH_CENTER_PAGE_SIZE: 50,
      YOUTH_CENTER_REQUEST_DELAY_MS: 3000,
      YOUTH_CENTER_MAX_ATTEMPTS: 3,
      POLICY_IMPORT_BATCH_SIZE: 200,
      TZ: 'Asia/Seoul',
    });
  });

  it('문자열 숫자를 변환하고 빈 인증키는 미설정으로 다룬다', () => {
    expect(parseEnvironment({
      DATABASE_URL: databaseUrl,
      YOUTH_CENTER_API_KEY: '  ',
      YOUTH_CENTER_PAGE_SIZE: '1',
      YOUTH_CENTER_REQUEST_DELAY_MS: '0',
      YOUTH_CENTER_MAX_ATTEMPTS: '1',
      POLICY_IMPORT_BATCH_SIZE: '1',
    })).toMatchObject({
      YOUTH_CENTER_API_KEY: undefined,
      YOUTH_CENTER_PAGE_SIZE: 1,
      YOUTH_CENTER_REQUEST_DELAY_MS: 0,
      YOUTH_CENTER_MAX_ATTEMPTS: 1,
      POLICY_IMPORT_BATCH_SIZE: 1,
    });
  });

  it.each([undefined, '', 'not-a-url', 'https://example.com/db', 'postgresql://localhost', 'postgresql://tester@localhost/'])(
    '필수 DB 주소가 없거나 PostgreSQL 접속 형식이 아니면 거부한다: %s', (value) => {
      expect(() => parseEnvironment({ DATABASE_URL: value })).toThrow('DATABASE_URL');
    },
  );

  it.each([
    ['YOUTH_CENTER_PAGE_SIZE', '0'],
    ['YOUTH_CENTER_PAGE_SIZE', '1.5'],
    ['YOUTH_CENTER_PAGE_SIZE', '9007199254740992'],
    ['YOUTH_CENTER_REQUEST_DELAY_MS', '-1'],
    ['YOUTH_CENTER_REQUEST_DELAY_MS', '2147483648'],
    ['YOUTH_CENTER_REQUEST_DELAY_MS', ''],
    ['YOUTH_CENTER_MAX_ATTEMPTS', '0'],
    ['YOUTH_CENTER_MAX_ATTEMPTS', '4'],
    ['POLICY_IMPORT_BATCH_SIZE', '0'],
    ['POLICY_IMPORT_BATCH_SIZE', '201'],
    ['POLICY_IMPORT_BATCH_SIZE', 'abc'],
    ['TZ', 'UTC'],
  ])('유효하지 않은 %s 설정은 거부한다: %s', (name, value) => {
    expect(() => parseEnvironment({ DATABASE_URL: databaseUrl, [name]: value })).toThrow(name);
  });

  it('오류 메시지에 DB URL이나 인증키를 노출하지 않는다', () => {
    const invalidUrl = 'https://tester:db-secret@example.com/db';
    try {
      parseEnvironment({ DATABASE_URL: invalidUrl, YOUTH_CENTER_API_KEY: 'api-secret', TZ: 'UTC' });
      throw new Error('잘못된 설정을 허용했습니다.');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('TZ');
      expect(message).not.toMatch(/db-secret|api-secret|https:\/\//);
    }
  });
});
