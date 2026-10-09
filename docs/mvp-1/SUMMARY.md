## Step 0. MVP0 인수 확인

### 완료 내용

- MVP1에서 재사용할 Entity를 확인했다. `PolicyEntity`, `PolicySourceEntity`, `RegionEntity`, `MedianIncomeEntity`가 각각 정책, 출처, 행정구역, 기준 중위소득 테이블에 대응한다.
- `@kkultong/contracts`의 `PolicyConditions`, `BenefitAmount`, `PolicyImportInput`은 정책 Entity와 import CLI가 공통으로 사용한다.
- `data/policies/policies.json`은 외부 식별자가 중복되지 않는 정책 30건을 포함한다.
- 별도 임시 PostgreSQL 16 컨테이너에서 실제 명령 흐름을 검증했다. migration 적용, 기준 데이터 seed, 정책 30건 import가 모두 성공했고 최종 행 수는 `regions` 284건, `median_income_table` 8건, `policy_sources` 1건, `policies` 30건이다. 임시 컨테이너는 검증 직후 삭제했다.
- MVP0 production 코드는 수정하거나 리팩터링하지 않았다.

### 검증

- `corepack pnpm --filter @kkultong/contracts typecheck` 성공
- `corepack pnpm --filter @kkultong/contracts build` 성공
- `corepack pnpm --filter @kkultong/server typecheck` 성공
- `corepack pnpm server:test` 성공: 6개 suite, 23개 test. PostgreSQL 16 Testcontainers 통합 테스트를 포함한다.
- `corepack pnpm --filter @kkultong/server build` 성공
- 임시 PostgreSQL에서 `db:migrate` → `db:seed` → `policy:import` 성공

### 인수 결과 및 주의사항

- MVP1 구현을 막는 코드 구조 충돌은 없다. Step 1은 기존 `@kkultong/contracts` 공개 진입점에 API 계약을 추가하는 방식으로 진행할 수 있다.
- 기존 개발 Compose DB에는 MVP0 migration 이력이 있으나 정책 행은 0건이고, named volume의 기존 비밀번호가 현재 `docker-compose.yml`의 예시와 달라 애플리케이션의 TCP 연결 인증에 실패한다. 이번 Step에서는 기존 개발 DB를 수정하지 않았다. 다음 로컬 실행 전에는 개발 DB의 연결 설정을 정리한 뒤 seed와 정책 import를 다시 수행해야 한다.

## Step 1. MVP1 API 공유 Contracts

### 완료 내용

- `@kkultong/contracts`에 페이지네이션, 정책 목록 카드·응답, 조건 검색 요청, 검색 결과·매칭 상태 계약을 추가했다.
- `PolicyListQuerySchema`와 `SearchCriteriaSchema`는 page 1, size 20 기본값 및 최대 size 50을 적용한다.
- 나이(0~120), 가구원 수(양의 정수), 월 가구소득(0 이상의 정수), 지역 코드, 카테고리·상태 enum을 Zod로 검증한다.
- 모든 새 공개 type과 schema에 도메인 의미를 설명하는 한글 JSDoc을 작성했고, 패키지 공개 진입점에서 export했다.
- 목록 카드와 검색 결과에는 `requiresManualCheck`만 포함한다. 원문 `manualCheckNote`는 이후 정책 상세 응답 전용으로 제공하도록 SPEC과 계약을 정리했다.
- 서버 API와 DB는 아직 구현하거나 변경하지 않았다. 이 계약은 이후 Step에서 공통으로 사용한다.

### 검증

- `corepack pnpm --filter @kkultong/contracts exec jest --runInBand` 성공: 2개 suite, 35개 test
- `corepack pnpm --filter @kkultong/contracts typecheck` 성공
- `corepack pnpm --filter @kkultong/contracts build` 성공
- `git diff --check` 성공

## Step 2. Server Public API 기본 보안 / 오류 처리

### 완료 내용

