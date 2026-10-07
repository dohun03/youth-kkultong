import type { PolicyImportInput } from '@kkultong/contracts';
import { PolicyWriteError } from '../modules/policies/services/policy-write.service';
import { runPolicyImportCli, type PolicyImportCliDependencies } from './import-policies';

const VALID_POLICY: PolicyImportInput = {
  externalId: '2026-youth-housing',
  title: '청년 주거 지원',
  agency: '청년정책과',
  category: 'HOUSING',
  benefitSummary: '월 20만 원 지원',
  benefitAmount: { kind: 'MONTHLY', amountWon: 200_000, months: 12, text: '월 20만 원' },
  conditions: {
    age: { kind: 'ANY' },
    region: { kind: 'RULE', value: ['11'] },
    income: { kind: 'UNKNOWN' },
    status: { kind: 'ANY' },
    householdSize: { kind: 'ANY' },
  },
  hasUnresolvedEligibilityCondition: false,
  unresolvedConditionNote: null,
  requiredDocs: ['신분증'],
  applyStart: '2026-01-01',
  applyEnd: '2026-12-31',
  isAlwaysOpen: false,
  officialUrl: 'https://example.com/policies/2026-youth-housing',
  lastVerifiedAt: '2026-01-01T00:00:00.000Z',
  isPublished: false,
};

function createDependencies(overrides: Partial<PolicyImportCliDependencies> = {}) {
  const standardOutput: string[] = [];
  const standardError: string[] = [];
  const dependencies: PolicyImportCliDependencies = {
    readPolicyFile: jest.fn(async () => JSON.stringify([VALID_POLICY])),
    importManualBatch: jest.fn(async () => ({ total: 1, created: 1, updated: 0, unchanged: 0 })),
    writeStandardOutput: (message) => standardOutput.push(message),
    writeStandardError: (message) => standardError.push(message),
    ...overrides,
  };

  return { dependencies, standardOutput, standardError };
}

describe('runPolicyImportCli', () => {
  it('정상 파일을 쓰기 모드로 저장하고 요약과 성공 종료 코드를 반환한다', async () => {
    const { dependencies, standardOutput, standardError } = createDependencies();

    const exitCode = await runPolicyImportCli(['--file', 'data/policies/policies.json'], dependencies);

    expect(exitCode).toBe(0);
    expect(dependencies.importManualBatch).toHaveBeenCalledWith([VALID_POLICY], { dryRun: false });
    expect(standardOutput.join('')).toContain('Policy import succeeded.');
    expect(standardOutput.join('')).toContain('File:      data/policies/policies.json');
    expect(standardOutput.join('')).toContain('Created:');
    expect(standardError).toEqual([]);
  });

  it('dry-run은 같은 저장 경로에 dryRun 옵션을 전달하고 검증 요약을 출력한다', async () => {
    const { dependencies, standardOutput } = createDependencies({
      importManualBatch: jest.fn(async () => ({ total: 1, created: 0, updated: 1, unchanged: 0 })),
    });

    const exitCode = await runPolicyImportCli(['--dry-run', '--file', 'policies.json'], dependencies);

    expect(exitCode).toBe(0);
    expect(dependencies.importManualBatch).toHaveBeenCalledWith([VALID_POLICY], { dryRun: true });
    expect(standardOutput.join('')).toContain('Mode: DRY RUN');
    expect(standardOutput.join('')).toContain('Would update:');
    expect(standardOutput.join('')).toContain('No database changes were committed.');
  });

  it('필수 파일 인자가 없으면 파일을 읽거나 DB 저장을 시도하지 않는다', async () => {
    const { dependencies, standardError } = createDependencies();

    const exitCode = await runPolicyImportCli(['--dry-run'], dependencies);

    expect(exitCode).toBe(1);
    expect(dependencies.readPolicyFile).not.toHaveBeenCalled();
    expect(dependencies.importManualBatch).not.toHaveBeenCalled();
    expect(standardError.join('')).toContain('--file 옵션은 필수입니다.');
  });

  it('잘못된 JSON은 저장 전에 위치 없는 오류로 종료한다', async () => {
    const { dependencies, standardError } = createDependencies({
      readPolicyFile: jest.fn(async () => '{'),
    });

    const exitCode = await runPolicyImportCli(['--file', 'invalid.json'], dependencies);

    expect(exitCode).toBe(1);
    expect(dependencies.importManualBatch).not.toHaveBeenCalled();
    expect(standardError.join('')).toContain('정책 JSON 파일의 형식이 올바르지 않습니다.');
  });

  it('스키마 오류는 정책 index와 externalId를 함께 출력하고 저장하지 않는다', async () => {
    const invalidPolicy = { ...VALID_POLICY, title: '' };
    const { dependencies, standardError } = createDependencies({
      readPolicyFile: jest.fn(async () => JSON.stringify([invalidPolicy])),
    });

    const exitCode = await runPolicyImportCli(['--file', 'invalid-schema.json'], dependencies);

    expect(exitCode).toBe(1);
    expect(dependencies.importManualBatch).not.toHaveBeenCalled();
    expect(standardError.join('')).toContain('Index: 0');
    expect(standardError.join('')).toContain(`externalId: ${VALID_POLICY.externalId}`);
    expect(standardError.join('')).toContain('Field: title');
  });

  it('저장 서비스 오류의 정책 위치를 유지하고 실패 종료 코드를 반환한다', async () => {
    const { dependencies, standardError } = createDependencies({
      importManualBatch: jest.fn(async () => {
        throw new PolicyWriteError('REGION_NOT_FOUND', {
          index: 0,
          externalId: VALID_POLICY.externalId,
          field: 'conditions.region.value.0',
          reason: '지역 코드 "99999"가 존재하지 않습니다.',
        });
      }),
    });

    const exitCode = await runPolicyImportCli(['--file', 'invalid-region.json'], dependencies);

    expect(exitCode).toBe(1);
    expect(standardError.join('')).toContain('Field: conditions.region.value.0');
    expect(standardError.join('')).toContain('No policies were saved.');
  });
});
