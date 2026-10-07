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

## Phase 6. JSON Import CLI

### 완료 내용

- HTTP 서버를 띄우지 않는 정책 JSON import CLI를 추가했다. 파일·JSON·Zod 검증은 DB 연결 전에 끝내므로 잘못된 입력이 DB 연결을 시도하지 않는다.
- `--file <path>`는 필수이고 `--dry-run`은 선택이다. 지원하지 않는 옵션·중복 옵션·파일 읽기 실패·JSON 형식 오류도 저장 전에 실패한다.
- 스키마 오류는 JSON 배열의 index, `externalId`, 필드 경로, 사유를 출력한다. `PolicyWriteService`의 지역·DB 오류도 같은 형식으로 전달해 전체 미저장 사실을 명확히 알린다.
- 실제 저장은 `PolicyWriteService.importManualBatch`만 호출한다. WRITE와 DRY RUN의 트랜잭션·rollback 책임은 기존 서비스에 유지했다.
- DB 초기 연결은 일시 오류에 대비해 최대 2회 시도하며, 실행이 끝나면 초기화된 TypeORM DataSource를 항상 닫는다. 성공은 종료 코드 `0`, 실패는 `1`을 반환한다.

### 주요 파일

- `apps/server/src/cli/import-policies.ts`: 인자 처리, 파일·스키마 검증, import 실행, 표준 출력·오류 출력
- `apps/server/src/cli/policy-import.module.ts`: DB 연결, `PolicyWriteService` 조립 및 실행 종료 시 연결 정리
- `apps/server/src/cli/import-policies.spec.ts`: WRITE/DRY RUN, 필수 인자, JSON·스키마 오류, 서비스 오류 출력 검증
- `apps/server/package.json`: `import:policies`, `policy:validate`, `policy:import` CLI 스크립트

### 실행 방법

```bash
pnpm --filter @kkultong/server import:policies --file ../../data/policies/policies.json
pnpm --filter @kkultong/server import:policies --file ../../data/policies/policies.json --dry-run
```

`data/policies/policies.json`은 Phase 7에서 작성한다.

### 검증

- `corepack pnpm --filter @kkultong/server typecheck` 성공
- `corepack pnpm --filter @kkultong/server exec jest --runInBand` 성공 (5개 suite, 17개 test)
- `corepack pnpm --filter @kkultong/server build` 성공
- `corepack pnpm --filter @kkultong/server import:policies --dry-run` 실행 시 `--file` 누락 오류와 종료 코드 `1`을 확인했다.

## Phase 7. 정책 JSON

### 완료 내용

- `policies.sample.json`에 공식 정책 기반 5건을 작성했다. 고정 금액, 월 지원, 현물성 지원, 전국·지역 조건, 상시·기간제 정책을 포함한다.
- `policies.json`에 실제 정책 30건을 작성했다. 주거 7건, 금융 5건, 교육 8건, 일자리 4건, 복지 6건으로 구성했다.
- 정책별 공식 URL과 `lastVerifiedAt`을 모두 기록했다. 고용노동부, 국토교통부·마이홈, 서민금융진흥원, 한국장학재단, 농림축산식품부, 서울·부산·경기도 공식 페이지를 출처로 사용했다.
- 건강보험료, 개인소득, 자산, 공고별 우선순위처럼 현재 조건 모델로 안전하게 비교할 수 없는 값은 중위소득 비율로 변환하지 않고 `UNKNOWN`과 미확인 사유로 남겼다.

### 주요 파일

- `data/policies/policies.sample.json`: 데이터 모델 조합을 확인하는 5건의 샘플 정책
- `data/policies/policies.json`: MVP 0 적재 대상 실제 정책 30건

### 검증

- `PolicyImportArraySchema.safeParse`로 샘플 5건과 실제 정책 30건의 JSON·Zod 검증을 통과했다.
- 빈 PostgreSQL에서 migration 적용 후 기준 데이터 seed를 완료했다.
- PostgreSQL과 같은 Docker 네트워크에서 CLI dry-run을 실행했다. 결과는 `Total: 30`, `Would create: 30`, `Would update: 0`, `Unchanged: 0`이며 정책 행은 rollback되어 저장되지 않았다.

## Phase 8. 테스트

### 완료 내용

- 정책 계약 단위 테스트에 MONTHLY 금액·개월 수 오류, 신청 기간 역전, 나이 경계값, 중복 지역·상태, `ANY`·`UNKNOWN`의 불필요한 값, `RULE` 값 누락 검증을 보강했다.
- PostgreSQL 16 Testcontainers 통합 테스트를 추가했다. 각 실행은 컨테이너 생성 후 migration과 기준 데이터 seed를 적용하고, 종료 시 DataSource와 컨테이너를 정리한다.
- 실제 DB에서 신규 3건 생성, 동일 3건 재import, 변경 정책 update, 잘못된 지역 코드 batch rollback, dry-run 미저장, 기준 데이터 seed 반복 실행을 검증했다.
- PostgreSQL 공식 이미지의 초기화용 임시 서버 로그를 피하기 위해 최종 서버의 준비 로그까지 기다린 뒤 migration을 시작한다.

