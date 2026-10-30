import { parsePolicyCategories } from '@youth-kkultong/shared';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { Policy } from '../entities/policy.entity';
import type { PolicyRefreshInput, PolicyWriteInput } from '../services/policies-write.service';

/** 목록 카드·신청 상태·자격 판정·정렬에 필요한 값만 담는 서버 내부 자료형 */
export type PolicyCandidate = Pick<Policy,
  'id' | 'externalId' | 'title' | 'category' | 'subcategory' | 'viewCount' | 'sourceRegisteredAt'
  | 'applicationPeriodCode' | 'applicationPeriodRaw' | 'applicationStartDate' | 'applicationEndDate'
  | 'ageMin' | 'ageMax' | 'jobCodes' | 'schoolCodes' | 'regionCodes'
> & {
  benefitPreview: string | null;
  descriptionPreview: string | null;
  hasExtraText: boolean;
};

/** 수집 후 공개 정책의 조회수 갱신에 필요한 식별자와 최신 조회수 */
export type PolicyViewCountInput = Pick<Policy, 'source' | 'externalId' | 'viewCount'>;

/** 공개 정책 조회와 본문 저장, 조회수 갱신을 담당하는 저장소 */
@Injectable()
export class PolicyRepository {
  /** 전체 정책 목록 조회 (경량) */
  async findCandidates(manager: EntityManager): Promise<PolicyCandidate[]> {
    const columns = [
      'id', 'externalId', 'title', 'category', 'subcategory', 'viewCount', 'sourceRegisteredAt',
      'applicationPeriodCode', 'applicationPeriodRaw',
      'ageMin', 'ageMax', 'jobCodes', 'schoolCodes', 'regionCodes',
    ] as const;
    const query = manager.getRepository(Policy).createQueryBuilder('policy');

    // 필요한 컬럼만 선택
    query.select([]);
    for (const column of columns) query.addSelect(`policy.${column}`, column);

    // 지원 본문·정책 소개는 DB에서 앞 200자만 가져오고, 추가 자격·제한 설명은 존재 여부만 확인
    // NULL·빈 문자열·공백뿐인 설명은 추가 조건으로 보지 않음
    return query
      // 원시 조회를 사용해서 DB에서 날짜 문자열로 명시. (JS의 지저분한 DATE 변환을 거치지 않게 조회)
      .addSelect(`TO_CHAR(policy.applicationStartDate, 'YYYY-MM-DD')`, 'applicationStartDate')
      .addSelect(`TO_CHAR(policy.applicationEndDate, 'YYYY-MM-DD')`, 'applicationEndDate')
      .addSelect('LEFT(policy.benefitText, 200)', 'benefitPreview')
      .addSelect('LEFT(policy.description, 200)', 'descriptionPreview')
      .addSelect(`COALESCE(policy.extraQualification ~ '[^[:space:]]', false)
        OR COALESCE(policy.participationRestriction ~ '[^[:space:]]', false)`, 'hasExtraText')
      .getRawMany<PolicyCandidate>();
  }

  /** 상세 정책 조회 */
  async findById(manager: EntityManager, id: string): Promise<Policy | null> {
    return manager.getRepository(Policy).findOneBy({ id });
  }

  /** 정책의 카테고리 고유값 조회. (NULL·공백 값은 제외) */
  async findCategories(manager: EntityManager): Promise<string[]> {
    const rows = await manager.getRepository(Policy).createQueryBuilder('policy')
      .select('policy.category', 'category')
      .distinct(true)
      .where(`policy.category ~ '[^[:space:]]'`)
      .orderBy('policy.category', 'ASC')
      .getRawMany<{ category: string }>();

    // 원문은 DB에 보존하고 선택지에서만 복수 분야를 펼쳐 중복을 제거한다.
    return [...new Set(rows.flatMap(({ category }) => parsePolicyCategories(category)))].sort((a, b) => a.localeCompare(b, 'ko'));
  }

