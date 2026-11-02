import type { JsonValue, PolicyFieldDiff } from '@youth-kkultong/shared';

/** 모든 깊이의 객체 키를 정렬 -> 배열 순서와 원문을 보존해 JSON 값을 직렬화 */
function serializeFieldValue(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);

  // 배열 안의 객체도 같은 규칙으로 비교하며 원소 순서는 그대로 유지
  if (Array.isArray(value)) return `[${value.map(serializeFieldValue).join(',')}]`;

  // 숫자 형태의 키도 문자열 오름차순을 유지하도록 각 항목을 직접 연결
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${serializeFieldValue(value[key])}`).join(',')}}`;
}

/** 기존 공개 기준본 vs 검수 변경본의 최상위 필드 차이를 계산 (조회수 제외) */
export function calculatePolicyFieldDiff(
  base: Record<string, JsonValue> | null,
  target: Record<string, JsonValue>,
): PolicyFieldDiff[] {
  // 신규 후보는 빈 기준본과 비교해 변경본에 있는 모든 필드를 추가로 표시
  const beforeRaw = base ?? {};
  // base, target의 필드 이름들 배열로 전부 뽑기 -> new Set으로 중복 제거 -> 다시 [...]을 사용해 배열로 만들기 -> inqCnt 키 제외 -> 오름차순 정렬
  const keys = [...new Set([...Object.keys(beforeRaw), ...Object.keys(target)])]
    .filter((key) => key !== 'inqCnt').sort();
  const differences: PolicyFieldDiff[] = [];

  for (const key of keys) {
    // 양쪽에 해당 필드(key)가 실제로 존재하는가?
    const beforeExists = Object.hasOwn(beforeRaw, key);
    const afterExists = Object.hasOwn(target, key);
    const before = beforeExists ? beforeRaw[key] : null;
    const after = afterExists ? target[key] : null;

    // 양쪽에 존재한다면 값의 내용이 같은가? (직렬화한 내용을 비교해 동일 필드를 제외)
    if (beforeExists === afterExists && serializeFieldValue(before) === serializeFieldValue(after)) continue;

    // 다른 경우 differences에 저장
    differences.push({ key, beforeExists, afterExists, before, after });
  }

  return differences;
}
