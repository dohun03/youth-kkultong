# 청년꿀통 (youth-kkultong) — MVP 0 PLAN.md

> 기준: `PRD.md` / `ARCHITECTURE.md` / `SPEC.md`
> 목표: 실제 정책 30~50건을 검증된 Canonical Policy Schema로 PostgreSQL에 안전하게 적재하고, MVP1이 그대로 사용할 데이터 기반을 완성한다.  
> 구현 범위: 백엔드 / DB / 데이터 / CLI / 테스트  
> 프론트엔드 작업: 없음

---

# 1. 최종 완료 상태

MVP0 완료 시 다음 흐름이 새 환경에서도 재현되어야 한다.

```text
pnpm install
→ PostgreSQL 실행
→ migration
→ seed
→ policies.json dry-run
→ 실제 import
→ 동일 파일 재import
→ 수정 파일 재import
→ 테스트
```

기대 결과:

```text
신규 정책      → CREATED
동일 정책      → UNCHANGED
변경 정책      → UPDATED
1건이라도 오류 → 전체 rollback
```

---

# 2. 범위

## 구현한다

- pnpm workspace
- `apps/server`
- `packages/contracts`
- PostgreSQL 16
- TypeORM migration
- Zod 정책 schema
- regions / median income / policy source seed
- Policy Entity / Repository
- `PolicyWriteService`
- JSON import CLI
- `--dry-run`
- 실제 정책 JSON 30~50건
- Unit / Integration Test

## 구현하지 않는다

- 사용자용 Next.js 화면
- Public Policy API
- Matching API / Matching Engine
- 로그인 / 프로필 / 북마크
- 관리자 웹
- 자동 수집
- Worker
- Redis / BullMQ
- LLM
- 알림 / 캘린더
- Raw Snapshot
- Revision / Audit Log

---

# 3. 목표 프로젝트 구조

```text
youth-kkultong/
├─ apps/
│  ├─ web/                         # MVP0 작업 없음
│  └─ server/
│     ├─ src/
│     │  ├─ main.ts
│     │  ├─ app.module.ts
│     │  ├─ common/
│     │  │  ├─ config/
│     │  │  │  ├─ env.schema.ts
│     │  │  │  └─ database.config.ts
│     │  │  └─ utils/
│     │  │     └─ stable-json.util.ts
│     │  ├─ database/
│     │  │  ├─ datasource.ts
│     │  │  ├─ migrations/
│     │  │  │  └─ 001-mvp0-core-policy.ts
│     │  │  └─ seeds/
│     │  │     ├─ data/
│     │  │     │  ├─ regions.json
│     │  │     │  └─ median-income.json
│     │  │     ├─ seed-policy-sources.ts
│     │  │     ├─ seed-regions.ts
│     │  │     ├─ seed-median-income.ts
│     │  │     └─ run-seeds.ts
│     │  ├─ modules/
│     │  │  ├─ meta/
│     │  │  │  └─ entities/
│     │  │  │     ├─ region.entity.ts
│     │  │  │     └─ median-income.entity.ts
│     │  │  └─ policies/
│     │  │     ├─ entities/
│     │  │     │  ├─ policy.entity.ts
│     │  │     │  └─ policy-source.entity.ts
│     │  │     ├─ repositories/
│     │  │     │  └─ policy.repository.ts
│     │  │     └─ services/
│     │  │        └─ policy-write.service.ts
│     │  └─ cli/
│     │     └─ import-policies.ts
│     ├─ test/
│     │  ├─ helpers/
│     │  │  └─ postgres-test-container.ts
│     │  └─ integration/
│     │     └─ policy-import.integration.spec.ts
│     └─ package.json
├─ packages/
│  └─ contracts/
│     ├─ src/
│     │  ├─ enums.ts
│     │  ├─ policy.ts
│     │  └─ index.ts
│     └─ package.json
├─ data/
│  └─ policies/
│     ├─ policies.sample.json
│     └─ policies.json
├─ .env.example
├─ docker-compose.yml
├─ pnpm-workspace.yaml
└─ package.json
```

