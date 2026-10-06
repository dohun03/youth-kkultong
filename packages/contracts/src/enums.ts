export const POLICY_CATEGORIES = [
  'HOUSING',
  'FINANCE',
  'JOB',
  'EDUCATION',
  'WELFARE',
  'ETC',
] as const;

export type PolicyCategory = (typeof POLICY_CATEGORIES)[number];

export const USER_STATUSES = [
  'JOB_SEEKER',
  'STUDENT',
  'EMPLOYEE',
  'UNEMPLOYED',
] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

export const SOURCE_TYPES = ['MANUAL', 'API'] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_STATUSES = ['ACTIVE', 'NOT_SEEN', 'CLOSED'] as const;

export type SourceStatus = (typeof SOURCE_STATUSES)[number];
