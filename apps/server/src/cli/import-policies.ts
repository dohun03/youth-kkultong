import { readFile } from 'node:fs/promises';
import { PolicyImportArraySchema, type PolicyImportInput } from '@kkultong/contracts';
import { ZodError } from 'zod';
import {
  type ImportSummary,
  PolicyWriteError,
  PolicyWriteService,
} from '../modules/policies/services/policy-write.service';
import type { PolicyImportModule } from './policy-import.module';

const FILE_OPTION = '--file';
const DRY_RUN_OPTION = '--dry-run';
const SUCCESS_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;

interface ParsedArguments {
  filePath: string;
  dryRun: boolean;
}

interface CliErrorDetails {
  index?: number;
  externalId?: string;
  field?: string;
  reason: string;
}

class PolicyImportCliError extends Error {
  public constructor(public readonly details: CliErrorDetails) {
    super(details.reason);
    this.name = 'PolicyImportCliError';
  }
}

export interface PolicyImportCliDependencies {
  readPolicyFile: (filePath: string) => Promise<string>;
  importManualBatch: (
    policies: PolicyImportInput[],
    options: { dryRun: boolean },
  ) => Promise<ImportSummary>;
  writeStandardOutput: (message: string) => void;
  writeStandardError: (message: string) => void;
}

/** 정책 JSON 파일을 검증하고 저장한 뒤, CLI 종료 코드를 반환한다. */
export async function runPolicyImportCli(
  argumentsList: string[],
  dependencies: PolicyImportCliDependencies,
): Promise<number> {
  try {
    const argumentsValue = parseArguments(argumentsList);
    const policies = await readAndValidatePolicies(argumentsValue.filePath, dependencies.readPolicyFile);
    const summary = await dependencies.importManualBatch(policies, { dryRun: argumentsValue.dryRun });

    dependencies.writeStandardOutput(formatSuccessOutput(argumentsValue, summary));
    return SUCCESS_EXIT_CODE;
  } catch (error) {
    dependencies.writeStandardError(formatFailureOutput(error));
    return FAILURE_EXIT_CODE;
  }
}

/** 실제 CLI 실행에 필요한 DB 연결과 종료 처리를 구성한다. */
export async function executePolicyImportCli(argumentsList: string[]): Promise<number> {
  let importModule: PolicyImportModule | undefined;

  try {
    return await runPolicyImportCli(argumentsList, {
      readPolicyFile: (filePath) => readFile(filePath, 'utf8'),
      importManualBatch: async (policies, options) => {
        // 파일과 스키마 검증이 끝난 뒤에만 DB 연결을 열어 잘못된 입력에서 불필요한 연결을 피한다.
        const { createPolicyImportModule } = await import('./policy-import.module');
        importModule = await createPolicyImportModule();

        return importModule.policyWriteService.importManualBatch(policies, options);
      },
      writeStandardOutput: (message) => process.stdout.write(message),
      writeStandardError: (message) => process.stderr.write(message),
    });
  } finally {
    // 성공·실패와 관계없이 TypeORM 연결을 닫아 CLI 프로세스가 안전하게 종료되도록 한다.
    if (importModule !== undefined) {
      await importModule.close();
    }
  }
}

/** `--file <path>`, `--dry-run`만 허용해 실행 의도를 명확히 한다. */
function parseArguments(argumentsList: string[]): ParsedArguments {
  let filePath: string | undefined;
  let dryRun = false;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];

    if (argument === FILE_OPTION) {
      const value = argumentsList[index + 1];

      if (filePath !== undefined || value === undefined || value.startsWith('--')) {
        throw new PolicyImportCliError({
          field: FILE_OPTION,
          reason: `${FILE_OPTION} 옵션에는 정책 JSON 파일 경로를 한 번만 입력해야 합니다.`,
        });
      }

      filePath = value;
      index += 1;
      continue;
    }

    if (argument === DRY_RUN_OPTION && !dryRun) {
      dryRun = true;
      continue;
    }

    throw new PolicyImportCliError({
      field: argument,
      reason: `지원하지 않거나 중복된 옵션입니다: ${argument}`,
    });
  }

  if (filePath === undefined) {
    throw new PolicyImportCliError({
      field: FILE_OPTION,
      reason: `${FILE_OPTION} 옵션은 필수입니다.`,
    });
  }

  return { filePath, dryRun };
}