기존 프로젝트 구조가 있다면 파일명은 조정 가능하지만 역할은 유지한다.

---

# 4. 구현 순서

```text
Phase 0  Workspace / 프로젝트 기반
Phase 1  PostgreSQL / 환경설정
Phase 2  Policy Contracts / Zod
Phase 3  Migration / Entity
Phase 4  Seed
Phase 5  PolicyWriteService
Phase 6  Import CLI
Phase 7  정책 JSON
Phase 8  테스트
Phase 9  실행 명령 정리
Phase 10 최종 검증
```

각 Phase 테스트가 끝난 뒤 다음 Phase로 진행한다.

---

# Phase 0. Workspace / 프로젝트 기반

## 목표

MVP0 구현을 위한 monorepo 기반을 준비한다.

## 작업

- [x] 0-1. pnpm workspace 구성
- [x] 0-2. `apps/server` NestJS + TypeScript strict 기반 구성
- [x] 0-3. `packages/contracts` 공유 계약 패키지 기반 구성
- [x] 0-4. Root script 구성

### 0-1. pnpm workspace

`pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### 0-2. `apps/server`

NestJS + TypeScript strict 기준으로 구성한다.

필요 dependency:

```text
@nestjs/common
@nestjs/core
@nestjs/config
@nestjs/platform-express
typeorm
pg
zod
nestjs-pino
reflect-metadata
rxjs
```

CLI argument parsing은 `commander` 사용을 권장한다.

테스트:

```text
jest
ts-jest
@types/jest
testcontainers
```

### 0-3. `packages/contracts`

package name 예:

```text
@kkultong/contracts
```

DB Entity가 아니라 FE/BE 공통 타입, enum, Zod schema만 둔다.

`src/index.ts`

```ts
export * from './enums';
export * from './policy';
```

### 0-4. Root script

최소 다음 흐름을 루트에서 실행 가능하게 한다.

```text
server:dev
server:test
db:migrate
db:revert
db:seed
policy:validate
policy:import
```

## 완료 조건

```text
pnpm install 성공
apps/server build 성공
packages/contracts typecheck 성공
```

---

# Phase 1. PostgreSQL / 환경설정

## 목표

Nest/TypeORM이 PostgreSQL에 연결되고 migration을 실행할 준비를 한다.

## 1-1. Docker Compose

- [x] PostgreSQL 16 개발 컨테이너 구성

MVP0에서는 PostgreSQL만 사용한다.

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: youth_kkultong
      POSTGRES_USER: kkultong
      POSTGRES_PASSWORD: kkultong_local
    ports:
      - "5432:5432"
    volumes:
      - kkultong_postgres:/var/lib/postgresql/data

volumes:
  kkultong_postgres:
```

## 1-2. `.env.example`

- [x] 개발 환경변수 예시 구성

```text
NODE_ENV=development
DATABASE_URL=postgresql://kkultong:kkultong_local@localhost:5432/youth_kkultong
MAX_HOUSEHOLD_SIZE=8
```

JWT/Redis/LLM 변수는 추가하지 않는다.

## 1-3. Env schema

- [x] 필수 환경변수 Zod 검증 구성

`apps/server/src/common/config/env.schema.ts`

Zod 검증:

```text
NODE_ENV
DATABASE_URL
MAX_HOUSEHOLD_SIZE
```

잘못된 환경변수면 시작 시 즉시 실패한다.

## 1-4. TypeORM DataSource

- [x] PostgreSQL DataSource 및 migration 탐색 설정 구성

`apps/server/src/database/datasource.ts`

필수 설정:

```text
PostgreSQL
DATABASE_URL
entities
migrations
synchronize=false
```

Production에서 `synchronize=true` 금지.

## 완료 조건