- 모든 HTTP route에 `/api/v1` global prefix를 적용했다.
- `WEB_ORIGIN` 한 곳만 CORS allowlist로 허용한다. Origin 헤더가 없는 서버 간 요청은 CORS 대상이 아니므로 허용하며, 그 외 브라우저 Origin에는 CORS 응답 헤더를 반환하지 않는다.
- API 응답에는 CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` 기본 보안 헤더를 설정했다.
- `@nestjs/throttler`를 추가하고, Redis 없이 메모리 기반으로 단일 IP당 1분 60회 요청 제한을 전역 적용했다.
- `HttpErrorFilter`가 모든 오류를 `{ statusCode, message }` 형식으로 반환한다. 예상하지 못한 오류의 message와 stack은 브라우저에 노출하지 않는다.
- request body를 기록하는 HTTP logger를 등록하지 않았다. 이후 검색 조건 API가 추가돼도 소득 등 민감 조건의 전체 body가 로그에 남지 않도록 하는 기준이다.
- `WEB_ORIGIN`, `API_ORIGIN`, `HIDE_DAYS`를 환경 변수 schema와 `.env.example`에 추가했다. `STALE_DAYS`는 현재 UI 요구가 없으므로 추가하지 않았다.

### 검증

- `corepack pnpm --filter @kkultong/server typecheck` 성공
- `corepack pnpm --filter @kkultong/server exec jest --runInBand` 성공: 9개 suite, 30개 test
- `corepack pnpm --filter @kkultong/server build` 성공
- `git diff --check` 성공

## Step 3. 정책 목록 Backend

### 완료 내용

- `PolicyRepository.findPublicPolicies`가 공개 여부, ACTIVE 출처, 신청 마감일, `HIDE_DAYS` 검증일을 한 DB query에 적용하고 전체 건수를 함께 반환한다.
- `PolicyQueryService`가 목록 query의 page·size를 정규화하고, `PolicyEntity`를 공개용 `PolicyCard`로 변환한다. 기본 정렬은 신청 마감일, 정책명, id 순서이며 마감일이 없는 정책은 마지막에 둔다.
- `GET /api/v1/policies`를 추가했다. `page`, `size`, `category`는 공유 Zod 계약으로 검증하며 유효하지 않은 query는 400으로 거부한다.
- Nest 모듈에서 기존 TypeORM `DataSource`를 초기화해 별도 ORM 패키지 없이 정책 목록 API의 DB 연결을 제공한다.
- 정책 모듈은 NestJS 관례에 맞춰 HTTP 진입점을 `controllers/`, 조회·저장 흐름을 `services/`로 분리했다.
- 목록 카드와 검색 결과 계약은 `requiresManualCheck`만 포함한다. 원문 `manualCheckNote`는 정책 상세 응답에서만 제공하도록 SPEC과 공유 계약을 정리했다.

### 검증

- `corepack pnpm --filter @kkultong/contracts exec jest --runInBand` 성공: 2개 suite, 35개 test
- `corepack pnpm --filter @kkultong/server exec jest --runInBand` 성공: 10개 suite, 35개 test. PostgreSQL 16 Testcontainers로 공개 조건, pagination, category, 고정 정렬, query validation을 확인했다.
- `corepack pnpm --filter @kkultong/contracts typecheck` 성공
- `corepack pnpm --filter @kkultong/server typecheck` 성공
- `corepack pnpm --filter @kkultong/server build` 성공
- 임시 PostgreSQL에 migration·seed·정책 30건 import 후 `curl "http://127.0.0.1:3002/api/v1/policies?page=1&size=20"` 성공: 공개 조건을 만족한 24건과 정책 카드 응답을 확인했다. 임시 서버와 컨테이너는 검증 후 제거했다.

## Step 4. Meta API

### 완료 내용

- `GET /api/v1/meta/regions`가 활성 상태인 시·도(level 1)만 행정 코드 순서로 `{ code, name }` 목록에 반환한다. 시·군·구와 비활성 지역은 MVP1 초기 검색 UI에 필요하지 않아 제외한다.
- `GET /api/v1/meta/categories`, `GET /api/v1/meta/statuses`가 각각 `@kkultong/contracts`의 `POLICY_CATEGORIES`, `USER_STATUSES`를 그대로 반환한다. 별도 메타 테이블은 만들지 않았다.
- Meta 모듈은 기존 정책 모듈의 TypeORM `DataSource`를 공유한다. 애플리케이션에서 DB 연결을 중복 초기화하지 않으면서 Meta API가 기존 지역 기준 데이터를 조회한다.

### 검증

- PostgreSQL 16 Testcontainers 통합 테스트에서 활성 시·도 필터, 행정 코드 정렬, 카테고리·상태 enum 응답을 검증했다.
- `corepack pnpm --filter @kkultong/server typecheck` 성공
- `corepack pnpm --filter @kkultong/server exec jest --runInBand` 성공
- `corepack pnpm --filter @kkultong/server build` 성공
- `git diff --check` 성공

## Step 5. Next.js Web 기본 구성 + 정책 목록

### 완료 내용

- `apps/web`에 Next.js App Router, TypeScript strict, Tailwind CSS 기반 웹 앱을 구성했다. 기본 개발·실행 포트는 API CORS 설정과 같은 `3001`이다.
- 홈 화면은 서비스 소개, 현재 공개 정책 전체 수, 반응형 정책 카드 목록과 페이지네이션을 제공한다. 넓은 화면은 최대 3열 grid, 모바일은 1열로 표시한다.
- `PolicyCard`는 정책명, 지원 내용, 신청 기간, 카테고리, 지역, 나이, 기관, 상세 보기 링크를 보여 준다. Step 5 범위를 지켜 매칭 badge나 검색 조건 UI는 추가하지 않았다.
- 브라우저의 native `fetch`로 `GET /api/v1/policies`를 호출하며, 로딩·API 오류(재시도)·빈 목록 상태를 각각 표시한다. 별도 server-state 라이브러리는 추가하지 않았다.
- 프런트엔드 의존성으로 Next.js·React·Tailwind 및 Vitest/Testing Library를 추가했다. Turbopack은 이 실행 환경에서 Tailwind 변환 프로세스의 포트 권한 오류가 발생해, `build`는 안정적으로 검증된 Webpack 경로를 사용한다.

### 검증

- `corepack pnpm --filter @kkultong/web typecheck` 성공
- `corepack pnpm --filter @kkultong/web test` 성공: 1개 suite, 4개 test. PolicyCard 필수 정보, 목록·전체 건수, empty, error 상태를 검증했다.
- `corepack pnpm --filter @kkultong/web build` 성공: Next.js Webpack production build
- `git diff --check` 성공
- 임시 PostgreSQL 16에 migration·seed·정책 30건 import 후 API를 확인했다. `http://127.0.0.1:3000/api/v1/policies?page=1&size=20`은 공개 정책 24건 중 20건을 반환했고, 첫 정책은 `2026 국가근로장학금`이었다. 웹 앱 `/`은 `200`과 `청년꿀통` 제목으로 응답했다. 검증용 웹·API 프로세스와 DB 컨테이너는 모두 종료·삭제했다.

