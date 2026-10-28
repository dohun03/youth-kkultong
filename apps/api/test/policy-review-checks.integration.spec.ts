import 'reflect-metadata';
import { DataSource, getMetadataArgsStorage } from 'typeorm';
import type { EntityMetadata } from 'typeorm';
import { EntityMetadataBuilder } from 'typeorm/metadata-builder/EntityMetadataBuilder';
import { createDataSource } from '../src/database/data-source';
import { loadEnvironment } from '../src/common/environment';
import { Policy } from '../src/modules/policies/entities/policy.entity';
import { PolicyReview } from '../src/modules/policies/entities/policy-review.entity';
import { SourcePolicy } from '../src/modules/policies/entities/source-policy.entity';

const id = '00000000-0000-4000-8000-000000000001';
const now = '2026-10-28T12:00:00Z';
const hash = 'a'.repeat(64);
const pending = {
  id, source_policy_id: id, kind: 'NEW', status: 'PENDING', content_hash: hash,
  raw_snapshot: { plcyNo: 'sample', plcyNm: '검증 정책', nested: [null, { text: '원문' }] },
  base_policy_id: null, base_content_hash: null, base_raw_snapshot: null,
  reviewed_by: null, rejection_reason: null, superseded_reason: null, created_at: now, closed_at: null,
};
const original = {
  id, source: 'youthcenter', external_id: 'sample', title: '검증 정책', raw_json: pending.raw_snapshot,
  content_hash: hash, view_count: null, first_collected_at: null, last_collected_at: null,
  last_collection_result: null, missing_count: 0, created_at: now, updated_at: now,
};

