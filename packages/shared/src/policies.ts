/** 정렬·신청 상태·일치 태그는 한국어 표시 문구와 분리한 API 코드다. */
export type SortKey = 'recommended' | 'popular' | 'deadline' | 'newest';

export type ApplicationStatus =
  | 'ALWAYS_OPEN'
  | 'UPCOMING'
  | 'OPEN'
  | 'CLOSING_SOON'
  | 'CLOSED'
  | 'UNKNOWN';

export type MatchTag =
  | 'AGE_MATCH'
  | 'JOB_MATCH'
  | 'SCHOOL_MATCH'
  | 'REGION_RELATED'
  | 'EXTRA_REVIEW'
  | 'AGE_REVIEW'
  | 'JOB_REVIEW'
  | 'SCHOOL_REVIEW'
  | 'REGION_REVIEW';

/** 사용자 입력 정보 */
export interface UserConditions {
  age?: number; // 1~120 사이 정수, 만 나이
  regionCode?: string; // 현행 5자리 지역 코드
  jobCode?: string; // 검증된 취업 코드표의 값
  schoolCode?: string; // 검증된 학력 코드표의 값
}

/** 사용자 조건이 있으면 맞춤순, 없으면 인기순이다. 카테고리만 선택하면 조건 없음이다. */
export interface PolicySearchRequest {
  page?: number; // 기본 1
  limit?: number; // 기본 20, 최대 50
  category?: string; // 비우면 전체
  includeClosed?: boolean; // 기본 false
  sort?: SortKey;
  conditions?: UserConditions;
}

export interface PolicyCard {
  id: string; // UUID
  title: string;
  category: string | null;
  subcategory: string | null;
  benefitPreview: string;
  applicationStatus: ApplicationStatus;
  applicationPeriodText: string | null;
  applicationEndDate: string | null; // YYYY-MM-DD
  viewCount: number | null;
  score: number; // 0, 0.5, 1, ... 3.5
  tags: MatchTag[];
}

export interface PolicySearchResponse {
  items: PolicyCard[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number; // 결과가 없으면 0
  };
  appliedSort: SortKey; // 조건 없는 맞춤순 요청의 인기순 전환 등 실제 적용한 값
}

export interface PolicyDetail extends PolicyCard {
  source: string;
  externalId: string;
  description: string | null;
  benefitText: string | null;
  ageRangeText: string | null;
  jobConditionText: string | null;
  schoolConditionText: string | null;
  regionText: string | null;
  extraQualification: string | null;
  participationRestriction: string | null;
  links: { label: '신청' | '참고'; url: string }[];
}
