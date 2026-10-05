# 청년꿀통 (youth-kkultong) — MVP 0 상세 기능 명세서

> 기준 문서: PRD v0.4 / ARCHITECTURE.md  
> 단계 목표: **실제 정책 30~50건을 검증된 구조로 PostgreSQL에 적재하고, MVP 1의 정책 목록·매칭 구현을 바로 시작할 수 있는 데이터 기반을 만든다.**  
> 이 단계는 사용자용 웹 기능을 만드는 단계가 아니다.

---

## 0. 범위

### 0.1 MVP 0에서 만드는 것

| 영역 | 내용 |
|---|---|
| 프로젝트 기반 | pnpm monorepo의 `apps/server`, `packages/contracts`, `data/policies` 사용 |
| 데이터베이스 | PostgreSQL 16, TypeORM migration |
| 기준 데이터 | 지역 코드, 기준 중위소득 표 |
| 정책 데이터 | 실제 정책 30~50건 |
| 정책 타입 | 정책 기본정보, 혜택 금액, 조건, 신청기간, 출처 상태 |
| 검증 | Zod + DB 참조 검증 + 필드 간 도메인 검증 |
| 저장 | `PolicyWriteService`를 통한 정책 저장 |
| 입력 방식 | JSON 파일 일괄 import CLI |
| 테스트 | schema, validation, import transaction, 중복/재import 테스트 |

### 0.2 MVP 0에서 만들지 않는 것

- 사용자용 정책 목록 화면
- Next.js 실제 UI
- Public 정책 조회 API
- 검색/매칭 API
- 로그인과 사용자 계정
- 프로필
- 북마크
- 관리자 웹 화면
- 자동 정책 수집
- Worker
- Redis
- BullMQ
- LLM
- 알림
- 캘린더
- 정책 Raw 원문 저장
- 정책 수정 이력 / audit log

위 기능은 이후 MVP에서 추가한다.

---

## 1. 완료 상태

MVP 0은 다음 상태가 되면 완료로 본다.

```text
PostgreSQL 실행
→ migration 적용
→ 기준 데이터 seed
→ 실제 정책 JSON 30~50건 준비
→ 전체 JSON 검증
→ CLI import
→ policies 저장
→ 재import/오류/rollback 테스트 통과
```

완료 후 MVP 1에서는 별도의 데이터 모델 재설계 없이 `policies`를 읽어 정책 목록과 매칭 기능을 구현할 수 있어야 한다.

---

## 2. 프로젝트 구조

MVP 0에서 실제로 사용하는 주요 위치:

```text
youth-kkultong/
├─ apps/
│  ├─ web/                         # MVP1부터 본격 사용
│  └─ server/
│     └─ src/
│        ├─ common/
│        │  ├─ config/
│        │  └─ errors/
│        ├─ database/
│        │  ├─ migrations/
│        │  ├─ seeds/
│        │  └─ datasource.ts
│        ├─ modules/
│        │  ├─ meta/
│        │  └─ policies/
│        │     ├─ entities/
│        │     ├─ repositories/
│        │     └─ services/
│        │        └─ policy-write.service.ts
│        └─ cli/
│           └─ import-policies.ts
├─ packages/
│  └─ contracts/
│     └─ src/
│        ├─ enums.ts
│        └─ policy.ts
├─ data/
│  └─ policies/
│     ├─ policies.json
│     └─ policies.sample.json
└─ docker-compose.yml
```

MVP 0에서는 `apps/web`에 실제 서비스 화면을 구현하지 않는다.

---

## 3. 기술 기준

| 항목 | 선택 |
|---|---|
| Runtime | Node.js 22 LTS |
| Language | TypeScript strict |
| Backend | NestJS 11 |
| DB | PostgreSQL 16 |
| ORM | TypeORM |
| Validation | Zod |
| Package manager | pnpm |
| Test | Jest + Testcontainers |
| Container | Docker / docker compose |

Production 환경에서는 TypeORM `synchronize=true`를 사용하지 않는다.

---

# 4. 공통 열거값

