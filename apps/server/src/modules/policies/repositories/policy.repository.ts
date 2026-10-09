import type { PolicyCategory, SourceStatus } from '@kkultong/contracts';
import { In, type DataSource, type EntityManager } from 'typeorm';
import { MedianIncomeEntity } from '../../meta/entities/median-income.entity';
import { RegionEntity } from '../../meta/entities/region.entity';
import { PolicyEntity } from '../entities/policy.entity';
import { PolicySourceEntity } from '../entities/policy-source.entity';

export interface FindPublicPoliciesOptions {
  category?: PolicyCategory;
  offset: number;
  limit: number;
  today: string;
  hideBefore: Date;
}

export interface PublicPoliciesPage {
  policies: PolicyEntity[];
  total: number;
}

export interface FindPublicPolicyOptions {
  id: string;
  today: string;
  hideBefore: Date;
}

export interface FindSearchContextOptions {
  medianIncomeYear: number;
}

const ACTIVE_SOURCE_STATUS: SourceStatus = 'ACTIVE';

/**
 * 공개 정책 목록과 정책 저장 흐름에 필요한 `policies`, `policy_sources`, `regions` DB 접근을 맡는다.
 * 저장 흐름은 Service가 transaction 경계를 결정하고, 이 Repository는 전달받은 EntityManager를 우선 사용한다.
 */
export class PolicyRepository {
  public constructor(private readonly dataSource: DataSource) {}

  /** `policy_sources`에서 code로 정책 출처를 찾는다. */
  public async findSourceByCode(
    code: string,
    manager?: EntityManager,
  ): Promise<PolicySourceEntity | null> {
    // policy_sources.code는 고유값이므로 MANUAL 같은 하나의 출처만 조회한다.
    return this.getManager(manager).getRepository(PolicySourceEntity).findOneBy({ code });
  }

  /** `policies`에서 출처(sourceId)와 외부 식별자(externalId)가 모두 같은 정책을 찾아 재등록 여부를 판단한다. */
  public async findBySourceIdentity(
    sourceId: number,
    externalId: string,
    manager?: EntityManager,
  ): Promise<PolicyEntity | null> {
    // externalId는 출처 안에서만 고유하므로 source_id와 함께 externalId를 조회한다.
    return this.getManager(manager)
      .getRepository(PolicyEntity)
      .findOneBy({ source: { id: sourceId }, externalId });
  }

  /** `regions`에 실제로 등록된 코드만 한 번의 조회로 반환해 정책 조건의 참조 무결성을 확인한다. */
  public async findExistingRegionCodes(codes: string[], manager?: EntityManager): Promise<string[]> {
    if (codes.length === 0) {
      return [];
    }

    // 여러 지역 코드를 IN 조건으로 한 번에 조회
    const regions = await this.getManager(manager)
      .getRepository(RegionEntity)
      .find({ select: { code: true }, where: { code: In(codes) } });

    return regions.map((region) => region.code);
  }

  /** 정책과 전체 건수를 정렬된 페이지 단위로 조회한다. */
  public async findPublicPolicies({
    category,
    offset,
    limit,
    today,
    hideBefore,
  }: FindPublicPoliciesOptions): Promise<PublicPoliciesPage> {
    const query = this.dataSource
      .getRepository(PolicyEntity)
      .createQueryBuilder('policy')
      .where('policy.is_published = :isPublished', { isPublished: true })
      .andWhere('policy.source_status = :sourceStatus', { sourceStatus: ACTIVE_SOURCE_STATUS })
      .andWhere('(policy.apply_end IS NULL OR policy.apply_end >= :today)', { today })
      .andWhere('policy.last_verified_at >= :hideBefore', { hideBefore });

    if (category !== undefined) {
      query.andWhere('policy.category = :category', { category });
    }

    const [policies, total] = await query
      .orderBy('policy.apply_end', 'ASC', 'NULLS LAST')
      .addOrderBy('policy.title', 'ASC')
      .addOrderBy('policy.id', 'ASC')
      .skip(offset)
      .take(limit)
      .getManyAndCount();

    return { policies, total };
  }

  /** 조건 검색 전에 공개 정책 전체를 마감일 순으로 한 번에 조회한다. */
  public async findAllPublicPolicies({
    categories,
    today,
    hideBefore,
  }: Omit<FindPublicPoliciesOptions, 'category' | 'offset' | 'limit'> & {
    categories?: PolicyCategory[];
  }): Promise<PolicyEntity[]> {
    const query = this.dataSource
      .getRepository(PolicyEntity)
      .createQueryBuilder('policy')
      .where('policy.is_published = :isPublished', { isPublished: true })
      .andWhere('policy.source_status = :sourceStatus', { sourceStatus: ACTIVE_SOURCE_STATUS })
      .andWhere('(policy.apply_end IS NULL OR policy.apply_end >= :today)', { today })
      .andWhere('policy.last_verified_at >= :hideBefore', { hideBefore });

    if (categories !== undefined) {
      query.andWhere('policy.category IN (:...categories)', { categories });
    }

    return query
      .orderBy('policy.apply_end', 'ASC', 'NULLS LAST')
      .addOrderBy('policy.title', 'ASC')
      .addOrderBy('policy.id', 'ASC')
      .getMany();
  }

  /** 매칭에 필요한 지역 부모 관계와 해당 연도의 중위소득을 각각 한 번에 가져온다. */
  public async findSearchContext({
    medianIncomeYear,
  }: FindSearchContextOptions): Promise<{
    regionParentByCode: Map<string, string | null>;
    medianIncomeByHouseholdSize: Map<number, number>;
  }> {
    const [regions, medianIncomes] = await Promise.all([
      this.dataSource
        .getRepository(RegionEntity)
        .find({ select: { code: true, parentCode: true } }),
      this.dataSource
        .getRepository(MedianIncomeEntity)
        .find({
          select: { householdSize: true, amount: true },
          where: { year: medianIncomeYear },
        }),
    ]);

    return {
      regionParentByCode: new Map(regions.map((region) => [region.code, region.parentCode])),
      medianIncomeByHouseholdSize: new Map(
        medianIncomes.map((medianIncome) => [
          medianIncome.householdSize,
          Number(medianIncome.amount),
        ]),
      ),
    };
  }

  /** 목록과 같은 공개 기준을 만족하는 정책 한 건만 반환한다. */
  public async findPublicPolicy({
    id,
    today,
    hideBefore,
  }: FindPublicPolicyOptions): Promise<PolicyEntity | null> {
    return this.dataSource
      .getRepository(PolicyEntity)
      .createQueryBuilder('policy')
      .where('policy.id = :id', { id })
      .andWhere('policy.is_published = :isPublished', { isPublished: true })
      .andWhere('policy.source_status = :sourceStatus', { sourceStatus: ACTIVE_SOURCE_STATUS })
      .andWhere('(policy.apply_end IS NULL OR policy.apply_end >= :today)', { today })
      .andWhere('policy.last_verified_at >= :hideBefore', { hideBefore })
      .getOne();
  }

  /** 생성 또는 변경된 `PolicyEntity`를 현재 transaction에 저장한다. */
  public async save(policy: PolicyEntity, manager?: EntityManager): Promise<PolicyEntity> {
    return this.getManager(manager).getRepository(PolicyEntity).save(policy);
  }

  /** 공통 메서드: 호출자가 transaction을 열었으면 그 manager를 우선 사용해 모든 쿼리를 같은 transaction에 묶는다. */
  private getManager(manager?: EntityManager): EntityManager {
    return manager ?? this.dataSource.manager;
  }
}