## Step 6. 정책 상세 Backend

### 완료 내용

- `GET /api/v1/policies/:id`를 추가했다. UUID v4 형식이 아닌 id는 400으로 거부한다.
- 상세 조회도 목록과 동일하게 공개 여부, ACTIVE 출처, 신청 마감일, `HIDE_DAYS` 기준 마지막 확인일을 적용한다. 조건을 충족하지 않는 비공개·종료 출처·마감·오래된 검증 정책과 존재하지 않는 id는 구분하지 않고 모두 404로 처리한다.
- 공유 contracts에 `PolicyDetail`을 추가했다. 상세 응답에는 다섯 가지 자격 조건, 미해결 조건 여부와 원문, 필요 서류, 공식 URL, 마지막 확인일을 포함한다.
- DB Entity를 그대로 직렬화하지 않아 `sourceStatus`, `isPublished`, 출처 같은 내부 관리 필드는 API 응답에서 제외했다.

### 검증

- PostgreSQL 16 Testcontainers 통합 테스트에서 정상 상세 응답, 잘못된 UUID 400, 존재하지 않는 정책 404, 비공개·종료 출처·마감·오래된 검증 정책 404를 확인했다.
- `corepack pnpm --filter @kkultong/contracts exec jest --runInBand` 성공: 2개 suite, 35개 test
- `corepack pnpm --filter @kkultong/server exec jest --runInBand` 성공: 11개 suite, 40개 test
- `corepack pnpm --filter @kkultong/contracts typecheck` 성공
- `corepack pnpm --filter @kkultong/contracts build` 성공
- `corepack pnpm --filter @kkultong/server typecheck` 성공
- `corepack pnpm --filter @kkultong/server build` 성공
- `curl http://127.0.0.1:3000/api/v1/policies/30ce595b-443c-4f8b-86db-aa6d9d549c4c`로 실제 상세 응답을 확인했다.
- `git diff --check` 성공

