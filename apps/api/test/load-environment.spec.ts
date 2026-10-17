import fs from 'node:fs';
import { loadEnvironment } from '../src/common/environment';

describe('실행 환경과 루트 .env 설정 읽기', () => {
  beforeEach(() => {
    jest.replaceProperty(process, 'env', {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('루트 .env를 읽되 실행 환경에서 전달한 값을 우선한다', () => {
    jest.spyOn(fs, 'readFileSync').mockReturnValue([
      'DATABASE_URL=postgresql://file-user:file-secret@db:5432/file-db',
      'YOUTH_CENTER_PAGE_SIZE=50',
    ].join('\n'));
    process.env.DATABASE_URL = 'postgresql://runtime-user:runtime-secret@db:5432/runtime-db';
    process.env.YOUTH_CENTER_PAGE_SIZE = '25';

    expect(loadEnvironment()).toMatchObject({
      DATABASE_URL: process.env.DATABASE_URL,
      YOUTH_CENTER_PAGE_SIZE: 25,
      TZ: 'Asia/Seoul',
    });
    expect(process.env.TZ).toBe('Asia/Seoul');
  });

  it('.env가 없는 컨테이너도 실행 환경의 설정만으로 동작한다', () => {
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw Object.assign(new Error('없는 파일'), { code: 'ENOENT' });
    });
    process.env.DATABASE_URL = 'postgresql://tester@db:5432/example';
    expect(loadEnvironment().DATABASE_URL).toBe(process.env.DATABASE_URL);
  });

  it('실행 환경의 잘못된 값을 .env의 정상값으로 대체하지 않는다', () => {
    jest.spyOn(fs, 'readFileSync').mockReturnValue('DATABASE_URL=postgresql://tester@db:5432/example');
    process.env.DATABASE_URL = '';
    expect(loadEnvironment).toThrow('DATABASE_URL');
  });

  it('.env 접근 오류를 무시하지 않고 비밀값 없이 실패한다', () => {
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw Object.assign(new Error('비밀값을 담을 수 있는 원본 오류'), { code: 'EACCES' });
    });
    expect(loadEnvironment).toThrow('루트 .env 파일을 읽지 못했습니다.');
  });
});