```text
PostgreSQL 실행 성공
DataSource initialize 성공
잘못된 DATABASE_URL에서는 명확히 실패
```

---

# Phase 2. Policy Contracts / Zod

## 목표

DB보다 먼저 청년꿀통 Canonical Policy Schema를 코드로 확정한다.

## 2-1. enums

- [x] 정책·사용자 상태·출처 공통 열거값 및 타입 정의

`packages/contracts/src/enums.ts`

```ts
POLICY_CATEGORIES = [
  'HOUSING',
  'FINANCE',
  'JOB',
  'EDUCATION',
  'WELFARE',
  'ETC',
];

USER_STATUSES = [
  'JOB_SEEKER',
  'STUDENT',
  'EMPLOYEE',
  'UNEMPLOYED',
];

SOURCE_TYPES = [
  'MANUAL',
  'API',
];

SOURCE_STATUSES = [
  'ACTIVE',
  'NOT_SEEN',
  'CLOSED',
];
```

MVP0 import는 `MANUAL`, `ACTIVE`만 사용한다.

## 2-2. Schema 구현 순서

- [x] Canonical Policy Zod schema 구현

`packages/contracts/src/policy.ts`

```text
NumberRangeSchema
AgeBasisSchema
AgeRuleSchema
IncomeRuleSchema
Constraint Schema
PolicyConditionsSchema
BenefitAmountSchema
PolicyImportInputSchema
PolicyImportArraySchema
```

## 2-3. NumberRange

- [x] null 경계 및 min/max 관계 검증

```text
min/max = null 또는 number
둘 다 있으면 min <= max
```

## 2-4. AgeBasis

- [x] 나이 기준 discriminated union 및 날짜·범위 검증

지원:

```text
TODAY
FIXED_DATE
YEAR_DIFF
BIRTH_YEAR
```

`FIXED_DATE`는 실제 존재하는 날짜인지 검증한다.

일반 나이 RULE은 0~120 범위.

`BIRTH_YEAR`는 min/max를 연도로 해석한다.

## 2-5. IncomeRule

- [x] 기준 중위소득 비율 및 확정 여부 검증

```ts
{
  min: number | null;
  max: number | null;
  basisConfirmed: true;
}
```

검증:

```text
min/max 0~1000
min <= max
basisConfirmed literal true
```

정확한 기준 확인이 안 된 소득 정책은 RULE을 만들지 않고 UNKNOWN으로 둔다.

## 2-6. Constraint

- [x] ANY, RULE, UNKNOWN constraint 검증

```ts
{ kind: 'ANY' }
{ kind: 'UNKNOWN' }
{ kind: 'RULE', value: ... }
```

규칙:

```text
RULE → value 필수
ANY/UNKNOWN → value 금지
```

## 2-7. PolicyConditions

- [x] 필수 5개 정책 조건 검증

반드시 존재:

```text
age
region
income
status
householdSize
```

## 2-8. BenefitAmount

- [x] 혜택 종류별 discriminated union 검증

Zod `discriminatedUnion('kind', ...)`.

종류:

```text
FIXED
MONTHLY
RATE
IN_KIND
UNKNOWN
```

FIXED:

```text
amountWon positive integer
text required
```

MONTHLY:

```text
amountWon positive integer
months = null 또는 positive integer
text required
```

RATE / IN_KIND / UNKNOWN:

```text
text required
amountWon 필드 금지
```

## 2-9. PolicyImportInput

- [x] 정책 import 필드 및 교차 필드 검증

필드:

```text
externalId
title
agency
category
benefitSummary
benefitAmount
conditions
hasUnresolvedEligibilityCondition
unresolvedConditionNote
requiredDocs
applyStart
applyEnd
isAlwaysOpen
officialUrl
lastVerifiedAt
isPublished
```

검증:

```text
externalId 1~120
title 1~200
agency 1~120
benefitSummary 1~300
officialUrl http/https
lastVerifiedAt ISO 8601
```

cross-field:

