import { createHash } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { loadEnvironment } from '../../common/environment';
import { Region } from '../../modules/meta/entities/region.entity';
import { createDataSource } from '../data-source';
import snapshot from './regions.json';

const regionSchema = z.object({
  code: z.string().regex(/^[0-9]{5}$/),
  name: z.string().trim().min(1).max(100),
  provinceName: z.string().trim().min(1).max(100),
  parentCode: z.string().regex(/^[0-9]{5}$/).nullable(),
  isActive: z.boolean(),
}).strict();

/** DB에 쓰기 전에 코드·현행 명칭 중복과 명시된 부모 관계를 검증한다. */
export function validateRegions(input: unknown): z.infer<typeof regionSchema>[] {
  const result = z.array(regionSchema).min(1).safeParse(input);
  if (!result.success) {
    throw new Error(`지역 자료 형식 오류: ${result.error.issues.map(issue => issue.path.join('.')).join(', ')}`);
  }
  const rows = result.data;
  const byCode = new Map<string, typeof rows[number]>();
  const activeNames = new Set<string>();
  for (const row of rows) {
    if (byCode.has(row.code)) throw new Error(`지역 코드 중복: ${row.code}`);
    // 공식 과거 자료에는 서로 다른 코드의 같은 지역명이 있으므로 현행 이름만 중복 검사한다.
    if (row.isActive && activeNames.has(row.name)) throw new Error(`현행 지역명 중복: ${row.name}`);
    byCode.set(row.code, row);
    if (row.isActive) activeNames.add(row.name);
  }
  for (const row of rows) {
    if (row.parentCode === null) {
      if (row.name !== row.provinceName) throw new Error(`상위 지역 누락: ${row.code}`);
      continue;
    }
    const parent = byCode.get(row.parentCode);
    if (!parent || parent.code === row.code) throw new Error(`상위 지역 참조 오류: ${row.code}`);
    // 공식 명칭의 직접 상위와 일치해야 한다. 코드 문자열의 앞자리는 비교하지 않는다.
    const parentName = row.name.slice(0, row.name.lastIndexOf(' '));
    if (parent.name !== parentName || parent.provinceName !== row.provinceName) {
      throw new Error(`상위 지역 명칭·시도 불일치: ${row.code}`);
    }
  }
  return rows;
}

/** 한 트랜잭션의 묶음 upsert로 재실행 중복을 막고 기존 역사 자료는 삭제하지 않는다. */
export async function seedRegions(dataSource: DataSource, input: unknown): Promise<number> {
  const rows = validateRegions(input);
  await dataSource.transaction(async manager => {
    await manager.getRepository(Region).upsert(rows, {
      conflictPaths: ['code'], skipUpdateIfNoValuesChanged: true,
    });
  });
  return rows.length;
}

async function bootstrap(): Promise<void> {
  let dataSource: DataSource | undefined;
  let stage = '환경변수 검증';
  try {
    const environment = loadEnvironment();
    stage = '지역 자료 검증';
    const hash = createHash('sha256').update(JSON.stringify(snapshot.regions)).digest('hex');
    if (hash !== snapshot.source.regionsSha256) throw new Error('공식 지역 스냅샷 해시 불일치');
    const rows = validateRegions(snapshot.regions);
    stage = 'DB 연결';
    dataSource = createDataSource(environment);
    await dataSource.initialize();
    stage = '지역 저장';
    const count = await seedRegions(dataSource, rows);
    console.log(`공식 지역 시드 완료: ${count}개 (자료 시행일 ${snapshot.source.effectiveDate}, 검증일 ${snapshot.source.verifiedOn})`);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    const reason = typeof code === 'string' && /^[A-Z0-9_]{5,20}$/.test(code) ? ` (${code})` : '';
    const message = stage.endsWith('검증') && error instanceof Error
      ? error.message : 'DATABASE_URL, DB 준비 상태와 Migration 적용 여부를 확인하세요.';
    console.error(`공식 지역 시드 실패 [${stage}]${reason}: ${message}`);
    process.exitCode = 1;
  } finally {
    if (dataSource?.isInitialized) {
      try { await dataSource.destroy(); }
      catch { console.error('공식 지역 시드 DB 연결 정리에 실패했습니다.'); process.exitCode = 1; }
    }
  }
}

if (require.main === module) void bootstrap();
