# 청년꿀통(youth-kkultong) SPEC — MVP2 v0.5

> 저장 위치: `docs/mvp-2/SPEC.md`  
> 기준: PRD v0.12 · ARCHITECTURE v0.7 · 수정일: 2026-10-28  
> 상태: 개발 명세 작성안. 구현·테스트 완료를 뜻하지 않는다.

이 문서는 MVP2의 DB·API·수집·검수·인증·화면·테스트 기준을 정의한다. MVP1 SPEC의 수집 호출·변환·공개 API·매칭·탐색 규칙을 재사용하되, **수집 즉시 본문을 공개하던 저장 방식은 승인 후 공개로 바꾼다.** MVP1 실제 구현은 `docs/mvp-1/SUMMARY.md`를 기준으로 확인한다.

## 목차

1. [기능과 처리 순서](#1-기능과-처리-순서)
2. [DB 스키마](#2-db-스키마)
3. [공용 인터페이스·타입](#3-공용-인터페이스타입)
4. [API 명세](#4-api-명세)
5. [정책 수집 명세](#5-정책-수집-명세)
6. [검수 상태와 공개 규칙](#6-검수-상태와-공개-규칙)
7. [관리자 인증·권한](#7-관리자-인증권한)
8. [관리자 화면과 기존 탐색 유지](#8-관리자-화면과-기존-탐색-유지)
9. [검증 시나리오](#9-검증-시나리오)
10. [구현 착수 전 준비 자료](#10-구현-착수-전-준비-자료)

## 1. 기능과 처리 순서

**MVP2 목표:** 온통청년 정책을 매일 수집하고, 신규·변경 내용은 관리자가 승인한 뒤 공개한다. 기존 사용자의 정책 탐색은 유지한다.

**수집 처리 순서:** 수집 중복 실행 잠금 → 전체 페이지 조회·검증 → 변환·해시 계산 → 지난 수집 원본과 비교 → 원본·누락·검수 후보·공개 조회수를 한 트랜잭션으로 저장 → 결과 기록·잠금 해제.

**관리자 처리 순서:** 로그인 → 검수 대기 목록 → 기존 공개본과 변경본 비교 → 승인 또는 거절 → 처리 이력 확인.

예를 들어 공개 정책 내용이 A일 때 B를 수집해도 사용자는 계속 A를 본다. 관리자가 B를 승인하면 B로 바뀌고, 거절하면 A를 유지한다. 조회수는 승인과 별개로 최신 수집값을 사용한다.

| 개념 | 의미 | 값 |
| --- | --- | --- |
| 수집 결과 | 지난번 수집한 원본과 이번 자료를 비교한 결과 | `NEW`(신규), `CHANGED`(변경), `UNCHANGED`(동일), `MISSING`(누락) |
| 검수 상태 | 특정 변경본을 관리자가 처리했는지 여부 | `PENDING`(대기), `APPROVED`(승인), `REJECTED`(거절), `SUPERSEDED`(대체됨) |
| 공개 정책 | 현재 사용자가 조회하는 승인된 내용 | `policies`에 저장된 행 |

후보 생성은 6.2절, 누락 처리는 5.3절을 따른다. 수집 결과와 검수 상태를 같은 값으로 취급하지 않는다.

범위는 PRD 3장을 따른다. 이번 관리자 기능은 검수·이력·누락 확인이며 정책 직접 편집·수동 공개 중단·웹 수집 실행 API는 제공하지 않는다.

## 2. DB 스키마

### 2.1 `source_policies` — 최신 수집 원본

정책 하나당 최신 원본 한 건을 보관한다. 공개본이 없는 신규 정책도 이 테이블에는 존재한다.

| 컬럼 | PostgreSQL 타입 | 필수·기본값 | 설명 |
| --- | --- | --- | --- |
| `id` | `UUID` | PK, 자동 생성 | 수집 원본 내부 ID. 공개 정책 UUID와 별개 |
| `source` | `VARCHAR(32)` | NOT NULL | 온통청년은 `youthcenter` |
| `external_id` | `VARCHAR(64)` | NOT NULL | 온통청년 `plcyNo` |
| `title` | `TEXT` | NOT NULL | 최신 원본의 정책명 |
| `raw_json` | `JSONB` | NOT NULL | 최신 수집 정책 객체 전체 |
| `content_hash` | `CHAR(64)` | NOT NULL | 최상위 `inqCnt`를 제외한 원본 SHA-256 |
| `view_count` | `INTEGER` | NULL | 최신 원본 조회수의 정규화 결과 |
| `first_collected_at` | `TIMESTAMPTZ` | NULL | MVP2에서 처음 실제 수집에 성공한 시각 |
| `last_collected_at` | `TIMESTAMPTZ` | NULL | 마지막으로 실제 수집된 시각. 누락 시 갱신하지 않음 |
| `last_collection_result` | `VARCHAR(16)` | NULL | 마지막 정상 전체 수집에서의 네 가지 판정 중 하나 |
| `missing_count` | `INTEGER` | NOT NULL, 0 | 정상 전체 수집에서 연속으로 빠진 횟수 |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, 현재 시각 | 행 생성 시각. 실제 API 수집 시각과 구분 |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, 현재 시각 | 마지막 DB 반영 시각 |

**제약·인덱스**

- `UNIQUE (source, external_id)`. 식별자·제목은 공백만으로 구성될 수 없으며 MVP1 길이·자료형 검증을 유지한다.
- `content_hash`는 소문자 16진수 64자리, `raw_json`은 JSON 객체, `view_count`는 NULL 또는 0 이상이다.
- `last_collection_result`는 NULL 또는 수집 결과 네 값만 허용한다. NULL은 기존 데이터 이관 후 아직 실제 수집되지 않은 경우에만 사용한다.
- `missing_count`는 0 이상의 연속 누락 횟수다. 정상 전체 수집에서 빠지면 1 증가하고 다시 수집되면 0으로 초기화한다.
- 이관 원본은 실제 수집 전까지 수집 시각이 NULL일 수 있다. 실제 수집 시 `first_collected_at`이 비어 있으면 채우고 이후 유지한다.
- 누락 목록용 부분 인덱스: `(missing_count DESC, id ASC) WHERE missing_count > 0`.
- 이 테이블은 정규화된 정책 컬럼을 전부 복제하지 않는다. 공개 반영 시 검수 원본을 기존 변환 함수에 전달한다.

### 2.2 `policy_reviews` — 검수 후보와 처리 이력

후보 하나는 **특정 변경본과 그때의 공개 기준본**을 뜻한다. 스냅샷(Snapshot)은 나중에 원본이 바뀌어도 검수 당시 내용을 확인하도록 복사해 둔 데이터다.

| 컬럼 | PostgreSQL 타입 | 필수·기본값 | 설명 |
| --- | --- | --- | --- |
| `id` | `UUID` | PK, 자동 생성 | 검수 후보 ID |
| `source_policy_id` | `UUID` | NOT NULL, FK | `source_policies.id` |
| `kind` | `VARCHAR(16)` | NOT NULL | `NEW` 또는 `CHANGED`. 후보 생성 시 공개본이 없으면 NEW |
| `status` | `VARCHAR(16)` | NOT NULL, PENDING | 네 가지 검수 상태 중 하나 |
| `content_hash` | `CHAR(64)` | NOT NULL | 검수 변경본 해시 |
| `raw_snapshot` | `JSONB` | NOT NULL | 검수할 변경본 원본 객체 |
| `base_policy_id` | `UUID` | NULL, FK | 후보 생성 당시 `policies.id`. 신규는 NULL |
| `base_content_hash` | `CHAR(64)` | NULL | 후보 생성 당시 공개본 해시 |
| `base_raw_snapshot` | `JSONB` | NULL | 후보 생성 당시 공개본 원본 객체 |
| `reviewed_by` | `VARCHAR(64)` | NULL | 승인·거절한 관리자 로그인 식별자 |
| `rejection_reason` | `VARCHAR(1000)` | NULL | 거절 사유 |
| `superseded_reason` | `VARCHAR(32)` | NULL | 대체 이유. 아래 코드 사용 |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, 현재 시각 | 후보 생성 시각 |
| `closed_at` | `TIMESTAMPTZ` | NULL | 승인·거절·대체 처리 시각 |

**제약·인덱스**

- 두 FK는 `ON DELETE RESTRICT`. 원본·공개 정책·검수 이력을 이번 MVP에서 삭제하지 않는다.
- 원본 하나에 대기 후보는 최대 한 개다: `UNIQUE (source_policy_id) WHERE status = 'PENDING'`.
- `(source_policy_id, content_hash)` 전체에 UNIQUE를 걸지 않는다. 과거 승인·대체 해시가 현재 공개본과 다른 내용으로 돌아오면 새 후보를 만들 수 있기 때문이다.
- 처리 완료 목록용 `(closed_at DESC, id ASC) WHERE status <> 'PENDING'` 인덱스를 둔다. 목록 조회용 `(status, created_at DESC, id ASC)`, 정책 이력용 `(source_policy_id, created_at DESC, id ASC)`, 거절 해시 확인용 `(source_policy_id, content_hash) WHERE status = 'REJECTED'` 인덱스를 둔다.
- `NEW`는 기준본 세 값이 모두 NULL, `CHANGED`는 모두 NOT NULL이다. 기준 ID의 출처·외부 ID가 원본과 같은지는 서비스에서 검사한다.
- 두 해시는 존재 시 소문자 16진수 64자리다. 스냅샷은 JSON 객체이며 저장 전에 해당 해시와 일치하는지 검증한다.
- 상태별 필수값을 아래처럼 DB CHECK(행 유효성 제약)로 보호한다. “없음”은 NULL이다.

| 상태 | 처리자 | 거절 사유 | 대체 이유 | 종료 시각 |
| --- | --- | --- | --- | --- |
| PENDING | 없음 | 없음 | 없음 | 없음 |
| APPROVED | 필수 | 없음 | 없음 | 필수 |
| REJECTED | 필수 | 공백 아닌 값 필수 | 없음 | 필수 |
| SUPERSEDED | 없음 | 없음 | 필수 | 필수 |

- 대체 이유는 `SOURCE_CHANGED`(원본 변경), `PUBLIC_BASE_CHANGED`(공개 기준본 변경), `MATCHES_PUBLIC`(공개본과 같아짐), `PREVIOUSLY_REJECTED`(거절했던 내용으로 복귀)다.
- 후보 생성 후 변경본·기준본 스냅샷, 해시, 종류는 수정하지 않는다. 처리할 때는 상태와 처리 정보만 갱신한다. 기존 이력을 다시 PENDING으로 돌리지 않는다.

### 2.3 기존 `policies`·`regions` — 유지

기존 컬럼·UUID·복합 UNIQUE·지역 시드와 공개 API 계약은 MVP1 SPEC 2장을 따른다. 새 테이블 두 개를 위한 Migration(스키마 변경 기록)을 추가하되 기존 테이블을 삭제·재생성하지 않는다. 부분·DESC 인덱스는 Migration SQL로 생성하고 엔티티의 해당 인덱스 메타데이터에는 `synchronize: false`를 지정한다. 적용 후 ORM 스키마 차이 0건과 실제 DB의 인덱스 방향·조건·유일성을 각각 확인한다.

- 원본과 공개 정책은 `(source, external_id)`로 연결한다. 하나의 원본에 공개본은 0개 또는 1개, 검수 이력은 여러 개다.
- `policies.content_hash`·`raw_json`·정규화된 본문 컬럼은 **승인된 내용**을 나타낸다. 수집 시 미승인 본문으로 바꾸지 않는다.
- `policies.view_count`만 승인 여부와 관계없이 갱신한다. 따라서 공개 `raw_json.inqCnt`와 최신 `view_count`는 다를 수 있다. `inqCnt`는 내용 해시에 포함되지 않는다.
- 기존 정책 승인 갱신은 `id`·`source`·`external_id`·`created_at`을 유지한다. 최초 승인되는 신규 정책의 공개 ID는 기존 방식으로 UUID를 생성한다.
- `updated_at`은 실제 DB 반영 시각이다. 조회수만 바뀌어도 달라질 수 있으므로 공개 버전 비교에 사용하지 않는다. 버전 비교는 내용 해시를 사용한다.
- 엔티티·Repository(DB 접근 계층)는 `PoliciesModule`, 관리자 컨트롤러·인증은 `AdminModule`에 둔다. 지역과 매칭 모듈의 경계는 유지한다.

### 2.4 기존 데이터 이관

1. **사전 확인:** 자동 수집을 비활성화하고 이전·신규 코드의 쓰기를 중단한 뒤 DB·수집 로그를 백업한다. 기존 원본·해시 일치와 식별자 중복을 검증하고 이상이 있으면 이관하지 않는다.
2. **이관:** 한 Migration 트랜잭션에서 새 테이블·제약·인덱스를 만들고 공개 정책마다 원본을 복사한다. 출처·외부 ID·제목·원본·해시·조회수는 그대로, 원본 ID는 새 UUID로 둔다. 실제 수집 시각·결과=NULL, 누락 횟수=0, 생성·갱신 시각=이관 시각이다. 후보·가상의 승인 이력은 만들지 않는다.
3. **검증:** 공개 UUID·전체 행·지역 데이터가 그대로인지, 원본 대응 건수·해시가 맞는지 확인한다. 같은 자료 재수집은 UNCHANGED·후보 0건이어야 한다. 이관 오류는 전체 취소하며 적용된 Migration은 재실행하지 않는다.
4. **운영 전환:** 새 코드로 수동 수집·검수·공개 API를 확인한 뒤 API의 자동 수집을 활성화한다. 검수 데이터가 생긴 뒤 테이블을 지우는 자동 역이관은 제공하지 않는다. 복구는 별도 빈 DB에 백업을 복원해 검증한 뒤 수행한다.

## 3. 공용 인터페이스·타입

추가 위치: `packages/shared/src/admin.ts`. 아래 타입은 관리자 API 계약이다. DB 엔티티나 DB 트랜잭션 타입을 shared에 넣지 않는다. 기존 `policies.ts`·메타 응답은 유지한다.

```ts
export type CollectionResult = 'NEW' | 'CHANGED' | 'UNCHANGED' | 'MISSING';
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
export type ReviewKind = 'NEW' | 'CHANGED';
export type SupersededReason =
  | 'SOURCE_CHANGED' | 'PUBLIC_BASE_CHANGED'
  | 'MATCHES_PUBLIC' | 'PREVIOUSLY_REJECTED';
export type JsonValue = null | boolean | number | string
  | JsonValue[] | { [key: string]: JsonValue };
export interface PolicySnapshot {
  contentHash: string;
  raw: Record<string, JsonValue>;
}
export interface AdminIdentity { username: string; expiresAt: string; }
export interface AdminLoginRequest { username: string; password: string; }
export interface AdminReviewQuery {
  page?: number; limit?: number;
  status?: ReviewStatus | 'PROCESSED';
  kind?: ReviewKind; keyword?: string; sourcePolicyId?: string;
}
export interface Pagination {
  page: number; limit: number; total: number; totalPages: number;
}
export interface ReviewListItem {
  id: string; sourcePolicyId: string; source: string; externalId: string;
  title: string; kind: ReviewKind; status: ReviewStatus;
  contentHash: string; baseContentHash: string | null;
  createdAt: string; closedAt: string | null;
  reviewedBy: string | null; rejectionReason: string | null;
  supersededReason: SupersededReason | null;
}
export interface ReviewListResponse {
  items: ReviewListItem[]; pagination: Pagination;
}
export interface PolicyFieldDiff {
  key: string;
  beforeExists: boolean; afterExists: boolean;
  before: JsonValue; after: JsonValue;
}
export interface AdminReviewDetail {
  review: ReviewListItem;
  base: PolicySnapshot | null;
  target: PolicySnapshot;
  currentPublished: (PolicySnapshot & { id: string; viewCount: number | null }) | null;
  latestSource: {
    contentHash: string; viewCount: number | null;
    lastCollectedAt: string | null; missingCount: number;
  };
  changedFields: PolicyFieldDiff[];
  latestPendingReviewId: string | null;
  canReview: boolean;
}
export interface ReviewActionRequest {
  contentHash: string;
  baseContentHash: string | null;
}
export interface RejectReviewRequest extends ReviewActionRequest { reason: string; }
export interface ReviewActionResponse {
  id: string; status: 'APPROVED' | 'REJECTED';
  policyId: string | null; closedAt: string;
}
export interface MissingPolicyQuery {
  page?: number; limit?: number; keyword?: string; minMissingCount?: number;
}
export interface MissingPolicyItem {
  sourcePolicyId: string; source: string; externalId: string; title: string;
  policyId: string | null; contentHash: string;
  lastCollectedAt: string | null;
  missingCount: number;
  latestPendingReviewId: string | null;
}
export interface MissingPolicyResponse {
  items: MissingPolicyItem[]; pagination: Pagination;
}
```

- JSON 필드는 camelCase(단어 첫 글자를 구분하는 표기), API 시각은 UTC의 ISO 8601 문자열로 전달한다. 웹은 한국 시각으로 표시한다.
- 제목은 검수 목록에서 `raw_snapshot.plcyNm`, 누락 목록에서 최신 원본 `title`을 사용한다. 과거 후보의 제목을 현재 원본 제목으로 바꾸지 않는다.
- 스냅샷은 API 응답 봉투 전체가 아닌 정책 객체만 담는다. 관리자에게만 제공하며 공개 응답에는 넣지 않는다.
- Zod로 요청값·조회 조건을 검증한다. 내부 오류·SQL·인증 비밀값은 응답에 포함하지 않는다.

## 4. API 명세

경로 접두사: `/api/v1`. 기존 공개 정책·메타·health API는 변경하지 않는다. 관리자 요청도 기존 Next.js 동일 출처 프록시를 통한다.

| 방식·경로 | 요청 | 정상 응답 |
| --- | --- | --- |
| `POST /admin/auth/login` | `AdminLoginRequest` | 200, `AdminIdentity` 및 인증 쿠키 |
| `GET /admin/auth/me` | 인증 쿠키 | 200, `AdminIdentity` |
| `POST /admin/auth/logout` | 빈 JSON 객체 | 204, 쿠키 삭제 |
| `GET /admin/reviews` | `AdminReviewQuery`를 query로 전달 | 200, `ReviewListResponse` |
| `GET /admin/reviews/:id` | 검수 UUID | 200, `AdminReviewDetail` |
| `POST /admin/reviews/:id/approve` | `ReviewActionRequest` | 200, `ReviewActionResponse` |
| `POST /admin/reviews/:id/reject` | `RejectReviewRequest` | 200, `ReviewActionResponse` |
| `GET /admin/source-policies/missing` | `MissingPolicyQuery`를 query로 전달 | 200, `MissingPolicyResponse` |

로그인을 제외한 관리자 데이터 API는 인증이 필요하다. 로그아웃은 쿠키가 없어도 204이며 출처 검증은 적용한다. 인증정보 없이 요청하면 목록·상세·존재 여부를 조회하기 전에 401로 거부한다.

### 4.1 검수 목록·처리 이력

- `page` 기본 1, `limit` 기본 20·최대 50. query의 양의 정수 문자열만 허용하며 소수·음수·배열·중복 query 키는 400이다.
- `status` 기본 PENDING. 네 상태를 개별 조회하거나 `PROCESSED`로 승인·거절·대체 이력을 함께 조회한다. PROCESSED는 조회용 묶음이며 DB 검수 상태가 아니다.
- `kind`·`sourcePolicyId`는 선택 조건이다. `keyword`는 앞뒤 공백 제거 후 최대 100자이며 후보 제목의 부분 일치 검색에만 사용한다. 영문 대소문자는 구분하지 않고 `%`·`_`도 문자 그대로 비교한다. 빈 문자열은 검색 없음이다.
- 조건은 모두 AND로 적용한다. 기본 정렬은 `created_at DESC → id ASC`, PROCESSED는 `closed_at DESC → id ASC`다. 다른 개별 상태도 기본 정렬을 사용한다.
- 전체 조건 적용 후 일반 조회로 건수·페이지를 읽는다. 동시에 수집·검수가 반영되면 건수와 항목에 일시적인 차이가 있을 수 있으며 목록 조회용 트랜잭션은 추가하지 않는다.
- 결과 0건 또는 범위를 넘은 페이지는 200·빈 배열이다. N+1(항목마다 추가 조회) 없이 원본 식별 정보를 조합한다. 목록에 긴 원본 스냅샷은 포함하지 않는다.

### 4.2 상세·차이 비교

- UUID 형식 오류는 400, 존재하지 않는 후보는 404다. 이력을 포함해 모든 검수 상태의 상세를 조회할 수 있다.
- `base`와 `target`은 보관된 스냅샷이다. 신규의 `base`는 NULL이다. `currentPublished`는 요청 당시 실제 공개본이며 과거 기준본과 다를 수 있다.
- 상세는 후보·원본·현재 공개본·최신 대기 ID를 하나의 짧은 읽기 전용 REPEATABLE READ(같은 읽기 시점 유지) 트랜잭션으로 읽는다. 목록과 달리 비교 대상끼리의 일관성이 필요하다.
- `changedFields`는 기준본과 변경본의 **최상위 필드**를 비교한 배열이다. `inqCnt`는 제외하고 키를 오름차순으로 정렬한다. 중첩 값은 기존 해시와 같은 키 정렬 직렬화로 비교하고 배열 순서는 유지한다.
- 새 필드·사라진 필드와 명시적 NULL을 구분한다. 없는 쪽 값은 NULL로 응답하되 `beforeExists`·`afterExists`로 구분한다. 신규 후보는 존재하는 모든 필드가 추가다. 원문을 자르거나 공백을 정규화해 동일 처리하지 않는다.
- `canReview`는 6.3절의 대기 상태·최신 원본·공개 기준 확인을 통과할 때 true다. 화면 안내용 값이며 처리 시 서버가 다시 검사한다.
- 누락 상태만으로 `canReview`를 false로 만들지 않는다. 누락 사실을 화면에서 경고하고 저장된 최신 정상 원본에 대해 검수할 수 있다.

### 4.3 승인·거절

```http
POST /api/v1/admin/reviews/{검수 UUID}/approve
Content-Type: application/json
```

```json
{
  "contentHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "baseContentHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}
```

위 해시는 형식 설명용 예시다. 실제 요청은 상세에서 받은 해시를 그대로 보내며 신규 후보의 `baseContentHash`는 JSON `null`을 보낸다. 거절은 같은 두 필드에 `reason`을 추가한다. 사유는 앞뒤 공백 제거 후 1~1000자이며 HTML로 해석하지 않는다.

- 알 수 없는 본문 필드, 누락된 필드, 잘못된 해시·사유·UUID는 400이다. 관리자가 변경본을 요청 본문에 직접 보내거나 편집할 수 없다.
- 처리·중복 요청·동시 실행 기준은 6.3절을 따른다.
- 공개 정책이 없던 후보를 거절하면 `policyId=null`이다. 기존 정책이면 현재 공개 UUID를 반환한다. 정상 처리 시에만 `closedAt`을 반환한다.

### 4.4 누락 정책 목록

- 누락 횟수가 1 이상인 원본만 반환한다. 공개 여부와 관계없이 미승인 신규 원본도 포함한다.
- `page`·`limit`·제목 `keyword` 검증은 4.1절과 같으며 제목은 최신 원본 기준이다. `minMissingCount`는 기본 1, 1~2147483647 정수이며 이 횟수 이상만 조회한다.
- `missing_count DESC → id ASC`로 정렬한다. 정책별 최신 대기 후보 ID와 공개 UUID를 함께 제공한다. 공개본이 없으면 `policyId=null`이다.
- `lastCollectedAt=null`은 이관 이후 실제 수집된 적이 없다는 뜻이다. 임의로 이관 시각을 대신 넣지 않는다. 건수·항목은 4.1절과 같이 일반 조회하며 동시 변경 중 일시적인 차이를 허용한다.

### 4.5 오류·요청 보호

기존 `{ "code": "...", "message": "..." }` 오류 형식을 유지한다. 오류 메시지는 한국어 고정 문구를 사용한다.

| HTTP | 코드 | 상황 |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | 요청 형식·UUID·query·입력값 오류 |
| 401 | `ADMIN_UNAUTHORIZED` | 쿠키 없음·변조·만료·잘못된 로그인 |
| 403 | `ADMIN_ORIGIN_FORBIDDEN` | 관리자 상태 변경 요청 출처 누락·불일치 |
| 404 | `REVIEW_NOT_FOUND` | 인증된 관리자가 없는 후보 조회·처리 |
| 409 | `REVIEW_NOT_PENDING` | 이미 승인·거절·대체된 후보 |
| 409 | `REVIEW_CONTENT_CONFLICT` | 화면/후보/최신 원본의 변경본 해시 불일치 |
| 409 | `REVIEW_BASE_CONFLICT` | 화면·후보 기준 해시 또는 현재 공개 ID·해시 불일치 |
| 413 / 415 / 429 | 기존 공통 코드 | 본문 한도·JSON 형식·호출 제한 위반 |
| 500 | `INTERNAL_SERVER_ERROR` | 내부 처리·저장 오류 |
| 503 | `SERVICE_UNAVAILABLE` | DB 연결 불가 |

- 400·500·503은 MVP1 공통 코드를 유지한다. 관리자 전용 업무 코드만 추가하고 공통 오류 필터가 명시된 상태·코드·안전한 메시지를 보존하는지 검증한다. 임의 예외 본문을 그대로 노출하지 않는다. 공개 API의 오류·검증·CORS·보안 헤더는 유지하며 호출 제한 집계 분리는 7.2절을 따른다.
- 관리자 POST도 기존 JSON 16KB 한도와 압축 본문 거부 규칙을 적용한다. 관리자 응답은 성공·실패 모두 `Cache-Control: no-store`로 제공한다.
- 로그인 비밀번호·인증 쿠키·원본 요청 본문·거절 사유·정책 원문을 액세스 로그에 남기지 않는다. 검수 사유는 검수 DB에만 저장한다.

## 5. 정책 수집 명세

### 5.1 실행·자동 수집

- 자동 수집은 `@nestjs/schedule`의 `@Cron('0 0 4 * * *', { name: 'policy-daily-import', timeZone: 'Asia/Seoul' })`으로 매일 한국 시간 04:00에 실행한다. 초·분·시를 포함하는 6자리 표현식이며 OS·컨테이너의 기본 시간대와 별개로 명시한다.
- 스케줄러는 API 프로세스에서 `await ingestionService.importPolicies()`를 호출하는 얇은 진입점이다. 수집·검증·저장·잠금·결과 로그는 기존 공통 서비스를 재사용한다. 자동 실행을 위해 셸 명령이나 CLI 자식 프로세스를 만들지 않는다.
- `POLICY_SCHEDULE_ENABLED`는 true/false만 허용하며 기본값은 false다. HTTP 전용 설정에서 검증하고 `.env.example`·Compose api 환경변수에 전달한다. true인 HTTP 구성에서만 `ScheduleModule.forRoot()`를 한 번 등록하고 스케줄러 제공자를 연결한다. 수집·Migration·시드 CLI와 일반 테스트 컨텍스트에는 타이머를 등록하지 않는다.
- 단일 API 인스턴스에서 실행한다. 자동 수집과 수동 CLI가 겹쳐도 기존 출처별 고정 PostgreSQL 세션 Advisory Lock으로 하나만 수집하고 나머지는 중복 실행으로 기록한다. 이 잠금은 DB 전체 잠금이 아니며 공개 조회는 계속 제공한다.
- 수동 수집은 기존 `npm run import:policies --workspace apps/api`를 유지한다. HTTP 서버 없이 같은 공통 서비스를 호출한다. 종료 코드 0=수집·DB 반영·로그·정리 성공, 1=실패, 2=다른 수집 진행 중이다. DB 확정 후 로그·정리 실패도 1일 수 있으므로 saved를 함께 확인한다.
- 자동 실행은 공통 서비스의 오류를 받아 정해진 실패 로그와 자원 정리를 수행하고 다음 스케줄을 유지한다. API 프로세스를 종료하거나 애플리케이션 컨텍스트를 닫지 않는다. process.exit·CLI 종료 코드 처리는 CLI 진입점에만 둔다. 재시도는 5.2·5.5절 기준만 적용한다.
- API가 정지·재시작 중이면 해당 시각의 실행은 누락될 수 있다. 시작 즉시 실행하거나 놓친 작업을 자동 보충하지 않으며 복구 후 운영자가 수동 수집한다. 자동 운영에는 해당 시각 API가 계속 실행되는 환경이 필요하다.
- 자동 실행 검증은 핸들러 직접 호출뿐 아니라 등록된 스케줄러의 호출·시간대·다음 실행 시각, 비활성 및 CLI의 타이머 없음, 실패 뒤 API 정상 응답을 확인한다. 시험용 실행은 별도 검증 환경에서 수행한다.

### 5.2 API 조회·검증·변환

MVP1 SPEC 5.1~5.4의 클라이언트·검증·변환·해시 함수를 재사용한다. 주요 기준은 다음과 같다.

| 항목 | 기준 |
| --- | --- |
| 조회 | 온통청년만 사용. `pageType=1`, `rtnType=json`, 기본 50건·요청 간 3초·순차 조회 |
| 재시도 | 페이지당 최초 포함 최대 3회. 연결 오류·타임아웃·429·5xx만 대상. 1초→2초 대기, Retry-After 우선. 400/401/403·e003·형식 오류는 반복하지 않음 |
| 검증·변환 | 페이지 번호·크기·필수 ID/제목·중복·총 건수와 변화 검증. 원문 보존과 날짜·숫자·코드 정규화 유지. 불확실한 신청기간은 NULL |
| 해시 | 최상위 `inqCnt`만 제외한 SHA-256. 모든 깊이의 객체 키 정렬, 배열 순서·공백·미확인 필드 보존 |

전체 수집·검증·변환·해시 계산 후에만 저장한다. `totCount=0`도 검증을 통과하면 정상 전체 수집이므로 기존 원본 모두 누락 처리하되 공개본은 유지한다. 새 출처용 변환 계층은 추가하지 않는다.

### 5.3 수집 결과·누락 판정

비교 대상은 **현재 공개 정책이 아니라 직전 `source_policies`**다.

| 조건 | 판정 | 저장 |
| --- | --- | --- |
| 원본 행이 없음 | NEW | 원본 생성, 실제 첫/최근 수집 시각 저장 |
| 원본 행이 있고 내용 해시가 다름 | CHANGED | 최신 원본·해시·제목·조회수·최근 수집 시각 갱신 |
| 원본 행이 있고 내용 해시가 같음 | UNCHANGED | 원본·제목·조회수·최근 수집 시각 최신화 |
| 기존 원본이 정상 전체 응답에 없음 | MISSING | 원본·해시·최근 수집 시각 유지, 누락 정보만 갱신 |

- 한 실행의 `NEW+CHANGED+UNCHANGED`는 실제 전체 수집 건수와 같다. MISSING은 수신되지 않은 기존 원본 수이므로 별도로 집계한다.
- 수집된 원본은 `missing_count=0`으로 초기화한다. 처음 실제 관찰하는 이관 원본이면 첫 수집 시각도 채운다.
- 누락 원본은 `missing_count`에 1을 더한다. 정수 최대값에서는 더 늘리지 않고 유지한다.
- 횟수는 **정상 전체 실행의 횟수**이며 날짜 수가 아니다. 같은 날 수동 수집까지 두 번 성공해 모두 빠지면 2회다. 실패한 실행은 증가·초기화 모두 하지 않는다.
- 같은 실행에서 쓰는 관찰 시각은 전체 수집·변환 완료 시점의 UTC 시각 한 값으로 통일한다. 스케줄 시간대와 DB 시각 표현을 구분한다.
- 다시 나타난 정책은 남아 있는 직전 원본 해시와 비교해 CHANGED/UNCHANGED를 판정한다. NEW로 되돌리지 않는다.
- 누락만으로 공개본이나 후보를 삭제·비공개·거절하지 않는다. 이번에 관찰되지 않은 조회수는 기존 값을 유지한다.

### 5.4 저장·검수 후보 조정

1. 수집 잠금을 획득한 같은 QueryRunner에서 READ COMMITTED(각 조회 시 확정된 값을 읽는 방식) 트랜잭션을 시작한다.
2. 해당 출처의 기존 원본 행 전체를 `(source, external_id)` 오름차순으로 `FOR UPDATE`(행 수정 잠금) 조회한다. 그 뒤 새 원본을 정렬된 순서로 생성한다. 원본 행을 잠그기 전 읽은 공개본·후보로 저장 계획을 확정하지 않는다.
3. 같은 트랜잭션에서 원본별 대기·거절 이력과 현재 공개본을 읽어 6.2절 기준으로 후보를 조정한다. 원본별 DB 조회를 반복하지 않고 일괄 조회·묶음 쓰기로 처리한다.
4. 최신 원본·누락 정보·후보 대체/생성·공개 조회수를 기본 최대 200건씩 묶어 저장한다. 대체 UPDATE를 먼저 처리한 뒤 새 PENDING을 INSERT해 대기 유일성 제약을 지킨다.
5. 모든 쓰기는 같은 `queryRunner.manager`를 사용한다. 한 묶음이라도 실패하면 **전체 실행분을 ROLLBACK(취소)** 한다. 모두 성공해야 COMMIT(확정)한다.
6. 공개본이 있는 수집 정책의 `view_count`는 승인·거절과 관계없이 최신 정규화 값(NULL 포함)으로 갱신한다. 미승인 원본을 `policies.raw_json`에 복사하지 않는다.

UNCHANGED도 6.2절을 적용한다. 원본이 같아도 검수 기준 공개본은 바뀌었을 수 있다.

### 5.5 실패·재시도·로그

- API·검증·변환 실패는 정책 DB 쓰기 전에 종료한다. 저장 중 오류는 전체 트랜잭션을 취소한다. 공개 조회는 기존 확정 데이터를 제공한다.
- 교착 `40P01`·직렬화 실패 `40001`만 최초 포함 최대 2회 저장을 시도한다. 재시도는 원본·후보·공개본을 다시 읽고 계산한다.
- 다른 DB 오류·잠금 연결 끊김은 새 연결에서 자동 재시도하지 않는다. COMMIT 결과가 불명이면 아래 로그 규칙으로 구분하고, 재실행 시 실제 DB 상태를 다시 비교한다.
- 기존 로그 경로·볼륨·이벤트를 유지하고 `missingCount`, `reviewCreatedCount`, `reviewSupersededCount`, `publicViewUpdatedCount`를 추가한다. `saved=true`는 수집분 DB 확정이며 전체 공개를 뜻하지 않는다. COMMIT 결과가 불명이면 `saved=null`·확정 건수=null·`commitOutcome=UNKNOWN`으로 기록해 미반영(false·0건)과 구분한다.
- 판정·갱신 건수는 COMMIT 성공 시에만 확정치로 기록한다. 취소된 시도의 계획 건수를 실제 반영 건수로 쓰지 않는다. 잠금 중복 종료와 호출·검증·변환·비교·저장 실패 단계/원인/횟수를 구분한다.
- 결과 로그가 실패하면 NestJS Logger로 대체 기록을 시도한다. COMMIT 후 로그 실패로 이미 저장된 DB를 되돌렸다고 기록하거나 저장 트랜잭션을 재시도하지 않는다.
- 모든 종료 경로에서 로그와 별개로 `finally`의 잠금 해제·연결 반환을 시도한다. 프로세스 강제 종료 시 종료 로그는 보장할 수 없고 DB가 세션 잠금을 해제한다.

## 6. 검수 상태와 공개 규칙

### 6.1 상태 전이

| 현재 상태 | 발생한 일 | 다음 상태 | 공개 정책 |
| --- | --- | --- | --- |
| 후보 없음 | 최신 내용에 검수 필요 | PENDING 생성 | 유지, 신규는 공개 안 됨 |
| PENDING | 관리자 승인 조건 통과 | APPROVED | 검수한 내용 반영 |
| PENDING | 관리자 거절 조건 통과 | REJECTED | 유지 |
| PENDING | 원본 또는 공개 기준본 변경 | SUPERSEDED | 유지, 필요하면 새 PENDING 생성 |
| APPROVED / REJECTED / SUPERSEDED | 재수집·중복 요청 | 기존 상태 유지 | 이력 자체로 변경하지 않음 |

대체됨은 관리자 거절이 아니다. 예전 후보 대신 최신 후보를 검수하도록 시스템이 정리한 결과다. 종료된 후보의 내용을 고치거나 다시 열지 않는다.

### 6.2 새 후보가 필요한지 판단

수집 트랜잭션 안에서 아래 순서대로 판단한다. 실제로 수집된 원본을 대상으로 하며 누락 원본은 후보를 그대로 둔다.

1. **최신 원본 해시=현재 공개본 해시:** 대기가 있으면 MATCHES_PUBLIC로 대체 처리하고 새 후보는 만들지 않는다.
2. **같은 원본 ID·최신 해시의 REJECTED 이력 존재:** 대기가 있으면 PREVIOUSLY_REJECTED로 대체 처리하고 새 후보는 만들지 않는다. 거절 이력은 현재 공개본이 달라져도 같은 해시의 자동 재검수를 막는다.
3. **기존 대기의 변경본 해시와 공개 기준 ID·해시가 모두 현재 상태와 같음:** 대기를 그대로 유지한다. 스냅샷의 조회수를 고치지 않는다.
4. **그 외 기존 대기 존재:** 변경본 해시가 다르면 SOURCE_CHANGED, 해시는 같고 공개 기준만 다르면 PUBLIC_BASE_CHANGED로 대체 처리한다.
5. **검수가 필요한 최신 원본으로 새 후보 생성:** 공개본이 없으면 NEW·기준본 NULL, 있으면 CHANGED·현재 공개 ID/해시/원본 스냅샷을 저장한다. 변경본 원본과 해시는 최신 수집본을 복사한다.

| 예시 | 처리 |
| --- | --- |
| 공개 A → B 수집 → B 반복 수집 | B 대기 한 건 유지 |
| 공개 A → B 대기 → C 수집 | B는 대체됨, C 새 대기 |
| 공개 A → B 대기 → A 복귀 | B는 대체됨, 새 대기 없음 |
| 공개 A → B 거절 → B 반복 또는 다른 내용을 거쳐 B 복귀 | B 재검수 없음 |
| 공개 A → B 거절 → 새로운 C 수집 | C 새 대기 |
| 과거 A 승인 → 현재 B 공개 → A 재수집 | 현재 B를 기준으로 A 새 대기. 자동 복원하지 않음 |
| 공개 A → B 대기 → C 대기 → B 복귀 | 이전 B는 대체 이력 유지, 최신 B로 새 대기 생성 |

위 A·B·C는 내용 해시가 서로 다른 정책 원본을 뜻한다. 조회수만 다른 자료는 같은 내용으로 취급한다. 후보 종류 NEW/CHANGED는 **공개본의 존재 여부**로 정하므로, 수집 판정이 CHANGED여도 공개되지 않은 정책의 후보 종류는 NEW일 수 있다.

### 6.3 승인·거절의 트랜잭션

**공통 확인**

공개 기준본 충돌은 현재의 단일 대기·승인 전용 공개 쓰기 흐름에서 통상 발생하지 않는 방어 경로다. 테스트는 격리된 DB에서 공개 행을 직접 변경하거나 복원 상태를 구성해 재현한다. 운영 DB를 직접 수정하는 절차는 제공하지 않는다.

1. 인증·출처·입력을 확인한다. 후보로 원본 ID를 찾되 이 단계에서 후보 행을 먼저 잠그지 않는다.
2. 별도 QueryRunner의 READ COMMITTED 트랜잭션에서 **원본 행 → 후보 행 → 현재 공개 행** 순서로 수정 잠금을 획득한다. 후보와 공개본은 원본 잠금 후 다시 읽는다. 수집도 원본을 먼저 잠그므로 서로 다른 순서의 잠금으로 인한 충돌을 줄인다.
3. 후보가 존재하는지, 아직 PENDING인지, 요청의 변경본·기준 해시가 후보와 같은지 확인한다. 후보 변경본 해시가 최신 원본 해시와 같은지도 확인한다.
4. 후보의 기준 공개 ID·해시가 현재 공개 ID·해시와 같은지 확인한다. 신규는 둘 다 공개본이 없어야 한다. 내용 해시가 같아도 공개 UUID가 달라졌으면 충돌이다.
5. 하나라도 다르면 해당 409를 반환하고 **업무 데이터는 변경하지 않는다**. 404·409에는 공개 반영·검수 이력 추가가 없어야 한다. 원본/공개 기준이 달라진 오래된 대기는 다음 정상 수집의 후보 조정에서 정리한다.

**승인**

- 후보 `raw_snapshot`의 해시를 다시 계산해 저장된 대상 해시와 일치하는지 확인하고, 기존 변환 함수로 공개 저장값을 만든다. 손상된 스냅샷은 내부 오류로 처리하고 전체 취소한다.
- 신규는 정책을 INSERT하고, 기존은 기준 공개 UUID의 행을 UPDATE한다. 최신 원본 객체를 통째로 공개하는 대신 **검수 후보 스냅샷의 내용**을 사용한다.
- 조회수만 최신 `source_policies.view_count`로 넣는다. 후보 생성 이후 조회수가 바뀌었어도 과거 값으로 되돌리지 않는다. 공개 `raw_json`은 검수 스냅샷을 유지한다.
- 같은 트랜잭션에서 후보를 APPROVED로 바꾸고 관리자 식별자·종료 시각을 저장한다. 공개 저장·승인 기록 중 어느 하나라도 실패하면 모두 취소한다.

**거절**

- 공통 확인을 동일하게 수행한 뒤 후보를 REJECTED로 바꾸고 관리자·사유·종료 시각을 저장한다. 원본·공개 내용·조회수는 이 요청에서 변경하지 않는다.
- 거절 사유는 필수이며 기존 이력에 덧붙이거나 수정하는 API는 제공하지 않는다.

**동시 요청·예외**

- 수집 HTTP 호출 중에는 아직 새 원본을 DB에 반영하지 않았으므로, 기존 최신 정상 원본에 대한 검수는 가능하다. 수집 저장과 검수 저장은 원본 행 잠금으로 순서를 정한다.
- 승인 2개 또는 승인·거절이 동시에 오면 한 요청만 처리되고 다음 요청은 다시 읽은 상태를 기준으로 409다. 공개 UNIQUE와 대기 부분 UNIQUE도 마지막 보호 장치로 유지한다.
- 공개 조회는 일반 SELECT를 사용하므로 수정 잠금 때문에 전체 서비스를 중단하지 않는다. 확정 전에는 기존 공개본, 확정 후에는 새 공개본을 읽는다.
- 잠금 순서 통일은 교착 위험을 줄이지만 DB 제약·인덱스 잠금 등 모든 교착을 배제하지는 않는다. DB 오류는 전체 취소하고 5.5절의 재시도 대상·횟수를 적용해 공통 확인도 반복한다.
- 네트워크가 응답 전에 끊기면 관리자는 상세를 재조회해 처리 여부를 확인한다. 서버는 성공 응답을 받지 못했다는 이유로 이미 확정된 승인을 되돌리지 않는다.

## 7. 관리자 인증·권한

### 7.1 계정과 인증 쿠키

- 단일 관리자 자격을 환경변수로 관리한다. 계정 테이블·회원가입·역할 구분·비밀번호 변경 화면은 만들지 않는다. 모든 관리자 데이터 API에 Guard(서버 접근 검사)를 적용한다.
- `ADMIN_USERNAME`은 1~64자의 공백 없는 로그인 식별자, `ADMIN_PASSWORD_HASH`는 해시된 비밀번호다. 평문 비밀번호를 환경변수·소스에 저장하지 않는다.
- 비밀번호 해시는 Node.js 내장 `scrypt`로 생성한다. 설정은 N=16384, r=8, p=1, salt=무작위 16바이트, key=64바이트, 저장은 `scrypt$16384$8$1$<salt-base64>$<key-base64>` 형식이다. 비교는 고정 길이 `timingSafeEqual`(비교 시간 차이로 정보를 노출하지 않는 함수)을 사용한다. 외부 암호 패키지는 추가하지 않는다.
- 입력 비밀번호는 1~256자이며 trim(앞뒤 공백 제거)하지 않는다. 잘못된 계정·비밀번호는 같은 401 문구를 반환한다. 계정 불일치에도 비밀번호 검증 경로를 수행해 계정 존재 정보를 구분하지 않는다.
- 인증 쿠키 이름은 `youth_admin_auth`다. 값은 `base64url(JSON payload).base64url(HMAC-SHA256 서명)` 형식이며 payload는 `{ sub: 관리자 식별자, iat: 발급 Unix 초, exp: 만료 Unix 초 }`다. 서명 대상은 앞의 payload 인코딩 문자열 전체다.
- 서명 키 `ADMIN_AUTH_SECRET`은 무작위 32바이트 이상을 base64로 저장한다. 토큰은 최대 2048자이고 두 조각의 base64url 형식만 허용한다. 서명 검증 후 고정 payload 필드·자료형·sub를 확인한다. iat·exp는 정수이며 `iat <= 현재 시각 < exp`, `exp - iat = 28800`이어야 한다. 만료는 서버 시각으로 판단한다. 서명 오류·만료는 같은 401이다. 쿠키를 로그에 남기지 않는다.
- 만료는 발급 후 **8시간 고정**이며 활동으로 연장하지 않는다. `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/admin`, `Max-Age=28800`, Domain 미지정을 사용한다. Secure는 7.2절의 관리자 웹 출처로 결정한다. 삭제할 때도 같은 이름·Path·속성을 사용한다.
- 로그인·me 응답은 4장의 계약을 따른다. 로그아웃은 같은 속성의 쿠키를 삭제하며 인증값을 JS 저장소에 넣지 않는다.
- 로그아웃은 해당 브라우저 쿠키만 삭제한다. 서버에서 개별 쿠키를 폐기하지 않으므로 계정·비밀번호 변경 또는 전체 무효화 시 서명 키도 교체하고 API를 재시작한다.

### 7.2 요청 출처·실행 설정

- `ADMIN_WEB_ORIGIN`에 정확한 웹 출처 한 개를 설정한다. 로컬 기본은 `http://localhost:3000`, 운영은 HTTPS 출처다. 경로·와일드카드·인증정보·끝 슬래시는 허용하지 않는다.
- 로그인·로그아웃·승인·거절 POST는 `Origin` 헤더가 설정 출처와 정확히 같아야 한다. 누락도 403이다. Origin 없는 CLI의 관리자 상태 변경 호출은 허용하지 않는다.
- 인증 쿠키와 정확한 Origin 검사, JSON 전용 요청을 함께 적용해 CSRF(다른 사이트가 관리자 대신 요청하는 공격)를 막는다. Next.js 프록시가 원래 Origin과 Set-Cookie를 보존하는지 통합 테스트한다. API에서 Origin을 내부 서버 주소로 바꾸거나 임의로 보충하지 않는다.
- 일반 공개 API의 CORS 인증정보 허용값은 바꾸지 않는다. 관리자 웹은 동일 출처 프록시를 사용하며 별도 교차 출처 관리자 웹은 지원하지 않는다.
- 일반 호출 제한은 공개 경로와 `/api/v1/admin/*`를 **별도 집계**한다. 두 영역 각각 실제 접속 주소별 60초당 120회이며 같은 요청을 양쪽에 중복 집계하지 않는다. 기존 전체 미들웨어에서 공개 한도를 먼저 소진시켜 관리자 요청을 막지 않도록 분기한다. 공개 한도가 소진돼도 관리자 한도가 남은 인증 GET은 200이어야 한다. 기존 health·사전 요청 제외는 유지한다.
- 로그인은 관리자 일반 한도와 별도의 60초당 5회(성공·실패 모두) 제한도 적용한다. 초과는 429·Retry-After다. 메모리 집계·만료 정리·영역별 최대 10,000개 주소·전달 IP 헤더 미신뢰는 MVP1 방식을 유지한다.
- 현재 프록시 경유 요청은 같은 접속 주소로 합산된다. 공개·관리자 일반 한도는 분리되지만 로그인 5회 제한은 프록시 경유 전체 합산이므로 다른 요청자가 소진하면 관리자의 로그인도 잠시 제한될 수 있다. 이 분리는 접근 제어를 대신하지 않으며 실제 사용자별 제한은 신뢰할 프록시 구성을 확정할 때 검토한다.
- 관리자 필수 설정은 HTTP 진입점의 listen 전에 검사하고 누락·형식 오류면 API 시작을 중단한다. 수집·Migration·시드 CLI에는 관리자 자격을 요구하지 않는다. 기존 CLI의 AppModule/DB 설정 재사용은 유지하며 공유 모듈 생성자·공통 환경 검증에서 HTTP 전용 필수값을 강제하지 않는다.
- 쿠키 Secure는 `ADMIN_WEB_ORIGIN`의 스킴으로 결정한다. `https:`는 true, `http:`는 호스트가 `localhost` 또는 `127.0.0.1`일 때만 허용하며 false다. 다른 HTTP 출처는 설정 오류다. NODE_ENV로 판단하거나 별도 Secure 설정값을 받지 않는다. 비밀값을 문서·로그·이미지 빌드 인자에 넣지 않는다.

## 8. 관리자 화면과 기존 탐색 유지

### 8.1 경로·공통 동작

| 웹 경로 | 화면 |
| --- | --- |
| `/admin` | 인증 확인 후 검수 대기 목록 또는 로그인으로 이동 |
| `/admin/login` | 관리자 ID·비밀번호 로그인 |
| `/admin/reviews` | 검수 대기 목록 |
| `/admin/reviews/[id]` | 후보 상세·비교·승인·거절 |
| `/admin/history` | 승인·거절·대체 처리 이력 |
| `/admin/missing` | 누락 정책 목록 |

- 기존 Next.js·React·공통 색상을 사용한다. 진입 시 me로 인증을 확인하고 401이면 보호 데이터를 지운 뒤 로그인으로 이동한다. 로그인 성공 경로는 `/admin/reviews`로 고정한다.
- 로그인 입력·사유 초안·관리자 데이터는 sessionStorage/localStorage에 저장하지 않는다. 메뉴는 대기·이력·누락·로그아웃이며 로딩·빈 결과·실패·재시도·키보드 조작·좁은 화면을 지원한다.

### 8.2 검수 대기 목록·상세

- 목록은 제목·외부 ID·신규/변경·등록 시각, 제목 검색·종류 필터·페이지 이동을 제공한다. 기본 20개, 10/20/50개 선택이며 필터 변경 시 1페이지로 간다.
- 상세는 공개 기준본과 변경본을 나란히, 좁은 화면에서는 위아래로 표시한다. 신규는 “아직 공개된 정책이 없습니다”로 안내한다.
- MVP1 필드는 한국어 이름으로, 미확인 필드는 원래 키로 “기타 변경 항목”에 표시한다. 변경 필드를 강조하고 전체 항목 보기를 제공한다. 긴 값은 더보기, 객체·배열은 JSON 텍스트로 보여주며 공백·줄바꿈 차이는 보존한다.
- 원문·거절 사유는 HTML로 삽입하지 않고 링크는 기존 HTTP(S)·새 탭 보호 규칙을 따른다. 조회수는 차이 비교 대신 최신 값으로 별도 표시한다.
- 공개 기준 또는 최신 원본이 달라졌으면 오래된 후보임을 알린다. 바뀐 현재 공개본을 확인할 수 있게 하고 최신 대기 ID가 있으면 링크를 제공한다. 누락은 “최근 정상 수집에서 N회 연속 확인되지 않았습니다”로 표시하되 검수 가능 여부와 구분한다.
- `canReview=false`이면 처리 버튼을 비활성화한다. 승인 확인·거절 사유 입력/확인을 제공하고 처리 중 중복 클릭을 막는다. 서버의 최종 확인은 6.3절을 따른다.
- 성공 후 상세를 재조회해 상태·처리자·시각을 표시한다. 409는 상세를 갱신하고 변경 사실을 안내한다. 5xx·연결 끊김도 상세에서 처리 여부를 먼저 확인하며 자동 승인·자동 재요청하지 않는다.

### 8.3 이력·누락 목록

- 이력은 기본 PROCESSED와 개별 종료 상태 필터, 제목 검색·페이지 이동·종료 시각·처리자·거절/대체 이유·상세 링크를 제공한다. 상세에서 `sourcePolicyId`로 같은 정책의 이력을 조회한다. “대체됨”을 관리자 거절로 표시하지 않는다.
- 누락 목록은 제목 검색·최소 횟수 필터·페이지 이동, 누락 횟수·마지막 수집·공개 여부를 표시한다. 실제 수집 기록이 없으면 “아직 실제 수집 기록 없음”으로 안내한다.
- 공개본·대기가 있으면 각 상세 링크를 제공하고 둘 다 없어도 누락 목록에 남긴다. 삭제·비공개·정책 편집·이력 수정 버튼은 제공하지 않는다.

### 8.4 기존 사용자 기능 유지

- 기존 웹 경로·공개 API·UUID를 유지한다. 공개 목록·상세·분야는 `policies`만 읽으며 미승인 원본을 노출하지 않는다.
- 신청 상태·제외·점수·지역 관계·정렬·검색·분야·페이지·표시 개수·탭 세션은 MVP1 SPEC 6~8장을 따른다. 전체 필터·제외·점수·정렬 후 페이지를 나눈다.
- 신청 상태는 승인된 기간과 요청 날짜로 계산한다. 누락·거절로 기존 공개본을 숨기지 않으며 최신 조회수에 따른 인기순 변화는 허용한다. 새 기간의 공개가 늦어지는 문제는 관리자 검수로 대응한다.

## 9. 검증 시나리오

아래는 **구현 후 통과해야 할 기준**이다. DB·API·화면은 실제 PostgreSQL·NestJS HTTP·브라우저로 확인한다. 원격 API 응답은 fixture(검증용 고정 자료)로 대체할 수 있다.

| ID | 테스트 입력·상황 | 기대 결과 |
| --- | --- | --- |
| T2-01 | 기존 정책·지역이 있는 DB 이관 | 공개 UUID·전체 행·지역 동일, 원본만 생성, 후보 0건 |
| T2-02 | 이관 중 오류·기존 해시 불일치 | 전체 이관 취소, 기존 공개 데이터 유지 |
| T2-03 | 이관 뒤 같은 자료 수집 | UNCHANGED, 실제 수집 시각 채움, 후보 없음 |
| T2-04 | 신규 원본 B 수집 | 원본과 NEW 대기 생성, 공개 API에 B 없음 |
| T2-05 | 공개 A에 변경 B 수집 | A 유지, 기준 A/변경 B 스냅샷 대기 생성 |
| T2-06 | B 반복 수집 | 대기 ID·스냅샷 유지, 후보 중복 없음 |
| T2-07 | B 대기 중 C 수집 | B SUPERSEDED, C PENDING 한 건 |
| T2-08 | 공개 A·B 대기 상태에서 A 복귀 | B 대체 처리, 새 대기 없음 |
| T2-09 | B 거절 후 B 반복 또는 C를 거쳐 B 복귀 | B 거절 이력 유지, B 대기 없음 |
| T2-10 | B 거절 후 새로운 C 수집 | C 대기 생성 |
| T2-11 | 과거 A 승인·현재 B 공개에서 A 복귀 | 기준 B/변경 A 새 후보, 자동 공개 복원 없음 |
| T2-12 | B가 대체된 뒤 다시 B 복귀 | 기존 B 이력 유지, 최신 B 새 후보 가능 |
| T2-13 | 조회수만 변경 | UNCHANGED, 후보 없음, 기존 공개 조회수만 최신화 |
| T2-14 | 변경 B 대기/거절 상태에서 조회수 변경 | 공개 A 본문 유지, 조회수 최신화 |
| T2-15 | 후보 생성 후 조회수 증가한 뒤 승인 | 검수 내용 공개, 최신 조회수 유지 |
| T2-16 | 정상 전체 수집에서 정책 누락 | 횟수 +1, 원본·공개·후보 내용 유지 |
| T2-17 | 연속 누락 뒤 재등장 | 누락 횟수 0으로 초기화, 과거 원본과 해시 비교 |
| T2-18 | 페이지 실패·총 건수 변화·중복 ID·변환 오류 | 원본·후보·누락·공개 행 모두 이전 상태 |
| T2-19 | 정상 전체 0건 응답 | 기존 원본 전부 누락 +1, 공개 정책 유지 |
| T2-20 | 같은 날 정상 수집 두 번 모두 누락 | 누락 +2, 날짜 단위로 오인하지 않음 |
| T2-21 | 200건 묶음 중 후반 DB 제약 오류 | 전체 수집분 취소, 앞 묶음도 반영 안 됨 |
| T2-22 | 저장 교착/직렬화 충돌 | 기존 한도 내 재시도, 다시 읽어 후보 조정 |
| T2-23 | CLI 두 개 및 스케줄러·CLI 동시 실행, 오류·강제 종료 후 재실행 | 하나만 수집, 잠금·연결 정리, 다음 실행 가능 |
| T2-24 | 정상 승인 | 후보 스냅샷 공개·UUID 유지·APPROVED가 함께 확정 |
| T2-25 | 공개 저장 성공 후 승인 기록 실패 | 전체 취소, PENDING 및 기존 공개본 유지 |
| T2-26 | 승인 시 요청/후보/원본 해시 불일치 | 409, 공개·후보 변경 없음 |
| T2-27 | 격리 DB의 공개 행 직접 변경으로 기준 해시·ID 충돌/신규 공개본 존재 재현 | 방어 경로에서 409, 잘못된 덮어쓰기 없음 |
| T2-28 | 격리 DB에서 공개 기준을 직접 변경한 뒤 동일 원본 재수집 | 방어 경로에서 이전 대기 대체, 현재 기준으로 조정 |
| T2-29 | 승인 두 번 또는 승인·거절 동시 요청 | 하나만 확정, 후속 409, 중복 공개/이력 없음 |
| T2-30 | 수집 DB 저장과 검수 동시 실행 | 원본 우선 잠금, 확정된 순서의 일관된 결과 |
| T2-31 | 거절·사유 검증 | 공개 유지·거절 기록, 빈/초과 사유는 400 |
| T2-32 | 누락 대기 후보 검수 | 누락 안내, 해시/기준 일치하면 승인·거절 가능 |
| T2-33 | 종료 후보 반복 수집·처리 요청 | 이력 불변, 재처리는 409 |
| T2-34 | 기준본 이후 원본 변경 | 과거 상세의 스냅샷·제목·차이 결과 보존 |
| T2-35 | 추가/삭제 필드·NULL·배열·중첩 객체·공백 차이 | 결정된 필드 비교, inqCnt만 제외 |
| T2-36 | 관리자 인증 없음·변조·만료·잘못된 계정 | 보호 데이터 조회 전 401, 비밀값 비노출 |
| T2-37 | 정상 로그인·me·로그아웃·8시간 경계 | 쿠키 속성·만료·삭제 정상, 저장소에 토큰 없음 |
| T2-38 | Origin 누락/다름·조작된 프록시 요청 | 관리자 POST 403, 동일 출처는 정상 |
| T2-39 | 로그인 60초 내 6번째 요청 및 공개 일반 한도 120회 소진 | 로그인 429·만료 회복. 공개 한도만 소진 시 관리자 한도가 남은 인증 GET은 200 |
| T2-40 | HTTP 설정·출처·NODE_ENV 조합과 CLI 컨텍스트 | 잘못된 HTTP 설정은 시작 오류, Secure 자동 결정. 수집·Migration·시드 CLI는 관리자 자격 및 스케줄러 없이 실행 |
| T2-41 | 관리자 목록 필터·순서·초과 페이지·메타문자 검색 | 계약대로 건수/항목, 0건은 빈 배열 |
| T2-42 | 누락 목록의 미공개·이관 미수집 원본 | NULL/횟수/링크를 정확히 표시 |
| T2-43 | @Cron 등록·실제 호출·시간대·활성/비활성·API 재시작·수집 실패 | 한국 04:00·Asia/Seoul 확인. CLI 타이머 없음, 중지분 자동 보충 없음, 실패 후 API와 다음 스케줄 유지 |
| T2-44 | COMMIT 전후 로그 실패·COMMIT 결과 불명 | 확정 여부를 구분, 잘못된 저장 재시도 없음 |
| T2-45 | 수집·검수 중 공개 검색/상세 | 기존 확정 정책 정상 응답, 미승인 본문 비노출 |
| T2-46 | 전체 관리자 웹 흐름·401·409·연결 끊김 | 비교·승인/거절·이력·누락·재조회 안내 동작 |
| T2-47 | 악성 HTML·URL·거절 사유·긴 원문 | 텍스트 표시·HTTP(S) 링크 제한, 화면 넘침 방지 |
| T2-48 | 기존 MVP1 테스트 전체 회귀 | 공개 계약·매칭·정렬·세션 유지. 수집 저장 기대만 MVP2로 갱신 |
| T2-49 | 백업을 별도 빈 DB로 복원 | 공개·원본·검수·지역·Migration 보존, 관리자 조회 정상 |

수집 동시 실행은 실제 독립 CLI 두 개와 스케줄러·CLI 조합, 승인 경쟁은 별도 DB 연결의 요청 두 개로 재현한다. COMMIT 전후 공개 읽기를 확인하고 실패 주입 테스트에서는 운영 데이터·볼륨을 변경하지 않는다. 승인 후 네트워크 단절·누락 정책·미공개 신규까지 관리자 UI에서 확인한다.

## 10. 구현 착수 전 준비 자료

| 자료 | 용도 | 확인 방식 |
| --- | --- | --- |
| PRD v0.12·ARCHITECTURE v0.7 | 이번 MVP의 제품 범위·공통 구조 | 이번에 수정한 문서를 저장소 정식 경로에 반영 |
| MVP1 SPEC·SUMMARY·OPERATIONS·실제 소스 | 기존 컬럼·API·수집 잠금·변환·종료 코드 재사용 | 최종 인수 기록과 구현 코드를 대조. 코드가 첨부되지 않은 이번 작성 단계에서는 코드 검증을 완료로 표시하지 않음 |
| 기존 DB와 수집 로그 백업 | 이관 전 보존·복원 검증 | 별도 빈 DB 복원 후 공개 UUID·행 값·원본 해시 대조 |
| 온통청년 인증키·수집 fixture | 수집 재사용·오류 재현 | 기존 환경변수·검증용 자료 사용, 인증키 비노출 |
| 관리자 자격·서명 키·웹 출처 | 관리자 인증과 운영 쿠키 | 로컬/운영 환경별 설정 검증. 실제 비밀값은 문서에 기록하지 않음 |
| @nestjs/schedule 호환 버전·API 실행 설정 | 매일 04:00 실행 | 현재 NestJS·Node.js와 호환성 확인 후 잠금 파일에 고정. 활성 설정·스케줄 등록·시간대·로그 확인 |

작업 순서·Step과 운영 명령의 환경별 경로는 PLAN에서 작성한다. 이 문서는 구현·테스트 완료 기록을 대신하지 않는다.
