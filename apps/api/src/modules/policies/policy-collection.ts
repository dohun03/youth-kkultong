import type { CollectionResult } from '@youth-kkultong/shared';
import type { SourcePolicy } from './entities/source-policy.entity';

/** 정상 전체 수집에서 확인된 정책의 판정과 초기화할 누락 횟수 */
export interface CollectedPolicyResult {
  source: string;
  externalId: string;
  lastCollectionResult: Exclude<CollectionResult, 'MISSING'>;
  missingCount: 0;
}

/** 수집된 정책의 판정 목록과 누락 갱신 목록, 판정별 건수 */
export interface PolicyCollectionPlan {
  collected: CollectedPolicyResult[];
  missing: Pick<SourcePolicy, 'id' | 'missingCount'>[];
  counts: Record<CollectionResult, number>;
}

/** PostgreSQL INTEGER 컬럼에 저장할 수 있는 최대 누락 횟수 */
const MAX_MISSING_COUNT = 2147483647;

/** 한 출처의 정상 전체 응답을 직전 원본(source)과 비교 */
export function classifyPolicyCollection(
  source: string,
  previous: readonly Pick<SourcePolicy, 'id' | 'source' | 'externalId' | 'contentHash' | 'missingCount'>[],
  incoming: readonly Pick<SourcePolicy, 'source' | 'externalId' | 'contentHash'>[],
): PolicyCollectionPlan {
  // 이전 원본을 외부 ID로 찾기
  const originals = new Map<string, typeof previous[number]>();
  for (const policy of previous) {
    if (policy.source !== source) throw new Error('수집 비교 대상 원본의 출처가 다릅니다.');
    if (originals.has(policy.externalId)) throw new Error('수집 비교 대상 원본의 식별자가 중복되었습니다.');

    originals.set(policy.externalId, policy);
  }

  // 수집 정책 순회하면서 plan에 결과 담기
  const plan: PolicyCollectionPlan = {
    collected: [], missing: [], counts: { NEW: 0, CHANGED: 0, UNCHANGED: 0, MISSING: 0 },
  };
  const observedIds = new Set<string>();
  for (const policy of incoming) {
    // 정상 전체 응답에 서로 다른 출처나 중복 정책이 섞이면 예외 처리
    if (policy.source !== source) throw new Error('수집 응답 정책의 출처가 다릅니다.');
    if (observedIds.has(policy.externalId)) throw new Error('수집 응답 정책의 식별자가 중복되었습니다.');

    observedIds.add(policy.externalId);

    // 원본이 없으면 신규, 내용 해시가 다르면 변경, 같으면 동일로 판정
    const original = originals.get(policy.externalId);
    const result = original === undefined ? 'NEW' : original.contentHash === policy.contentHash ? 'UNCHANGED' : 'CHANGED';
    plan.collected.push({ source, externalId: policy.externalId, lastCollectionResult: result, missingCount: 0 });
    plan.counts[result] += 1;
  }

  // 이번 전체 응답에 없는 원본은 누락 횟수를 한 번 늘리고 정수 최댓값에서 유지
  for (const original of previous) {
    if (observedIds.has(original.externalId)) continue;
    plan.missing.push({ id: original.id, missingCount: Math.min(original.missingCount + 1, MAX_MISSING_COUNT) });
    plan.counts.MISSING += 1;
  }

  // 결과 반환
  return plan;
}
