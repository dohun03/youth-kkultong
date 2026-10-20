import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { loadEnvironment } from '../src/common/environment';
import { createDataSource } from '../src/database/data-source';
import { CreatePolicies1792162800000 } from '../src/database/migrations/1792162800000-create-policies';
import { IngestionLockService } from '../src/modules/ingestion/services/ingestion-lock.service';
import { IngestionLogService } from '../src/modules/ingestion/services/ingestion-log.service';
import type { IngestionLogEntry } from '../src/modules/ingestion/services/ingestion-log.service';
import { IngestionService } from '../src/modules/ingestion/services/ingestion.service';
import { YouthCenterClient } from '../src/modules/ingestion/youth-center/youth-center.client';
import type { YouthCenterRawPolicy } from '../src/modules/ingestion/youth-center/youth-center-response.schema';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { PoliciesWriteService } from '../src/modules/policies/services/policies-write.service';
import type { PreparedPolicyBatches } from '../src/modules/policies/services/policies-write.service';
import { PolicyRepository } from '../src/modules/policies/repositories/policy.repository';
import sample from './fixtures/youth-center-policy.json';

/** 기존 원본 샘플·최소 필드·날짜와 코드가 있는 정책을 서로 다른 페이지에 배치한다. */
function initialPolicies(): YouthCenterRawPolicy[] {
  return [
    {
      ...structuredClone(sample),
      unknownField: { text: '원문 공백과 줄바꿈\n따옴표 \' " · 역슬래시 \\', list: [0, false, null, '한글'] },
    },
    { plcyNo: 'minimal-policy', plcyNm: '최소 필드 정책', inqCnt: '0', aplyUrlAddr: '  ' },
    {
      plcyNo: 'dated-policy', plcyNm: '특정 기간 정책', inqCnt: '25',
      sprtTrgtMinAge: '18', sprtTrgtMaxAge: '34',
      jobCd: '0013010, 0013001', schoolCd: '0049010', zipCd: '41131, 41133',
      aplyPrdSeCd: '0057001', aplyYmd: '20261001 ~ 20261031',
    },
  ];
}