  /** 정책 해시 조회 */
  async findContentHashes(
    manager: EntityManager,
    keys: readonly Pick<Policy, 'source' | 'externalId'>[],
  ): Promise<Pick<Policy, 'source' | 'externalId' | 'contentHash'>[]> {
    if (keys.length === 0) return [];

    // 변경 여부 비교에 필요한 출처·외부 ID·해시만 가져오기
    return manager.getRepository(Policy).find({
      select: { source: true, externalId: true, contentHash: true },
      where: keys.map(({ source, externalId }) => ({ source, externalId })),
    });
  }

  /** 승인된 정책을 신규 추가하거나 지정한 공개 UUID의 본문을 갱신 */
  async saveApprovedPolicy(manager: EntityManager, policy: PolicyWriteInput, basePolicyId: string | null): Promise<void> {
    this.requireTransaction(manager);
    this.requireViewCount(policy.viewCount);
    const query = manager.getRepository(Policy).createQueryBuilder();

    // 시간대 없는 원본 시각과 JSON 원문을 매개변수로 전달
    query.setParameters({ registered: policy.sourceRegisteredAt, modified: policy.sourceModifiedAt,
      raw: JSON.stringify(policy.rawJson) });

    // 공개 본문에 저장할 컬럼을 명시해 기존 정책의 식별자와 생성 시각을 보존
    const values = {
      title: policy.title, category: policy.category, subcategory: policy.subcategory,
      description: policy.description, benefitText: policy.benefitText,
      applyUrl: policy.applyUrl, referenceUrl1: policy.referenceUrl1, referenceUrl2: policy.referenceUrl2,
      viewCount: policy.viewCount,
      sourceRegisteredAt: () => 'CAST(:registered AS timestamp)',
      sourceModifiedAt: () => 'CAST(:modified AS timestamp)',
      applicationPeriodCode: policy.applicationPeriodCode, applicationPeriodRaw: policy.applicationPeriodRaw,
      applicationStartDate: policy.applicationStartDate, applicationEndDate: policy.applicationEndDate,
      ageMin: policy.ageMin, ageMax: policy.ageMax,
      jobCodes: policy.jobCodes, schoolCodes: policy.schoolCodes, regionCodes: policy.regionCodes,
      extraQualification: policy.extraQualification, participationRestriction: policy.participationRestriction,
      rawJson: () => 'CAST(:raw AS jsonb)', contentHash: policy.contentHash,
      updatedAt: () => 'CURRENT_TIMESTAMP',
    };

    if (basePolicyId === null) {
      // 최초 승인은 새 공개 UUID를 생성하고 출처와 외부 ID를 함께 저장
      await query.insert().values({ ...values, source: policy.source, externalId: policy.externalId })
        .updateEntity(false).execute();
      return;
    }

    // 기존 승인은 검수 기준 UUID와 출처, 외부 ID가 모두 같은 공개 행을 갱신
    const result = await query.update().set(values)
      .where({ id: basePolicyId, source: policy.source, externalId: policy.externalId }).execute();
    if (result.affected !== 1) throw new Error('승인 내용을 반영할 공개 기준 정책을 찾을 수 없습니다.');
  }

  /** 전달받은 묶음의 공개 조회수와 DB 반영 시각을 갱신하고 반영 행 수를 반환 */
  async refreshViewCounts(manager: EntityManager, policies: readonly PolicyViewCountInput[]): Promise<number> {
    this.requireTransaction(manager);
    if (policies.length === 0) return 0;

    // 같은 공개 정책에 서로 다른 조회수가 적용되는 일을 막기 위해 중복 식별자를 확인
    const keys = policies.map(({ source, externalId }) => JSON.stringify([source, externalId]));
    if (new Set(keys).size !== keys.length) throw new Error('조회수를 갱신할 정책 식별자가 중복되었습니다.');
    for (const policy of policies) this.requireViewCount(policy.viewCount);

    // 갱신할 세 필드만 전달하고 공개 행이 있는 정책을 출처와 외부 ID로 연결
    const incoming = policies.map(({ source, externalId, viewCount }) => ({ source, externalId, viewCount }));
    // PostgreSQL UPDATE 결과는 TypeORM에서 [행 목록, 반영 건수]로 반환
    const [, updatedCount]: [unknown[], number] = await manager.sql`
      UPDATE ${() => this.tableName(manager)} AS policy
      SET view_count = incoming."viewCount", updated_at = CURRENT_TIMESTAMP
      FROM jsonb_to_recordset(${JSON.stringify(incoming)}::jsonb)
        AS incoming(source text, "externalId" text, "viewCount" integer)
      WHERE policy.source = incoming.source AND policy.external_id = incoming."externalId"
    `;
    return updatedCount;
  }

