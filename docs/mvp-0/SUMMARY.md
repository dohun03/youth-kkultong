## Phase 0. Workspace / 프로젝트 기반

### 완료 내용

- pnpm workspace를 구성해 `apps/*`, `packages/*`를 패키지 범위로 등록했다.
- `apps/server`에 NestJS 11 및 TypeScript strict 기반을 만들었다. 현재는 서버 부팅에 필요한 최소 `AppModule`, `main.ts`만 포함하며, DB·API 기능은 이후 Phase에서 추가한다.
- `packages/contracts`에 `@kkultong/contracts` 패키지와 typecheck 설정을 추가했다. 정책 enum과 Zod schema는 Phase 2 범위이므로 아직 정의하지 않았다.
- 루트에 `server:dev`, `server:test`, `db:migrate`, `db:revert`, `db:seed`, `policy:validate`, `policy:import` 명령 진입점을 구성했다. DB 및 policy 명령의 실제 구현은 해당 Phase에서 연결한다.
- `node_modules`, 빌드 결과물, 환경 파일이 Git에 포함되지 않도록 `.gitignore`를 구성했다.

### 주요 파일

- `package.json`: workspace 공통 스크립트와 pnpm 버전 선언
- `pnpm-workspace.yaml`: pnpm workspace 범위
- `apps/server/src/main.ts`, `apps/server/src/app.module.ts`: NestJS 최소 실행 기반
- `apps/server/tsconfig.json`, `apps/server/jest.config.cjs`: 엄격한 TypeScript 및 Jest 설정
- `packages/contracts/src/index.ts`: 향후 공유 계약의 공개 진입점

### 검증

- `corepack pnpm install` 성공
- `corepack pnpm --filter @kkultong/server build` 성공
- `corepack pnpm --filter @kkultong/contracts typecheck` 성공
- `corepack pnpm server:test` 성공 (Phase 0에는 테스트 대상이 없어 `--passWithNoTests` 적용)

## Phase 1. PostgreSQL / 환경설정

### 완료 내용

- PostgreSQL 16만 포함한 개발용 `docker-compose.yml`을 추가했다. 데이터는 `kkultong_postgres` named volume으로 유지한다.
- `.env.example`에 `NODE_ENV`, `DATABASE_URL`, `MAX_HOUSEHOLD_SIZE`만 정의했다. 이후 MVP 범위인 JWT·Redis·LLM 관련 변수는 추가하지 않았다.
- Zod 기반 환경변수 schema를 추가해 앱 시작 시 PostgreSQL URL, 실행 환경, 양의 정수 가구원 수를 검증한다. 잘못된 값은 명확한 오류 메시지와 함께 즉시 실패한다.
- TypeORM `DataSource`를 PostgreSQL 연결, 향후 entity/migration 탐색 경로, `synchronize: false`로 구성했다. migration은 다음 Phase에서 추가한다.
- `AppModule`에 전역 `ConfigModule`을 연결해 서버 시작 경로에서도 같은 환경변수 검증을 적용했다.

### 주요 파일

- `docker-compose.yml`: PostgreSQL 16 개발 컨테이너
- `.env.example`: 로컬 실행 환경변수 예시
- `apps/server/src/common/config/env.schema.ts`: 환경변수 Zod schema 및 검증 함수
- `apps/server/src/database/datasource.ts`: TypeORM DataSource
- `apps/server/src/common/config/env.schema.spec.ts`, `apps/server/src/database/datasource.spec.ts`: 환경변수 및 DataSource 설정 검증

### 검증

- `corepack pnpm --filter @kkultong/server build` 성공
- `corepack pnpm --filter @kkultong/server test` 성공 (2개 suite, 5개 test)
- `docker compose config --quiet` 성공
- `docker compose up -d postgres` 및 컨테이너 내부 `pg_isready` 성공
- 동일 Compose 네트워크에서 실제 `datasource.ts`의 `DataSource.initialize()` 성공

## Phase 2. Policy Contracts / Zod

### 완료 내용

