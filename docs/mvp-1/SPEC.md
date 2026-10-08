# 청년꿀통 (youth-kkultong) — MVP 1 상세 기능 명세서

> 위치: `docs/mvp-1/SPEC.md`  
> 기준: `docs/PRD.md` / `docs/ARCHITECTURE.md` / `docs/mvp-0/SUMMARY.md`  
> 목표: **로그인 없이 실제 정책을 탐색하고, 사용자가 선택적으로 입력한 조건으로 명백히 맞지 않는 정책을 안전하게 제외할 수 있는가를 검증한다.**

---

# 0. MVP 1 핵심 목표

사용자는 로그인하지 않고 다음 흐름을 사용할 수 있어야 한다.

```text
웹 접속
→ 공개 정책 목록 확인
→ 필요한 조건만 선택
→ 명백히 맞지 않는 정책 제거
→ 남은 정책의 추가 확인 필요 조건 확인
→ 정책 상세
→ 공식 공고 이동
```

MVP1은 "지원 자격을 확정하는 서비스"가 아니다.

핵심 목표는:

```text
받을 가능성이 없는 정책은 줄이고,
판단할 수 없는 정책은 숨기지 않고,
사용자가 직접 확인해야 할 부분을 명확하게 보여주는 것
```

이다.

---

# 1. MVP0 데이터 상태를 전제로 한 제품 결정

MVP0 실제 정책 30건 분석 결과:

| 조건 | ANY | RULE | UNKNOWN |
|---|---:|---:|---:|
| age | 6 | 11 | 13 |
| region | 0 | 30 | 0 |
| income | 9 | 0 | 21 |
| status | 8 | 9 | 13 |
| householdSize | 30 | 0 | 0 |

추가:

```text
hasUnresolvedEligibilityCondition = true
30 / 30건
```

따라서 MVP1에서는 아래를 전제로 한다.

1. `UNKNOWN`을 자격 미달로 처리하지 않는다.
2. unresolved 조건이 있다고 결과에서 제외하지 않는다.
3. 현재 실제 필터 효과가 큰 조건은 나이 / 지역 / 상태다.
4. 소득 / 가구원 수는 PRD 범위에는 유지하지만 보조 입력으로 둔다.
5. 30건 데이터만으로 스키마를 영구 확정하지 않는다.
6. MVP1 진행 중 정책 수를 최소 50건 이상으로 늘려 조건 분포를 다시 검토한다.
7. 반복 빈도가 높고 안전하게 구조화 가능한 조건이 확인될 때만 다음 schema 확장을 검토한다.

---

# 2. 범위

## 2.1 포함

### 사용자 기능

- 로그인 없는 정책 목록
- 정책 카드
- 정책 상세
- 카테고리 필터
- 나이 입력
- 지역 입력
- 현재 상태 선택
- 선택형 가구원 수
- 선택형 월 가구소득
- 조건 초기화
- 조건 기반 정책 검색
- 매칭 상태 표시
- 추가 확인 필요 표시
- 공식 공고 링크

### Backend

- Public Policy API
- Meta API
- 규칙 기반 Matching Engine
- Zod request/response contract
- 공개 정책 필터링
- Pagination
- 기본 public API 보안
- 테스트

### Frontend

- Next.js App Router
- 정책 목록
- 검색 조건 UI
- 정책 상세
- 반응형 웹
- loading / empty / error 상태
- 핵심 E2E

---

## 2.2 제외

- 로그인
- 사용자 계정
- 검색 조건 영구 저장
- 북마크
- 최근 본 정책 저장
- 관리자 웹
- 자동 정책 수집
- 정책 수정 UI
- 알림
- 캘린더
- Redis
- BullMQ
- LLM
- 분석/추천 ML
- 네이티브 앱

---

# 3. 핵심 용어

## 3.1 Category Filter

카테고리는 사용자의 자격조건이 아니다.

예:

```text
주거
금융
일자리
교육
복지
기타
```

정책 목록을 관심 분야로 좁히는 일반 검색 필터다.

---

## 3.2 사용자 조건

MVP1에서 사용자가 선택적으로 입력할 수 있는 자격 관련 값:

```text
age
regionCode
statuses
householdSize
householdMonthlyIncome
```

모든 필드는 선택사항이다.

---

## 3.3 정책 조건

MVP0에서 확정한 구조를 그대로 사용한다.

```ts
type Constraint<T> =
  | { kind: 'ANY' }
  | { kind: 'RULE'; value: T }
  | { kind: 'UNKNOWN' };
```

---

# 4. 매칭 상태

## 4.1 FieldEvaluation

```ts
type FieldEvaluation =
  | 'MATCH'
  | 'MISMATCH'
  | 'POLICY_UNKNOWN'
  | 'NOT_PROVIDED';
```

### MATCH

사용자가 값을 입력했고 정책과 일치한다.

### MISMATCH

사용자가 값을 입력했고 정책과 명백히 불일치한다.

**MISMATCH가 하나라도 있으면 검색 결과에서 제외한다.**

### POLICY_UNKNOWN

사용자는 비교할 값을 입력했지만 정책 조건이 모호하거나 현재 모델로 안전하게 자동 판정할 수 없다.

결과에서 제외하지 않는다.

### NOT_PROVIDED

해당 조건을 판정하는 데 필요한 사용자 정보가 충분하지 않다.

결과에서 제외하지 않는다.

---

# 5. 정책 노출 규칙

## 5.1 기본 목록

아무 사용자 조건도 입력하지 않았을 때:

```text
공개 가능한 모든 정책
```

을 보여준다.

매칭 여부를 판단하지 않는다.

---

## 5.2 검색 결과

사용자가 조건을 입력했을 때:

```text
각 정책 평가
→ MISMATCH 하나라도 존재
   → 결과 제외

→ MISMATCH 없음
   → 결과 유지
```

즉 검색은:

```text
"확실히 맞는 정책만 보여주기"
```

가 아니라:

```text
"확실히 안 맞는 정책을 제거하기"
```

방식이다.

---

# 6. UI용 MatchSummary

API에서 다음 상태를 제공한다.

```ts
type MatchSummary =
  | 'UNASSESSED'
  | 'MATCHED'
  | 'PARTIAL'
  | 'NEEDS_CHECK';
```

### UNASSESSED

사용자 자격 조건을 하나도 입력하지 않은 일반 목록.

### MATCHED

입력된 조건이 모두 비교 가능하고 일치했으며, 정책 자체에 핵심 UNKNOWN / unresolved 조건이 없다.

### PARTIAL

입력된 조건과 충돌은 없지만 비교 가능한 정책 조건 중 사용자 입력이 부족한 항목이 있다.

### NEEDS_CHECK

입력된 조건과 충돌은 없지만 다음 중 하나가 존재한다.

```text
POLICY_UNKNOWN
hasUnresolvedEligibilityCondition=true
```

---

# 7. 현재 데이터에 대한 UI 표시 원칙

현재 정책 30건 전부 unresolved 조건이 있으므로 모든 카드를 단순히:

```text
확인 필요
```

라고만 표시하지 않는다.

사용자에게 다음 두 정보를 분리해서 보여준다.

## 7.1 입력한 조건에 대한 결과

예:

```text
입력한 조건과 충돌 없음
```

또는 조건이 충분한 경우:

```text
입력한 조건과 잘 맞아요
```

## 7.2 추가 확인 상태

별도의 작은 안내:

```text
추가 조건 확인 필요
```

상세 화면에서:

```text
자동으로 판단하기 어려운 조건이 있습니다.
최종 신청 전 공식 공고를 확인해 주세요.
```

를 보여준다.

즉:

```text
입력 조건 결과
+
추가 확인 여부
```

를 분리한다.

---

# 8. Field별 매칭 규칙

## 8.1 나이

사용자 입력:

```ts
age?: number
```

### 사용자 미입력

```text
NOT_PROVIDED
```

### 정책 ANY

사용자가 나이를 입력한 경우:

```text
MATCH
```

### 정책 UNKNOWN

```text
POLICY_UNKNOWN
```

### 정책 RULE

MVP1에서 사용자에게는 현재 나이만 입력받는다.

#### TODAY

현재 나이를 min/max와 비교한다.