```ts
export const POLICY_CATEGORIES = [
  'HOUSING',
  'FINANCE',
  'JOB',
  'EDUCATION',
  'WELFARE',
  'ETC',
] as const;

export type PolicyCategory =
  typeof POLICY_CATEGORIES[number];

export const USER_STATUSES = [
  'JOB_SEEKER',
  'STUDENT',
  'EMPLOYEE',
  'UNEMPLOYED',
] as const;

export type UserStatus =
  typeof USER_STATUSES[number];

export const SOURCE_TYPES = [
  'MANUAL',
  'API',
] as const;

export type SourceType =
  typeof SOURCE_TYPES[number];

export const SOURCE_STATUSES = [
  'ACTIVE',
  'NOT_SEEN',
  'CLOSED',
] as const;

export type SourceStatus =
  typeof SOURCE_STATUSES[number];
```

MVP 0에서는 정책 출처로 `MANUAL`만 사용한다.

`API`와 `NOT_SEEN`은 이후 자동 수집 확장을 위해 타입에는 존재할 수 있지만 MVP 0 import에서는 사용하지 않는다.

---

# 5. 정책 조건 모델

## 5.1 공통 Constraint

```ts
export type Constraint<T> =
  | { kind: 'ANY' }
  | { kind: 'RULE'; value: T }
  | { kind: 'UNKNOWN' };
```

| 값 | 의미 |
|---|---|
| `ANY` | 공식 공고를 확인한 결과 해당 항목 제한이 없음 |
| `RULE` | 시스템에서 비교 가능한 명확한 조건이 있음 |
| `UNKNOWN` | 공고가 모호하거나 현재 구조로 정확히 판단할 수 없음 |

`UNKNOWN`을 임의의 기본값으로 바꾸지 않는다.

---

## 5.2 NumberRange

```ts
export interface NumberRange {
  min: number | null;
  max: number | null;
}
```

- 양 끝 포함
- `min = null`: 최소 제한 없음
- `max = null`: 최대 제한 없음
- `min`, `max`가 모두 있으면 `min <= max`

---

## 5.3 나이 조건

```ts
export type AgeBasis =
  | { kind: 'TODAY' }
  | { kind: 'FIXED_DATE'; date: string }
  | { kind: 'YEAR_DIFF'; year: number }
  | { kind: 'BIRTH_YEAR' };

export interface AgeRule {
  min: number | null;
  max: number | null;
  basis: AgeBasis;
}
```

의미:

| basis | 의미 |
|---|---|
| `TODAY` | 조회 시점의 만 나이 |
| `FIXED_DATE` | 특정 날짜 기준 만 나이 |
| `YEAR_DIFF` | 기준연도 - 출생연도 |
| `BIRTH_YEAR` | 출생연도 자체를 min/max와 비교 |

규칙:

- 일반 나이 값은 0~120
- `BIRTH_YEAR`이면 min/max는 실제 연도 값
- 기준일이 불분명하면 `RULE`로 억지 입력하지 않고 `UNKNOWN`

---

## 5.4 지역 조건

```ts
Constraint<string[]>
```

허용 값:

```text
KR       전국
2자리    시/도
5자리    시/군/구
```

예:

```json
{
  "kind": "RULE",
  "value": ["11", "41111"]
}
```

`KR` 외의 코드는 `regions` 테이블에 존재해야 한다.

같은 코드의 중복 입력을 허용하지 않는다.

---

## 5.5 소득 조건

```ts
export interface IncomeRule {
  min: number | null;
  max: number | null;
  basisConfirmed: true;
}
```

단위:

```text
기준 중위소득 비율 %
```

`RULE`은 아래 조건을 모두 확인한 경우에만 허용한다.

1. 정책이 기준 중위소득 비율을 기준으로 한다.
2. 정책의 소득 산정 방식이 서비스가 사용할 방식과 호환된다.
3. 정책의 가구 범위가 서비스의 가구 정의와 호환된다.

다음 유형은 MVP 0에서 자동 환산하지 않고 `UNKNOWN`으로 저장한다.

- 개인 연소득
- 부모 소득 별도 조건
- 건강보험료
- 소득인정액
- 도시근로자 월평균소득
- 산정 방식이 불명확한 경우

비율 범위는 0~1000으로 제한한다.

---

## 5.6 현재 상태

```ts
Constraint<UserStatus[]>
```

`RULE`의 배열은 최소 1개 이상이어야 하며 중복을 허용하지 않는다.

---

## 5.7 가구원 수