## Step 7. 정책 상세 Frontend

### 완료 내용

- `apps/web/app/policies/[id]/page.tsx`를 추가해 목록 카드의 상세 보기 링크가 정책 상세 화면으로 이동한다.
- `PolicyDetail`이 `GET /api/v1/policies/:id`를 호출해 정책명·기관·지원 내용·신청 기간·다섯 가지 자격 조건·추가 확인 조건·필요 서류·마지막 확인일을 표시한다.
- UNKNOWN 자격 조건은 `직접 확인 필요`로, 미해결 조건은 `추가 조건 확인 필요`와 원문 메모로 표시한다.
- 공식 공고 CTA는 새 탭으로 열며 `rel="noreferrer"`를 적용했다.
- 로딩, API 오류(재시도), API 404 안내 상태를 컴포넌트 로컬 state로 처리한다. 별도 전역 상태 라이브러리는 추가하지 않았다.

### 검증

- `corepack pnpm --filter @kkultong/web typecheck` 성공
- `corepack pnpm --filter @kkultong/web test` 성공: 2개 suite, 8개 test. 정상 상세, UNKNOWN, 미해결 원문, 404 상태를 검증했다.
- `corepack pnpm --filter @kkultong/web build` 성공: Next.js Webpack production build. `/policies/[id]` 동적 route 생성을 확인했다.
- 실행 중인 로컬 웹 앱에서 `http://127.0.0.1:3001/policies/30ce595b-443c-4f8b-86db-aa6d9d549c4c`가 200으로 응답하고 상세 화면의 로딩 상태를 반환하는 것을 확인했다. 이 환경에는 브라우저 자동 제어 도구가 없어 클릭 상호작용은 컴포넌트 테스트로 확인했다.
- `git diff --check` 성공

## Step 8. Matching Engine — 공통 / 나이

### 완료 내용

- DB, HTTP, 현재 시각 직접 조회에 의존하지 않는 순수 매칭 엔진의 `MatchContext`, `MatchablePolicy`, `PolicyEvaluation` 최소 타입을 추가했다. 날짜와 기준 데이터는 호출자가 `MatchContext`로 주입한다.
- `evaluateAge`는 사용자 나이 미입력 시 `NOT_PROVIDED`, 정책 `ANY` 시 `MATCH`, `UNKNOWN` 시 `POLICY_UNKNOWN`을 반환한다.
- `TODAY` 나이 RULE은 min/max 경계를 포함해 비교하며, `FIXED_DATE`·`YEAR_DIFF`·`BIRTH_YEAR`처럼 현재 나이만으로 확정할 수 없는 기준은 정책을 제외하지 않도록 `POLICY_UNKNOWN`으로 처리한다.
- `evaluatePolicy`는 이후 조건 평가에도 유지할 순수 함수 계약으로 `policy`, `criteria`, `context`를 받고, 이번 Step 범위에서는 나이 결과만 조립한다.

### 검증

- `corepack pnpm --filter @kkultong/server exec jest src/modules/matching/evaluate-age.spec.ts --runInBand` 성공: 1개 suite, 8개 test
- `corepack pnpm --filter @kkultong/server exec jest --runInBand` 성공: 12개 suite, 48개 test. PostgreSQL 16 Testcontainers 통합 테스트를 포함한다.
- `corepack pnpm --filter @kkultong/server typecheck` 성공
- `corepack pnpm --filter @kkultong/server build` 성공
- `git diff --check` 성공

## Step 9. Matching Engine — 지역 / 상태

### 완료 내용

