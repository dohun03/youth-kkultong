# 청년꿀통 (youth-kkultong) — MVP 1 PLAN.md

> 위치: `docs/mvp-1/PLAN.md`  
> 기준: `docs/ARCHITECTURE.md` / `docs/mvp-1/SPEC.md` / `docs/mvp-0/SUMMARY.md`
> 목표: **비로그인 정책 목록 → 선택 조건 검색 → 상세 → 공식 공고** 흐름을 작은 Vertical Slice 단위로 완성한다.

---

# 0. PLAN 운영 원칙

이 PLAN은 MVP0보다 작은 Step으로 나눈다.

한 Step의 목적:

```text
구현
→ 테스트
→ 사용자가 코드 검수
→ 중단
→ 다음 Step 승인
```

각 Step은 가능하면 핵심 production 파일 2~4개 수준으로 유지한다.

한 번에 MVP1 전체를 구현하지 않는다.

---

# 1. 전체 순서

```text
Step 0  MVP0 인수 확인 / 현재 코드 구조 파악
Step 1  MVP1 API 공유 Contracts
Step 2  Server Public API 기본 보안/공통 오류
Step 3  정책 목록 Backend
Step 4  Meta API
Step 5  Next.js Web 기본 구성 + 정책 목록
Step 6  정책 상세 Backend
Step 7  정책 상세 Frontend
Step 8  Matching Engine - 공통/나이
Step 9  Matching Engine - 지역/상태
Step 10 Matching Engine - 가구원/소득/최종 summary
Step 11 정책 Search API
Step 12 검색 UI - 기본 조건
Step 13 검색 UI - 추가 조건/결과 상태
Step 14 UX 정리 / 반응형 / 접근성
Step 15 E2E / API Integration / Load Test
Step 16 정책 데이터 50건+ 확장 및 schema 재평가
Step 17 MVP1 최종 검증
```

---

# Step 0. MVP0 인수 확인

## 목적

MVP0 구현을 건드리지 않고 MVP1이 사용할 계약을 확인한다.

## 작업

확인:

```text
PolicyEntity
PolicySourceEntity
RegionEntity
MedianIncomeEntity
@kkultong/contracts
PolicyConditions
BenefitAmount
PolicyImportInput
policies 30건
```

다음 상태 확인:

```text
migration 적용 가능
seed 가능
policy import 가능
server test 통과
```

MVP0 코드를 리팩터링하지 않는다.

## 결과물

코드 변경 없음이 정상이다.

## 완료 체크

- [x] MVP0 build/test 확인
- [x] MVP1에서 재사용할 type/entity 목록 확인
- [x] 기존 코드 중 MVP1과 충돌하는 구조 유무 보고

**여기서 중단.**

---

# Step 1. MVP1 API 공유 Contracts

## 목적

Frontend/Backend가 동일한 API 요청/응답 타입을 사용하도록 최소 계약을 정의한다.

## 주요 파일

```text
packages/contracts/src/policy-api.ts
packages/contracts/src/matching.ts
packages/contracts/src/index.ts
```

테스트는 기존 contracts test 위치에 추가한다.

## 구현

### Pagination

```ts
interface PaginationMeta {
  page: number;
  size: number;
  total: number;
  totalPages: number;
}
```

### PolicyCard

목록에 필요한 정보만 정의한다.

```text
id
title
agency
category
benefitSummary
benefitAmount
applyStart
applyEnd
isAlwaysOpen
region condition
age condition
requiresManualCheck
```

Entity 전체를 API로 노출하지 않는다.

### SearchCriteria

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

### Matching

```text
FieldEvaluation
MatchSummary
PolicySearchCard
PolicySearchResponse
```

각 type/schema 위에는 도메인 의미를 짧은 한글 JSDoc으로 작성한다.

## 검증

- Zod request validation test
- 잘못된 page/size
- age 범위
- householdSize 범위
- 음수 income
- invalid enum

## 복잡도 제한

- generic API response framework 만들지 않음
- API versioning abstraction 만들지 않음