```text
applyStart <= applyEnd
isAlwaysOpen=true → applyEnd=null
unresolved=true → unresolvedConditionNote non-empty
```

## 2-10. 배열 단위 검증

- [x] 파일 내 externalId 중복 검증

`PolicyImportArraySchema`에서 파일 내부 `externalId` 중복을 거부한다.

## 테스트

- [x] Policy Contracts unit test 구현

필수 케이스:

```text
정상 FIXED
정상 MONTHLY
amountWon <= 0
2026-02-31
age min > max
잘못된 AgeBasis
region RULE []
status RULE []
income basisConfirmed != true
unresolved=true + note 없음
alwaysOpen + applyEnd
invalid URL
duplicate externalId
```

## 완료 조건

```text
contracts unit test 전체 통과
```

---

# Phase 3. MVP0 Migration / Entity

## 목표

MVP0에서 필요한 4개 테이블만 생성한다.

```text
regions
median_income_table
policy_sources
policies
```

## 3-1. Migration

- [x] `regions`, `median_income_table`, `policy_sources`, `policies` 생성 migration 구현

파일 예:

```text
apps/server/src/database/migrations/001-mvp0-core-policy.ts
```

UUID용:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

## 3-2. regions

- [x] `regions` 테이블, self FK, level 제약조건 및 parent_code 인덱스 구현

```text
code          PK
parent_code   self FK nullable
level         1 or 2
name
active
```

Index:

```text
parent_code
```

## 3-3. median_income_table

- [x] 복합 PK 및 가구원 수·금액 검증 제약조건 구현

```text
year
household_size
amount
PK(year, household_size)
```

Checks:

```text
household_size >= 1
amount > 0
```

## 3-4. policy_sources

- [x] 출처 타입 제약조건과 생성·수정 시각 기본값 구현

```text
id
code UNIQUE
name
type
enabled
base_url
created_at
updated_at
```

`type`:

```text
MANUAL | API
```

## 3-5. policies

- [x] 정책 필드, FK·고유성·도메인 제약조건 및 조회용 인덱스 구현

필드:

```text
id UUID
source_id FK
external_id

title
agency
category

benefit_summary
benefit_amount JSONB
conditions JSONB

has_unresolved_eligibility_condition
unresolved_condition_note

required_docs text[]

apply_start
apply_end
is_always_open

official_url

source_status
is_published
last_verified_at

created_at
updated_at
```

Unique:

```text
(source_id, external_id)
```

Checks:

```text
apply_start <= apply_end
alwaysOpen → apply_end null
unresolved=true → note non-empty
official_url http/https
category allowed
source_status allowed
```

Indexes:

```text
(is_published, source_status, apply_end)
category
last_verified_at
```

## 3-6. Entity

- [x] 4개 테이블에 대응하는 TypeORM Entity 구현

작성:

```text
RegionEntity
MedianIncomeEntity
PolicySourceEntity
PolicyEntity
```

Migration schema와 Entity가 일치해야 한다.

`benefit_amount`, `conditions`는 JSONB.

`required_docs`는 text[].

## 3-7. Revert

- [x] FK 역순 down migration 및 재적용 검증

FK 역순:

```text
policies
policy_sources
median_income_table
regions
```

## 완료 조건

```text
빈 DB migration 성공
4개 테이블 존재
index/constraint 존재
revert 성공
재 migration 성공
```

---

# Phase 4. Seed

## 목표

정책 import 전에 필요한 기준 데이터를 idempotent하게 입력한다.

## 4-1. MANUAL source

- [x] `MANUAL` 정책 출처를 code 기준으로 upsert

```text
code = MANUAL
name = 수동 등록
type = MANUAL
enabled = true
base_url = null
```

`code` 기준 upsert.

## 4-2. Region

- [x] 행정안전부 2026-07-01 기준 시·도·시·군·구 284건을 부모 → 자식 순으로 upsert

파일:

```text
database/seeds/data/regions.json
```

