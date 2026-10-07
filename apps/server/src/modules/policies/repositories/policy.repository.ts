import { In, type DataSource, type EntityManager } from 'typeorm';
import { RegionEntity } from '../../meta/entities/region.entity';
import { PolicyEntity } from '../entities/policy.entity';
import { PolicySourceEntity } from '../entities/policy-source.entity';

/**
 * 정책 저장 흐름에서 사용하는 `policies`, `policy_sources`, `regions` 엔티티의 조회와 저장을 맡는다.
 * Service가 transaction 경계를 결정하고, 이 Repository는 전달받은 EntityManager 안에서만 DB 작업을 수행한다.
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

  /** 생성 또는 변경된 `PolicyEntity`를 현재 transaction에 저장한다. */
  public async save(policy: PolicyEntity, manager?: EntityManager): Promise<PolicyEntity> {
    return this.getManager(manager).getRepository(PolicyEntity).save(policy);
  }

  /** 공통 메서드: 호출자가 transaction을 열었으면 그 manager를 우선 사용해 모든 쿼리를 같은 transaction에 묶는다. */
  private getManager(manager?: EntityManager): EntityManager {
    return manager ?? this.dataSource.manager;
  }
}
