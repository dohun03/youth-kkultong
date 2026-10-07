// 정책 카테고리 (주거, 취업, 교육 등..)
export const POLICY_CATEGORIES = [
  'HOUSING',
  'FINANCE',
  'JOB',
  'EDUCATION',
  'WELFARE',
  'ETC',
] as const;
export type PolicyCategory = (typeof POLICY_CATEGORIES)[number];

// 유저 상태 (학생, 무직, 직장인 등..)
export const USER_STATUSES = [
  'JOB_SEEKER',
  'STUDENT',
  'EMPLOYEE',
  'UNEMPLOYED',
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

// 정책 출처 입력 방식 (수동 or API)
export const SOURCE_TYPES = ['MANUAL', 'API'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

// 정책 상태
export const SOURCE_STATUSES = ['ACTIVE', 'NOT_SEEN', 'CLOSED'] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];
