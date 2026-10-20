import { Logger } from '@nestjs/common';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnvironment } from '../src/common/environment';
import { IngestionLogError, IngestionLogService } from '../src/modules/ingestion/services/ingestion-log.service';
import type { IngestionLogEntry } from '../src/modules/ingestion/services/ingestion-log.service';

describe('수집 전용 파일 로그', () => {
  const apiKey = 'log-api-"secret\\value';
  const environment = parseEnvironment({ DATABASE_URL: 'postgresql://tester:db%21secret@db/test', YOUTH_CENTER_API_KEY: apiKey });
  const entry: IngestionLogEntry = {
    runId: 'run-1', event: 'RUN_FINISHED', stage: 'COMPLETE', status: 'SUCCESS',
    counts: { NEW: 1, CHANGED: 2, UNCHANGED: 3 }, pageNum: 2, attempts: 1, saveAttempts: 1, saved: true,
  };
  let directory: string;

  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'ingestion-log-')); });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('실행 기록을 UTF-8 JSON 한 줄씩 추가하고 파일을 소유자만 읽고 쓰게 한다', async () => {
    const target = join(directory, 'logs');
    const service = new IngestionLogService(environment, target);
    await service.write(entry);
    await service.write({ ...entry, runId: 'run-2', status: 'ALREADY_RUNNING' });
    const file = join(target, 'policies-import.jsonl');
    const lines = (await readFile(file, 'utf8')).trimEnd().split('\n').map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject(entry);
    expect(lines[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(lines[1].runId).toBe('run-2');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('원본·SQL·오류 메시지·추가 속성은 기록하지 않는다', async () => {
    const service = new IngestionLogService(environment, directory);
    const unsafe = { ...entry, rawJson: { apiKey }, query: 'SELECT private_data', message: 'private-message', cause: environment.DATABASE_URL };
    await service.write(unsafe);
    const record = JSON.parse(await readFile(join(directory, 'policies-import.jsonl'), 'utf8'));
    for (const key of ['rawJson', 'query', 'message', 'cause']) expect(record).not.toHaveProperty(key);
  });

  it('정책 ID·필드에 섞인 인증키와 인코딩 전후 DB 비밀번호도 제거한다', async () => {
    const service = new IngestionLogService(environment, directory);
    await service.write({ ...entry, failures: [{
      stage: 'HASH', reason: 'INVALID_JSON_VALUE', policyId: apiKey,
      fields: [apiKey, environment.DATABASE_URL, 'db%21secret', 'db!secret'],
    }] });
    const record = JSON.parse(await readFile(join(directory, 'policies-import.jsonl'), 'utf8'));
    expect(record.failures[0].policyId).toBe('[REDACTED]');
    expect(record.failures[0].fields).toEqual(Array(4).fill('[REDACTED]'));
  });

  it('파일 경로에 쓸 수 없으면 같은 안전한 기록을 기본 로그에 남긴다', async () => {
    const blocked = join(directory, 'blocked');
    await writeFile(blocked, '폴더 대신 파일');
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    await new IngestionLogService(environment, blocked).write(entry);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('FILE_LOG_FAILED ');
    expect(warn.mock.calls[0][0]).not.toContain(blocked);
    expect(JSON.parse(String(warn.mock.calls[0][0]).slice('FILE_LOG_FAILED '.length))).toMatchObject(entry);
  });

  it('파일과 기본 로그가 모두 실패하면 원본 오류 없이 기록 실패를 알린다', async () => {
    const blocked = join(directory, 'blocked');
    await writeFile(blocked, '폴더 대신 파일');
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => { throw new Error(apiKey); });
    await expect(new IngestionLogService(environment, blocked).write(entry)).rejects.toBeInstanceOf(IngestionLogError);
  });

  it('여러 실행이 동시에 추가해도 각 JSON 기록이 분리된다', async () => {
    const service = new IngestionLogService(environment, directory);
    await Promise.all(Array.from({ length: 10 }, (_, index) => service.write({ ...entry, runId: `run-${index}` })));
    const lines = (await readFile(join(directory, 'policies-import.jsonl'), 'utf8')).trimEnd().split('\n').map((line) => JSON.parse(line));
    expect(new Set(lines.map((record) => record.runId)).size).toBe(10);
  });
});
