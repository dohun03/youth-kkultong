import type {
  MatchSummary,
  PolicyConditions,
  PolicyFieldEvaluations,
  SearchCriteria,
} from '@kkultong/contracts';

/** 정책 조건을 순수하게 평가하는 데 필요한 기준 데이터다. */
export interface MatchContext {
  today: Date;
  medianIncomeByHouseholdSize: ReadonlyMap<number, number>;
  regionParentByCode: ReadonlyMap<string, string | null>;
}

/** 매칭 엔진이 정책 엔터티 전체 대신 참조하는 최소 정책 정보다. */
export interface MatchablePolicy {
  conditions: PolicyConditions;
  hasUnresolvedEligibilityCondition: boolean;
}

/** 정책별 조건 평가, 검색 제외 여부, UI용 요약 상태를 함께 나타낸다. */
export interface PolicyEvaluation {
  fieldEvaluations: PolicyFieldEvaluations;
  excluded: boolean;
  matchSummary: MatchSummary;
  requiresManualCheck: boolean;
}

/** 나이 평가에 사용할 사용자 입력만 분리한 형태다. */
export type AgeCriteria = Pick<SearchCriteria, 'age'>;

/** 지역 평가에 사용할 사용자 입력만 분리한 형태다. */
export type RegionCriteria = Pick<SearchCriteria, 'regionCode'>;

/** 상태 평가에 사용할 사용자 입력만 분리한 형태다. */
export type StatusCriteria = Pick<SearchCriteria, 'statuses'>;

/** 가구원 수 평가에 사용할 사용자 입력만 분리한 형태다. */
export type HouseholdCriteria = Pick<SearchCriteria, 'householdSize'>;

/** 소득 평가에 사용할 사용자 입력만 분리한 형태다. */
export type IncomeCriteria = Pick<SearchCriteria, 'householdMonthlyIncome' | 'householdSize'>;
