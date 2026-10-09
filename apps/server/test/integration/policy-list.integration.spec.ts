import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PolicyConditions, PolicyDetail, PolicyListResponse } from '@kkultong/contracts';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { DataSource, type DeepPartial } from 'typeorm';
import { Mvp0CorePolicy1760000000000 } from '../../src/database/migrations/001-mvp0-core-policy';
import { PolicyEntity } from '../../src/modules/policies/entities/policy.entity';
import { PolicySourceEntity } from '../../src/modules/policies/entities/policy-source.entity';
import { PoliciesController } from '../../src/modules/policies/controllers/policies.controller';
import { PolicyRepository } from '../../src/modules/policies/repositories/policy.repository';
import { PolicyQueryService } from '../../src/modules/policies/services/policy-query.service';

const TEST_TIMEOUT_MS = 60_000;
const POSTGRES_PORT = 5432;
const TEST_DATABASE_NAME = 'kkultong_test';
const TEST_DATABASE_USER = 'kkultong';
const TEST_DATABASE_PASSWORD = 'kkultong_test';
const POSTGRES_READY_LOG_COUNT = 2;
const HIDE_DAYS = 30;
const NOW = new Date('2026-10-09T12:00:00.000Z');
const DEFAULT_CONDITIONS: PolicyConditions = {
  age: { kind: 'ANY' },
  region: { kind: 'RULE', value: ['11'] },
  income: { kind: 'UNKNOWN' },
  status: { kind: 'ANY' },
  householdSize: { kind: 'ANY' },
};

jest.setTimeout(TEST_TIMEOUT_MS);