```ts
Constraint<NumberRange>
```

`RULE`의 값은 정수이며 최소 1 이상이어야 한다.

서비스에서 지원하는 최대 가구원 수는 환경설정/기준표 범위와 일치시킨다.

정책의 가구 정의가 서비스 가구 정의와 명백히 다르면 조건을 억지로 환산하지 않고 `UNKNOWN`으로 둔다.

---

## 5.8 PolicyConditions

```ts
export interface PolicyConditions {
  age: Constraint<AgeRule>;
  region: Constraint<string[]>;
  income: Constraint<IncomeRule>;
  status: Constraint<UserStatus[]>;
  householdSize: Constraint<NumberRange>;
}
```

5개 필드는 생략할 수 없다.

각 필드는 반드시 `ANY`, `RULE`, `UNKNOWN` 중 하나여야 한다.

---

# 6. 혜택 금액

```ts
export type BenefitAmount =
  | {
      kind: 'FIXED';
      amountWon: number;
      text: string;
    }
  | {
      kind: 'MONTHLY';
      amountWon: number;
      months: number | null;
      text: string;
    }
  | {
      kind: 'RATE';
      text: string;
    }
  | {
      kind: 'IN_KIND';
      text: string;
    }
  | {
      kind: 'UNKNOWN';
      text: string;
    };
```

## 규칙

### FIXED

예:

```text
최대 100만원 지원
```

```json
{
  "kind": "FIXED",
  "amountWon": 1000000,
  "text": "최대 100만원"
}
```

### MONTHLY

예:

```text
월 최대 20만원, 12개월
```

```json
{
  "kind": "MONTHLY",
  "amountWon": 200000,
  "months": 12,
  "text": "월 최대 20만원, 최대 12개월"
}
```

지원 개월 수를 정확히 알 수 없으면 `months = null`.

### RATE

이자 지원, 할인율 등 단순 총액 계산이 어려운 경우.

### IN_KIND

교육, 서비스, 물품 등 현금이 아닌 지원.

### UNKNOWN

금액을 구조화하기 어렵거나 공고상 불명확.

---

## 6.1 MVP1용 총액 정렬 값

MVP 0에서 DB 컬럼으로 따로 저장하지 않는다.

코드에서 다음처럼 계산 가능해야 한다.

```text
FIXED
→ amountWon

MONTHLY + months 있음
→ amountWon × months

MONTHLY + months 없음
→ null

RATE / IN_KIND / UNKNOWN
→ null
```

---

# 7. 정책 입력 규격

JSON import의 정책 1건은 다음 구조를 사용한다.

```ts
export interface PolicyImportInput {
  externalId: string;

  title: string;
  agency: string;
  category: PolicyCategory;

  benefitSummary: string;
  benefitAmount: BenefitAmount;

  conditions: PolicyConditions;

  hasUnresolvedEligibilityCondition: boolean;
  unresolvedConditionNote: string | null;

  requiredDocs: string[];

  applyStart: string | null;
  applyEnd: string | null;
  isAlwaysOpen: boolean;

  officialUrl: string;

  lastVerifiedAt: string;

  isPublished: boolean;
}
```

`sourceCode`는 MVP 0 import에서는 항상 `MANUAL`로 처리하므로 각 JSON 항목에 반복 저장하지 않는다.

---

## 7.1 externalId

MVP 0의 수동 JSON 정책을 재import할 수 있도록 안정적인 식별자를 둔다.

예:

```text
2026-seoul-youth-rent-support
2026-national-youth-job-program
```

규칙:

- 파일 내에서 unique
- 한번 정한 값은 정책 제목이 바뀌어도 가급적 유지
- URL이나 DB UUID를 externalId로 사용하지 않음
- 소문자 영문, 숫자, `-` 사용 권장

DB에서는:

```text
MANUAL source + externalId
```

조합으로 같은 정책을 식별한다.

---

# 8. JSON 파일 형식

기본 파일:

```text
data/policies/policies.json
```

형식:

```json
[
  {
    "externalId": "2026-example-policy",
    "title": "예시 청년 지원 정책",
    "agency": "예시 기관",
    "category": "WELFARE",
    "benefitSummary": "최대 100만원 지원",
    "benefitAmount": {
      "kind": "FIXED",
      "amountWon": 1000000,
      "text": "최대 100만원"
    },
    "conditions": {
      "age": {
        "kind": "RULE",
        "value": {
          "min": 19,
          "max": 34,
          "basis": {
            "kind": "TODAY"
          }
        }
      },
      "region": {
        "kind": "RULE",
        "value": ["11"]
      },
      "income": {
        "kind": "UNKNOWN"
      },
      "status": {
        "kind": "ANY"
      },
      "householdSize": {
        "kind": "ANY"
      }
    },
    "hasUnresolvedEligibilityCondition": true,
    "unresolvedConditionNote": "공고의 세부 우선순위 조건은 공식 공고 확인 필요",
    "requiredDocs": [],
    "applyStart": "2026-01-01",
    "applyEnd": "2026-12-31",
    "isAlwaysOpen": false,
    "officialUrl": "https://example.go.kr/policy",
    "lastVerifiedAt": "2026-10-05T00:00:00+09:00",
    "isPublished": true
  }
]
```

실제 데이터는 공식 공고를 직접 확인한 정책만 입력한다.

---

# 9. 정책 입력 검증

## 9.1 기본 문자열

| 필드 | 규칙 |
|---|---|
| `externalId` | 1~120자, 파일 내 중복 금지 |
| `title` | 1~200자 |
| `agency` | 1~120자 |
| `benefitSummary` | 1~300자 |
| `officialUrl` | `http://` 또는 `https://` |
| `unresolvedConditionNote` | null 또는 trim 후 1자 이상 |

---

## 9.2 날짜

날짜는 regex만 확인하지 않고 실제 존재하는 날짜인지 검증한다.

예:

```text
2026-02-31 → 실패
2026-02-28 → 통과
```

규칙:

```text
applyStart <= applyEnd
```

둘 다 존재할 때만 비교한다.

`isAlwaysOpen = true`이면:

```text
applyEnd = null
```

이어야 한다.

`lastVerifiedAt`은 유효한 ISO 8601 시간이어야 한다.

---

## 9.3 추가 자격 조건

```text
hasUnresolvedEligibilityCondition = true
```

이면:

```text
unresolvedConditionNote
```

가 반드시 있어야 한다.

false이면 note는 null을 권장한다.

---

## 9.4 BenefitAmount

### FIXED
- amountWon: 양의 정수
- text: 필수

### MONTHLY
- amountWon: 양의 정수
- months: null 또는 양의 정수
- text: 필수

### RATE / IN_KIND / UNKNOWN
- amountWon 필드 자체를 받지 않는다.
- text 필수

Zod `discriminatedUnion`으로 검증한다.

---

## 9.5 Conditions

각 5개 조건은 반드시 존재한다.

`RULE`이면 value가 반드시 존재한다.

`ANY`, `UNKNOWN`에는 value를 넣지 않는다.

---

## 9.6 지역 DB 검증

JSON schema 통과 후 DB를 조회해 지역 코드가 실제로 존재하는지 검증한다.

예:

```text
KR → DB 조회 불필요
11 → regions에 있으면 통과
99999 → 실패
```

하나라도 잘못된 코드가 있으면 해당 정책 import를 실패시킨다.

---

# 10. Database

MVP 0 migration에서는 아래 4개 테이블만 만든다.

```text
regions
median_income_table
policy_sources
policies
```

미래 MVP의 테이블은 만들지 않는다.

---

## 10.1 regions

```sql
CREATE TABLE regions (
  code         text PRIMARY KEY,
  parent_code  text REFERENCES regions(code),
  level        smallint NOT NULL CHECK (level IN (1, 2)),
  name         text NOT NULL,
  active       boolean NOT NULL DEFAULT true
);

CREATE INDEX idx_regions_parent
  ON regions(parent_code);
```

---

## 10.2 median_income_table

```sql
CREATE TABLE median_income_table (
  year            smallint NOT NULL,
  household_size  smallint NOT NULL CHECK (household_size >= 1),
  amount          bigint NOT NULL CHECK (amount > 0),

  PRIMARY KEY (year, household_size)
);
```

다른 가구원 수나 다른 연도의 값을 자동 대체하지 않는다.

---

## 10.3 policy_sources

