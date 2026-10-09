# 청년꿀통 — MVP 1 SPEC 핵심요약

> 위치: `docs/mvp-1/SPEC_SUMMARY.md`  
> 원본: `docs/mvp-1/SPEC.md`  
> 용도: 사용자 검수용 요약본  
> 실제 구현 기준은 항상 `SPEC.md`

---

## 1. MVP 1 목표

로그인 없이:

```text
전체 정책 보기
→ 조건 입력
→ 명백히 안 맞는 정책 제거
→ 추가 확인 조건 확인
→ 상세
→ 공식 공고
```

를 사용할 수 있게 한다.

핵심 목적은 **자격 확정**이 아니라:

> 내가 받을 가능성이 낮은 정책을 줄여서 탐색을 쉽게 만드는 것

이다.

---

## 2. MVP 1 포함 범위

### 사용자 기능

- 비로그인 정책 목록
- 정책 카드
- 정책 상세
- 카테고리 필터
- 지역
- 나이
- 현재 상태
- 선택형 가구원 수
- 선택형 월 가구소득
- 조건 초기화
- 조건 검색
- 매칭 상태 표시
- 추가 확인 필요 표시
- 공식 공고 이동

### 기술 기능

- Public Policy API
- Meta API
- 규칙 기반 Matching Engine
- Pagination
- Zod 검증
- 기본 보안
- 반응형 Next.js UI
- Unit / Integration / E2E

---

## 3. MVP 1 제외 범위

```text
로그인
회원 계정
프로필 저장
북마크
관리자 웹
자동 정책 수집
알림
캘린더
Redis
BullMQ
LLM
네이티브 앱
```

---

## 4. 현재 정책 30건 분석 결과

| 조건 | ANY | RULE | UNKNOWN |
|---|---:|---:|---:|
| 나이 | 6 | 11 | 13 |
| 지역 | 0 | 30 | 0 |
| 소득 | 9 | 0 | 21 |
| 현재 상태 | 8 | 9 | 13 |
| 가구원 수 | 30 | 0 | 0 |

추가로:

```text
hasUnresolvedEligibilityCondition = true
30 / 30건
```

따라서 현재 실제 필터 효과가 큰 조건은:

```text
나이
지역
현재 상태
```

이다.

소득/가구원 수는 기능에는 포함하지만 **보조 입력**으로 둔다.

---

## 5. 가장 중요한 매칭 원칙

MVP1은:

```text
확실히 맞는 정책만 남기기
```

가 아니라:

```text
확실히 안 맞는 정책만 제거하기
```

방식이다.

---

## 6. 조건 평가 상태

```text
MATCH
MISMATCH
POLICY_UNKNOWN
NOT_PROVIDED
```

### MATCH
사용자가 입력했고 정책과 일치.

### MISMATCH
사용자가 입력했고 명백히 불일치.

```text
→ 정책을 검색 결과에서 제외
```

### POLICY_UNKNOWN
정책 조건이 모호하거나 현재 시스템이 정확히 판정 불가.

```text
→ 결과 유지
→ 확인 필요
```

### NOT_PROVIDED
사용자 정보가 부족해 판정할 수 없음.

```text
→ 결과 유지
```

---

## 7. 최종 표시 상태

```text
UNASSESSED
MATCHED
PARTIAL
NEEDS_CHECK
```

- `UNASSESSED`: 사용자 조건 입력 전
- `MATCHED`: 입력 조건이 명확하게 일치
- `PARTIAL`: 충돌은 없지만 사용자 입력이 부족
- `NEEDS_CHECK`: 정책 UNKNOWN 또는 unresolved 존재

---

## 8. UI/UX 핵심

현재 30건 전부 unresolved가 있으므로 모든 정책을 크게:

```text
확인 필요
```

라고만 표시하면 안 된다.

반드시 두 정보를 나눈다.

### ① 입력한 조건과의 결과

예:

```text
입력한 조건과 잘 맞아요
입력한 조건과 충돌 없음
```

