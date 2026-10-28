// 공개 정책·메타·관리자 API 계약과 입력 검증을 공용 패키지에서 내보낸다.
export type {
  AdminIdentity, AdminLoginRequest, AdminReviewDetail, AdminReviewQuery,
  CollectionResult, JsonValue, MissingPolicyItem, MissingPolicyQuery, MissingPolicyResponse,
  Pagination, PolicyFieldDiff, PolicySnapshot, RejectReviewRequest,
  ReviewActionRequest, ReviewActionResponse, ReviewKind, ReviewListItem,
  ReviewListResponse, ReviewStatus, SupersededReason,
} from './admin.js';
export {
  adminLoginSchema, adminLogoutSchema, adminReviewIdSchema, adminReviewQuerySchema,
  missingPolicyQuerySchema, rejectReviewSchema, reviewActionSchema,
} from './admin.schema.js';
export type { EligibilityCodeOption, EligibilityCodesResponse, RegionOption } from './meta.js';
export { createPolicySearchSchema } from './policy-search.schema.js';
export type { PolicySearchCodes } from './policy-search.schema.js';
export type {
  ApplicationStatus,
  MatchTag,
  PolicyCard,
  PolicyDetail,
  PolicySearchRequest,
  PolicySearchResponse,
  SortKey,
  UserConditions,
} from './policies.js';

export { parsePolicyCategories } from './policy-categories.js';