## 완료 체크

- [x] 요청/응답 contract 구현
- [x] 한글 JSDoc
- [x] contracts test 통과

**여기서 중단.**

---

# Step 2. Server Public API 기본 보안 / 오류 처리

## 목적

Public API를 열기 전에 MVP1에 필요한 최소 HTTP 안전장치를 적용한다.

## 주요 파일

예:

```text
apps/server/src/main.ts
apps/server/src/common/errors/http-error.filter.ts
apps/server/src/app.module.ts
.env.example
```

새 패키지가 필요하면 작업 전에 보고한다.

## 구현

- `/api/v1` prefix
- CORS allowlist
- security headers
- `@nestjs/throttler`
- 내부 stack 비노출
- request body 전체 로깅 금지
- 환경변수:

```text
WEB_ORIGIN
API_ORIGIN
HIDE_DAYS
```

필요하다면 `STALE_DAYS`도 추가하되 UI에서 실제 사용할 요구가 있을 때만 사용한다.

## Rate Limit

MVP1의 단순 public API 보호 수준으로 시작한다.

정확한 숫자는 환경변수화하지 않아도 되며 코드 상수로 명확히 이름을 붙인다.

과도한 분산 rate limiter는 만들지 않는다.

## 테스트

- CORS 설정
- prefix
- filter가 stack을 노출하지 않는지
- throttler 설정 존재

## 복잡도 제한

- 인증 추가 금지
- Redis rate limit 금지
- custom security framework 금지

## 완료 체크

- [x] Public API 기본 보안
- [x] 공통 오류 응답
- [x] test/build

**여기서 중단.**

---

# Step 3. 정책 목록 Backend

## 목적

공개 가능한 정책 목록을 반환한다.

## 주요 파일

```text
apps/server/src/modules/policies/repositories/policy.repository.ts
apps/server/src/modules/policies/services/policy-query.service.ts
apps/server/src/modules/policies/controllers/policies.controller.ts
```

필요한 module 파일 변경은 허용한다.

## Repository

추가 기능:

```ts
findPublicPolicies({
  category,
  offset,
  limit,
  today,
  hideBefore,
})
```

DB 조건:

```text
is_published=true
source_status=ACTIVE
apply_end IS NULL OR apply_end >= today
last_verified_at >= hideBefore
```

count도 함께 제공한다.

불필요한 generic pagination repository를 만들지 않는다.

## Query Service

역할:

```text
page/size normalization
공개 정책 조회
PolicyEntity → PolicyCard 변환
Pagination 계산
```

public method에 JSDoc을 작성한다.

## Controller

```http
GET /api/v1/policies
```

Query:

```text
page
size
category
```

Zod contract 사용.

## Sorting

기본:

```text
apply_end ASC NULLS LAST
title ASC
id ASC
```

## 테스트

Integration 권장:

- 공개 정책만 노출
- 비공개 제외
- CLOSED 제외
- 마감 정책 제외
- 오래 검증되지 않은 정책 제외
- pagination
- category
- deterministic order

## 직접 확인

```bash
curl "http://localhost:3000/api/v1/policies?page=1&size=20"
```

## 완료 체크

- [x] Repository public query
- [x] Query Service
- [x] Controller
- [x] Integration test
- [x] curl 확인

**여기서 중단.**

---

# Step 4. Meta API

## 목적

Frontend 검색 UI가 enum/지역 데이터를 하드코딩하지 않고 가져오게 한다.

## 주요 파일

```text
apps/server/src/modules/meta/meta.service.ts
apps/server/src/modules/meta/meta.controller.ts
apps/server/src/modules/meta/meta.module.ts
```

## API

```http
GET /api/v1/meta/regions
GET /api/v1/meta/categories
GET /api/v1/meta/statuses
```

### regions

MVP1 초기에는 시·도(level 1) 중심.

응답:

```ts
{
  code: string;
  name: string;
}
```

### categories/statuses

contracts enum에서 반환한다.

