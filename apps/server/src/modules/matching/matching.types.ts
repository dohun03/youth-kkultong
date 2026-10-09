import type { FieldEvaluation, PolicyConditions, SearchCriteria } from '@kkultong/contracts';

/** 정책 조건을 순수하게 평가하는 데 필요한 기준 데이터다. */
export interface MatchContext {
  today: Date;
  medianIncomeByHouseholdSize: Map<number, number>;
  regionParentByCode: Map<string, string | null>;
}

/** 매칭 엔진이 정책 엔터티 전체 대신 참조하는 최소 정책 정보다. */
export interface MatchablePolicy {
  conditions: PolicyConditions;
  hasUnresolvedEligibilityCondition: boolean;
}

/** Step 8에서 조립하는 정책 평가 결과다. 이후 Step에서 지역·상태·가구원·소득 결과를 같은 객체에 추가한다. */
export interface PolicyEvaluation {
  fieldEvaluations: {
    age: FieldEvaluation;
    region: FieldEvaluation;
    status: FieldEvaluation;
  };
}

/** 나이 평가에 사용할 사용자 입력만 분리한 형태다. */
export type AgeCriteria = Pick<SearchCriteria, 'age'>;

/** 지역 평가에 사용할 사용자 입력만 분리한 형태다. */
export type RegionCriteria = Pick<SearchCriteria, 'regionCode'>;

/** 상태 평가에 사용할 사용자 입력만 분리한 형태다. */
export type StatusCriteria = Pick<SearchCriteria, 'statuses'>;