  /** 신규 정책 추가, 변경 정책 갱신 */
  async upsertPolicies(manager: EntityManager, policies: readonly PolicyWriteInput[]): Promise<void> {
    if (policies.length === 0) return;

    const repository = manager.getRepository(Policy);
    const query = repository.createQueryBuilder().insert();
    const rows = policies.map((policy, index) => {
      const registered = `registered${index}`;
      const modified = `modified${index}`;
      const raw = `raw${index}`;

      // 원본 시각은 Date 변환 없이 전달하고 JSON도 매개변수로 바인딩
      query.setParameters({
        [registered]: policy.sourceRegisteredAt,
        [modified]: policy.sourceModifiedAt,
        [raw]: JSON.stringify(policy.rawJson),
      });

      return {
        ...policy,
        sourceRegisteredAt: () => `CAST(:${registered} AS timestamp)`,
        sourceModifiedAt: () => `CAST(:${modified} AS timestamp)`,
        rawJson: () => `CAST(:${raw} AS jsonb)`,
      };
    });

    // 기존 정책의 ID·출처·외부 ID·최초 저장일은 유지
    const updates = repository.metadata.columns
      .filter((column) => !column.isGenerated && !column.isCreateDate && !column.isUpdateDate
        && !['source', 'externalId'].includes(column.propertyName))
      .map((column) => column.databaseName);

    // SQL 생성·컬럼 이름 처리·매개변수 번호 지정은 TypeORM에 맡김
    await query.values(rows).orUpdate(updates, ['source', 'external_id']).updateEntity(false).execute();
  }

  /** 내용이 같은 정책들의 원본 JSON·조회수·마지막 반영일만 한 번에 갱신 */
  async refreshPolicies(manager: EntityManager, policies: readonly PolicyRefreshInput[]): Promise<void> {
    if (policies.length === 0) return;

    // JSON 배열을 DB에서 행 목록으로 바꿔 서로 다른 원본·조회수를 한 번에 갱신
    // 테이블명은 내부 정의에서 가져오고, 정책 값은 sql 태그가 자동으로 바인딩
    await manager.sql`
      UPDATE ${() => this.tableName(manager)} AS policy
      SET raw_json = incoming."rawJson", view_count = incoming."viewCount", updated_at = CURRENT_TIMESTAMP
      FROM jsonb_to_recordset(${JSON.stringify(policies)}::jsonb)
        AS incoming(source text, "externalId" text, "rawJson" jsonb, "viewCount" integer)
      WHERE policy.source = incoming.source AND policy.external_id = incoming."externalId"
    `;
  }

  /** 조회수가 NULL 또는 PostgreSQL 정수 범위의 0 이상 값인지 확인 */
  private requireViewCount(viewCount: number | null): void {
    if (viewCount !== null && (!Number.isInteger(viewCount) || viewCount < 0 || viewCount > 2147483647)) {
      throw new Error('공개 조회수는 NULL 또는 0 이상 2147483647 이하의 정수여야 합니다.');
    }
  }

  /** 공개 본문 저장과 조회수 갱신에 사용할 트랜잭션 상태를 확인 */
  private requireTransaction(manager: EntityManager): void {
    if (!manager.queryRunner?.isTransactionActive) {
      throw new Error('공개 정책 저장과 조회수 갱신에는 진행 중인 트랜잭션 관리자가 필요합니다.');
    }
  }

  /** 현재 연결에서 사용하는 정책 테이블의 스키마·이름 가져오기 */
  private tableName(manager: EntityManager): string {
    const { schema, tableName } = manager.getRepository(Policy).metadata;
    return [schema, tableName].filter((name): name is string => Boolean(name))
      .map((name) => manager.dataSource.driver.escape(name)).join('.');
  }
}
