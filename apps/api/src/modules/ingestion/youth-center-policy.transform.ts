import type { YouthCenterRawPolicy } from './youth-center-response.schema';

/** 자격 조건·기간·해시를 붙이기 전의 정책 기본 정보 */
export interface YouthCenterPolicyBasicInfo {
  source: 'youthcenter';
  externalId: string;
  title: string;
  category: string | null;
  subcategory: string | null;
  description: string | null;
  benefitText: string | null;
  applyUrl: string | null;
  referenceUrl1: string | null;
  referenceUrl2: string | null;
  viewCount: number | null;
  sourceRegisteredAt: string | null;
  sourceModifiedAt: string | null;
  rawJson: YouthCenterRawPolicy;
}

/** 변환 실패의 정책·필드·원인을 전달 */
export class YouthCenterPolicyTransformError extends Error {
  /** 수집 실패 단계 */
  readonly stage = 'TRANSFORMATION';

  constructor(
    readonly policyId: string,
    readonly field: string,
    readonly reason: 'INVALID_TYPE' | 'REQUIRED' | 'TOO_LONG' | 'INVALID_TIMESTAMP',
  ) {
    super(`온통청년 정책 ${policyId} 변환에 실패했습니다 (필드: ${field}, 원인: ${reason}).`);
    this.name = 'YouthCenterPolicyTransformError';
  }
}

/** 빈 문자열·공백·누락 -> NULL로 변경, 내용이 있는 문자열 -> 줄바꿈·공백까지 보존 */
function readText(raw: YouthCenterRawPolicy, field: string, maxLength?: number): string | null {
  const value = raw[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new YouthCenterPolicyTransformError(raw.plcyNo, field, 'INVALID_TYPE');
  }
  if (value.trim() === '') return null;
  if (maxLength !== undefined && [...value].length > maxLength) {
    throw new YouthCenterPolicyTransformError(raw.plcyNo, field, 'TOO_LONG');
  }
  return value;
}

/** 필수 ID·제목의 빈 값은 거부함 */
function readRequiredText(raw: YouthCenterRawPolicy, field: string, maxLength?: number): string {
  const value = readText(raw, field, maxLength);
  if (value === null) throw new YouthCenterPolicyTransformError(raw.plcyNo, field, 'REQUIRED');
  return value;
}

/** 0 이상 정수 문자열 -> 조회수로 변환, 해석 불가·INTEGER 범위 초과 -> NULL로 둔다. */
function readViewCount(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const count = Number(value.trim());
  return Number.isInteger(count) && count <= 2_147_483_647 ? count : null;
}

/** 날짜·시각을 검증, Date 객체나 UTC로 변환하지 않아 원본의 벽시계 시각을 유지한다. */
function readTimestamp(raw: YouthCenterRawPolicy, field: string): string | null {
  const value = readText(raw, field);
  if (value === null) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (parts) {
    const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
    // 윤년과 월별 일수를 직접 비교해 잘못된 날짜의 자동 보정을 막는다.
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1]
      && hour <= 23 && minute <= 59 && second <= 59) return value;
  }
  throw new YouthCenterPolicyTransformError(raw.plcyNo, field, 'INVALID_TIMESTAMP');
}

/** 검증된 원본 정책에서 기본 정보를 매핑하고 원본 객체는 변경하지 않는다. */
export function transformYouthCenterPolicyBasicInfo(raw: YouthCenterRawPolicy): YouthCenterPolicyBasicInfo {
  return {
    source: 'youthcenter',
    externalId: readRequiredText(raw, 'plcyNo', 64),
    title: readRequiredText(raw, 'plcyNm'),
    category: readText(raw, 'lclsfNm', 100),
    subcategory: readText(raw, 'mclsfNm', 100),
    description: readText(raw, 'plcyExplnCn'),
    benefitText: readText(raw, 'plcySprtCn'),
    applyUrl: readText(raw, 'aplyUrlAddr'),
    referenceUrl1: readText(raw, 'refUrlAddr1'),
    referenceUrl2: readText(raw, 'refUrlAddr2'),
    viewCount: readViewCount(raw.inqCnt),
    sourceRegisteredAt: readTimestamp(raw, 'frstRegDt'),
    sourceModifiedAt: readTimestamp(raw, 'lastMdfcnDt'),
    rawJson: raw,
  };
}