- `@kkultong/contracts`에 정책 카테고리, 사용자 상태, 출처 타입의 공통 열거값과 TypeScript 타입을 정의했다.
- Canonical Policy Zod schema를 추가했다. NumberRange, 나이 기준과 나이 조건, 소득 조건, 5개 Constraint 조건, 혜택 금액, 정책 import 배열을 포함한다.
- `ANY`·`UNKNOWN`에 `value`가 포함되거나 혜택 종류와 맞지 않는 금액 필드가 전달되는 것을 strict object로 차단했다.
- 실제 존재하지 않는 날짜, HTTP(S)가 아닌 공식 URL, 기간 순서 오류, 상시 정책의 마감일, 미확인 자격 사유 누락, 파일 내 `externalId` 중복을 검증한다.
- DB를 조회하는 지역 코드 존재 여부 검증은 Phase 5의 `PolicyWriteService` 범위로 남겼다. 이번 단계에서는 지역 코드 형식과 중복만 검증한다.

### 주요 파일

- `packages/contracts/src/enums.ts`: 공통 enum과 TypeScript 타입
- `packages/contracts/src/policy.ts`: 정책 입력 Zod schema 및 추론 타입
- `packages/contracts/src/index.ts`: contracts 공개 export
- `packages/contracts/test/policy.spec.ts`: 정상 및 오류 정책 입력 검증 테스트
- `packages/contracts/jest.config.cjs`: contracts Jest 설정

### 검증

- `corepack pnpm --filter @kkultong/contracts typecheck` 성공
- `corepack pnpm --filter @kkultong/contracts test` 성공 (1개 suite, 12개 test)
- `corepack pnpm --filter @kkultong/contracts build` 성공

## Phase 3. MVP0 Migration / Entity

### 완료 내용

- `pgcrypto` 확장과 함께 MVP 0에 필요한 `regions`, `median_income_table`, `policy_sources`, `policies` 4개 테이블만 생성하는 TypeORM migration을 추가했다.
- 정책 테이블에 출처·외부 식별자 고유성, 카테고리·출처 상태·URL·신청 기간·상시 신청·미확인 자격 조건 제약과 정책 조회용 인덱스를 구성했다.
- 4개 테이블에 대응하는 TypeORM Entity를 추가했다. 정책의 `benefitAmount`, `conditions`는 JSONB로, `requiredDocs`는 PostgreSQL `text[]`로 매핑했다.
- 서버 패키지가 공유 계약 타입을 참조하도록 workspace 내부 `@kkultong/contracts` 의존성을 연결했다. 외부 패키지는 추가하지 않았다.
- 루트의 `db:migrate`, `db:revert` 명령이 실제 TypeORM migration CLI를 실행하도록 연결했다.

### 주요 파일

- `apps/server/src/database/migrations/001-mvp0-core-policy.ts`: 4개 핵심 테이블의 up/down migration
- `apps/server/src/modules/meta/entities/region.entity.ts`: 지역 Entity
- `apps/server/src/modules/meta/entities/median-income.entity.ts`: 기준 중위소득 Entity
- `apps/server/src/modules/policies/entities/policy-source.entity.ts`: 정책 출처 Entity
- `apps/server/src/modules/policies/entities/policy.entity.ts`: 정책 Entity
- `apps/server/package.json`: DB migration/revert 명령 및 contracts workspace 의존성

### 검증

- `corepack pnpm --filter @kkultong/contracts build` 성공
- `corepack pnpm --filter @kkultong/server typecheck` 성공
- `corepack pnpm --filter @kkultong/server test` 성공 (2개 suite, 5개 test)
- `corepack pnpm --filter @kkultong/server build` 성공
- 빈 임시 PostgreSQL에서 migration 적용 성공 → revert 성공 → 재적용 성공
- 프로젝트 PostgreSQL에서 migration 적용 성공. 4개 테이블, 4개 지정 인덱스, `policies`의 6개 CHECK 제약조건과 1개 UNIQUE 제약조건을 확인했다.

## Phase 4. Seed

### 완료 내용

- `MANUAL` 정책 출처를 `code` 기준으로 idempotent upsert하도록 구현했다.
- 행정안전부 2026-07-01 행정구역 코드에서 시·도 16건과 시·군·구 268건을 추출해 `regions.json`으로 관리한다. 시·군·구가 아닌 출장소와 이름 없는 코드 행은 제외했다.
- 보건복지부 고시의 2026년 기준 중위소득을 가구원 수 1~8인 범위로 `median-income.json`에 저장했다. 8인 금액은 고시에 명시된 7인·6인 차액 산식으로 확정했다.
- seed runner는 정책 출처 → 상위 지역 → 하위 지역 → 기준 중위소득 순서로 하나의 transaction 안에서 실행한다. 파일 읽기와 DB 초기 연결은 일시 오류에 대비해 재시도하며, 실패 시 오류를 반환한다.
- 데이터는 `upsert`만 사용하므로 반복 실행해도 행이 중복되지 않는다.