예 구조:

```json
[
  {
    "code": "11",
    "parentCode": null,
    "level": 1,
    "name": "서울특별시"
  }
]
```

실제 코드는 공식/신뢰 가능한 행정구역 기준 데이터를 사용한다.

부모 → 자식 순으로 seed.

upsert key:

```text
code
```

## 4-3. Median Income

- [x] 보건복지부 2026년 기준 중위소득 1~8인 데이터를 복합 키 기준으로 upsert

파일:

```text
database/seeds/data/median-income.json
```

구조:

```json
[
  {
    "year": 2026,
    "householdSize": 1,
    "amount": 1234567
  }
]
```

실제 값은 공식 기준 자료만 사용한다.

금지:

```text
기억으로 입력
이전 연도 복사
없는 가구원 수 보간
임의 계산
```

upsert key:

```text
(year, household_size)
```

## 4-4. Seed runner

- [x] transaction 기반 seed runner와 `db:seed` 명령 구성

순서:

```text
policy source
→ regions
→ median income
```

오류 시 exit 1.

## 테스트

- [x] seed 2회 실행 시 중복 없이 동일한 행 수를 유지하는지 검증

```text
seed 1회
seed 2회
→ 중복 없음
→ row count 불필요 증가 없음
```

---

# Phase 5. Policy Repository / PolicyWriteService

## 목표

모든 정책 저장을 하나의 쓰기 경로로 통일한다.

CLI가 Repository를 직접 이용해 정책 row를 저장하지 않는다.

## 5-1. PolicyRepository

필요 기능:

```ts
findSourceByCode(...)
findBySourceIdentity(...)
save(...)
```

transaction `EntityManager`를 전달받을 수 있어야 한다.

## 5-2. Region reference validation

Policy 조건 중:

```text
region.kind === RULE
```

인 모든 region code를 모은다.

처리:

```text
KR 제외
중복 제거
DB 한 번 조회
존재하지 않는 코드 계산
하나라도 없으면 실패
```

정책별 N+1 query를 만들지 않는다.

## 5-3. Normalize / compare

UNCHANGED 비교 시 DB 시스템 필드는 제외한다.

제외:

```text
id
source_id
created_at
updated_at
```

비교:

```text
external_id
title
agency
category
benefit_summary
benefit_amount
conditions
unresolved fields
required_docs
dates
official_url
source_status
is_published
last_verified_at
```

안정적인 deep equality를 사용한다.

## 5-4. `upsertManual`

```ts
upsertManual(
  input: PolicyImportInput,
  manager?: EntityManager,
): Promise<{
  policy: PolicyEntity;
  action: 'CREATED' | 'UPDATED' | 'UNCHANGED';
}>;
```

흐름:

```text
MANUAL source 조회
→ MANUAL + externalId 조회
→ 없음: CREATE
→ 있음 + 동일: UNCHANGED
→ 있음 + 변경: UPDATE
```

UPDATE:

```text
id 유지
createdAt 유지
updatedAt 변경
```

MVP0의 `sourceStatus`는 항상 `ACTIVE`.

## 5-5. Batch import

추가:

```ts
importManualBatch(
  inputs: PolicyImportInput[],
  options?: { dryRun?: boolean },
): Promise<ImportSummary>;
```

```ts
interface ImportSummary {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
}
```

전체 batch를 **하나의 transaction**으로 처리한다.

```text
transaction 시작
→ MANUAL source 확인
→ region 검증
→ upsert 반복
→ summary
→ commit
```

1건 실패:

```text
rollback
```

## 5-6. Dry Run

단순히 write를 생략하지 않는다.

가능하면 실제 INSERT/UPDATE 경로를 실행한 뒤 rollback해서 DB constraint까지 검증한다.

권장:

```text
QueryRunner
→ startTransaction
→ 실제 import 실행
→ dry-run이면 rollback
→ 일반 모드면 commit
```

## 5-7. Error

