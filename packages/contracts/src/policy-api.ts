import { z } from 'zod';
import { POLICY_CATEGORIES, USER_STATUSES } from './enums';
import type { PolicyCategory, UserStatus } from './enums';
import type { BenefitAmount, PolicyConditions } from './policy';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MIN_AGE = 0;
const MAX_AGE = 120;
const REGION_CODE_PATTERN = /^(KR|\d{2}|\d{5})$/;

const RegionCodeSchema = z.string().regex(REGION_CODE_PATTERN, '유효한 지역 코드여야 합니다.');

/**
 * 페이지 단위 목록 응답에서 현재 위치와 전체 건수를 나타낸다.
 */
export interface PaginationMeta {
  page: number;
  size: number;
  total: number;
  totalPages: number;
}

/**
 * 일반 정책 목록에서 엔터티 전체 대신 사용자에게 보여 줄 최소 정보다.
 * 원문 미해결 조건 메모는 목록에 노출하지 않고 정책 상세에서만 제공한다.
 */
export interface PolicyCard {
  id: string;
  title: string;
  agency: string;
  category: PolicyCategory;
  benefitSummary: string;
  benefitAmount: BenefitAmount;
  applyStart: string | null;
  applyEnd: string | null;
  isAlwaysOpen: boolean;
  regionCondition: PolicyConditions['region'];
  ageCondition: PolicyConditions['age'];
  requiresManualCheck: boolean;
}

/**
 * 개인 자격 조건 없이 정책 목록을 조회할 때 사용하는 query다.
 */
export const PolicyListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE),
  size: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  category: z.enum(POLICY_CATEGORIES).optional(),
});

/**
 * 개인 자격 조건 없이 정책 목록을 조회할 때 사용하는 query의 요청 형태다.
 */
export interface PolicyListQuery {
  page?: number;
  size?: number;
  category?: PolicyCategory;
}

/**
 * 일반 정책 목록 API의 페이지 응답이다.
 */
export interface PolicyListResponse extends PaginationMeta {
  items: PolicyCard[];
}

/**
 * 공개 정책 상세 화면에 필요한 전체 정보다.
 * DB 엔터티의 출처·공개 상태 등 내부 관리 필드는 포함하지 않는다.
 */
export interface PolicyDetail {
  id: string;
  title: string;
  agency: string;
  category: PolicyCategory;
  benefitSummary: string;
  benefitAmount: BenefitAmount;
  applyStart: string | null;
  applyEnd: string | null;
  isAlwaysOpen: boolean;
  ageCondition: PolicyConditions['age'];
  regionCondition: PolicyConditions['region'];
  statusCondition: PolicyConditions['status'];
  incomeCondition: PolicyConditions['income'];
  householdSizeCondition: PolicyConditions['householdSize'];
  requiresManualCheck: boolean;
  manualCheckNote: string | null;
  requiredDocs: string[];
  officialUrl: string;
  lastVerifiedAt: string;
}

/**
 * 사용자가 선택적으로 입력하는 정책 검색 및 매칭 조건이다.
 */
export const SearchCriteriaSchema = z.strictObject({
  category: z.array(z.enum(POLICY_CATEGORIES)).min(1).optional(),
  age: z.number().int().min(MIN_AGE).max(MAX_AGE).optional(),
  regionCode: RegionCodeSchema.optional(),
  statuses: z.array(z.enum(USER_STATUSES)).min(1).optional(),
  householdSize: z.number().int().min(1).optional(),
  householdMonthlyIncome: z.number().int().nonnegative().optional(),
  page: z.number().int().min(1).default(DEFAULT_PAGE),
  size: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: z.literal('DEADLINE').optional(),
});

/**
 * 사용자가 선택적으로 입력하는 정책 검색 및 매칭 요청 body다.
 */
export interface SearchCriteria {
  category?: PolicyCategory[];
  age?: number;
  regionCode?: string;
  statuses?: UserStatus[];
  householdSize?: number;
  householdMonthlyIncome?: number;
  page?: number;
  size?: number;
  sort?: 'DEADLINE';
}
