import type { MatchTag, RegionOption } from '@youth-kkultong/shared';

/** 지역은 제외 조건이 아니며 관련 점수와 확인 태그만 반환 */
export interface RegionMatchResult {
  score: 0 | 0.5;
  tags: Extract<MatchTag, 'REGION_RELATED' | 'REGION_REVIEW'>[];
}

/** 수집 단계에서 쉼표를 나누고 공백을 제거한 정책 지역 코드 목록 */
export interface PolicyRegionCodes {
  regionCodes: readonly string[] | null;
}

/** 현행 지역 코드가 키이고 공식 직접 상위 관계가 값인 조회표. 호출자가 한 번 준비해 정책마다 재사용한다. */
export type ActiveRegionMap = ReadonlyMap<string, Pick<RegionOption, 'parentCode'>>;

/** 사용자 지역과 같거나 공식 부모·자식 관계에 있는 정책 지역을 판정 */
export function checkRegion(
  policy: PolicyRegionCodes,
  regionCode: string | undefined,
  activeRegions: ActiveRegionMap,
): RegionMatchResult {
  // 지역 미입력
  if (regionCode === undefined) return { score: 0, tags: [] };

  // 사용자 지역은 현행 5자리 코드만 허용
  if (!/^\d{5}$/.test(regionCode) || !activeRegions.has(regionCode)) {
    throw new RangeError('사용자 지역 코드는 현행 5자리 지역 코드여야 합니다.');
  }

  const codes = policy.regionCodes;
  // 지역 정보가 없는 경우
  if (codes === null || codes.length === 0) return { score: 0, tags: ['REGION_REVIEW'] };

  const relatedCodes = new Set<string>();
  let current: string | null = regionCode;
  let unclearParent = false;

  // 사용자 지역에서 공식 부모를 따라 올라가 같은 지역과 상위 지역을 모은다.
  while (current !== null) {
    const region = activeRegions.get(current);
    // 잘못된 조회표의 부모 누락·순환 참조 때문에 추측하거나 무한 반복하지 않는다.
    if (!region || relatedCodes.has(current)) {
      unclearParent = true;
      break;
    }
    relatedCodes.add(current);
    current = region.parentCode;
  }

  // 같은 지역과 상위 지역이 여러 번 일치해도 가점은 한 번만 준다.
  if (codes.some((code) => relatedCodes.has(code))) return { score: 0.5, tags: ['REGION_RELATED'] };

  // 정책 지역에서도 부모를 따라 올라가 선택 지역의 하위인지 확인
  for (const code of codes) {
    const visited = new Set<string>();
    let child: string | null = code;

    while (child !== null) {
      const region = activeRegions.get(child);
      if (!region || visited.has(child)) {
        unclearParent = true;
        break;
      }
      if (child === regionCode) return { score: 0.5, tags: ['REGION_RELATED'] };
      visited.add(child);
      child = region.parentCode;
    }
  }

  // 현행 목록에 없는 폐지·미확인·빈 코드가 섞였거나 부모 관계가 불명확하면 확인 태그만 붙인다.
  if (unclearParent || codes.some((code) => !activeRegions.has(code))) {
    return { score: 0, tags: ['REGION_REVIEW'] };
  }

  // 확인 가능한 다른 지역이면 가점 없이 유지. 지역 불일치는 제외 사유가 아니다.
  return { score: 0, tags: [] };
}