도메인 오류 예:

```text
INVALID_JSON
SCHEMA_VALIDATION_FAILED
DUPLICATE_EXTERNAL_ID
MANUAL_SOURCE_NOT_FOUND
REGION_NOT_FOUND
DB_CONSTRAINT_FAILED
```

가능하면 다음 정보 포함:

```text
index
externalId
field
reason
```

## 완료 조건

```text
신규 CREATED
동일 UNCHANGED
변경 UPDATED
unknown region 실패
1건 실패 전체 rollback
dry-run DB 변경 없음
```

---

# Phase 6. JSON Import CLI

## 목표

한 명령으로 전체 정책 JSON을 검증/저장한다.

## 6-1. 파일

```text
apps/server/src/cli/import-policies.ts
```

HTTP server는 띄우지 않는다.

Nest Application Context 또는 import 전용 module을 사용한다.

실행 종료 시 connection을 닫는다.

## 6-2. Arguments

```text
--file <path>
--dry-run
```

예:

```bash
pnpm --filter server import:policies \
  --file ../../data/policies/policies.json
```

Dry run:

```bash
pnpm --filter server import:policies \
  --file ../../data/policies/policies.json \
  --dry-run
```

## 6-3. 처리 순서

```text
1. args 검증
2. 파일 존재 확인
3. UTF-8 read
4. JSON.parse
5. PolicyImportArraySchema.safeParse
6. externalId 중복 검증
7. PolicyWriteService.importManualBatch
8. summary 출력
9. 종료
```

DB transaction은 Service가 책임진다.

## 6-4. 성공 출력

```text
Policy import succeeded.

File:      data/policies/policies.json
Mode:      WRITE

Total:     42
Created:   40
Updated:    2
Unchanged:  0
```

## 6-5. Dry-run 출력

```text
Policy validation succeeded.

Mode: DRY RUN

Total: 42
Would create: 40
Would update: 2
Unchanged: 0

No database changes were committed.
```

## 6-6. 실패 출력

```text
Policy import failed.

Index: 17
externalId: 2026-example-policy
Field: conditions.region.value.0
Reason: region code "99999" does not exist

No policies were saved.
```

## 6-7. Exit code

```text
0 success
1 failure
```

---

# Phase 7. 정책 JSON

## 목표

MVP0 데이터 모델을 실제 정책으로 검증한다.

## 7-1. Sample

`data/policies/policies.sample.json`

3~6건.

가능하면 다음 조합 포함:

```text
FIXED
MONTHLY
IN_KIND 또는 RATE
KR
지역 RULE
age RULE
income UNKNOWN
ANY
추가 자격 조건
상시
기간 정책
```

## 7-2. Actual

`data/policies/policies.json`

실제 정책 30~50건.

각 정책은 공식 공고 기준으로 확인한다.

필수:

```text
정책명
기관
카테고리
지원 금액
기간
지역
나이
상태
가구원
소득
추가 자격조건
서류
공식 URL
확인 시점
```

## 7-3. 데이터 원칙

추측하지 않는다.

표현이 어렵다면:

```text
UNKNOWN
```

또는:

```text
hasUnresolvedEligibilityCondition=true
unresolvedConditionNote="..."
```

사용.

소득 중 다음은 억지로 중위소득 RULE로 변환하지 않는다.

```text
건강보험료
소득인정액
부모 합산 소득
도시근로자 평균소득
개인 연소득
불명확한 산정법
```

## 7-4. 다양성

가능하면 포함:

```text
전국 / 지역
주거 / 취업 / 복지 / 교육 / 금융
나이 제한 있음 / 없음
소득 제한 있음 / UNKNOWN
상시 / 기간제
현금 / 월 지원 / 비현금
추가 자격 조건 있음
```

## 완료 조건

```text
30~50건
externalId unique
officialUrl 100%
lastVerifiedAt 100%
dry-run 전체 성공
```

---

# Phase 8. 테스트