### DB 변경사항

- 없음. 기존 migration과 seed, `PolicyWriteService` 동작을 실제 PostgreSQL에서 검증했다.

### 주요 파일

- `packages/contracts/test/policy.spec.ts`: Canonical Policy Schema 단위 테스트
- `apps/server/test/integration/policy-import.integration.spec.ts`: PostgreSQL 16 Testcontainers 정책 import 통합 테스트

### 검증

- `corepack pnpm --filter @kkultong/contracts typecheck` 성공
- `corepack pnpm --filter @kkultong/contracts exec jest --runInBand` 성공 (1개 suite, 18개 test)
- `corepack pnpm --filter @kkultong/server typecheck` 성공
- `corepack pnpm --filter @kkultong/server test` 성공 (6개 suite, 23개 test; PostgreSQL 16 Testcontainers 포함)
- `corepack pnpm --filter @kkultong/server build` 성공

## Phase 9. 실행 명령 정리

### 완료 내용

- 환경변수 검증 진입점에서 Node 22 내장 `process.loadEnvFile`로 workspace 루트 `.env`를 읽도록 구성했다. migration·seed·정책 CLI가 같은 DB 연결 설정을 사용한다.
- `policy:validate`, `policy:import`는 내부 `pnpm` 재실행 없이 기본 `data/policies/policies.json` 경로를 직접 전달한다.
- 로컬 실행 전에는 `.env.example`을 루트 `.env`로 복사하면 된다. `.env`는 Git에 포함하지 않는다.

### DB 변경사항

- 없음. 실행 명령과 환경변수 로딩만 정리했다.

### 주요 파일

- `apps/server/src/common/config/env.schema.ts`: workspace 루트 `.env` 공통 로드
- `apps/server/package.json`: 기본 정책 파일을 사용하는 정책 validate/import 명령
- `package.json`: Phase 0에서 추가한 루트 명령 진입점 유지

### 검증

별도 PostgreSQL 16 임시 컨테이너와 루트 `.env`를 사용해 다음 명령을 인자 없이 순서대로 실행했다.

- `corepack pnpm db:migrate` 성공
- `corepack pnpm db:seed` 성공
- `corepack pnpm policy:validate` 성공: 30건 dry-run, 생성 예정 30건
- `corepack pnpm policy:import` 성공: 30건 생성
- 동일 `corepack pnpm policy:import` 재실행 성공: 30건 `UNCHANGED`
- `corepack pnpm server:test` 성공: 6개 suite, 23개 test

## Phase 10. 최종 검증

### 완료 내용

- 기존 개발 DB를 변경하지 않도록 별도 PostgreSQL 16 임시 컨테이너의 빈 DB에서 최종 흐름을 검증했다.
- migration → seed → dry-run → import 순서로 실행해 실제 정책 30건이 저장되는 것을 확인했다.
- 동일 정책 파일 재import 결과는 `Created: 0`, `Updated: 0`, `Unchanged: 30`이며 행 수는 30건으로 유지됐다.
- 정책 1건을 수정한 임시 JSON import는 `Updated: 1`로 처리됐고, 기존 UUID·생성 시각과 전체 행 수 30건을 유지했다.
- 존재하지 않는 지역 코드 `99999`를 넣은 임시 JSON import는 종료 코드 1로 실패했고, 저장된 정책 행 수와 기존 정책 내용은 변하지 않았다.
- 전체 30건은 `MANUAL` 출처·`ACTIVE` 상태이고 `externalId`도 모두 고유함을 집계로 확인했다. DB 조회에서 정책별 공개 여부도 함께 확인했다.

### DB 변경사항

- 없음. 최종 검증은 폐기한 임시 PostgreSQL 16 컨테이너에서만 수행했다.

### 검증

- 빈 DB: `db:migrate` → `db:seed` → `policy:validate` → `policy:import` 성공
- dry-run: 총 30건, 생성 예정 30건, DB 미저장 확인
- 재import: 총 30건, `UNCHANGED` 30건, 행 수 30건
- update: 동일 UUID·생성 시각 유지, `UPDATED` 1건, 행 수 30건
- rollback: `REGION_NOT_FOUND` 오류와 종료 코드 1, DB 변경 없음
- `corepack pnpm server:test` 성공 (6개 suite, 23개 test)
- `corepack pnpm --filter @kkultong/server build` 성공
