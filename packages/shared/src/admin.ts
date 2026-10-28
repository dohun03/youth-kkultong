/** 지난 수집 원본 VS 이번 수집을 비교한 결과 */
export type CollectionResult = 'NEW' | 'CHANGED' | 'UNCHANGED' | 'MISSING';

/** 검수 후보 상태 */
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';

/** 후보 생성 당시 공개본이 없으면 "신규", 있으면 "변경" */
export type ReviewKind = 'NEW' | 'CHANGED';

/** 시스템이 이전 대기 후보를 종료한 이유 */
export type SupersededReason =
  | 'SOURCE_CHANGED' | 'PUBLIC_BASE_CHANGED'
  | 'MATCHES_PUBLIC' | 'PREVIOUSLY_REJECTED';

/** 원본의 중첩 객체·배열과 명시적 NULL을 보존하는 JSON 값이다. */
export type JsonValue = null | boolean | number | string
  | JsonValue[] | { [key: string]: JsonValue };

/** 검수 당시의 정책 객체와 내용 비교용 해시를 함께 전달한다. */
export interface PolicySnapshot {
  contentHash: string;
  raw: Record<string, JsonValue>;
}

/** 로그인과 인증 확인 응답에는 식별자·만료 시각만 제공한다. */
export interface AdminIdentity { username: string; expiresAt: string }

/** 관리자 로그인 폼에서 보내는 자격 정보다. */
export interface AdminLoginRequest { username: string; password: string }

/** 검수 목록·처리 이력의 조회 조건이다. 숫자는 웹에서 query 문자열로 전송한다. */
export interface AdminReviewQuery {
  page?: number;
  limit?: number;
  status?: ReviewStatus | 'PROCESSED';
  kind?: ReviewKind;
  keyword?: string;
  sourcePolicyId?: string;
}

/** 전체 조건 적용 후의 페이지 위치와 결과 건수다. */
export interface Pagination {
  page: number; limit: number; total: number; totalPages: number;
}

/** 스냅샷 원문을 제외한 검수 목록 한 행이다. 제목은 해당 후보 생성 당시 값이다. */
export interface ReviewListItem {
  id: string; sourcePolicyId: string; source: string; externalId: string;
  title: string; kind: ReviewKind; status: ReviewStatus;
  contentHash: string; baseContentHash: string | null;
  createdAt: string; closedAt: string | null;
  reviewedBy: string | null; rejectionReason: string | null;
  supersededReason: SupersededReason | null;
}

/** 검수 목록·이력 조회 결과와 페이지 정보를 전달한다. */
export interface ReviewListResponse {
  items: ReviewListItem[];
  pagination: Pagination;
}

/** 없는 필드와 명시적 NULL을 구분하는 최상위 원본 필드 차이다. */
export interface PolicyFieldDiff {
  key: string;
  beforeExists: boolean; afterExists: boolean;
  before: JsonValue; after: JsonValue;
}

/** 보관된 검수 스냅샷과 요청 당시 최신 원본·공개본을 비교하는 상세 응답이다. */
export interface AdminReviewDetail {
  review: ReviewListItem;
  base: PolicySnapshot | null;
  target: PolicySnapshot;
  currentPublished: (PolicySnapshot & { id: string; viewCount: number | null }) | null;
  latestSource: {
    contentHash: string; viewCount: number | null;
    lastCollectedAt: string | null; missingCount: number;
  };
  changedFields: PolicyFieldDiff[];
  latestPendingReviewId: string | null;
  canReview: boolean;
}

/** 화면에서 확인한 변경본·공개 기준본의 해시를 승인 요청에 보낸다. */
export interface ReviewActionRequest {
  contentHash: string;
  baseContentHash: string | null;
}

/** 거절 요청은 같은 검수 해시와 필수 거절 사유를 보낸다. */
export interface RejectReviewRequest extends ReviewActionRequest { reason: string }

/** 정상 승인·거절의 최종 상태와 공개 UUID·종료 시각이다. 신규 거절은 공개 UUID가 NULL이다. */
export interface ReviewActionResponse {
  id: string; status: 'APPROVED' | 'REJECTED';
  policyId: string | null; closedAt: string;
}

/** 누락 목록에서 페이지·최신 제목·최소 연속 누락 횟수를 선택한다. */
export interface MissingPolicyQuery {
  page?: number; limit?: number; keyword?: string; minMissingCount?: number;
}

/** 미공개 원본도 포함하는 누락 목록 한 행이다. 실제 수집 이력이 없으면 시각은 NULL이다. */
export interface MissingPolicyItem {
  sourcePolicyId: string; source: string; externalId: string; title: string;
  policyId: string | null; contentHash: string;
  lastCollectedAt: string | null;
  missingCount: number;
  latestPendingReviewId: string | null;
}

/** 누락 정책 목록과 페이지 정보를 전달한다. */
export interface MissingPolicyResponse {
  items: MissingPolicyItem[];
  pagination: Pagination;
}
