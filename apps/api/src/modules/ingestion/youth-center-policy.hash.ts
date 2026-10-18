import { createHash } from 'node:crypto';
import type { YouthCenterRawPolicy } from './youth-center-response.schema';

/** 원본을 노출하지 않고 해시 계산에 실패한 정책·필드·원인을 전달 */
export class YouthCenterPolicyHashError extends Error {
  /** 수집 실패 단계 */
  readonly stage = 'HASH';

  constructor(
    readonly policyId: string,
    readonly field: string,
    readonly reason: 'INVALID_JSON_VALUE' | 'CYCLIC_REFERENCE' | 'HASH_FAILED',
  ) {
    super(`온통청년 정책 ${policyId} 해시 계산에 실패했습니다 (필드: ${field}, 원인: ${reason}).`);
    this.name = 'YouthCenterPolicyHashError';
  }
}

/**
 * 원본 정책 데이터는 중첩된 트리 구조 형태기에 재귀 함수로 구현함.
 * 객체 키는 알파벳 순으로 정렬하고 배열 순서는 유지해, 일정한 JSON 문자열을 생성
*/
function serializePolicyContent(
  value: unknown,
  policyId: string,
  field: string,
  ancestors: Set<object>,
): string {
  // [ 분기 처리 목록 ]
  // 기본 값(null, 문자열, 부울, 유효한 숫자)은 표준 JSON.stringify로 안전하게 변환
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
    return JSON.stringify(value);
  }
  // JSON으로 표현 불가능한 값이 들어오면 해시 오염을 막기 위해 에러 발생
  if (typeof value !== 'object' || value === null) {
    throw new YouthCenterPolicyHashError(policyId, field, 'INVALID_JSON_VALUE');
  }
  // 커스텀 클래스 인스턴스 차단: 일반 객체만 허용하고 Date, Map 등 특수 객체는 해시 값이 달라지므로 거부
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== null && Object.getPrototypeOf(prototype) !== null) {
    throw new YouthCenterPolicyHashError(policyId, field, 'INVALID_JSON_VALUE');
  }
  // 이미 방문한 객체인지 Set로 검사하여 무한 루프 방지
  if (ancestors.has(value)) {
    throw new YouthCenterPolicyHashError(policyId, field, 'CYCLIC_REFERENCE');
  }

  ancestors.add(value);

  try {
    // 배열인 경우: 순서가 생명이므로 기존 순서를 유지한 채 각 아이템을 재귀적으로 직렬화
    if (Array.isArray(value)) {
      return `[${Array.from(value, (item, index) => serializePolicyContent(item, policyId, `${field}.${index}`, ancestors)).join(',')}]`;
    }
    // 일반 객체인 경우: 키 이름들을 알파벳 순으로 정렬
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record).sort().map((key) => {
      const path = field === '$' ? key : `${field}.${key}`;
      return `${JSON.stringify(key)}:${serializePolicyContent(record[key], policyId, path, ancestors)}`;
    });
    return `{${entries.join(',')}}`;
  } finally {
    // 현재 객체 처리가 끝나면 상위 경로 재귀로 돌아갈 때 ancestors 세트에서 제거
    ancestors.delete(value);
  }
}

/** 조회수만 제외한 원본 전체에서 내용 변경 판정용 SHA-256 해시를 생성 */
export function createYouthCenterPolicyContentHash(raw: YouthCenterRawPolicy): string {
  try {
    // 조회수 필드 제거
    const content = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'inqCnt'));
    const serialized = serializePolicyContent(content, raw.plcyNo, '$', new Set());
    return createHash('sha256').update(serialized, 'utf8').digest('hex');
  } catch (error) {
    if (error instanceof YouthCenterPolicyHashError) throw error;
    // 예상 밖 오류도 원본 메시지 없이 안전한 오류로 전달
    throw new YouthCenterPolicyHashError(raw.plcyNo, '$', 'HASH_FAILED');
  }
}