describe('전체 수집·재수집 성공 경로의 실제 PostgreSQL 검증', () => {
  const schema = `step26_test_${randomUUID().replaceAll('-', '')}`;
  const environment = {
    ...loadEnvironment(), YOUTH_CENTER_API_KEY: 'step26-test-key',
    YOUTH_CENTER_PAGE_SIZE: 2, YOUTH_CENTER_REQUEST_DELAY_MS: 0, POLICY_IMPORT_BATCH_SIZE: 200,
  };
  let admin: DataSource;
  let dataSource: DataSource;
  let schemaCreated = false;
  let directory: string;
  let policies: YouthCenterRawPolicy[];
  let service: IngestionService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  /** 결과를 DB에서 다시 읽어 원본 JSON·정규화 컬럼·UUID·해시를 비교한다. */
  async function storedPolicies(): Promise<Policy[]> {
    return dataSource.getRepository(Policy).find({ order: { source: 'ASC', externalId: 'ASC' } });
  }

  /** 모의 HTTP 응답만 교체하고 수집·검증·변환·저장·로그·잠금은 실제 서비스로 연결한다. */
  function createService(pageSize = 2): IngestionService {
    return new IngestionService(
      new YouthCenterClient({ ...environment, YOUTH_CENTER_PAGE_SIZE: pageSize }),
      new IngestionLockService(dataSource),
      new PoliciesWriteService(new PolicyRepository(), environment),
      new IngestionLogService(environment, directory),
    );
  }

  /** 실행 반환값과 최종 파일 로그의 확정 건수를 대조하고 중복 저장도 함께 검사한다. */
  async function expectImport(counts: PreparedPolicyBatches['counts'], pages = [1, 2]): Promise<void> {
    fetchMock.mockClear();
    await expect(service.importPolicies()).resolves.toEqual({ status: 'COMPLETED', value: counts });
    expect(fetchMock.mock.calls.map(([input]) => Number(new URL(String(input)).searchParams.get('pageNum')))).toEqual(pages);

    const records: IngestionLogEntry[] = (await readFile(join(directory, 'policies-import.jsonl'), 'utf8'))
      .trimEnd().split('\n').map((line) => JSON.parse(line));
    expect(records.at(-1)).toMatchObject({ event: 'RUN_FINISHED', stage: 'COMPLETE', status: 'SUCCESS', saved: true, counts });
    // 개발 테이블 대신 이 테스트가 만든 스키마에서만 유일성을 확인한다.
    expect(await dataSource.query(`
      SELECT source, external_id FROM "${schema}".policies
      GROUP BY source, external_id HAVING count(*) > 1
    `)).toEqual([]);
  }

  beforeAll(async () => {
    // 매번 새 검증 스키마를 만들어 개발 정책과 Migration 이력을 건드리지 않는다.
    admin = createDataSource(environment).setOptions({ entities: [], migrations: [] });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    dataSource = createDataSource(environment).setOptions({
      schema, entities: [Policy], migrations: [CreatePolicies1792162800000],
      extra: { options: `-c timezone=${environment.TZ} -c search_path=${schema}` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  beforeEach(async () => {
    await dataSource.getRepository(Policy).clear();
    directory = await mkdtemp(join(tmpdir(), 'ingestion-success-'));
    policies = initialPolicies();
    service = createService();
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      // 실제 네트워크에 나가지 않고 요청한 페이지의 원본 목록을 HTTP JSON으로 돌려준다.
      const url = new URL(String(input));
      const pageNum = Number(url.searchParams.get('pageNum'));
      const pageSize = Number(url.searchParams.get('pageSize'));
      return Response.json({
        resultCode: 200, resultMessage: '성공', result: {
          pagging: { totCount: policies.length, pageNum, pageSize },
          youthPolicyList: policies.slice((pageNum - 1) * pageSize, pageNum * pageSize),
        },
      });
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  afterAll(async () => {
    // 테스트 성공·실패에 관계없이 연결·검증 스키마를 차례로 정리한다.
    try {
      if (dataSource?.isInitialized) await dataSource.destroy();
    } finally {
      try {
        if (schemaCreated && admin?.isInitialized) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        if (admin?.isInitialized) await admin.destroy();
      }
    }
  });

  it('첫 수집은 두 페이지의 3건을 신규 저장하고 정규화 값과 추가 필드 원본을 보관한다', async () => {
    await expectImport({ NEW: 3, CHANGED: 0, UNCHANGED: 0 });
    const rows = await storedPolicies();
    expect(rows).toHaveLength(3);
    for (const raw of policies) {
      expect(rows.find((row) => row.externalId === raw.plcyNo)).toMatchObject({
        source: 'youthcenter', rawJson: raw, contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
    }
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
    expect(rows.find((row) => row.externalId === sample.plcyNo)).toMatchObject({
      title: sample.plcyNm, description: sample.plcyExplnCn, benefitText: sample.plcySprtCn,
      applyUrl: sample.aplyUrlAddr, referenceUrl1: sample.refUrlAddr1, referenceUrl2: sample.refUrlAddr2,
      viewCount: 14, ageMin: 0, ageMax: 0, jobCodes: ['0013010'], schoolCodes: ['0049010'],
      applicationPeriodCode: '0057002', applicationStartDate: null, applicationEndDate: null,
    });
    expect(rows.find((row) => row.externalId === 'minimal-policy')).toMatchObject({
      viewCount: 0, applyUrl: null, category: null, ageMin: null, ageMax: null,
      jobCodes: null, schoolCodes: null, regionCodes: null,
    });
    expect(rows.find((row) => row.externalId === 'dated-policy')).toMatchObject({
      ageMin: 18, ageMax: 34, jobCodes: ['0013010', '0013001'], schoolCodes: ['0049010'],
      regionCodes: ['41131', '41133'], applicationPeriodRaw: '20261001 ~ 20261031',
      applicationStartDate: '2026-10-01', applicationEndDate: '2026-10-31',
    });
    // timestamp는 DB에서 직접 문자열로 읽어 시간대 자동 변환 없이 원본과 비교한다.
    expect(await dataSource.query(`
      SELECT to_char(source_registered_at, 'YYYY-MM-DD HH24:MI:SS') AS registered,
        to_char(source_modified_at, 'YYYY-MM-DD HH24:MI:SS') AS modified
      FROM "${schema}".policies WHERE external_id = $1
    `, [sample.plcyNo])).toEqual([{ registered: sample.frstRegDt, modified: sample.lastMdfcnDt }]);
  });

  it('T-21: 같은 자료를 세 번 더 수집해도 정책·UUID·최초 저장일·해시는 유지된다', async () => {
    await expectImport({ NEW: 3, CHANGED: 0, UNCHANGED: 0 });
    const before = await storedPolicies();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expectImport({ NEW: 0, CHANGED: 0, UNCHANGED: 3 });
      expect(await storedPolicies()).toEqual(before.map((row) => ({ ...row, updatedAt: expect.any(Date) })));
    }
  });

  it('내용이 바뀐 정책만 CHANGED로 갱신하고 재수집하면 다시 UNCHANGED로 분류한다', async () => {
    await expectImport({ NEW: 3, CHANGED: 0, UNCHANGED: 0 });
    const before = await storedPolicies();
    const original = before.find((row) => row.externalId === sample.plcyNo)!;
    policies[0] = { ...policies[0], plcyNm: '변경된 정책 제목', plcySprtCn: '새 지원 내용\n줄바꿈 유지' };
    await expectImport({ NEW: 0, CHANGED: 1, UNCHANGED: 2 });
    const after = await storedPolicies();
    expect(after).toHaveLength(3);
    expect(after.find((row) => row.externalId === sample.plcyNo)).toMatchObject({
      id: original.id, createdAt: original.createdAt, title: '변경된 정책 제목',
      benefitText: '새 지원 내용\n줄바꿈 유지', viewCount: original.viewCount, rawJson: policies[0],
    });
    expect(after.find((row) => row.externalId === sample.plcyNo)!.contentHash).not.toBe(original.contentHash);
    for (const unchanged of before.filter((row) => row.externalId !== sample.plcyNo)) {
      expect(after.find((row) => row.id === unchanged.id)).toEqual({ ...unchanged, updatedAt: expect.any(Date) });
    }
    await expectImport({ NEW: 0, CHANGED: 0, UNCHANGED: 3 });
  });

  it('T-20: 조회수만 증가하면 UNCHANGED이며 해시·정규화 내용은 유지하고 원본·조회수만 갱신한다', async () => {
    await expectImport({ NEW: 3, CHANGED: 0, UNCHANGED: 0 });
    const original = (await storedPolicies()).find((row) => row.externalId === sample.plcyNo)!;
    policies[0] = { ...policies[0], inqCnt: '99' };
    await expectImport({ NEW: 0, CHANGED: 0, UNCHANGED: 3 });
    const after = await storedPolicies();
    expect(after).toHaveLength(3);
    expect(after.find((row) => row.externalId === sample.plcyNo)).toEqual({
      ...original, viewCount: 99, rawJson: policies[0], updatedAt: expect.any(Date),
    });
  });

  it('한 수집에 신규·내용 변경·조회수 변경·동일 정책이 섞여도 건수와 최신 원본이 일치한다', async () => {
    await expectImport({ NEW: 3, CHANGED: 0, UNCHANGED: 0 });
    const before = await storedPolicies();
    policies = [
      { ...policies[0], plcyNm: '변경 제목' },
      { ...policies[1], inqCnt: '45' },
      policies[2],
      { plcyNo: 'new-policy', plcyNm: '추가 정책', inqCnt: '1' },
    ];
    await expectImport({ NEW: 1, CHANGED: 1, UNCHANGED: 2 });
    const after = await storedPolicies();
    expect(after).toHaveLength(4);
    for (const raw of policies) expect(after.find((row) => row.externalId === raw.plcyNo)!.rawJson).toEqual(raw);
    for (const original of before) {
      expect(after.find((row) => row.externalId === original.externalId)).toMatchObject({ id: original.id, createdAt: original.createdAt });
    }
    expect(after.find((row) => row.externalId === 'minimal-policy')).toMatchObject({ viewCount: 45 });
    await expectImport({ NEW: 0, CHANGED: 0, UNCHANGED: 4 });
  });

  it('외부 ID가 같은 다른 출처와 이번 수집에서 빠진 정책을 빈 응답 재수집 후에도 보존한다', async () => {
    await expectImport({ NEW: 3, CHANGED: 0, UNCHANGED: 0 });
    const repository = dataSource.getRepository(Policy);
    const other = await repository.save({
      source: 'other-source', externalId: sample.plcyNo, title: '다른 출처 정책',
      rawJson: { preserved: true }, contentHash: 'a'.repeat(64),
    });
    const otherBefore = await repository.findOneByOrFail({ id: other.id });
    await expectImport({ NEW: 0, CHANGED: 0, UNCHANGED: 3 });
    expect(await repository.findOneByOrFail({ id: other.id })).toEqual(otherBefore);
    const before = await storedPolicies();
    policies = [];
    await expectImport({ NEW: 0, CHANGED: 0, UNCHANGED: 0 }, [1]);
    expect(await storedPolicies()).toEqual(before);
    expect(before).toHaveLength(4);
  });

  it('201건을 5페이지로 수집해 200건 저장 경계를 넘긴 뒤 재수집·조회수 갱신에도 중복이 없다', async () => {
    policies = Array.from({ length: 201 }, (_, index) => ({
      plcyNo: `bulk-${index}`, plcyNm: `묶음 검증 정책 ${index}`, inqCnt: '0',
      extra: { index, values: [null, false, '원본'] },
    }));
    service = createService(50);
    await expectImport({ NEW: 201, CHANGED: 0, UNCHANGED: 0 }, [1, 2, 3, 4, 5]);
    const before = await storedPolicies();
    expect(before).toHaveLength(201);
    await expectImport({ NEW: 0, CHANGED: 0, UNCHANGED: 201 }, [1, 2, 3, 4, 5]);
    policies = policies.map((raw) => ({ ...raw, inqCnt: '100' }));
    await expectImport({ NEW: 0, CHANGED: 0, UNCHANGED: 201 }, [1, 2, 3, 4, 5]);
    const after = await storedPolicies();
    expect(after).toHaveLength(201);
    for (const original of before) {
      expect(after.find((row) => row.externalId === original.externalId)).toEqual({
        ...original, viewCount: 100, rawJson: { ...original.rawJson, inqCnt: '100' }, updatedAt: expect.any(Date),
      });
    }
  });
});
