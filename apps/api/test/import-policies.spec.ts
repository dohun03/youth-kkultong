import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { importPolicies } from '../src/import-policies';
import { IngestionService } from '../src/modules/ingestion/services/ingestion.service';

describe('정책 수집 CLI 결과와 애플리케이션 정리', () => {
  const collect = jest.fn<ReturnType<IngestionService['importPolicies']>, []>();
  const close = jest.fn<Promise<void>, []>();
  const get = jest.fn();
  let stdout: jest.SpiedFunction<typeof console.log>;
  let stderr: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    collect.mockReset().mockResolvedValue({ status: 'COMPLETED', value: { NEW: 3, CHANGED: 2, UNCHANGED: 1 } });
    close.mockReset().mockResolvedValue(undefined);
    get.mockReset().mockReturnValue({ importPolicies: collect });
    jest.spyOn(NestFactory, 'createApplicationContext').mockResolvedValue({ get, close } as unknown as INestApplicationContext);
    jest.spyOn(NestFactory, 'create');
    stdout = jest.spyOn(console, 'log').mockImplementation(() => {});
    stderr = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it('독립 컨텍스트에서 한 번 수집하고 연결 정리 후 건수와 성공 코드 0을 반환한다', async () => {
    close.mockImplementation(async () => {
      expect(collect).toHaveBeenCalledTimes(1);
      expect(stdout).not.toHaveBeenCalled();
    });
    await expect(importPolicies()).resolves.toBe(0);
    expect(NestFactory.createApplicationContext).toHaveBeenCalledWith(AppModule, { abortOnError: false, logger: ['warn'] });
    expect(NestFactory.create).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith(IngestionService);
    expect(close).toHaveBeenCalledTimes(1);
    expect(stdout).toHaveBeenCalledWith('정책 수집 완료: 신규 3건, 변경 2건, 동일 1건.');
    expect(stderr).not.toHaveBeenCalled();
  });

  it('이미 수집 중이면 연결을 닫고 중복 실행 코드 2와 건너뜀 메시지를 반환한다', async () => {
    collect.mockResolvedValue({ status: 'ALREADY_RUNNING' });
    await expect(importPolicies()).resolves.toBe(2);
    expect(close).toHaveBeenCalledTimes(1);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('이미 실행 중'));
    expect(stdout).not.toHaveBeenCalledWith(expect.stringContaining('수집 완료'));
    expect(stderr).not.toHaveBeenCalled();
  });

  it('수집 실패 시 연결을 닫고 원본 오류 없이 실패 코드 1을 반환한다', async () => {
    collect.mockRejectedValue(new AggregateError([new Error('api-secret'), new Error('postgresql://private')], 'SQL secret'));
    await expect(importPolicies()).resolves.toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(stderr).toHaveBeenCalledWith('정책 수집에 실패했습니다. 수집 로그와 환경변수·DB 설정을 확인하세요.');
    expect(stdout).not.toHaveBeenCalled();
  });

  it('컨텍스트 초기화 실패도 강제 종료 없이 안전한 메시지와 코드 1을 반환한다', async () => {
    jest.mocked(NestFactory.createApplicationContext).mockRejectedValue(new Error('postgresql://secret'));
    await expect(importPolicies()).resolves.toBe(1);
    expect(collect).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('환경변수·DB 설정'));
    expect(JSON.stringify(stderr.mock.calls)).not.toContain('postgresql://secret');
  });

  it('서비스 조회에 실패해도 생성한 컨텍스트를 정리한다', async () => {
    get.mockImplementation(() => { throw new Error('서비스 조회 실패'); });
    await expect(importPolicies()).resolves.toBe(1);
    expect(collect).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(['성공', '실패', '중복'] as const)('%s 결과 뒤 컨텍스트 정리에 실패하면 최종 코드 1만 반환한다', async (status) => {
    if (status === '실패') collect.mockRejectedValue(new Error('원본 오류 비밀값'));
    if (status === '중복') collect.mockResolvedValue({ status: 'ALREADY_RUNNING' });
    close.mockRejectedValue(new Error('DB 연결 정리 비밀값'));
    await expect(importPolicies()).resolves.toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('자원 정리에 실패'));
    expect(JSON.stringify(stderr.mock.calls)).not.toContain('비밀값');
  });
});