## 8-1. Contracts Unit

필수:

```text
FIXED 정상/실패
MONTHLY 정상/실패
invalid date
start > end
alwaysOpen + end
ANY / UNKNOWN / RULE
RULE missing value
age boundary
region RULE []
status RULE []
duplicate values
unresolved note
duplicate externalId
```

## 8-2. PostgreSQL Integration

Testcontainers PostgreSQL 16 사용.

흐름:

```text
container
→ datasource
→ migration
→ seed
→ test
→ cleanup
```

## 8-3. Create Test

```text
3건 import
→ created=3
→ DB=3
```

## 8-4. Same Reimport

```text
같은 3건 재import
→ unchanged=3
→ DB row count=3
→ id 유지
```

## 8-5. Update

```text
같은 externalId 내용 변경
→ updated=1
→ row count 동일
→ id 동일
→ createdAt 동일
→ updatedAt 변경
```

## 8-6. Rollback

```text
정상 2 + invalid region 1
→ 전체 실패
→ 새 row 0
```

기존 데이터가 있었다면 기존 값도 변경되지 않는다.

## 8-7. Dry Run

```text
신규 3건 dry-run
→ would create 3
→ DB row 0
```

## 8-8. Seed idempotency

```text
seed
seed
→ MANUAL 1개
→ region 중복 없음
→ income 중복 없음
```

## 완료 조건

```text
Unit 전체 통과
Integration 전체 통과
```

---

# Phase 9. 실행 명령 정리

루트에서 최소 다음 흐름이 가능해야 한다.

```bash
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm policy:validate
pnpm policy:import
pnpm server:test
```

CLI/seed/migration은:

```text
성공 → exit 0
실패 → stderr + exit 1
```

---

# Phase 10. 최종 검증

## 10-1. Clean DB

완전히 빈 DB에서:

```text
migration
seed
dry-run
import
```

결과:

```text
실제 정책 30~50건 저장
```

## 10-2. Same Reimport

같은 파일 다시 import.

기대:

```text
Created 0
Updated 0
Unchanged 30~50
```

row count 동일.

## 10-3. Update

임시 JSON copy에서 정책 하나 수정.

기대:

```text
Updated 1
동일 id
row count 동일
```

## 10-4. Rollback

임시 JSON copy에 invalid region 삽입.

기대:

```text
import 실패
DB 변경 0
```

## 10-5. DB inspect

```sql
SELECT COUNT(*) FROM policies;

SELECT
  ps.code,
  p.external_id,
  p.title,
  p.category,
  p.source_status,
  p.is_published
FROM policies p
JOIN policy_sources ps
  ON ps.id = p.source_id
ORDER BY p.created_at;
```

기대:

```text
source = MANUAL
source_status = ACTIVE
external_id unique
```

---

# 5. 핵심 구현 결정

## 정책 identity

DB PK:

```text
UUID
```

수동 정책 business identity:

```text
MANUAL + externalId
```

정책 제목이나 URL이 바뀌어도 같은 사업이면 externalId를 유지한다.

## lastVerifiedAt

의미:

```text
사람이 공식 공고를 실제 확인한 시점
```

파일 수정만으로 자동 갱신하지 않는다.

## isPublished

MVP1에서 사용자에게 보여줄 준비가 끝난 정책:

```text
true
```

검토 중:

```text
false
```

## sourceStatus

MVP0 import:

```text
ACTIVE
```

고정.

`NOT_SEEN`, `CLOSED`는 이후 MVP에서 사용한다.

## JSONB

```text
benefit_amount
conditions
```

을 JSONB로 저장한다.

이유:

- 초기 정책 모델 변화에 유연
- 테이블 과분리 방지
- Zod를 Canonical Contract로 사용

JSONB라도 write validation은 반드시 수행한다.

## requiredDocs

PostgreSQL `text[]`.

입력 검증:

```text
trim
blank 금지
중복 금지 권장
```