별도 DB 테이블을 만들지 않는다.

## 테스트

- region active only
- 정렬
- enum response

## 완료 체크

- [x] regions
- [x] categories
- [x] statuses
- [x] test

**여기서 중단.**

---

# Step 5. Next.js Web 기본 구성 + 정책 목록

## 목적

브라우저에서 실제 공개 정책 목록을 볼 수 있게 한다.

## 변경 범위

`apps/web`을 Next.js App Router + TypeScript strict + Tailwind 기준으로 구성한다.

새 package 설치 목록은 작업 시작 전에 간단히 보고한다.

## 핵심 파일

가능하면:

```text
apps/web/app/page.tsx
apps/web/components/policy/PolicyCard.tsx
apps/web/lib/api/policies.ts
apps/web/app/globals.css
```

Next 설정 파일은 별도.

## 구현

Home:

```text
서비스 제목
짧은 설명
전체 정책 개수
PolicyCard 목록
pagination
```

PolicyCard:

```text
정책 이름
지원 내용
기간
카테고리
지역
나이
기관
상세 보기
```

아직 matching badge는 넣지 않는다.

## API 호출

native `fetch`.

새로운 server-state library 추가 금지.

## 상태

- Loading
- API Error
- Empty

## 반응형

최소:

```text
PC: card grid/list
Mobile: 1 column
```

디자인 시스템 구축 금지.

## 테스트

- PolicyCard render
- 목록 render
- empty/error

## 직접 확인

브라우저 `/`에서 MVP0 실제 정책이 보여야 한다.

## 완료 체크

- [x] Next.js 기본 구성
- [x] PolicyCard
- [x] 목록 API 연결
- [x] loading/error/empty
- [x] frontend test
- [x] browser 확인

**여기서 중단.**

---

# Step 6. 정책 상세 Backend

## 목적

공개 정책 한 건의 상세 정보를 반환한다.

## 주요 파일

기존 파일 중심:

```text
policy.repository.ts
services/policy-query.service.ts
controllers/policies.controller.ts
```

새 계층을 만들지 않는다.

## API

```http
GET /api/v1/policies/:id
```

공개 가능 조건은 목록과 동일하게 적용한다.

비공개/종료/숨김 정책:

```text
404
```

DB Entity를 그대로 serialize하지 않는다.

## 테스트

- normal
- invalid UUID
- not found
- unpublished 404
- closed 404
- expired 404

## 완료 체크

- [x] detail repository/service
- [x] endpoint
- [x] integration test
- [x] curl 확인

**여기서 중단.**

---

# Step 7. 정책 상세 Frontend

## 목적

정책 카드에서 상세 페이지와 공식 공고로 이동할 수 있게 한다.

## 핵심 파일

```text
apps/web/app/policies/[id]/page.tsx
apps/web/components/policy/PolicyDetail.tsx
apps/web/lib/api/policies.ts
```

## UI

표시:

```text
정책명
기관
지원 내용
신청 기간
자격 조건
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

## 테스트

- 정상 상세
- UNKNOWN 표시
- unresolved note
- 404

## 완료 체크

- [x] 상세 페이지
- [x] 공식 URL CTA
- [x] 상태 표시
- [x] browser 확인

**여기서 중단.**

---

# Step 8. Matching Engine — 공통 / 나이

## 목적

DB와 HTTP에 의존하지 않는 순수 매칭 엔진의 최소 기반과 나이 조건만 구현한다.

## 주요 파일

```text
apps/server/src/modules/matching/matching.types.ts
apps/server/src/modules/matching/evaluate-age.ts
apps/server/src/modules/matching/evaluate-policy.ts
```

테스트 파일 별도.

## MatchContext

```ts
interface MatchContext {
  today: Date;
  medianIncomeByHouseholdSize: Map<number, number>;
  regionParentByCode: Map<string, string | null>;
}
```

현재 Step에서는 필요한 값만 사용한다.

## Age

```text
미입력 → NOT_PROVIDED
ANY → MATCH
UNKNOWN → POLICY_UNKNOWN
TODAY RULE → MATCH/MISMATCH
정확 평가 불가 basis → POLICY_UNKNOWN
```

## `evaluatePolicy`

현재 Step에서는 age 결과를 조립할 최소 구조만 만든다.

"evaluator factory" 같은 미래 추상화 금지.

## 테스트

- no age
- ANY
- UNKNOWN
- TODAY min/max
- boundary
- unsupported safe basis

## 완료 체크

- [ ] types
- [ ] age evaluator
- [ ] 최소 policy evaluator
- [ ] unit tests

**여기서 중단.**

---

# Step 9. Matching Engine — 지역 / 상태

## 목적

실제 현재 데이터에서 효과가 큰 region/status를 추가한다.

## 주요 파일

```text
evaluate-region.ts
evaluate-status.ts
evaluate-policy.ts
```

## Region

지원:

```text
KR
2자리 시·도
5자리 시·군·구
parent region
```

사용자 기본 입력은 시·도.

정책이 같은 시·도 내 특정 시군구:

```text
NOT_PROVIDED
```

다른 시·도 시군구:

```text
MISMATCH
```

## Status

```text
ANY → MATCH
UNKNOWN → POLICY_UNKNOWN
RULE ↔ user statuses 교집합
```

## 테스트

Region:

```text
KR
same sido
different sido
same parent sigungu
different parent sigungu
```

Status:

```text
intersection
no intersection
ANY
UNKNOWN
not provided
```

## 완료 체크

- [ ] region
- [ ] status
- [ ] policy evaluator 연결
- [ ] unit tests

**여기서 중단.**

---

# Step 10. Matching Engine — 가구원 / 소득 / 최종 Summary

## 목적

5개 조건 평가를 완성하고 최종 결과 상태를 결정한다.

## 주요 파일

```text
evaluate-household.ts
evaluate-income.ts
evaluate-policy.ts
```

## Household

SPEC 규칙 그대로 구현한다.

## Income

RULE인데 아래 둘 중 하나가 없으면:

```text
householdMonthlyIncome
householdSize
```

결과:

```text
NOT_PROVIDED
```

Median table 값이 없으면:

```text
POLICY_UNKNOWN
```

임의 대체 금지.

## Visibility

```text
fieldEvaluations 중 MISMATCH 존재
→ excluded=true
```

## Summary

```text
사용자 조건 없음 → UNASSESSED
UNKNOWN/unresolved 존재 → NEEDS_CHECK
비교 가능한 RULE인데 입력 부족 → PARTIAL
나머지 → MATCHED
```

`requiresManualCheck`를 계산한다. 원문 `manualCheckNote`는 목록·검색 응답에 포함하지 않고, Step 6의 정책 상세 응답에서만 제공한다.

## 테스트

- income ANY
- income UNKNOWN
- missing household size
- threshold
- missing median table
- unresolved=true
- PARTIAL
- MATCHED
- NEEDS_CHECK
- MISMATCH excluded

## 완료 체크

- [ ] household
- [ ] income
- [ ] final summary
- [ ] full matching tests

**여기서 중단.**

---

# Step 11. 정책 Search API

## 목적

Matching Engine을 실제 DB 정책에 연결한다.

## 핵심 파일

기존 중심:

```text
services/policy-query.service.ts
controllers/policies.controller.ts
matching orchestration 파일
```

필요 이상으로 계층을 추가하지 않는다.

## API

```http
POST /api/v1/policies/search
```

흐름:

```text
request validation
→ 공개 정책 조회
→ 필요한 median/region context 일괄 조회
→ evaluatePolicy
→ MISMATCH 제거
→ DEADLINE sort
→ pagination
→ response
```

## 개인정보

로그 금지:

```text
householdMonthlyIncome
전체 request body
```

## 성능

MVP1에서는 공개 정책을 메모리에 가져와 평가한다.

N+1 방지:

```text
region context 일괄 조회
median 기준 일괄 조회
```

## 테스트

Integration:

- no criteria
- age mismatch remove
- region mismatch remove
- status mismatch remove
- UNKNOWN keep
- unresolved keep
- income missing context keep
- pagination
- category
- body validation

## 직접 확인

```bash
curl -X POST \
  http://localhost:3000/api/v1/policies/search \
  -H "Content-Type: application/json" \
  -d '{"age":27,"regionCode":"11","statuses":["JOB_SEEKER"]}'
