function normalizeValue(value: unknown): unknown {
  // Date 객체와 문자열 날짜를 같은 ISO 표현으로 맞춰 비교 결과가 흔들리지 않게 한다.
  if (value instanceof Date) {
    return value.toISOString();
  }

  // 배열은 필수 서류처럼 입력 순서가 의미가 있을 수 있으므로 순서를 바꾸지 않는다.
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;

    // 객체는 키 입력 순서만 달라도 다른 JSON 문자열이 되므로, 키를 정렬해 같은 내용으로 비교한다.
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((normalized, key) => {
        normalized[key] = normalizeValue(record[key]);
        return normalized;
      }, {});
  }

  return value;
}

export function stableJsonStringify(value: unknown): string {
  // 중첩된 객체까지 정규화한 뒤 문자열로 바꿔 정책 내용의 변경 여부를 안정적으로 판단한다.
  const serialized = JSON.stringify(normalizeValue(value));

  return serialized ?? 'undefined';
}
