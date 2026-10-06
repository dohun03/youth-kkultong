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