```sql
CREATE TABLE policy_sources (
  id          smallserial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  type        text NOT NULL
              CHECK (type IN ('MANUAL', 'API')),
  enabled     boolean NOT NULL DEFAULT true,
  base_url    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

MVP 0 seed:

```text
code = MANUAL
name = 수동 등록
type = MANUAL
enabled = true
```

---

## 10.4 policies

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE policies (
  id                                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  source_id                             smallint REFERENCES policy_sources(id),
  external_id                           text,

  title                                 varchar(200) NOT NULL,
  agency                                varchar(120) NOT NULL,
  category                              text NOT NULL
                                        CHECK (category IN (
                                          'HOUSING',
                                          'FINANCE',
                                          'JOB',
                                          'EDUCATION',
                                          'WELFARE',
                                          'ETC'
                                        )),

  benefit_summary                       varchar(300) NOT NULL,
  benefit_amount                        jsonb NOT NULL,
  conditions                            jsonb NOT NULL,

  has_unresolved_eligibility_condition boolean NOT NULL,
  unresolved_condition_note             text,

  required_docs                         text[] NOT NULL DEFAULT '{}',

  apply_start                           date,
  apply_end                             date,
  is_always_open                        boolean NOT NULL DEFAULT false,

  official_url                          text NOT NULL,

  source_status                         text NOT NULL DEFAULT 'ACTIVE'
                                        CHECK (source_status IN (
                                          'ACTIVE',
                                          'NOT_SEEN',
                                          'CLOSED'
                                        )),

  is_published                          boolean NOT NULL DEFAULT false,
  last_verified_at                      timestamptz NOT NULL,

  created_at                            timestamptz NOT NULL DEFAULT now(),
  updated_at                            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (source_id, external_id),

  CHECK (
    apply_start IS NULL
    OR apply_end IS NULL
    OR apply_start <= apply_end
  ),

  CHECK (
    NOT is_always_open
    OR apply_end IS NULL
  ),

  CHECK (
    NOT has_unresolved_eligibility_condition
    OR (
      unresolved_condition_note IS NOT NULL
      AND btrim(unresolved_condition_note) <> ''
    )
  ),

  CHECK (official_url ~ '^https?://')
);

CREATE INDEX idx_policies_active
  ON policies(is_published, source_status, apply_end);

CREATE INDEX idx_policies_category
  ON policies(category);

CREATE INDEX idx_policies_verified
  ON policies(last_verified_at);
```

MVP 0에서는 `source_status = ACTIVE`만 import한다.

---

# 11. 기준 데이터 Seed

## 11.1 지역

`regions`에는 최소 다음 범위를 넣는다.

- 시/도
- 시/군/구

행정 코드 데이터는 별도 seed 파일로 관리한다.

`KR`은 전국을 의미하는 애플리케이션 예약 코드이며 `regions` 행으로 넣지 않아도 된다.

---

## 11.2 기준 중위소득

현재 서비스가 사용할 연도와 가구원 수 범위의 값을 seed한다.

예:

```text
year
household_size
amount
```

실제 금액 자체는 공식 기준 자료를 확인해 입력한다.

누락된 값을 임의 계산하거나 직전 연도 값으로 채우지 않는다.

---

# 12. PolicyWriteService

MVP 0에서 정책 저장은 반드시 `PolicyWriteService`를 거친다.

필수 메서드:

```ts
create(input: PolicyImportInput): Promise<Policy>;

updateBySourceIdentity(
  sourceCode: 'MANUAL',
  externalId: string,
  input: PolicyImportInput,
): Promise<Policy>;

upsertManual(input: PolicyImportInput): Promise<{
  policy: Policy;
  action: 'CREATED' | 'UPDATED' | 'UNCHANGED';
}>;
```

책임:

1. Zod schema 검증
2. 날짜/조건 필드 간 검증
3. 지역 코드 DB 검증
4. MANUAL source 조회
5. 기존 정책 식별
6. create/update
7. transaction 내 저장

MVP 0에서는 audit log/revision을 만들지 않는다.

MVP 2에서 `PolicyWriteService` 내부에 해당 기록 기능을 추가한다.

---

# 13. JSON Import CLI

실행 예:

```bash
pnpm --filter server import:policies \
  --file ../../data/policies/policies.json
```