### ② 별도 추가 확인 상태

```text
추가 조건 확인 필요
```

즉:

```text
현재 입력값과의 비교 결과
+
아직 자동 판단하지 못한 조건
```

을 분리한다.

---

## 9. 사용자 입력 우선순위

### 기본 화면

```text
카테고리
지역
나이
현재 상태
```

### 추가 조건 영역

```text
가구원 수
월 가구소득
```

현재 정책 데이터에서 소득/가구원은 실제 필터 효과가 거의 없으므로 처음부터 강조하지 않는다.

---

## 10. 나이 매칭

사용자는 **현재 나이**만 입력한다.

```text
ANY → MATCH
UNKNOWN → POLICY_UNKNOWN
TODAY RULE → 범위 비교
```

현재 나이만으로 정확히 판단하기 어려운:

```text
FIXED_DATE
YEAR_DIFF
BIRTH_YEAR
```

는 MVP1에서 억지 판정하지 않고:

```text
POLICY_UNKNOWN
```

처리한다.

생년월일/출생연도를 새로 받지 않는다.

---

## 11. 지역 매칭

기본 입력은 **시·도**.

지원 정책 코드는:

```text
KR
2자리 시·도
5자리 시·군·구
```

### 전국 KR
`MATCH`

### 다른 시·도
`MISMATCH`

### 같은 시·도 안의 특정 시·군·구인데 사용자 상세 지역 미입력
`NOT_PROVIDED`

---

## 12. 현재 상태 매칭

복수 선택 가능.

예:

```text
학생 + 재직자
```

정책 RULE과 하나라도 겹치면:

```text
MATCH
```

전혀 겹치지 않으면:

```text
MISMATCH
```

근속기간, 고용형태, 사업자 여부는 현재 status에 억지로 추가하지 않는다.

---

## 13. 가구원 수 / 소득

### 가구원 수

현재 30건은 전부 `ANY`.

즉 현재는 실제 결과를 좁히지 않는다.

### 소득

income RULE인 경우에만:

```text
월 가구소득
÷ 해당 가구원 수 기준 중위소득
× 100
```

으로 비교한다.

정확한 기준 중위소득 데이터가 없으면 다른 값을 대신 쓰지 않는다.

```text
POLICY_UNKNOWN
```

으로 처리한다.

현재 30건에는 income RULE이 0건이다.

---

## 14. unresolved 조건

정책이:

```text
hasUnresolvedEligibilityCondition = true
```

여도 결과에서 제외하지 않는다.

목록·검색 API/UI에서는:

```text
requiresManualCheck
```

만 보여준다. 원문 `manualCheckNote`는 정책 상세에서만 보여준다.

최종 신청 전 공식 공고 확인을 안내한다.

---

## 15. 공개 정책 기준

Public API는 기본적으로:

```text
is_published = true
source_status = ACTIVE
마감되지 않음
last_verified_at이 HIDE_DAYS 이내
```

인 정책만 보여준다.

---

## 16. 주요 API

### 전체 목록

```http
GET /api/v1/policies
```

주요 query:

```text
page
size
category
```

### 조건 검색

```http
POST /api/v1/policies/search
```

조회 전용 POST.

주요 body:

```text
category
age
regionCode
statuses
householdSize
householdMonthlyIncome
page
size
sort
```

POST 이유:

- 조건 구조가 복잡함
- 소득 값을 URL에 남기지 않음

### 상세

```http
GET /api/v1/policies/:id
```

공개할 수 없는 정책은 `404`.

### Meta

```http
GET /api/v1/meta/regions
GET /api/v1/meta/categories
GET /api/v1/meta/statuses
```

---

## 17. 검색 UX

MVP1은 단순하게:

```text
조건 입력
→ 결과 보기 버튼
→ 검색 API 호출
→ 결과 갱신
```

으로 시작한다.

조건 변경마다 자동 호출하는 실시간 검색은 나중에 필요할 때 추가한다.

초기화:

```text
모든 조건 제거
→ 전체 정책 목록
```

---

## 18. 정책 카드

기본:

```text
정책명
지원 내용
신청 기간
카테고리
지역
나이
기관
```

검색 후:

```text
입력 조건과의 상태
추가 확인 필요 여부
```

를 추가한다.

---

## 19. 정책 상세

주요 표시:

```text
정책명
기관
지원 내용
신청 기간
나이
지역
상태
소득
가구원
추가 확인 조건
필요 서류
마지막 확인일
공식 공고
```

`UNKNOWN`:

```text
직접 확인 필요
```

unresolved:

```text
추가 조건 확인 필요
```

---

## 20. 개인정보

MVP1에는 로그인/계정이 없다.

```text
검색 조건 DB 저장 금지
소득 URL 노출 금지
소득/생년월일/전체 검색 body 로그 금지
이름 입력 없음
```

---

## 21. Frontend 상태 관리

MVP1에서는:

```text
Redux 없음
별도 전역 상태 라이브러리 없음
native fetch
local/component state
```

를 기본으로 한다.

---

## 22. 성능

예상 규모:

```text
정책 30 ~ 1,000건
```

초기:

```text
DB 공개 정책 조회
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
p95 <= 500ms
```

실제 측정에서 문제가 생길 때만 고도화한다.

---

## 23. 보안

MVP1에서 구현:

```text
CORS allowlist
security headers
public API rate limit
Zod validation
ORM parameter binding
내부 stack 미노출
민감 request body logging 금지
```

JWT/OAuth는 넣지 않는다.

---

## 24. 테스트

### Unit
- 나이
- 지역
- 상태
- 가구원
- 소득
- UNKNOWN
- NOT_PROVIDED
- MISMATCH
- 최종 상태

### Integration
- 목록
- 상세
- 검색
- Meta
- 공개 정책 필터

### Frontend
- 목록
- 검색
- 매칭 표시
- loading/empty/error

### E2E

```text
홈
→ 정책 목록
→ 조건 입력
→ 결과
→ 추가 확인 표시
→ 상세
→ 공식 공고
```

---

## 25. 스키마 재검토

현재 30건으로 MVP1 구현은 시작한다.

MVP1 중 실제 정책을 최소 **50건 이상**으로 늘린 뒤 다시 분석한다.

재확인:

```text
5개 조건 ANY/RULE/UNKNOWN
unresolved 유형 빈도
반복되는 추가 조건
```

새 조건 추가 기준:

1. 여러 정책에서 반복
2. 사용자에게 명확하게 질문 가능
3. 정책 간 의미를 안전하게 하나의 규칙으로 통일 가능
4. 실제 검색 품질이 좋아짐

단순히 많이 등장한다는 이유만으로 바로 스키마를 확장하지 않는다.

---

## 26. MVP1 완료 기준

- 비로그인 사용 가능
- 조건 없이 전체 정책 탐색
- 나이/지역/상태로 명백한 불일치 제거
- UNKNOWN을 잘못 제거하지 않음
- unresolved 별도 표시
- 상세 → 공식 공고
- 민감 입력 저장/로그 없음
- PC/모바일 기본 사용
- 핵심 E2E 통과
- 1,000건 성능 검증
- 50건 이상 기준 schema 재평가 기록

---

## 27. 문구 원칙

금지:

```text
당신은 이 정책을 받을 수 있습니다.
지원 자격이 확정되었습니다.
```

권장:

```text
입력한 조건과 잘 맞아요
입력한 조건과 충돌이 없어요
추가 확인이 필요한 조건이 있어요
최종 신청 전 공식 공고를 확인해 주세요
```

---

## 28. 결론

MVP1은 **추천 확정 시스템이 아니라, 명백히 안 맞는 정책을 안전하게 제거하는 탐색 도구**다.

가장 중요한 UX는:

```text
입력한 조건과 비교한 결과
+
자동 판단하지 못한 조건
```

을 분리해서 보여주는 것이다.