/** 파일을 UTF-8로 읽고 JSON 및 전체 정책 배열 스키마를 검증한다. */
async function readAndValidatePolicies(
  filePath: string,
  readPolicyFile: PolicyImportCliDependencies['readPolicyFile'],
): Promise<PolicyImportInput[]> {
  let rawContent: string;

  try {
    rawContent = await readPolicyFile(filePath);
  } catch {
    throw new PolicyImportCliError({
      field: 'file',
      reason: `정책 JSON 파일을 읽을 수 없습니다: ${filePath}`,
    });
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(rawContent);
  } catch {
    throw new PolicyImportCliError({
      field: 'file',
      reason: '정책 JSON 파일의 형식이 올바르지 않습니다.',
    });
  }

  const parsedPolicies = PolicyImportArraySchema.safeParse(parsedJson);

  if (!parsedPolicies.success) {
    throw toSchemaCliError(parsedPolicies.error, parsedJson);
  }

  return parsedPolicies.data;
}

/** Zod 오류의 첫 위치를 CLI에서 읽기 쉬운 오류 정보로 변환한다. */
function toSchemaCliError(error: ZodError, rawValue: unknown): PolicyImportCliError {
  const issue = error.issues[0];

  if (issue === undefined) {
    return new PolicyImportCliError({ reason: '정책 JSON 검증에 실패했습니다.' });
  }

  const [firstPathSegment, ...fieldPath] = issue.path;
  const index = typeof firstPathSegment === 'number' ? firstPathSegment : undefined;
  const rawPolicy = index !== undefined && Array.isArray(rawValue) ? rawValue[index] : undefined;
  const externalId = getExternalId(rawPolicy);

  return new PolicyImportCliError({
    index,
    externalId,
    field: fieldPath.length > 0 ? fieldPath.join('.') : undefined,
    reason: issue.message,
  });
}

/** 원본 JSON에서 오류 정책의 externalId가 문자열일 때만 출력에 사용한다. */
function getExternalId(value: unknown): string | undefined {
  if (
    typeof value === 'object' &&
    value !== null &&
    'externalId' in value &&
    typeof value.externalId === 'string'
  ) {
    return value.externalId;
  }

  return undefined;
}

/** 성공 모드에 맞는 정책 저장 결과 요약을 출력한다. */
function formatSuccessOutput(argumentsValue: ParsedArguments, summary: ImportSummary): string {
  if (argumentsValue.dryRun) {
    return [
      'Policy validation succeeded.',
      '',
      'Mode: DRY RUN',
      '',
      formatCount('Total:', summary.total),
      formatCount('Would create:', summary.created),
      formatCount('Would update:', summary.updated),
      formatCount('Unchanged:', summary.unchanged),
      '',
      'No database changes were committed.',
      '',
    ].join('\n');
  }

  return [
    'Policy import succeeded.',
    '',
    `File:      ${argumentsValue.filePath}`,
    'Mode:      WRITE',
    '',
    formatCount('Total:', summary.total),
    formatCount('Created:', summary.created),
    formatCount('Updated:', summary.updated),
    formatCount('Unchanged:', summary.unchanged),
    '',
  ].join('\n');
}

/** 결과 숫자를 같은 열에 맞춰 사람이 빠르게 비교할 수 있게 한다. */
function formatCount(label: string, value: number): string {
  return `${label.padEnd(14)}${value}`;
}

/** CLI·스키마·저장 서비스 오류를 규격화된 실패 출력으로 만든다. */
function formatFailureOutput(error: unknown): string {
  const details = getErrorDetails(error);
  const lines = ['Policy import failed.', ''];

  if (details.index !== undefined) {
    lines.push(`Index: ${details.index}`);
  }

  if (details.externalId !== undefined) {
    lines.push(`externalId: ${details.externalId}`);
  }

  if (details.field !== undefined) {
    lines.push(`Field: ${details.field}`);
  }

  lines.push(`Reason: ${details.reason}`, '', 'No policies were saved.', '');
  return lines.join('\n');
}

/** 서비스 오류와 CLI 오류에서 안전한 진단 정보만 꺼낸다. */
function getErrorDetails(error: unknown): CliErrorDetails {
  if (error instanceof PolicyImportCliError || error instanceof PolicyWriteError) {
    return error.details;
  }

  return {
    reason: error instanceof Error ? error.message : '정책 import 중 알 수 없는 오류가 발생했습니다.',
  };
}

if (require.main === module) {
  executePolicyImportCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      process.stderr.write(formatFailureOutput(error));
      process.exitCode = FAILURE_EXIT_CODE;
    });
}