```text
범위 안 → MATCH
범위 밖 → MISMATCH
```

#### FIXED_DATE / YEAR_DIFF / BIRTH_YEAR

현재 나이만으로 정확한 판정이 불가능하면:

```text
POLICY_UNKNOWN
```

으로 처리한다.

MVP1에서는 생년월일/출생연도를 새로 받지 않는다.

---

## 8.2 지역

MVP1 UI의 기본 지역 입력은 **시·도 선택**을 우선한다.

정책 조건은 기존 2자리/5자리 코드와 `KR`을 그대로 지원한다.

### KR

전국 정책:

```text
MATCH
```

### 정책이 시·도 단위

사용자 시·도와 동일:

```text
MATCH
```

다름:

```text
MISMATCH
```

### 정책이 시·군·구 단위

사용자 시·도와 정책 시·군·구의 부모 시·도가 다름:

```text
MISMATCH
```

같은 시·도지만 사용자가 상세 시·군·구를 입력하지 않은 경우:

```text
NOT_PROVIDED
```

정책을 제거하지 않는다.

---

## 8.3 현재 상태

사용자 입력:

```ts
statuses?: UserStatus[]
```

복수 선택을 허용한다.

예:

```text
학생 + 재직자
```

### ANY

```text
MATCH
```

### UNKNOWN

```text
POLICY_UNKNOWN
```

### RULE

사용자 상태와 정책 허용 상태가 하나라도 겹치면:

```text
MATCH
```

하나도 겹치지 않으면:

```text
MISMATCH
```

근속기간, 고용형태, 사업자 여부 등은 MVP1 status enum에 억지로 넣지 않는다.

---

## 8.4 가구원 수

선택 입력.

현재 30개 정책은 모두 `ANY`이므로 **주요 입력으로 강조하지 않는다.**

### ANY

사용자가 입력했다면:

```text
MATCH
```

입력하지 않았다면:

```text
NOT_PROVIDED
```

### RULE

향후 RULE이 추가될 경우 min/max 비교.

### UNKNOWN

```text
POLICY_UNKNOWN
```

---

## 8.5 소득

선택 입력.

사용자 입력:

```ts
householdMonthlyIncome?: number
householdSize?: number
```

현재 정책 30건에는 income RULE이 없으므로 검색 결과를 실제로 좁히지 않는다.

UI에서는 **추가 조건** 영역에 둔다.

### ANY

제한 없음.

### UNKNOWN

사용자가 소득을 입력해도:

```text
POLICY_UNKNOWN
```

### RULE

RULE을 계산하려면 다음 두 값이 모두 필요하다.

```text
householdMonthlyIncome
householdSize
```

둘 중 하나라도 없으면:

```text
NOT_PROVIDED
```

둘 다 있으면 해당 연도의 `median_income_table`을 조회하여:

```text
소득 비율 = 월 가구소득 / 해당 가구원수 기준 중위소득 * 100
```

을 계산한다.

정확한 해당 연도/가구원 수 기준값이 없으면 임의 대체하지 않고:

```text
POLICY_UNKNOWN
```

처리한다.

---

# 9. unresolved 조건

정책:

```text
hasUnresolvedEligibilityCondition=true
```

이면 절대 검색 결과에서 제거하지 않는다.

API는 최소 다음 값을 결과에 포함한다.

```ts
requiresManualCheck: boolean;
manualCheckNote: string | null;
```

상세 화면에서는 원문 note를 사용자가 이해할 수 있게 표시한다.

---

# 10. Public Policy 노출 조건

Public API는 다음을 만족하는 정책만 대상으로 한다.

```text
is_published = true
source_status = ACTIVE
apply_end IS NULL 또는 apply_end >= today
last_verified_at >= today - HIDE_DAYS
```

종료된 정책은 DB에서 삭제하지 않는다.

---

# 11. API

Base:

```text
/api/v1
```

## 11.1 GET /policies

목적:

```text
일반 정책 목록
```

Query:

```ts
{
  page?: number;        // default 1
  size?: number;        // default 20, max 50
  category?: PolicyCategory;
}
```

사용자 민감 조건은 GET query에 넣지 않는다.

Response:

```ts
{
  items: PolicyCard[];
  page: number;
  size: number;
  total: number;
  totalPages: number;
}
```

---

## 11.2 POST /policies/search

상태 변경 없는 조회용 POST.

Body:

```ts
{
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
```

사용자 조건은 저장하지 않는다.

Response:

```ts
{
  items: PolicySearchCard[];
  page: number;
  size: number;
  total: number;
  totalPages: number;

  appliedCriteria: {
    age: boolean;
    region: boolean;
    status: boolean;
    householdSize: boolean;
    income: boolean;
  };
}
```

각 검색 결과 item:

```ts
{
  policy: PolicyCard;
  matchSummary: MatchSummary;
  fieldEvaluations: {
    age: FieldEvaluation;
    region: FieldEvaluation;
    income: FieldEvaluation;
    status: FieldEvaluation;
    householdSize: FieldEvaluation;
  };
  requiresManualCheck: boolean;
  manualCheckNote: string | null;
}
```

`MISMATCH` 정책은 response에 포함하지 않는다.

---

## 11.3 GET /policies/:id

공개 가능한 정책만 조회한다.

비공개/종료/숨김 정책은 일반 사용자에게 존재 여부를 노출하지 않고 `404` 처리한다.

Response에 포함:

- 정책명
- 기관
- 카테고리
- 혜택
- 신청기간
- 나이
- 지역
- 상태
- 소득
- 가구원
- 미해결 조건
- 제출 서류
- 공식 URL
- 마지막 확인일

---

## 11.4 Meta API

```text
GET /api/v1/meta/regions
GET /api/v1/meta/categories
GET /api/v1/meta/statuses
```

MVP1 초기 지역 UI는 시·도 목록을 우선 제공한다.

---

# 12. Policy Card

목록 최소 표시:

```text
정책 이름
지원 금액/지원 내용
신청 기간
카테고리
지역
나이
지급 기관
```

검색 결과에서는 추가:

```text
입력 조건 상태
추가 확인 필요 여부
```

---

# 13. Home 화면

```text
[청년꿀통 소개]

[조건 검색]
카테고리
지역
나이
현재 상태

[추가 조건 열기]
가구원 수
월 가구소득

[결과 보기]
[조건 초기화]

검색 결과 18개

[Policy Card]
[Policy Card]
...
```

---

# 14. 입력 UI 우선순위

현재 데이터 분포를 기준으로:

## 기본 노출

```text
카테고리
지역
나이
현재 상태
```

## 추가 조건 영역

```text
가구원 수
가구소득
```

소득/가구원 입력이 중요하지 않다는 뜻이 아니라, 현재 정책 데이터에서 자동 비교 가능한 RULE이 부족하기 때문에 초기 화면에서 강하게 요구하지 않는 것이다.

---

# 15. 검색 동작

MVP1은 이해하기 쉬운 동작을 우선한다.

```text
조건 변경
→ "결과 보기"
→ POST /policies/search
→ 결과 갱신
```

조건 변경마다 즉시 요청하는 debounce 검색은 MVP1 필수가 아니다.

---

# 16. 조건 초기화

```text
모든 조건 제거
→ GET /policies 기본 목록
```

---

# 17. Empty State

검색 결과 0건:

```text
입력한 조건과 명확히 맞지 않는 정책을 제외한 결과가 없습니다.
조건을 일부 해제하거나 전체 정책을 확인해 보세요.
```

"받을 수 있는 정책이 없다"라고 단정하지 않는다.

---

# 18. Error State

API 실패:

```text
정책을 불러오지 못했습니다.
잠시 후 다시 시도해 주세요.
```

내부 stack을 브라우저에 노출하지 않는다.

---

# 19. 상세 페이지 UX

섹션:

```text
정책명 / 기관
지원 내용
신청 기간
자격 조건
- 나이
- 지역
- 상태
- 소득
- 가구원
추가 확인 조건
필요 서류
마지막 확인일
공식 공고 보기
```

UNKNOWN:

```text
직접 확인 필요
```

unresolved:

```text
추가 조건 확인 필요
```

---

# 20. 개인정보

MVP1에는 계정이 없다.

검색 조건:

```text
DB 영구 저장 금지
```