정확한 npm script 이름은 구현 계획에서 조정할 수 있으나 기능은 아래 규칙을 따른다.

---

## 13.1 처리 순서

```text
파일 읽기
→ JSON parse
→ 전체 배열 Zod 검증
→ externalId 파일 내 중복 검사
→ DB 참조 검증
→ transaction 시작
→ 각 정책 PolicyWriteService.upsertManual()
→ transaction commit
→ 결과 출력
```

---

## 13.2 All-or-Nothing

한 건이라도 검증 또는 DB 저장에 실패하면:

```text
전체 import rollback
```

한다.

일부 정책만 저장된 상태를 만들지 않는다.

---

## 13.3 재import

같은:

```text
MANUAL + externalId
```

가 존재하면 새 행을 만들지 않는다.

입력 내용이 달라졌으면 기존 행을 업데이트한다.

내용이 완전히 같으면 `UNCHANGED`로 처리한다.

따라서 JSON을 수정한 뒤 반복적으로 import할 수 있어야 한다.

---

## 13.4 import 결과 출력

성공:

```text
Policy import succeeded.

Total:     42
Created:   40
Updated:    2
Unchanged:  0
```

실패 예:

```text
Policy import failed.

Index: 17
externalId: 2026-example-policy
Field: conditions.region.value[0]
Reason: region code "99999" does not exist

No policies were saved.
```

민감 정보는 포함하지 않는다.

---

## 13.5 Dry Run

권장 기능:

```bash
--dry-run
```

이 옵션은:

```text
파일 읽기
→ 모든 검증 수행
→ 저장하지 않음
```

으로 동작한다.

실제 정책 30~50건을 작성하면서 오류를 찾기 쉬워진다.

MVP 0에서 구현 권장 사항으로 포함한다.

---

# 14. 실제 정책 데이터 작성 규칙

정책은 공식 공고 또는 공식 기관 페이지를 기준으로 작성한다.

최소한 다음을 사람이 직접 확인한다.

| 항목 | 확인 내용 |
|---|---|
| 정책명 | 공식 명칭 |
| 기관 | 지급/운영 기관 |
| 금액 | 최대 지원 수준 |
| 기간 | 신청 시작/마감/상시 여부 |
| 카테고리 | 서비스 분류 |
| 지역 | 전국/지역 조건 |
| 나이 | 범위와 기준 방식 |
| 상태 | 취업/재학 등 조건 |
| 가구 | 가구원 조건 여부 |
| 소득 | 자동 판정 가능한 기준인지 |
| 추가 조건 | 5개 조건 밖의 자격요건 존재 여부 |
| 서류 | 공식 공고에 명시된 제출 서류 |
| URL | 공식 공고 링크 |
| 확인일 | 실제 확인한 날짜/시간 |

조건을 확신할 수 없으면 임의 추측하지 않고 `UNKNOWN` 또는 추가 자격 조건으로 기록한다.

---

# 15. 정책 30~50건 구성 원칙

MVP 0의 목적은 정책 수 자체를 많이 확보하는 것이 아니라 데이터 모델이 실제 공고를 충분히 표현하는지 검증하는 것이다.

따라서 정책 종류가 한쪽으로 몰리지 않도록 한다.

최소한 다음 유형이 섞이도록 선정하는 것을 권장한다.

- 전국 정책
- 지역 정책
- 나이 제한 정책
- 나이 제한 없는 정책
- 소득 제한 정책
- 소득 자동 판정이 어려운 정책
- 상시 정책
- 기간이 명확한 정책
- 금액이 고정된 정책
- 월 단위 지원 정책
- 현물/교육 지원
- 추가 자격 조건이 존재하는 정책

정확한 지역 범위와 카테고리 비율은 PRD의 별도 제품 결정으로 남긴다.

---

# 16. 테스트

## 16.1 Zod Unit Test

반드시 테스트:

- 정상 FIXED
- 정상 MONTHLY
- 잘못된 amountWon
- 잘못된 날짜
- age min > max
- 잘못된 AgeBasis
- region RULE 빈 배열
- status RULE 빈 배열
- 추가 조건 true + note 없음
- ALWAYS + applyEnd 존재
- 잘못된 URL
- 중복 externalId

---

## 16.2 DB Integration Test

Testcontainers PostgreSQL 기준.

테스트:

### 신규 import

```text
JSON 3건
→ policies 3행 생성
```

### 재import 동일

```text
동일 JSON 재import
→ 추가 행 없음
→ 3건 UNCHANGED
```

### 재import 수정

```text
정책 제목/금액 변경
→ 동일 id 정책 update
→ 중복 행 없음
```

### 하나 실패

```text
3건 중 1건 invalid
→ 전체 rollback
→ 0건 저장
```

### 잘못된 지역

```text
없는 region code
→ 전체 import 실패
```

### source identity

```text
MANUAL + externalId
→ unique 유지
```

---

# 17. MVP 0에서는 API를 만들지 않는다

MVP 0의 핵심 결과물은:

```text
검증된 DB 스키마
+
실제 정책 데이터
+
반복 가능한 import 방법
```

이다.

정책 조회 Public API:

```text
GET /api/v1/policies
GET /api/v1/policies/:id
POST /api/v1/policies/search
```

는 MVP 1에서 구현한다.

---

# 18. MVP 0 산출물

MVP 0 완료 시 최소 다음 산출물이 존재해야 한다.

```text
apps/server/
packages/contracts/
data/policies/policies.json

DB migration
regions seed
median income seed
MANUAL policy source seed

PolicyInput Zod schema
PolicyWriteService
JSON import CLI
import tests

실제 정책 30~50건
```

---

# 19. 수용 기준

| ID | 기준 |
|---|---|
| AC-01 | PostgreSQL 빈 DB에 migration이 정상 적용된다. |
| AC-02 | 지역 seed가 정상 입력된다. |
| AC-03 | 필요한 기준 중위소득 seed가 정상 입력된다. |
| AC-04 | MANUAL 정책 출처가 seed된다. |
| AC-05 | 실제 정책 JSON 30~50건이 schema 검증을 통과한다. |
| AC-06 | JSON 전체를 한 번에 DB에 import할 수 있다. |
| AC-07 | 한 건이라도 잘못되면 전체 import가 rollback된다. |
| AC-08 | 동일 파일을 재import해도 중복 정책이 생기지 않는다. |
| AC-09 | 수정된 정책을 재import하면 동일 정책이 update된다. |
| AC-10 | 잘못된 지역/날짜/조건 조합을 저장할 수 없다. |
| AC-11 | 정책마다 공식 URL과 마지막 확인일이 존재한다. |
| AC-12 | 정책 조건이 불분명할 때 추측값 대신 `UNKNOWN` 또는 추가 조건으로 저장되어 있다. |
| AC-13 | MVP 1에서 사용할 핵심 필드가 모두 30~50건 데이터에 존재한다. |
| AC-14 | Redis, BullMQ, 로그인, 자동 수집, LLM이 MVP 0 코드에 포함되지 않는다. |

---

# 20. MVP 0 종료 후 MVP 1로 넘기는 계약

MVP 1은 MVP 0의 `policies` 데이터를 그대로 사용한다.

MVP 1에서 새로 구현할 것은:

```text
GET /api/v1/policies
GET /api/v1/policies/:id
POST /api/v1/policies/search

규칙 기반 matching engine

Next.js 전체 정책 목록
필터/조건 UI
정책 상세 UI
```

MVP 0 완료 시 정책 데이터 자체를 다시 대규모 변환해야 한다면 MVP 0의 데이터 모델 검증이 실패한 것으로 본다.

---

# 21. 핵심 결정 요약

1. MVP 0은 **데이터 기반 구축 단계**다.
2. 사용자 화면/API/로그인은 만들지 않는다.
3. 실제 정책 30~50건을 공식 공고 기준으로 사람이 구조화한다.
4. 정책은 JSON → 검증 → CLI → `PolicyWriteService` → PostgreSQL 순서로 저장한다.
5. 수동 정책의 stable key는 `externalId`다.
6. 재import는 중복 생성이 아니라 upsert로 처리한다.
7. import는 all-or-nothing transaction이다.
8. 사용자 매칭에 필요한 핵심 조건은 5개 Constraint 구조로 통일한다.
9. 모호한 조건은 추측하지 않고 `UNKNOWN` 또는 추가 자격 조건으로 기록한다.
10. DB는 MVP 0에 필요한 테이블만 migration으로 생성한다.