배열 순서는 임의 정렬하지 않는다.

---

# 6. 권장 작업 단위

AI 에이전트에게 한 번에 MVP0 전체 구현을 맡기지 않고 아래 단위로 진행하는 것을 권장한다.

## 작업 1

```text
workspace
apps/server
packages/contracts
postgres docker
env
```

검증:

```text
build
DB connect
```

## 작업 2

```text
enum
policy Zod schema
unit tests
```

검증:

```text
contracts tests
```

## 작업 3

```text
migration
4 entities
migration run/revert
```

## 작업 4

```text
MANUAL seed
region seed
median income seed
idempotency
```

## 작업 5

```text
PolicyRepository
PolicyWriteService
batch transaction
dry-run
```

## 작업 6

```text
import CLI
error output
summary
exit code
```

## 작업 7

```text
sample JSON
manual CLI test
```

## 작업 8

```text
Testcontainers integration
create/reimport/update/rollback/dry-run
```

## 작업 9

```text
실제 policies.json 30~50건
dry-run 반복
최종 import
```

## 작업 10

```text
clean DB 재현
MVP0 acceptance 확인
```

---

# 7. MVP0 완료 체크리스트

```text
[ ] workspace 정상
[ ] apps/server build 성공
[x] contracts typecheck/test 성공

[ ] PostgreSQL 16 실행
[ ] synchronize=false
[ ] migration run/revert 성공

[ ] regions seed
[ ] median income seed
[ ] MANUAL source seed
[ ] seed 재실행 중복 없음

[x] PolicyImportInputSchema
[x] BenefitAmount schema
[x] 5개 PolicyConditions
[x] cross-field validation
[x] duplicate externalId validation

[ ] PolicyWriteService
[ ] 신규 CREATED
[ ] 동일 UNCHANGED
[ ] 변경 UPDATED
[ ] unknown region 거부

[ ] batch transaction
[ ] 1건 실패 전체 rollback
[ ] dry-run DB 변경 없음

[ ] import CLI
[ ] --file
[ ] --dry-run
[ ] summary
[ ] error location
[ ] exit code

[ ] sample JSON
[ ] 실제 정책 30~50건
[ ] officialUrl 100%
[ ] lastVerifiedAt 100%
[ ] actual dry-run 성공
[ ] actual import 성공

[ ] same reimport 중복 없음
[ ] update test 성공
[ ] rollback test 성공

[ ] Auth 없음
[ ] Public API 없음
[ ] Matching 없음
[ ] Redis 없음
[ ] BullMQ 없음
[ ] LLM 없음
```

---

# 8. MVP1로 넘기는 계약

MVP0 완료 후 그대로 사용할 것:

```text
PolicyEntity
PolicyConditions
BenefitAmount
PolicyCategory
UserStatus

policies
regions
median_income_table
policy_sources
```

MVP1에서 새로 만들 것:

```text
GET /api/v1/policies
GET /api/v1/policies/:id
POST /api/v1/policies/search

Policy Query Service
Matching Engine

Next.js 정책 목록
조건 입력 UI
정책 상세 UI
```

MVP0의 실제 정책 30~50건을 입력하는 과정에서 반복적으로 등장하는 새 자격 조건이 확인되면, MVP1로 넘어가기 전에 스키마 확장 여부를 판단한다.

---

# 9. 최종 완료 정의

MVP0은 단순히 DB 테이블 생성으로 끝나지 않는다.

새 DB에서 아래 흐름이 재현되어야 한다.

```text
install
→ postgres
→ migrate
→ seed
→ dry-run
→ import
→ tests
```

그리고 실제 정책 데이터가 다음 조건을 만족해야 한다.

```text
검증된 구조
반복 import 가능
중복 없음
변경 update 가능
오류 시 전체 rollback
MVP1에서 그대로 조회/매칭 가능
```

이 상태에서 MVP0을 종료하고 MVP1 구현으로 이동한다.
