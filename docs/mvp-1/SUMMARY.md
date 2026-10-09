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
