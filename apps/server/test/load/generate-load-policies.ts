import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createLoadPolicies } from './create-load-policies';

async function main(): Promise<void> {
  const outputPath = process.argv[2];
  if (outputPath === undefined) {
    throw new Error('출력할 fixture JSON 경로를 첫 번째 인자로 지정해야 합니다.');
  }

  const resolvedPath = resolve(outputPath);
  const policies = createLoadPolicies(new Date());

  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(policies, null, 2)}\n`, 'utf8');
  process.stdout.write(`${policies.length}건 fixture를 생성했습니다: ${resolvedPath}\n`);
}

void main();