```

## 완료 체크

- [ ] search endpoint
- [ ] context load
- [ ] MISMATCH filtering
- [ ] integration tests
- [ ] curl 확인

**여기서 중단.**

---

# Step 12. 검색 UI — 기본 조건

## 목적

현재 데이터에서 실제 효과가 높은 조건부터 제공한다.

## 핵심 파일

```text
apps/web/components/search/SearchPanel.tsx
apps/web/lib/api/policies.ts
apps/web/app/page.tsx
```

## 기본 노출

```text
카테고리
시·도
나이
현재 상태
```

상태는 multi-select.

## 동작

```text
조건 입력
→ 결과 보기
→ POST /policies/search
→ 목록 갱신
```

실시간 debounce search는 구현하지 않는다.

## 초기화

```text
전체 조건 reset
→ GET /policies 기본 목록
```

## 결과 문구

```text
조건에 맞지 않는 정책을 제외한 결과 18개
```

"추천 18개"처럼 자격을 확정하는 표현은 피한다.

## 테스트

- input
- submit
- reset
- request body
- result count
- empty

## 완료 체크

- [ ] primary search form
- [ ] submit
- [ ] reset
- [ ] result rendering
- [ ] frontend test
- [ ] browser 확인

**여기서 중단.**

---

# Step 13. 검색 UI — 추가 조건 / 결과 상태

## 목적

가구원/소득과 UNKNOWN/unresolved UX를 추가한다.

## 핵심 파일

```text
SearchPanel.tsx
PolicyCard.tsx
필요 시 MatchStatusBadge.tsx
```

## 추가 조건

접힘 영역:

```text
가구원 수
월 가구소득
```

설명:

```text
일부 정책은 소득 기준을 자동으로 판단하기 어려울 수 있습니다.
```

## 결과 카드

### MATCHED

```text
입력한 조건과 잘 맞아요
```

### PARTIAL

```text
입력한 조건과 충돌 없음
일부 조건은 추가 입력이 필요해요
```

### NEEDS_CHECK

```text
입력한 조건과 충돌 없음
추가 조건 확인 필요
```

현재 30건 전체가 unresolved이므로 "확인 필요"만 크게 강조하지 않는다.

## 개인정보

소득을 URL query에 넣지 않는다.

## 테스트

- advanced collapse
- income body
- MATCHED/PARTIAL/NEEDS_CHECK
- 자격 확정 문구 없음

## 완료 체크

- [ ] advanced inputs
- [ ] match display
- [ ] manual check display
- [ ] privacy 확인
- [ ] frontend tests

**여기서 중단.**

---

# Step 14. UX 정리 / 반응형 / 접근성

## 목적

핵심 흐름을 PC/모바일 브라우저에서 실제 사용할 수 있게 마무리한다.

## 범위

- 모바일 1열
- PC 적절한 최대 폭
- form label
- button disabled/loading
- keyboard focus
- error message
- empty state
- 긴 정책명/금액 대응
- 외부 링크 표시

디자인 시스템은 만들지 않는다.

## 직접 검수

```text
/
정책 상세
검색 결과 0건
API 오류
모바일 폭
```

## 완료 체크

- [ ] responsive
- [ ] loading/error/empty
- [ ] keyboard/basic accessibility
- [ ] visual overflow 확인

**여기서 중단.**

---

# Step 15. 통합 / E2E / 성능 검증

## 목적

MVP1 핵심 사용자 흐름과 현재 성능 목표를 검증한다.

## Backend Integration

```text
GET /policies
GET /policies/:id
GET /meta/*
POST /policies/search
```

## E2E

Playwright:

```text
홈
→ 정책 목록
→ 나이/지역/상태
→ 결과 보기
→ 결과 변화
→ 추가 확인 표시
→ 상세
→ 공식 공고 링크
```

## Load

별도 fixture/seed로 정책 1,000건 수준을 준비한다.

목표:

```text
50 RPS
5분
p95 <= 500ms
```

실패하면 먼저 측정한다.

검토 순서:

```text
query
→ 불필요한 DB 호출
→ Node 매칭 시간
→ index
```

Redis/cache는 자동 추가하지 않는다.

## 보안 확인

- CORS
- rate limit
- validation
- error stack
- income logging 없음

## 완료 체크

- [ ] integration
- [ ] E2E
- [ ] load
- [ ] security baseline
- [ ] 성능 위험 보고

**여기서 중단.**

---

# Step 16. 실제 정책 데이터 50건+ 확장 / Schema 재평가

## 목적

30건 표본으로 시작한 schema가 더 넓은 실제 데이터에서도 충분한지 다시 판단한다.

이 Step에서 schema를 자동 확장하지 않는다.

## 작업

실제 공식 정책을 추가해 최소 50건 이상을 목표로 한다.

재집계:

```text
age ANY/RULE/UNKNOWN
region ANY/RULE/UNKNOWN
income ANY/RULE/UNKNOWN
status ANY/RULE/UNKNOWN
householdSize ANY/RULE/UNKNOWN

hasUnresolvedEligibilityCondition
unresolved 유형별 빈도
```

검토 후보:

```text
자산
고용형태
근속기간
주택 조건
학력/성적
혼인
병역
```

## 새 조건 추가 판단 기준

모두 만족해야 후보로 본다.

1. 반복적으로 등장
2. 사용자 입력값이 명확함
3. 정책 간 의미를 하나의 rule로 안전하게 정규화 가능
4. 실제 검색 품질 개선 효과 존재

## 결과

```text
유지
추가 검토
MVP2 이후
```

로 분류해서 보고한다.

Schema/migration은 임의 변경하지 않는다.

## 완료 체크

- [ ] 50건+ 목표
- [ ] 분포 재집계
- [ ] unresolved 빈도
- [ ] schema 후보 보고
- [ ] 임의 schema 변경 없음

**여기서 중단.**

---

# Step 17. MVP1 최종 검증

## 기능

- [ ] 비로그인 정책 목록
- [ ] 카테고리
- [ ] 나이
- [ ] 지역
- [ ] 상태
- [ ] 가구원
- [ ] 소득
- [ ] 조건 초기화
- [ ] 정책 상세
- [ ] 공식 공고

## 매칭

- [ ] MISMATCH만 제외
- [ ] UNKNOWN 유지
- [ ] NOT_PROVIDED 유지
- [ ] unresolved 유지
- [ ] MATCHED/PARTIAL/NEEDS_CHECK 동작

## UX

- [ ] 자격 확정 표현 없음
- [ ] 추가 확인 상태 별도 표시
- [ ] mobile 사용 가능
- [ ] empty/error/loading

## 보안

- [ ] income 저장 안 함
- [ ] income URL 노출 없음
- [ ] 민감 body log 없음
- [ ] CORS
- [ ] rate limit
- [ ] validation

## 테스트

- [ ] contracts
- [ ] server unit
- [ ] server integration
- [ ] web test
- [ ] E2E
- [ ] load

## 데이터

- [ ] 50건+ 확장 목표 검토
- [ ] schema 재평가 보고

---

# MVP1 종료 후

MVP1이 끝나도 다음은 추가하지 않는다.

```text
로그인
북마크
알림
자동 수집
Redis
BullMQ
LLM
```

다음 순서는 PRD 기준:

```text
MVP2 정책 수집/운영 자동화
```

MVP1 결과에서 schema 개선이 필요하면 MVP2 시작 전에 별도 설계 변경으로 검토한다.