### 주요 파일

- `apps/server/src/database/seeds/data/regions.json`: 행정안전부 기준 지역 코드 284건
- `apps/server/src/database/seeds/data/median-income.json`: 2026년 기준 중위소득 8건
- `apps/server/src/database/seeds/seed-policy-sources.ts`: MANUAL 출처 seed
- `apps/server/src/database/seeds/seed-regions.ts`: 지역 seed
- `apps/server/src/database/seeds/seed-median-income.ts`: 기준 중위소득 seed
- `apps/server/src/database/seeds/run-seeds.ts`: transaction 기반 실행 진입점
- `apps/server/src/database/seeds/seeds.spec.ts`: 데이터·upsert 순서 검증

### 검증

- `corepack pnpm --filter @kkultong/server typecheck` 성공
- `corepack pnpm --filter @kkultong/server test` 성공 (3개 suite, 7개 test)
- `corepack pnpm --filter @kkultong/server build` 성공
- 프로젝트 PostgreSQL에서 seed를 2회 실행했다. 최종 행 수는 `policy_sources` 1건, `regions` 284건, `median_income_table` 8건으로 중복이 없음을 확인했다.

## Phase 5. Policy Repository / PolicyWriteService

### 완료 내용

- 모든 정책 저장을 `PolicyWriteService`로 통일했다. 이후 CLI는 Repository를 직접 사용하지 않고 이 서비스만 호출한다.
- `PolicyRepository`는 `EntityManager`를 선택적으로 받아 MANUAL 출처 조회, 출처와 `externalId` 기준 정책 조회, 정책 저장, 지역 코드 일괄 조회를 수행한다.
- batch import는 하나의 `QueryRunner` transaction으로 처리한다. `dryRun`도 동일한 INSERT/UPDATE 경로를 실행한 후 rollback하여 DB 제약조건을 함께 검증한다.
- 지역 `RULE` 조건의 코드에서 `KR`을 제외하고 중복을 제거한 뒤 한 번만 조회한다. 존재하지 않는 코드가 있으면 정책 저장 전에 `REGION_NOT_FOUND` 오류와 index·`externalId`·필드 위치를 반환한다.
- 수동 입력의 `sourceStatus`는 항상 `ACTIVE`로 저장한다. 시스템 필드(`id`, 출처, 생성·수정 시각)를 제외한 stable JSON 비교로 신규·변경·동일 상태를 각각 `CREATED`·`UPDATED`·`UNCHANGED`로 구분한다.
- DB 일시 오류 코드에 한해 전체 transaction을 최대 2회 시도하며, 그 외 저장 오류는 `DB_CONSTRAINT_FAILED` 도메인 오류로 정규화한다.

### DB 변경사항

- 없음. Phase 3에서 생성한 `policies`, `policy_sources`, `regions` 테이블을 그대로 사용한다.

### 주요 파일

- `apps/server/src/modules/policies/repositories/policy.repository.ts`: transaction-aware 정책 저장소
- `apps/server/src/modules/policies/services/policy-write.service.ts`: upsert, batch transaction, dry-run, 지역 검증, 오류 처리
- `apps/server/src/common/utils/stable-json.util.ts`: 객체 키 순서에 영향받지 않는 JSON 비교용 직렬화
- `apps/server/src/modules/policies/services/policy-write.service.spec.ts`: 저장 결과·지역 검증·rollback·dry-run 단위 테스트

### 검증

- `corepack pnpm --filter @kkultong/server typecheck` 성공
- `corepack pnpm --filter @kkultong/server test` 성공 (4개 suite, 11개 test)
- `corepack pnpm --filter @kkultong/server build` 성공
- 로컬 Docker PostgreSQL 컨테이너는 실행 중임을 확인했다. 다만 현재 실행 권한 경계에서 호스트 포트 연결이 거부되어 실제 DB 연결 검증은 수행하지 못했다. 실제 PostgreSQL 통합 검증은 계획된 Phase 8 Testcontainers 테스트에서 수행한다.