describe('원본·검수 CHECK 정의의 PostgreSQL 판정', () => {
  let connection: DataSource;
  let sourceModel: EntityMetadata;
  let reviewModel: EntityMetadata;

  beforeAll(async () => {
    // 테이블·스키마는 생성하지 않는다. 읽기 전용 SELECT로 실제 PostgreSQL의 NULL·정규식 판정을 확인한다.
    connection = createDataSource(loadEnvironment()).setOptions({ entities: [], migrations: [],
      extra: { options: '-c timezone=Asia/Seoul -c default_transaction_read_only=on' },
    });
    await connection.initialize();
    const definitions = new EntityMetadataBuilder(connection, getMetadataArgsStorage()).build([Policy, SourcePolicy, PolicyReview]);
    sourceModel = definitions.find(({ target }) => target === SourcePolicy)!;
    reviewModel = definitions.find(({ target }) => target === PolicyReview)!;
  });

  afterAll(async () => { if (connection?.isInitialized) await connection.destroy(); });

  /** 엔티티의 필수 컬럼·CHECK 식을 그대로 읽어 실제 PostgreSQL에서 한 행의 허용 여부를 평가한다. */
  async function accepts(model: EntityMetadata, values: Record<string, unknown>): Promise<boolean> {
    // 이름·자료형은 내부 메타데이터에서만 가져오고, 검증할 행은 JSON 매개변수 하나로 바인딩한다.
    const columns = model.columns.map(({ databaseName, type }) => {
      // ORM에 넘기는 null은 SQL NULL이다. JSONB 'null'로 바꾸면 신규의 빈 기준본을 잘못 판정한다.
      const value = type === 'jsonb' ? `NULLIF(input.value -> '${databaseName}', 'null'::jsonb)`
        : `(input.value ->> '${databaseName}')::${['varchar', 'char', 'text'].includes(String(type)) ? 'text' : type}`;
      return `${value} AS "${databaseName}"`;
    });
    const requirements = [
      ...model.columns.filter(({ isNullable }) => !isNullable).map(({ databaseName }) => `"${databaseName}" IS NOT NULL`),
      // PostgreSQL CHECK는 FALSE만 거부한다. 이 동작으로 검증해야 필수값의 NULL 누락을 발견할 수 있다.
      ...model.checks.map(({ expression }) => `(${expression}) IS NOT FALSE`),
    ];
    const rows: { valid: boolean }[] = await connection.query(`
      SELECT ${requirements.map((rule) => `(${rule})`).join(' AND ')} AS valid
      FROM (SELECT ${columns.join(', ')} FROM (SELECT $1::jsonb AS value) input) candidate
    `, [JSON.stringify(values)]);
    return rows[0].valid;
  }

  it('검증 연결 자체가 읽기 전용이다', async () => {
    expect(await connection.query('SHOW default_transaction_read_only')).toEqual([{ default_transaction_read_only: 'on' }]);
  });

  it('이관 원본의 NULL 수집 시각과 0회 누락을 허용한다', async () => {
    expect(await accepts(sourceModel, original)).toBe(true);
  });

  it.each(['NEW', 'CHANGED', 'UNCHANGED', 'MISSING'])('수집 결과 %s와 정수 경계값을 허용한다', async (result) => {
    expect(await accepts(sourceModel, { ...original, last_collection_result: result, view_count: 0, missing_count: 2147483647 })).toBe(true);
  });

  it.each([
    { source: '' }, { source: ' \t\n' }, { external_id: '' }, { title: ' \n ' },
    { raw_json: [] }, { raw_json: null }, { raw_json: '원본 아님' },
    { content_hash: 'A'.repeat(64) }, { content_hash: 'a'.repeat(63) }, { content_hash: null },
    { view_count: -1 }, { missing_count: -1 }, { missing_count: null }, { last_collection_result: 'PENDING' },
  ])('원본의 잘못된 값은 허용하지 않는다: %j', async (changes) => {
    expect(await accepts(sourceModel, { ...original, ...changes })).toBe(false);
  });

  it.each([
    {},
    { status: 'APPROVED', reviewed_by: 'admin', closed_at: now },
    { status: 'REJECTED', reviewed_by: 'admin', rejection_reason: '확인한 사유', closed_at: now },
    { status: 'SUPERSEDED', superseded_reason: 'SOURCE_CHANGED', closed_at: now },
  ])('상태별 정상 처리 정보를 허용한다: %j', async (changes) => {
    expect(await accepts(reviewModel, { ...pending, ...changes })).toBe(true);
  });

  it.each(['SOURCE_CHANGED', 'PUBLIC_BASE_CHANGED', 'MATCHES_PUBLIC', 'PREVIOUSLY_REJECTED'])(
    '정의된 대체 이유 %s를 허용한다', async (reason) => {
      expect(await accepts(reviewModel, { ...pending, status: 'SUPERSEDED', superseded_reason: reason, closed_at: now })).toBe(true);
    },
  );

  it('변경 후보는 기준 ID·해시·객체를 모두 갖춰야 한다', async () => {
    const changed = { ...pending, kind: 'CHANGED', base_policy_id: id, base_content_hash: hash, base_raw_snapshot: { plcyNm: '기준 정책' } };
    expect(await accepts(reviewModel, changed)).toBe(true);
    for (const field of ['base_policy_id', 'base_content_hash', 'base_raw_snapshot']) {
      expect(await accepts(reviewModel, { ...changed, [field]: null })).toBe(false);
      expect(await accepts(reviewModel, { ...pending, [field]: changed[field as keyof typeof changed] })).toBe(false);
    }
  });

  it.each([
    { base_content_hash: 'A'.repeat(64) }, { base_content_hash: 'a'.repeat(63) },
    { base_raw_snapshot: [] }, { base_raw_snapshot: '문자열' }, { base_raw_snapshot: null },
  ])('변경 후보의 기준 해시·스냅샷 형식도 검사한다: %j', async (changes) => {
    expect(await accepts(reviewModel, {
      ...pending, kind: 'CHANGED', base_policy_id: id,
      base_content_hash: hash, base_raw_snapshot: { plcyNm: '기준 정책' }, ...changes,
    })).toBe(false);
  });

  it.each([
    { kind: 'UNCHANGED' }, { status: 'PROCESSED' },
    { raw_snapshot: null }, { raw_snapshot: [] }, { raw_snapshot: '문자열' },
    { content_hash: 'g'.repeat(64) }, { base_content_hash: 'A'.repeat(64) }, { base_raw_snapshot: [] },
    { reviewed_by: 'admin' }, { rejection_reason: '사유' }, { superseded_reason: 'SOURCE_CHANGED' }, { closed_at: now },
    { status: 'APPROVED', closed_at: now }, { status: 'APPROVED', reviewed_by: 'admin' },
    { status: 'APPROVED', reviewed_by: 'admin', closed_at: now, rejection_reason: '사유' },
    { status: 'REJECTED', closed_at: now, rejection_reason: '사유' },
    { status: 'REJECTED', reviewed_by: 'admin', rejection_reason: '사유' },
    { status: 'REJECTED', reviewed_by: 'admin', closed_at: now },
    { status: 'REJECTED', reviewed_by: 'admin', closed_at: now, rejection_reason: ' \n\t' },
    { status: 'REJECTED', reviewed_by: 'admin', closed_at: now, rejection_reason: '사유', superseded_reason: 'SOURCE_CHANGED' },
    { status: 'SUPERSEDED', closed_at: now },
    { status: 'SUPERSEDED', superseded_reason: 'SOURCE_CHANGED' },
    { status: 'SUPERSEDED', superseded_reason: '다른 이유', closed_at: now },
    { status: 'SUPERSEDED', superseded_reason: 'SOURCE_CHANGED', closed_at: now, reviewed_by: 'admin' },
    { status: 'SUPERSEDED', superseded_reason: 'SOURCE_CHANGED', closed_at: now, rejection_reason: '사유' },
  ])('잘못된 상태·누락된 필수값·섞인 처리 정보는 허용하지 않는다: %j', async (changes) => {
    expect(await accepts(reviewModel, { ...pending, ...changes })).toBe(false);
  });
});