- `evaluateRegion`은 전국(`KR`), 시·도, 시·군·구 정책 조건을 평가한다. 동일 시·도에 한정된 특정 시·군·구 정책은 사용자 시·도 입력만으로 확정하지 않아 `NOT_PROVIDED`로 남긴다.
- 시·군·구의 부모 시·도를 `MatchContext`에서 찾지 못하면 임의로 불일치 처리하지 않고 `POLICY_UNKNOWN`으로 처리한다.
- `evaluateStatus`는 사용자 상태와 정책 허용 상태의 교집합으로 `MATCH` 또는 `MISMATCH`를 결정하며, ANY·UNKNOWN·미입력 상태도 구분한다.
- `evaluatePolicy`가 나이·지역·상태 평가를 하나의 결과 객체로 조립하도록 확장했다. 가구원·소득·최종 summary는 Step 10 범위로 남겼다.

### 검증

- `corepack pnpm --filter @kkultong/server exec jest src/modules/matching --runInBand` 성공: 3개 suite, 21개 test
- `corepack pnpm --filter @kkultong/server exec jest --runInBand` 성공: 14개 suite, 61개 test. PostgreSQL 16 Testcontainers 통합 테스트를 포함한다.
- `corepack pnpm --filter @kkultong/server typecheck` 성공
- `corepack pnpm --filter @kkultong/server build` 성공
- `git diff --check` 성공

## Step 10. Matching Engine — 가구원 / 소득 / 최종 Summary

### 완료 내용

- 가구원 수 ANY·UNKNOWN·RULE 범위 평가를 추가했다.
- 소득 RULE은 월 가구소득과 가구원 수를 모두 요구하고, 해당 가구원 수의 기준 중위소득이 없으면 임의 대체 없이 `POLICY_UNKNOWN`으로 처리한다.
- `evaluatePolicy`가 다섯 조건을 모두 평가해 `excluded`, `matchSummary`, `requiresManualCheck`을 계산한다. `MISMATCH`만 제외하며, `POLICY_UNKNOWN` 및 미해결 조건은 결과에 남겨 `NEEDS_CHECK`으로 표시한다.
- 사용자 입력이 전혀 없으면 `UNASSESSED`, 입력이 부족한 비교 가능 RULE이 있으면 `PARTIAL`, 나머지는 `MATCHED`로 결정한다.

### 검증

- `corepack pnpm --filter @kkultong/server exec jest src/modules/matching --runInBand` 성공: 6개 suite, 34개 test
- `corepack pnpm --filter @kkultong/server exec jest --runInBand` 성공: 17개 suite, 74개 test. PostgreSQL 16 Testcontainers 통합 테스트를 포함한다.
- `corepack pnpm --filter @kkultong/server typecheck` 성공
- `corepack pnpm --filter @kkultong/server build` 성공
- `git diff --check` 성공

## Step 11. 정책 Search API

### 완료 내용

- `POST /api/v1/policies/search`를 추가했다. 검색 조건은 URL query가 아닌 body로 받고, 공유 `SearchCriteriaSchema`으로 검증해 잘못된 입력은 400으로 거부한다.
- 공개 조건을 만족한 정책 전체를 마감일 순으로 조회하고, 카테고리 배열이 있으면 DB에서 먼저 좁힌 뒤 메모리에서 `evaluatePolicy`를 실행한다. `MISMATCH`가 하나라도 있는 정책만 제거하고 그 후 pagination을 적용한다.
- 지역 부모 관계와 요청 시각의 연도에 해당하는 기준 중위소득은 각각 한 번의 조회로 읽어 `MatchContext`에 전달한다. 정책별 DB 조회는 하지 않는다.
- 검색 응답에 정책 카드, 필드별 평가, 최종 매칭 상태, 추가 확인 여부와 실제 적용된 조건을 반환한다. 검색 조건은 저장하거나 로그에 기록하지 않는다.

### 검증

