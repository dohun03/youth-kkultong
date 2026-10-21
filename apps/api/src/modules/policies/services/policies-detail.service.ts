import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PolicyDetail } from '@youth-kkultong/shared';
import { DataSource } from 'typeorm';
import { JOB_OPTIONS, SCHOOL_OPTIONS } from '../../meta/eligibility-codes';
import { RegionRepository } from '../../meta/repositories/region.repository';
import { calculateApplicationStatus, getKoreaToday } from '../application-status';
import { toPolicyCard } from '../policy-card';
import { PolicyRepository } from '../repositories/policy.repository';

/** 공식 취업·학력 명칭 조회표. 미확인 코드는 원래 코드로 표시 */
const jobLabels = new Map<string, string>(JOB_OPTIONS.map(({ code, label }) => [code, label]));
const schoolLabels = new Map<string, string>(SCHOOL_OPTIONS.map(({ code, label }) => [code, label]));

/** 코드 목록을 공식 이름으로 변경 */
function formatCodes(codes: readonly string[] | null, labels: ReadonlyMap<string, string>): string | null {
  return codes?.map((code) => labels.get(code) ?? code).join(', ') || null;
}

/** 유효한 절대 HTTP(S) 링크만 남긴다 */
function httpUrl(value: string | null): string | null {
  const text = value?.trim();
  if (!text || !/^https?:\/\//i.test(text) || /[\u0000-\u0020\u007f]/.test(text)) return null;
  try {
    const url = new URL(text);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? text : null;
  } catch {
    return null;
  }
}

/** 정책 한 건의 원문 설명·조건·기간·안전한 신청 및 참고 링크를 조립 */
@Injectable()
export class PoliciesDetailService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(PolicyRepository) private readonly policyRepository: PolicyRepository,
    @Inject(RegionRepository) private readonly regionRepository: RegionRepository,
  ) {}

  /** 특정 정책을 상세 조회 */
  async findById(id: string): Promise<PolicyDetail> {
    const today = getKoreaToday(new Date());

    // DB 정책 조회
    const manager = this.dataSource.manager;
    const policy = await this.policyRepository.findById(manager, id);
    if (!policy) throw new NotFoundException();

    // 해당 정책의 지역 DB 조회
    const regions = await this.regionRepository.findByCodes(manager, policy.regionCodes ?? []);
    const regionLabels = new Map(regions.map(({ code, name }) => [code, name]));

    // links 배열에 {'신청', 실제 URL } 형태로 푸시
    const links: PolicyDetail['links'] = [];
    for (const [label, value] of [['신청', policy.applyUrl], ['참고', policy.referenceUrl1], ['참고', policy.referenceUrl2]] as const) {
      const url = httpUrl(value);
      if (url) links.push({ label, url });
    }

    return {
      // 정책 혜택은 200자 요약으로 자른다
      ...toPolicyCard({ ...policy, benefitPreview: [...(policy.benefitText ?? '')].slice(0, 200).join(''),
      applicationStatus: calculateApplicationStatus(policy, today), score: 0, tags: [] }),
      source: policy.source, externalId: policy.externalId, description: policy.description, benefitText: policy.benefitText,
      // 0~0·역전 같은 원본 범위도 그대로 표시하며 제한 없음이나 유효 구간으로 다시 해석하지 않는다.
      ageRangeText: policy.ageMin === null && policy.ageMax === null ? null : `${policy.ageMin ?? ''}~${policy.ageMax ?? ''}세`,
      jobConditionText: formatCodes(policy.jobCodes, jobLabels),
      schoolConditionText: formatCodes(policy.schoolCodes, schoolLabels),
      regionText: formatCodes(policy.regionCodes, regionLabels),
      extraQualification: policy.extraQualification, participationRestriction: policy.participationRestriction, links,
    };
  }
}