function dateFromToday(days: number): string {
  const date = new Date('2026-10-09T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

function createPolicy(
  id: string,
  title: string,
  overrides: DeepPartial<PolicyEntity> = {},
): DeepPartial<PolicyEntity> {
  return {
    id,
    source: null,
    externalId: null,
    title,
    agency: '청년정책과',
    category: 'HOUSING',
    benefitSummary: '월 20만 원 지원',
    benefitAmount: { kind: 'MONTHLY', amountWon: 200_000, months: 12, text: '월 20만 원' },
    conditions: DEFAULT_CONDITIONS,
    hasUnresolvedEligibilityCondition: false,
    unresolvedConditionNote: null,
    requiredDocs: [],
    applyStart: dateFromToday(-10),
    applyEnd: dateFromToday(10),
    isAlwaysOpen: false,
    officialUrl: 'https://example.go.kr/policies',
    sourceStatus: 'ACTIVE',
    isPublished: true,
    lastVerifiedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('GET /api/v1/policies PostgreSQL 통합', () => {
  let container: StartedTestContainer;
  let dataSource: DataSource;
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    // 공식 이미지의 초기화용 임시 서버와 최종 서버 로그를 모두 기다려 TCP 연결을 보장한다.
    container = await new GenericContainer('postgres:16')
      .withEnvironment({
        POSTGRES_DB: TEST_DATABASE_NAME,
        POSTGRES_USER: TEST_DATABASE_USER,
        POSTGRES_PASSWORD: TEST_DATABASE_PASSWORD,
      })
      .withExposedPorts(POSTGRES_PORT)
      .withWaitStrategy(
        Wait.forLogMessage(/database system is ready to accept connections/, POSTGRES_READY_LOG_COUNT),
      )
      .start();
    dataSource = new DataSource({
      type: 'postgres',
      url: `postgresql://${TEST_DATABASE_USER}:${TEST_DATABASE_PASSWORD}@${container.getHost()}:${container.getMappedPort(POSTGRES_PORT)}/${TEST_DATABASE_NAME}`,
      entities: [PolicyEntity, PolicySourceEntity],
      migrations: [Mvp0CorePolicy1760000000000],
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    const policyRepository = new PolicyRepository(dataSource);
    const policyQueryService = new PolicyQueryService(policyRepository, HIDE_DAYS, () => NOW);
    const testingModule = await Test.createTestingModule({
      controllers: [PoliciesController],
      providers: [{ provide: PolicyQueryService, useValue: policyQueryService }],
    }).compile();
    app = testingModule.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');

    const address = app.getHttpServer().address();

    if (address === null || typeof address === 'string') {
      throw new Error('통합 테스트 HTTP 서버 주소를 확인할 수 없습니다.');
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await dataSource.getRepository(PolicyEntity).clear();
  });

  afterAll(async () => {
    await app?.close();

    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }

    await container?.stop();
  });

  it('공개 조건을 모두 충족한 정책만 노출하고 미해결 원문은 목록에서 제외한다', async () => {
    await savePolicies(
      createPolicy('00000000-0000-4000-8000-000000000001', '공개 정책', {
        hasUnresolvedEligibilityCondition: true,
        unresolvedConditionNote: '근속 기간은 공고 원문을 확인해야 합니다.',
      }),
      createPolicy('00000000-0000-4000-8000-000000000002', '비공개 정책', { isPublished: false }),
      createPolicy('00000000-0000-4000-8000-000000000003', '종료 출처 정책', {
        sourceStatus: 'CLOSED',
      }),
      createPolicy('00000000-0000-4000-8000-000000000004', '마감 정책', {
        applyEnd: dateFromToday(-1),
      }),
      createPolicy('00000000-0000-4000-8000-000000000005', '오래된 검증 정책', {
        lastVerifiedAt: new Date('2026-09-08T23:59:59.000Z'),
      }),
    );

    const { response, body } = await getPolicies();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ page: 1, size: 20, total: 1, totalPages: 1 });
    expect(body.items).toEqual([
      expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000001',
        title: '공개 정책',
        requiresManualCheck: true,
      }),
    ]);
    expect(body.items[0]).not.toHaveProperty('manualCheckNote');
    expect(body.items[0]).not.toHaveProperty('unresolvedConditionNote');
  });

  it('page와 size를 적용하고 전체 페이지 수를 반환한다', async () => {
    await savePolicies(
      createPolicy('00000000-0000-4000-8000-000000000011', '첫 번째 정책', {
        applyEnd: dateFromToday(1),
      }),
      createPolicy('00000000-0000-4000-8000-000000000012', '두 번째 정책', {
        applyEnd: dateFromToday(2),
      }),
      createPolicy('00000000-0000-4000-8000-000000000013', '세 번째 정책', {
        applyEnd: dateFromToday(3),
      }),
    );

    const { response, body } = await getPolicies('?page=2&size=2');

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ page: 2, size: 2, total: 3, totalPages: 2 });
    expect(body.items.map((policy) => policy.title)).toEqual(['세 번째 정책']);
  });

  it('category로 공개 정책을 좁힌다', async () => {
    await savePolicies(
      createPolicy('00000000-0000-4000-8000-000000000021', '주거 정책'),
      createPolicy('00000000-0000-4000-8000-000000000022', '취업 정책', { category: 'JOB' }),
    );

    const { response, body } = await getPolicies('?category=JOB');

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ total: 1 });
    expect(body.items.map((policy) => policy.category)).toEqual(['JOB']);
  });

  it('마감일, 제목, id 순서로 항상 같은 목록 순서를 반환한다', async () => {
    await savePolicies(
      createPolicy('00000000-0000-4000-8000-000000000033', '같은 제목', {
        applyEnd: dateFromToday(1),
      }),
      createPolicy('00000000-0000-4000-8000-000000000031', '같은 제목', {
        applyEnd: dateFromToday(1),
      }),
      createPolicy('00000000-0000-4000-8000-000000000032', '가나다 정책', {
        applyEnd: dateFromToday(1),
      }),
      createPolicy('00000000-0000-4000-8000-000000000034', '늦은 마감 정책', {
        applyEnd: dateFromToday(2),
      }),
      createPolicy('00000000-0000-4000-8000-000000000035', '상시 정책', {
        applyEnd: null,
        isAlwaysOpen: true,
      }),
    );

    const { body } = await getPolicies();

    expect(body.items.map((policy) => policy.id)).toEqual([
      '00000000-0000-4000-8000-000000000032',
      '00000000-0000-4000-8000-000000000031',
      '00000000-0000-4000-8000-000000000033',
      '00000000-0000-4000-8000-000000000034',
      '00000000-0000-4000-8000-000000000035',
    ]);
  });

  it('잘못된 목록 query를 400으로 거부한다', async () => {
    const response = await fetch(`${baseUrl}/api/v1/policies?size=51`);

    expect(response.status).toBe(400);
  });

  it('공개 정책의 상세 정보와 미해결 조건 원문을 반환한다', async () => {
    const id = '00000000-0000-4000-8000-000000000041';
    await savePolicies(
      createPolicy(id, '상세 정책', {
        conditions: {
          age: { kind: 'RULE', value: { min: 19, max: 34, basis: { kind: 'TODAY' } } },
          region: { kind: 'RULE', value: ['11'] },
          income: { kind: 'UNKNOWN' },
          status: { kind: 'RULE', value: ['STUDENT'] },
          householdSize: { kind: 'ANY' },
        },
        hasUnresolvedEligibilityCondition: true,
        unresolvedConditionNote: '근속 기간은 공고 원문을 확인해야 합니다.',
        requiredDocs: ['신분증', '재학증명서'],
      }),
    );

    const { response, body } = await getPolicy(id);

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        id,
        title: '상세 정책',
        ageCondition: { kind: 'RULE', value: { min: 19, max: 34, basis: { kind: 'TODAY' } } },
        regionCondition: { kind: 'RULE', value: ['11'] },
        statusCondition: { kind: 'RULE', value: ['STUDENT'] },
        incomeCondition: { kind: 'UNKNOWN' },
        householdSizeCondition: { kind: 'ANY' },
        requiresManualCheck: true,
        manualCheckNote: '근속 기간은 공고 원문을 확인해야 합니다.',
        requiredDocs: ['신분증', '재학증명서'],
        lastVerifiedAt: '2026-10-01T00:00:00.000Z',
      }),
    );
    expect(body).not.toHaveProperty('sourceStatus');
    expect(body).not.toHaveProperty('isPublished');
  });

  it('형식이 잘못된 정책 id는 400으로 거부한다', async () => {
    const response = await fetch(`${baseUrl}/api/v1/policies/not-a-uuid`);

    expect(response.status).toBe(400);
  });

  it('존재하지 않거나 공개 조건을 충족하지 않는 정책은 모두 404로 숨긴다', async () => {
    await savePolicies(
      createPolicy('00000000-0000-4000-8000-000000000051', '비공개 정책', { isPublished: false }),
      createPolicy('00000000-0000-4000-8000-000000000052', '종료 출처 정책', {
        sourceStatus: 'CLOSED',
      }),
      createPolicy('00000000-0000-4000-8000-000000000053', '마감 정책', {
        applyEnd: dateFromToday(-1),
      }),
      createPolicy('00000000-0000-4000-8000-000000000054', '오래된 검증 정책', {
        lastVerifiedAt: new Date('2026-09-08T23:59:59.000Z'),
      }),
    );

    await expectPolicyNotFound('00000000-0000-4000-8000-000000000050');
    await expectPolicyNotFound('00000000-0000-4000-8000-000000000051');
    await expectPolicyNotFound('00000000-0000-4000-8000-000000000052');
    await expectPolicyNotFound('00000000-0000-4000-8000-000000000053');
    await expectPolicyNotFound('00000000-0000-4000-8000-000000000054');
  });

  async function savePolicies(...policies: DeepPartial<PolicyEntity>[]): Promise<void> {
    await dataSource.getRepository(PolicyEntity).save(policies);
  }

  async function getPolicies(query = ''): Promise<{ response: Response; body: PolicyListResponse }> {
    const response = await fetch(`${baseUrl}/api/v1/policies${query}`);
    const body = (await response.json()) as PolicyListResponse;

    return { response, body };
  }

  async function getPolicy(id: string): Promise<{ response: Response; body: PolicyDetail }> {
    const response = await fetch(`${baseUrl}/api/v1/policies/${id}`);
    const body = (await response.json()) as PolicyDetail;

    return { response, body };
  }

  async function expectPolicyNotFound(id: string): Promise<void> {
    const response = await fetch(`${baseUrl}/api/v1/policies/${id}`);

    expect(response.status).toBe(404);
  }
});
