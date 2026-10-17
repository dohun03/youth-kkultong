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

/** 기본 정보(YouthCenterPolicyBasicInfo)에 자격 조건·신청기간을 합친 형태, 내용 해시는 다음 단계에서 추가한다. */
export interface YouthCenterPolicy extends YouthCenterPolicyBasicInfo {
  /** 수치만 변환하며 나이 범위의 적합성은 매칭 단계에서 판단한다. */
  ageMin: number | null;
  ageMax: number | null;
  /** 앞자리 0과 미확인 코드를 보존한 자격·지역 코드 목록 */
  jobCodes: string[] | null;
  schoolCodes: string[] | null;
  regionCodes: string[] | null;
  /** 추가 자격·참여 제한 원문 */
  extraQualification: string | null;
  participationRestriction: string | null;
  /** 신청기간 코드·원문과 단일 유효 구간의 YYYY-MM-DD 날짜 */
  applicationPeriodCode: string | null;
  applicationPeriodRaw: string | null;
  applicationStartDate: string | null;
  applicationEndDate: string | null;
}

/** 변환 실패의 정책·필드·원인을 전달 */
export class YouthCenterPolicyTransformError extends Error {
  /** 수집 실패 단계 */
  readonly stage = 'TRANSFORMATION';

  constructor(
    readonly policyId: string,
    readonly field: string,
    readonly reason: 'INVALID_TYPE' | 'REQUIRED' | 'TOO_LONG' | 'INVALID_TIMESTAMP' | 'INVALID_INTEGER',
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

/** INTEGER 범위의 나이 문자열을 변환하고, 해석 불가 값은 정책·필드 오류로 전달 */
function readAge(raw: YouthCenterRawPolicy, field: string): number | null {
  const value = readText(raw, field);
  if (value === null) return null;
  const age = Number(value.trim());
  if (!/^[+-]?\d+$/.test(value.trim()) || !Number.isInteger(age)
    || age < -2_147_483_648 || age > 2_147_483_647) {
    throw new YouthCenterPolicyTransformError(raw.plcyNo, field, 'INVALID_INTEGER');
  }
  return age;
}

/** 쉼표로 나눠 코드 주변 공백만 제거함. 미확인·빈 토큰도 임의로 버리지 않는다. */
function readCodes(raw: YouthCenterRawPolicy, field: string): string[] | null {
  const value = readText(raw, field);
  return value === null ? null : value.split(',').map((code) => code.trim());
}

/** 윤년과 월별 일수를 비교해 실제 존재하는 날짜만 허용한다. */
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12
    && day >= 1 && day <= daysInMonth[month - 1];
}

/** 날짜·시각을 검증, Date 객체나 UTC로 변환하지 않아 원본의 벽시계 시각을 유지한다. */
function readTimestamp(raw: YouthCenterRawPolicy, field: string): string | null {
  const value = readText(raw, field);
  if (value === null) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (parts) {
    const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
    if (isValidCalendarDate(year, month, day)
      && hour <= 23 && minute <= 59 && second <= 59) return value;
  }
  throw new YouthCenterPolicyTransformError(raw.plcyNo, field, 'INVALID_TIMESTAMP');
}

/** 단일 날짜 구간만 추출하며 복수 기간·형식 오류·날짜 역전은 양쪽 날짜를 NULL로 둔다. */
function readApplicationDates(value: string | null): [string | null, string | null] {
  if (value === null) return [null, null];
  // YYYYMMDD 또는 YYYY-MM-DD 날짜 두 개가 ~로 연결된 전체 문자열만 허용한다.
  const parts = /^(\d{8}|\d{4}-\d{2}-\d{2})\s*~\s*(\d{8}|\d{4}-\d{2}-\d{2})$/.exec(value.trim());
  if (!parts) return [null, null];
  const dates = parts.slice(1).map((date) => date.replaceAll('-', ''));
  for (const date of dates) {
    if (!isValidCalendarDate(Number(date.slice(0, 4)), Number(date.slice(4, 6)), Number(date.slice(6, 8)))) {
      return [null, null];
    }
  }
  if (dates[0] > dates[1]) return [null, null];
  const [start, end] = dates.map((date) => `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`);
  return [start, end];
}

/** 검증된 원본 정책에서 기본 정보를 매핑 */
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

/** 기본 정보·자격 조건·신청기간을 하나의 정책 자료로 변환 */
export function transformYouthCenterPolicy(raw: YouthCenterRawPolicy): YouthCenterPolicy {
  const basicInfo = transformYouthCenterPolicyBasicInfo(raw);
  const applicationPeriodRaw = readText(raw, 'aplyYmd');
  const [applicationStartDate, applicationEndDate] = readApplicationDates(applicationPeriodRaw);
  return {
    ...basicInfo,
    ageMin: readAge(raw, 'sprtTrgtMinAge'),
    ageMax: readAge(raw, 'sprtTrgtMaxAge'),
    jobCodes: readCodes(raw, 'jobCd'),
    schoolCodes: readCodes(raw, 'schoolCd'),
    regionCodes: readCodes(raw, 'zipCd'),
    extraQualification: readText(raw, 'addAplyQlfcCndCn'),
    participationRestriction: readText(raw, 'ptcpPrpTrgtCn'),
    applicationPeriodCode: readText(raw, 'aplyPrdSeCd', 20)?.trim() ?? null,
    applicationPeriodRaw,
    applicationStartDate,
    applicationEndDate,
  };
}