로그 금지:

```text
householdMonthlyIncome
생년월일
전체 검색 request body
```

사용자 이름은 받지 않는다.

---

# 21. Frontend 상태 관리

MVP1에서 Redux 등 전역 상태 도구를 추가하지 않는다.

권장:

- component/local state
- native fetch
- 소득은 URL query에 넣지 않음

---

# 22. Backend 구현 원칙

- `PolicyQueryService`: 공개 정책 조회
- `Matching`: 순수 TypeScript 함수
- `PolicyRepository`: DB 조회
- Controller: HTTP validation / service 호출 / response

불필요한 generic repository를 만들지 않는다.

---

# 23. 성능

MVP1 예상 정책 규모:

```text
30 ~ 1,000건
```

초기 전략:

```text
DB에서 공개 정책 조회
→ Node.js에서 규칙 매칭
→ MISMATCH 제거
→ 정렬
→ pagination
```

Redis/cache 없음.

목표:

```text
정책 1,000건
50 RPS
p95 500ms 이하
```

실제 목표 미달일 때만 query/index/cache 개선을 검토한다.

---

# 24. 보안

MVP1 기본:

- CORS allowlist
- security headers
- public API rate limit
- Zod validation
- ORM parameter binding
- 내부 stack 미노출
- 민감 request body 로깅 금지

로그인이 없으므로 OAuth/JWT는 추가하지 않는다.

---

# 25. 테스트

## Unit

- 나이 평가
- 지역 평가
- 상태 평가
- 소득 평가
- 가구원 평가
- 최종 summary
- UNKNOWN
- NOT_PROVIDED
- MISMATCH 제외

## Integration

- GET policies
- POST search
- GET detail
- Meta APIs
- 공개 정책 조건

## Frontend

- 정책 목록
- 필터 입력
- 결과 상태
- Empty/Error

## E2E

```text
홈 접속
→ 전체 정책
→ 나이/지역/상태 입력
→ 결과 보기
→ 결과 감소
→ 추가 확인 표시
→ 상세
→ 공식 공고 링크
```

---

# 26. 데이터 모델 재검토 시점

현재 30건으로 MVP1 구현은 시작한다.

하지만 스키마를 최종 확정하지 않는다.

MVP1 진행 중 실제 정책을 **최소 50건 이상**으로 확장하는 것을 목표로 한다.

다시 집계:

```text
age ANY/RULE/UNKNOWN
region ANY/RULE/UNKNOWN
income ANY/RULE/UNKNOWN
status ANY/RULE/UNKNOWN
householdSize ANY/RULE/UNKNOWN
unresolved 유형 빈도
```

새 조건 추가 기준:

1. 여러 정책에서 반복된다.
2. 사용자에게 물을 수 있는 명확한 값이다.
3. 정책 간 의미를 하나의 규칙으로 안전하게 정규화할 수 있다.
4. 추가했을 때 실제 검색 결과 품질이 개선된다.

단순히 많이 등장한다는 이유만으로 필드를 추가하지 않는다.

---

# 27. 성공 기준

MVP1 완료 시:

1. 로그인 없이 정책 목록 사용 가능
2. 조건 미입력 상태에서도 정책 탐색 가능
3. 나이/지역/상태로 명백한 불일치 정책 제거
4. UNKNOWN 정책은 잘못 제거되지 않음
5. unresolved 조건이 별도 표시됨
6. 상세에서 공식 공고 이동 가능
7. 소득 등 민감 검색 조건이 저장/로그되지 않음
8. PC/모바일 브라우저 기본 사용 가능
9. 핵심 E2E 통과
10. 1,000건 기준 성능 목표 검증
11. 최소 50건 기준 schema 재검토 결과 기록

---

# 28. 금지 표현

다음 표현은 사용하지 않는다.

```text
당신은 이 정책을 받을 수 있습니다.
지원 자격이 확정되었습니다.
소득 기준을 충족합니다.  # UNKNOWN일 때
```

권장:

```text
입력한 조건과 잘 맞아요
입력한 조건과 충돌이 없어요
추가 확인이 필요한 조건이 있어요
최종 신청 전 공식 공고를 확인해 주세요
```