- PostgreSQL 16 Testcontainers 통합 테스트에서 조건 없음, 나이·지역·상태 불일치 제거, UNKNOWN·미해결 조건 유지, 중위소득 기준값 누락 유지, category, pagination, body validation을 검증했다.
- `corepack pnpm server:test` 성공: 17개 suite, 79개 test.
- `corepack pnpm --filter @kkultong/server typecheck` 성공
- `corepack pnpm --filter @kkultong/server build` 성공
- 임시 PostgreSQL에 migration·seed·정책 30건 import 후 `curl -X POST http://127.0.0.1:3002/api/v1/policies/search`로 `{ "age": 27, "regionCode": "11", "statuses": ["JOB_SEEKER"] }` 요청을 확인했다. 응답은 16건, `appliedCriteria`, 정책별 `fieldEvaluations` 및 `matchSummary`를 포함했다. 검증용 DB 컨테이너는 종료·삭제했다.
- `git diff --check` 성공

## Step 12. 검색 UI — 기본 조건

### 완료 내용

- 홈 화면에 `SearchPanel`을 연결해 카테고리, 시·도, 나이, 다중 선택 가능한 현재 상태를 제공했다. 선택지는 기존 Meta API에서 읽어 하드코딩하지 않았다.
- 결과 보기 시 입력한 조건만 JSON body에 담아 `POST /api/v1/policies/search`를 호출하고, 명백한 불일치 정책을 제외한 결과 수와 정책 카드를 표시한다. 실시간 검색은 추가하지 않았다.
- 조건 초기화는 입력값을 모두 비우고 `GET /api/v1/policies` 기본 목록으로 전환한다. 기존 페이지 이동도 검색·기본 목록 양쪽에서 유지했다.
- 검색 결과 0건은 자격을 단정하지 않는 안내 문구를 제공하고, 오류와 로딩 상태에서는 재시도 UI를 제공한다.
- Node 24에서 Next가 TypeScript CLI 설정 출력을 읽지 못해 build가 중단되는 문제를 피하도록 TypeScript API 경로를 사용하게 설정했다.

### 검증

- `corepack pnpm --filter @kkultong/web typecheck` 성공
- `corepack pnpm --filter @kkultong/web test` 성공: 3개 suite, 13개 test. 기본 입력, submit body, reset의 GET 재호출, 결과 수, empty 상태를 확인했다.
- `corepack pnpm --filter @kkultong/web build` 성공: Next.js Webpack production build
- 빌드된 로컬 웹 앱의 `/`가 200으로 응답하고 조건 검색, 카테고리, 현재 상태, 결과 보기, 조건 초기화 UI 문자열을 반환하는 것을 확인했다. 이 환경에는 브라우저 자동 제어 도구가 없어 상호작용은 컴포넌트 테스트로 검증했다.
- `git diff --check` 성공

## Step 13. 검색 UI — 추가 조건 / 결과 상태

### 완료 내용

- `SearchPanel`에 접을 수 있는 추가 조건 영역을 추가했다. 가구원 수와 월 가구소득은 기본 조건보다 뒤에 노출하며, 소득 기준은 자동 판정하기 어려울 수 있다는 설명을 함께 표시한다.
- 두 보조 입력은 값이 있을 때만 검색 요청의 JSON body에 `householdSize`, `householdMonthlyIncome`으로 담긴다. URL query에 소득·가구원 값을 넣지 않는다.
- 검색 결과 `PolicyCard`는 `MATCHED`, `PARTIAL`, `NEEDS_CHECK` 상태에 따라 입력 조건 결과를 표시한다. `requiresManualCheck`와 `NEEDS_CHECK`는 별도의 작은 `추가 조건 확인 필요` 안내로 처리해, 현재 미해결 조건이 많은 데이터에서 카드 전체를 과도하게 경고하지 않는다.
- 자격 확정 표현은 사용하지 않았고, 일반 정책 목록 카드에는 검색 결과 상태를 표시하지 않는다.

### 검증

- `corepack pnpm --filter @kkultong/web typecheck` 성공
- `corepack pnpm --filter @kkultong/web test` 성공: 3개 suite, 17개 test. 추가 조건 접힘, 소득·가구원 request body, MATCHED/PARTIAL/NEEDS_CHECK, 자격 확정 문구 미사용을 확인했다.
- `corepack pnpm --filter @kkultong/web build` 성공: Next.js Webpack production build
- `git diff --check` 성공
