import type { PaginationMeta, PolicyCard } from './policy-api';

/**
 * 하나의 사용자 조건과 정책 조건을 비교한 결과다.
 */
export type FieldEvaluation = 'MATCH' | 'MISMATCH' | 'POLICY_UNKNOWN' | 'NOT_PROVIDED';

/**
 * 여러 조건 비교 결과를 UI에 간단히 표시하기 위한 최종 상태다.
 */
export type MatchSummary = 'UNASSESSED' | 'MATCHED' | 'PARTIAL' | 'NEEDS_CHECK';

/**
 * 검색에 사용한 각 조건이 실제 비교에 적용됐는지 나타낸다.
 */
export interface AppliedCriteria {
  age: boolean;
  region: boolean;
  status: boolean;
  householdSize: boolean;
  income: boolean;
}

/**
 * 정책별 조건 비교 결과를 필드 단위로 전달한다.
 */
export interface PolicyFieldEvaluations {
  age: FieldEvaluation;
  region: FieldEvaluation;
  income: FieldEvaluation;
  status: FieldEvaluation;
  householdSize: FieldEvaluation;
}

/**
 * 조건 검색 결과 카드로, 정책 정보와 자동 비교 결과를 함께 제공한다.
 * 원문 미해결 조건 메모는 목록에 노출하지 않고 정책 상세에서만 제공한다.
 */
export interface PolicySearchCard {
  policy: PolicyCard;
  matchSummary: MatchSummary;
  fieldEvaluations: PolicyFieldEvaluations;
  requiresManualCheck: boolean;
}

/**
 * 조건 검색 API의 페이지 응답이다. 명백히 불일치한 정책은 items에 포함하지 않는다.
 */
export interface PolicySearchResponse extends PaginationMeta {
  items: PolicySearchCard[];
  appliedCriteria: AppliedCriteria;
}
