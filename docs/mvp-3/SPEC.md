# 청년꿀통(youth-kkultong) SPEC — MVP3 v0.3

> 저장 위치: `docs/mvp-3/SPEC.md`  
> 기준: PRD v0.14, ARCHITECTURE v0.9, 수정일: 2026-11-08  
> 상태: 개발 명세 작성안. 구현과 테스트는 이후 PLAN에 따라 진행한다.

이 문서는 MVP3의 변경 중요도, 검수 목록, 일괄 검수, 웹 수집 실행과 상태 조회의 구현 기준이다. 제품 범위는 [PRD](../PRD.md), 모듈 구조는 [ARCHITECTURE](../ARCHITECTURE.md)를 따른다. 기존 수집과 검수 규칙은 [MVP2 SPEC](../mvp-2/SPEC.md)을 재사용하고, 실제 완료 상태는 [MVP2 SUMMARY](../mvp-2/SUMMARY.md)와 대조한다.

## 목차

1. [기존 구현과 확장 범위](#1-기존-구현과-확장-범위)
2. [변경 중요도](#2-변경-중요도)
3. [검수 목록 조회](#3-검수-목록-조회)
4. [일괄 승인과 거절](#4-일괄-승인과-거절)
5. [수집 실행 데이터](#5-수집-실행-데이터)
6. [수집 실행과 복구](#6-수집-실행과-복구)
7. [API와 공용 타입](#7-api와-공용-타입)
8. [관리자 화면](#8-관리자-화면)
9. [보안과 운영 전환](#9-보안과-운영-전환)
10. [검증 시나리오](#10-검증-시나리오)

## 1. 기존 구현과 확장 범위

| 대상 | 기존 구현 | MVP3 확장 |
| --- | --- | --- |
| 필드 비교 | `calculatePolicyFieldDiff`로 공개 기준본과 변경본 비교 | 변경된 원본 필드에서 중요도 계산 |
| 검수 조회 | `PolicyReviewsReadService`, `PolicyReviewRepository` | 전체 대기의 중요도 필터와 정렬, 100건 조회 |
| 검수 처리 | `PolicyReviewApprovalService`, `PolicyReviewRejectionService` | 기존 서비스를 후보별로 호출하는 일괄 처리 |
| 수집 | `IngestionService`, `IngestionLockService` | 웹 접수, 공통 실행 ID, 영속 실행 요약 |
| 수집 저장 | `PolicyCollectionWriteService.saveCollection` | 같은 트랜잭션에 실행별 DB 반영 증거 기록 |
| 관리자 접근 | 쿠키 인증, `AdminGuard`, Origin 검사 | 신규 API에 같은 보호 적용 |
| 관리자 웹 | 대기, 상세, 이력, 누락 화면 | 목록 복원, 일괄 검수 확인, 수집 운영과 실행 기록 조회 |

MVP2의 원본 → 후보 → 공개본 잠금 순서, 두 해시 검증, 후보 생성과 대체, 거절 해시의 재검수 방지, 공개 UUID 보존을 유지한다. 전체 수집 저장은 하나의 트랜잭션, 일괄 검수는 후보별 독립 트랜잭션이다.

새 테이블은 `ingestion_runs` 하나다. 중요도는 조회 시 계산하며 기존 검수 이력을 결과 재확인에 사용한다. 상세 수집 로그는 기존 JSONL 파일과 볼륨에 보관한다.

추가 파일은 기존 역할별 폴더에 배치한다.

| 위치 | 역할 |
| --- | --- |
| `policies/rules/reviews/policy-review-importance.ts` | 필드 매핑과 중요도 순수 계산 |
| `policies/services/reviews/policy-reviews-batch.service.ts` | 후보별 검수 실행과 결과 조립 |
| `ingestion/entities/ingestion-run.entity.ts` | 실행 요약 엔티티 |
| `ingestion/repositories/ingestion-run.repository.ts` | 실행 기록과 조회 |
| `ingestion/services/ingestion-runs.service.ts` | 상태 조회와 복구, 실행 기록 업무 |
| `admin/controllers/admin-ingestion.controller.ts` | 보호된 수집 실행과 상태 조회 API |

`IngestionService`가 잠금과 전체 작업을 연결하며, 웹 접수도 이 서비스의 진입점을 사용한다. `IngestionRunsService`는 이 서비스에 역의존하지 않는다. Admin은 Ingestion이 내보내는 두 서비스를 호출하고 HTTP 전용 설정에서 IngestionModule을 가져온다.

## 2. 변경 중요도

### 2.1 계산 규칙

1. `NEW` 후보는 `importance=null`, `unclassifiedFields=[]`, `classificationWarning=null`로 반환한다.
2. `CHANGED` 후보는 두 스냅샷이 JSON 객체인지 확인하고 `base_raw_snapshot`과 `raw_snapshot`을 기존 필드 비교 함수에 전달한다.
3. 변경된 최상위 필드마다 아래 매핑을 적용하고 `HIGH > NORMAL > LOW` 중 가장 높은 값을 선택한다.
4. 매핑에 없는 변경 필드는 `HIGH`로 처리하고 키를 `unclassifiedFields`에 오름차순으로 담는다.

`HIGH=중요`, `NORMAL=일반`, `LOW=경미`다. 필드 추가, 삭제, 명시적 NULL, 공백, 배열 순서와 중첩 객체의 비교 방식은 기존 함수를 따른다. 중첩 값은 최상위 필드의 등급을 적용한다. `inqCnt`는 차이 비교에서 빠지며 내용 해시 규칙도 그대로 유지한다.

등급은 필드 종류로 결정한다. 지원 내용의 오탈자 변경은 HIGH, 키워드와 지원 내용이 함께 바뀌면 HIGH다. CHANGED인데 비교 결과가 비어 있거나 필수 기준본이 손상된 경우 HIGH로 표시하고 `classificationWarning='INVALID_REVIEW_SNAPSHOT'`을 반환한다. 승인 가능 여부와 저장 시 스냅샷 검증은 기존 서비스를 따른다.

### 2.2 전체 원본 필드 매핑

근거는 [API 조사 결과 2장](../api-research/RESULT.md#2-응답-필드-표)의 60개 필드와 MVP2 실제 수집 보관본의 필드 합집합이다. 아래 설명은 검수 우선순위 판정용이며, 불명확한 코드의 의미나 자격 판단 범위를 확장하는 근거로 사용하지 않는다.

| 필드명 | 의미 | 등급 | 분류 이유 |
| --- | --- | --- | --- |
| `plcyNo` | 정책번호 | HIGH | 정책 식별의 일관성 확인 |
| `bscPlanCycl` | 기본계획 차수 | NORMAL | 정책의 행정상 분류 |
| `bscPlanPlcyWayNo` | 기본계획 정책방향 번호 | NORMAL | 정책의 행정상 분류 |
| `bscPlanFcsAsmtNo` | 기본계획 중점과제 번호 | NORMAL | 정책의 행정상 분류 |
| `bscPlanAsmtNo` | 기본계획 과제 번호 | NORMAL | 정책의 행정상 분류 |
| `pvsnInstGroupCd` | 제공기관 그룹 코드 | NORMAL | 정책 출처와 분류 |
| `plcyPvsnMthdCd` | 정책 제공방법 코드 | HIGH | 지원 제공 방식에 영향 가능 |
| `plcyAprvSttsCd` | 원본 정책 승인상태 코드 | HIGH | 원본 유효성 변화 확인 필요 |
| `plcyNm` | 정책명 | NORMAL | 정책 식별과 탐색 |
| `plcyKywdNm` | 정책 키워드 | LOW | 탐색 보조 메타정보 |
| `plcyExplnCn` | 정책 설명 | NORMAL | 정책 개요 이해 |
| `lclsfNm` | 정책 대분류 | NORMAL | 분야 탐색 |
| `mclsfNm` | 정책 중분류 | NORMAL | 분야 탐색 |
| `plcySprtCn` | 지원 내용 | HIGH | 혜택 판단 |
| `sprvsnInstCd` | 주관기관 코드 | NORMAL | 기관 식별 |
| `sprvsnInstCdNm` | 주관기관명 | NORMAL | 기관 안내 |
| `sprvsnInstPicNm` | 주관기관 담당자명 | NORMAL | 문의 안내 |
| `operInstCd` | 운영기관 코드 | NORMAL | 기관 식별 |
| `operInstCdNm` | 운영기관명 | NORMAL | 기관 안내 |
| `operInstPicNm` | 운영기관 담당자명 | NORMAL | 문의 안내 |
| `sprtSclLmtYn` | 지원규모 제한 여부 | HIGH | 지원 가능 범위 변화 확인 |
| `aplyPrdSeCd` | 신청기간 구분 | HIGH | 신청 가능 시점 |
| `bizPrdSeCd` | 사업기간 구분 | HIGH | 지원 일정 |
| `bizPrdBgngYmd` | 사업 시작일 | HIGH | 지원 일정 |
| `bizPrdEndYmd` | 사업 종료일 | HIGH | 지원 일정 |
| `bizPrdEtcCn` | 사업기간 기타 내용 | HIGH | 일정 예외 확인 |
| `plcyAplyMthdCn` | 신청 방법 | HIGH | 신청 행동 |
| `srngMthdCn` | 심사 방법 | HIGH | 선정 절차 |
| `aplyUrlAddr` | 신청 URL | HIGH | 신청 경로 |
| `sbmsnDcmntCn` | 제출서류 | HIGH | 신청 준비 |
| `etcMttrCn` | 기타 사항 | HIGH | 자격이나 신청 예외 포함 가능 |
| `refUrlAddr1` | 참고 URL 1 | NORMAL | 추가 안내 확인 |
| `refUrlAddr2` | 참고 URL 2 | NORMAL | 추가 안내 확인 |
| `sprtSclCnt` | 지원규모 수 | HIGH | 지원 가능 규모 |
| `sprtArvlSeqYn` | 선착순 관련 여부 | HIGH | 신청 우선순위 변화 확인 |
| `sprtTrgtMinAge` | 지원대상 최소 나이 | HIGH | 지원 자격 |
| `sprtTrgtMaxAge` | 지원대상 최대 나이 | HIGH | 지원 자격 |
| `sprtTrgtAgeLmtYn` | 연령제한 관련 여부 | HIGH | 지원 자격 변화 확인 |
| `mrgSttsCd` | 혼인 상태 요건 | HIGH | 지원 자격 |
| `earnCndSeCd` | 소득조건 구분 | HIGH | 지원 자격 |
| `earnMinAmt` | 소득 최소 금액 | HIGH | 지원 자격 |
| `earnMaxAmt` | 소득 최대 금액 | HIGH | 지원 자격 |
| `earnEtcCn` | 소득 기타 내용 | HIGH | 소득 예외 확인 |
| `addAplyQlfcCndCn` | 추가 신청 자격 | HIGH | 지원 자격 |
| `ptcpPrpTrgtCn` | 참여 제한 대상 | HIGH | 지원 자격 |
| `inqCnt` | 조회수 | 비교 제외 | 기존 내용 해시와 필드 비교 규칙 |
| `rgtrInstCd` | 등록기관 코드 | NORMAL | 등록 출처 식별 |
| `rgtrInstCdNm` | 등록기관명 | NORMAL | 등록 출처 안내 |
| `rgtrUpInstCd` | 등록 상위기관 코드 | NORMAL | 등록 출처 식별 |
| `rgtrUpInstCdNm` | 등록 상위기관명 | NORMAL | 등록 출처 안내 |
| `rgtrHghrkInstCd` | 등록 최상위기관 코드 | NORMAL | 등록 출처 식별 |
| `rgtrHghrkInstCdNm` | 등록 최상위기관명 | NORMAL | 등록 출처 안내 |
| `zipCd` | 지역 코드 목록 | HIGH | 대상 지역 변화 확인 |
| `plcyMajorCd` | 전공 요건 | HIGH | 지원 자격 |
| `jobCd` | 취업 요건 | HIGH | 지원 자격 |
| `schoolCd` | 학력 요건 | HIGH | 지원 자격 |
| `aplyYmd` | 신청기간 문자열 | HIGH | 신청 가능 시점 |
| `frstRegDt` | 원본 최초 등록 시각 | LOW | 원본 관리 메타정보 |
| `lastMdfcnDt` | 원본 최종 수정 시각 | LOW | 원본 관리 메타정보 |
| `sbizCd` | 특화 요건 | HIGH | 지원 자격 |

### 2.3 계산 위치와 응답

판정 함수와 매핑 상수는 `PoliciesModule/rules/reviews/`에 둔다. 반환값은 `ReviewClassification`이며 목록과 상세에서 공유한다. 분류는 해당 스냅샷에 현행 매핑을 적용한 결과로, 매핑 변경 시 과거 후보의 표시도 달라질 수 있다. 검수 스냅샷과 해시는 보존한다.

목록 응답에는 분류 요약만 담고, 상세의 기존 `changedFields`와 `unclassifiedFields`를 함께 표시해 분류 근거를 확인한다.

## 3. 검수 목록 조회

### 3.1 요청과 필터

기존 `GET /api/v1/admin/reviews`를 확장한다. `status=PENDING` 또는 status 생략 시 아래 기준을 적용한다.

| 항목 | 값과 기본값 |
| --- | --- |
| `page` | 양의 안전한 정수 문자열, 기본 1 |
| `limit` | `20 / 50 / 100`, 기본 20 |
| `keyword` | 기존 제목 부분 검색, trim 후 최대 100자 |
| `kind` | `NEW / CHANGED`, 생략 시 전체 |
| `importance` | `HIGH / NORMAL / LOW`, 생략 시 전체 |
| `sort` | `IMPORTANCE / OLDEST / NEWEST`, 기본 IMPORTANCE |
| `sourcePolicyId` | 기존 UUID 필터 유지 |

필터는 AND로 적용한다. 중요도가 지정되면 CHANGED 후보만 일치한다. API에 `kind=NEW`와 중요도가 함께 오면 400이다. 화면은 신규 선택 시 중요도를 초기화한다. 중복 query 키, 배열, 잘못된 enum, 알 수 없는 query 키는 400이다. page와 limit의 곱이 안전한 정수 범위를 벗어나도 400이다.

처리 이력 조회는 기존 limit 최대 50과 정렬을 유지하고 중요도 필터와 sort를 받지 않는다. 기존 대기 API의 limit=10은 MVP3부터 400이며, 이 변경은 대기 화면에만 적용한다. 공개 목록과 누락 목록의 계약은 MVP2 기준을 유지한다.

### 3.2 전체 조회와 정렬

대기 후보의 목록 메타정보와 두 스냅샷을 한 번의 일괄 SELECT로 읽는다. 이 자료에서 분류, 필터, 정렬, total, 페이지를 함께 산출해 응답 내부의 기준을 맞춘다. 기존 SQL의 offset/limit은 이 대기 조회 경로에서 최종 페이지 분리 단계로 이동한다.

제목의 ILIKE 비교와 검색어의 `%`, `_` 이스케이프는 기존 Repository 쿼리를 재사용한다. 제목, 유형과 원본 ID 조건을 SELECT에서 먼저 적용해도 되며, 그 조건에 맞는 후보 전체를 가져온 뒤 중요도 필터와 정렬을 적용한다.

| 정렬 | 정확한 순서 |
| --- | --- |
| IMPORTANCE | HIGH 변경(0) → NEW(1) → NORMAL 변경(2) → LOW 변경(3), `created_at ASC`, `id ASC` |
| OLDEST | `created_at ASC`, `id ASC` |
| NEWEST | `created_at DESC`, `id ASC` |

UUID는 정규화된 소문자 문자열의 오름차순으로 비교한다. totalPages는 `ceil(total/limit)`이며 0건이면 0이다. 범위를 넘은 페이지는 빈 items를 반환한다. 화면은 total이 양수면 마지막 유효 페이지로 한 번 이동해 재조회한다.

목록 응답은 원문 스냅샷을 제외한 기존 `ReviewListItem`에 분류 요약을 더한다. 대기 기간은 화면에서 후보 `createdAt`으로 계산한다. 현재 규모의 검증 기준은 원본 5,000건, 대기 5,000건에서 응답 p95 2초 이내다. 동일 장비에서 1회 준비 호출 후 순차 20회 측정하고 메모리 사용도 기록한다. 미충족 시 계산과 조회 병목을 확인해 SPEC을 조정한 뒤 최적화한다.

## 4. 일괄 승인과 거절

### 4.1 입력과 결과 단위

요청은 후보별 `{ id, contentHash, baseContentHash }` 1~100건이다. 거절에는 공통 `reason`을 추가한다. UUID, 소문자 64자리 해시, 명시적 NULL과 사유 trim 후 1~1000자 검증은 기존 스키마를 재사용한다. 중복 ID나 항목 하나의 형식 오류도 요청 전체를 400으로 처리하고 쓰기 전에 종료한다.

신규 API의 UUID는 검증 후 소문자로 정규화하며, 중복 여부도 정규화한 값으로 비교한다. 본문은 명시된 속성만 허용한다.

서버는 요청 순서대로 후보를 하나씩 처리한다. 검수 권한과 Origin은 요청 진입 시 검증하며, 처리자는 인증된 관리자 식별자다. 정상적으로 시작한 요청은 브라우저 연결 종료 후에도 최대 요청 건수까지 계속 처리한다.

| 결과 | 의미 |
| --- | --- |
| SUCCESS | 해당 서비스 호출의 COMMIT 성공을 확인 |
| CONFLICT | 기존 검수 409 코드. 상태 또는 해시가 달라 처리 불가 |
| FAILED | 미반영이 확인된 오류, 없는 후보, 저장 전 입력 관련 업무 오류 |
| UNKNOWN | COMMIT 응답 유실 또는 DB 연결 문제로 최종 반영 여부를 확인할 수 없음 |

HTTP 200은 일괄 실행의 항목별 결과를 받았다는 뜻이다. 모든 후보가 실패해도 개별 결과를 만들 수 있으면 200이며, `summary`의 네 건수 합은 total과 같다. 결과 배열 순서는 요청 순서와 같다.

### 4.2 서비스와 트랜잭션

`PolicyReviewsBatchService`를 Policies의 `services/reviews/`에 추가한다. 기존 승인 또는 거절 서비스의 공개 메서드를 호출하고 각 오류를 항목별 결과로 변환한다. 공통 거절 사유는 기존 거절 서비스가 각 후보의 `rejection_reason`에 저장한다.

개별 서비스의 잠금 순서, 해시 검증, 공개 저장과 검수 이력의 원자성, DB가 롤백을 확정한 교착과 직렬화 실패의 1회 재시도를 유지한다. 일괄 호출에는 트랜잭션 내부 `SET LOCAL lock_timeout='2s'`, `statement_timeout='5s'` 옵션을 적용해 수집과의 긴 잠금 경합을 제한한다. 개별 HTTP 검수의 기존 기본값은 유지한다.

DB 응답과 연결 정리의 대기 상한 및 시간 초과 후 연결 폐기는 6.6절을 따른다. 일괄 HTTP 응답 제한은 후보별 트랜잭션이나 전체 처리의 취소 기한이 아니다.

`55P03` 또는 `57014`로 취소되고 ROLLBACK이 확인되면 FAILED다. 그 밖의 오류도 쓰기 전 또는 롤백 확정이면 FAILED, 확정 여부가 불명확하면 UNKNOWN으로 처리한다. 트랜잭션 실행 단계와 COMMIT 응답 유실을 서비스 내부 오류 타입으로 구분하고, 기존 개별 API의 HTTP 오류 계약은 보존한다. UNKNOWN을 만나도 나머지 후보는 각자의 트랜잭션으로 계속한다.

COMMIT 성공을 확인한 뒤 연결 반환만 실패한 경우 일괄 결과는 SUCCESS로 유지하고 정리 오류는 안전한 로그에 기록한다.

서버 내부 예외, SQL, 거절 사유 원문은 오류 응답에 넣지 않는다. 기존 검수 충돌 코드는 유지하고 일반 내부 오류는 `INTERNAL_SERVER_ERROR`, 반영 불명은 `REVIEW_OUTCOME_UNKNOWN`으로 전달한다.

### 4.3 중복 요청과 결과 재확인

중복 승인은 기존 PENDING 조건과 두 해시로 보호된다. 같은 후보에 동시 승인 또는 승인과 거절이 오면 먼저 확정된 요청 하나만 성공하고 나머지는 CONFLICT다.

응답 유실, 5xx, UNKNOWN에서는 `POST /admin/reviews/batch-status`로 요청 대상 ID들의 현재 상태를 일괄 조회한다. 이는 읽기 전용 업무지만 본문을 받으므로 기존 관리자 POST의 Origin 검사를 적용한다. 요청은 중복 없는 UUID 1~100개이며 한 번의 SELECT로 현재 후보의 상태와 처리 정보를 반환한다. 없는 ID는 항목별 `found=false`다.

응답 항목은 요청 ID 순서로 조립하고 checkedAt을 함께 반환한다. 조회 자체가 실패하면 전체 읽기 오류를 반환하며 기존 표시값을 조회 완료로 바꾸지 않는다.

재확인 결과는 **현재 DB 상태**다. 다른 요청이 처리했을 수도 있으므로 이를 원래 일괄 요청의 SUCCESS로 바꾸지 않는다. 화면에는 “승인 상태 확인”, “거절 상태 확인”, “대체됨”, “아직 대기”, “조회 불가”를 표시한다. PENDING은 원래 요청이 계속 처리 중일 수 있어 결과 미확정으로 유지한다.

자동 동작은 조회 재시도에 한정한다. 3초 간격으로 최대 20회 확인한 뒤 남은 미확정 후보는 수동 재조회로 이어간다. 재처리는 최신 상태를 확인하고 관리자가 다시 선택해 확인 모달을 거친다. 별도 일괄 실행 이력 대신 후보의 기존 처리자, 종료 시각, 거절 사유를 확인 근거로 사용한다.

## 5. 수집 실행 데이터

### 5.1 `ingestion_runs` 컬럼

엔티티와 Repository는 `IngestionModule`이 소유한다. 실행 한 건은 잠금을 획득해 접수한 전체 수집 한 번을 뜻한다. 중복 실행 시도는 기존 로그에 남긴다.

| 컬럼 | PostgreSQL 타입 | 필수와 기본값 | 의미 |
| --- | --- | --- | --- |
| `id` | UUID | PK, 자동 생성 | 응답과 파일 로그에 함께 쓰는 실행 ID |
| `source` | VARCHAR(32) | NOT NULL | 현재 `youthcenter` |
| `trigger` | VARCHAR(8) | NOT NULL | `WEB / CLI / CRON` |
| `request_id` | UUID | NULL | 웹에서 만든 요청 식별자, 응답 유실 시 중복 접수 방지 |
| `requested_by` | VARCHAR(64) | NULL | 웹 실행 요청 관리자 |
| `status` | VARCHAR(16) | NOT NULL, ACCEPTED | 실행 상태, 6.1절 참조 |
| `stage` | VARCHAR(32) | NOT NULL, LOCK | 마지막 확인 단계 |
| `commit_outcome` | VARCHAR(16) | NOT NULL, NOT_COMMITTED | DB 반영 여부 |
| `result` | JSONB | NULL | 확정된 판정 건수와 갱신 건수 |
| `failures` | JSONB | NOT NULL, `[]` | 허용된 실패 코드와 위치 |
| `owner_pid` | INTEGER | NOT NULL | 잠금 보유 PostgreSQL 세션 PID |
| `owner_backend_start` | TIMESTAMPTZ | NOT NULL | PID 재사용을 구분하는 DB 세션 시작 시각 |
| `accepted_at` | TIMESTAMPTZ | NOT NULL, 현재 시각 | 실행 접수를 확정한 시각 |
| `started_at` | TIMESTAMPTZ | NULL | 실제 수집 작업을 시작한 시각 |
| `collected_at` | TIMESTAMPTZ | NULL | 기존 전체 검증과 변환 완료 시각, DB 반영 증거와 함께 저장 |
| `finished_at` | TIMESTAMPTZ | NULL | 정상 또는 오류 종료를 확인한 시각 |
| `updated_at` | TIMESTAMPTZ | NOT NULL, 현재 시각 | 상태 갱신 또는 중단 확인 시각 |

`result`는 기존 `PolicyCollectionSaveResult`와 같은 `{ counts: { NEW, CHANGED, UNCHANGED, MISSING }, reviewCreatedCount, reviewSupersededCount, publicViewUpdatedCount }` 형식이다. 집계는 실제 DB 확정값이며, 미확정일 때는 result 전체가 NULL이다.

### 5.2 제약조건과 인덱스

- source는 `youthcenter`, trigger와 status 및 commit_outcome은 명시된 값만 허용한다. stage는 기존 `IngestionStage`와 실행 기록용 `RUN_STATE`를 허용한다.
- WEB은 request_id와 공백 없는 requested_by가 필수다. CLI와 CRON은 두 값이 NULL이다. `UNIQUE(request_id)`로 같은 웹 요청의 재접수를 막는다.
- 활성 실행은 `ACCEPTED / RUNNING`이며, `UNIQUE(source) WHERE status IN ('ACCEPTED','RUNNING')`을 둔다. 실행 시작과 중단 정리는 같은 Advisory Lock 안에서 수행한다.
- `owner_pid > 0`, 시각은 `accepted_at <= started_at <= finished_at`의 존재하는 구간만 검증한다. `updated_at >= accepted_at`, collected_at은 COMMITTED일 때 필수이며 started_at 이후다.
- ACCEPTED는 started_at과 finished_at이 NULL이며 NOT_COMMITTED다. RUNNING은 started_at 필수, finished_at은 NULL이다. SUCCESS는 started_at과 finished_at 필수, FAILED는 finished_at 필수다. INTERRUPTED는 실제 종료 시각을 알 수 없어 finished_at을 NULL로 두고 updated_at을 중단 확인 시각으로 표시한다.
- COMMITTED는 result와 collected_at 필수다. 다른 반영 상태에서는 두 값이 NULL이다. result의 위 4개 속성과 counts의 네 키를 모두 검사하고, 모든 건수는 0~2,147,483,647 정수로 제한한다. 필수 키 누락도 CHECK 위반이 되도록 NULL 통과를 방어한다.
- failures는 JSON 배열이며 원소는 7.2절의 안전한 실패 형식이다. SUCCESS는 COMMITTED이며 failures가 비어 있어야 한다. FAILED와 INTERRUPTED는 최소 한 개의 실패 정보를 가진다.
- 조회 인덱스는 `(source, accepted_at DESC, id ASC)`와 `(source, finished_at DESC, id ASC) WHERE status='SUCCESS' AND commit_outcome='COMMITTED'`다. 부분 인덱스는 Migration에서 정의하고 ORM 메타데이터와 일치시킨다.

### 5.3 적용과 보관

기존 정책과 검수 테이블은 유지하고 새 Migration으로 실행 테이블을 생성한다. 기존 JSONL 로그는 읽기 전용 운영 증거로 보존한다. 웹 실행 기록의 시작점은 MVP3 적용 이후이며, 이전 기록이 없으면 “MVP3 적용 이후 실행 기록 없음”으로 표시한다.

실행 요약은 MVP3에서 계속 보관하며 DB dump와 복원 검증에 포함한다. 기존 로그의 파일 경로와 볼륨은 유지한다. 실제 페이지별 시도와 상세 진단은 파일 로그, 웹 조회의 기준은 이 테이블이다.

## 6. 수집 실행과 복구

### 6.1 실행 상태와 DB 반영 상태

| 현재 상태 | 사건 | 다음 상태 |
| --- | --- | --- |
| 실행 없음 | Advisory Lock 획득과 접수 기록 확정 | ACCEPTED |
| ACCEPTED | 실제 수집 시작과 started_at 기록 | RUNNING |
| ACCEPTED 또는 RUNNING | 관측한 오류로 종료 | FAILED |
| RUNNING | 수집, DB 저장, 로그와 자원 정리 완료 | SUCCESS |
| ACCEPTED 또는 RUNNING | 잠금으로 이전 작업 종료를 확인했지만 최종 종료 기록이 없음 | INTERRUPTED |

INTERRUPTED는 프로세스 중단 등으로 **실행의 최종 결과를 확인할 수 없음**을 뜻한다. 관측한 실제 오류의 FAILED와 구분한다. 정상 종료된 행은 기존 상태를 보존하며, 반영 불명은 아래 절차로 후속 확인할 수 있다.

상태 갱신은 실행 ID, 소유 세션과 허용된 이전 상태를 조건으로 수행한다. 복구가 이미 종료한 이전 작업의 지연된 단계 또는 종료 갱신으로 상태가 되돌아가지 않도록 갱신 건수를 검사한다.

| commit_outcome | 의미와 표시 |
| --- | --- |
| NOT_COMMITTED | 작업 시작 전 또는 전체 롤백을 확인한 상태. “DB 미반영” |
| COMMITTED | 실행별 반영 증거를 확인한 상태. “DB 반영 완료”와 확정 건수 |
| UNKNOWN | 저장 또는 COMMIT의 결과를 확인하는 중이거나 연결 장애로 확정 여부가 불명. “DB 결과 확인 불가” |

FAILED 또는 INTERRUPTED여도 COMMITTED일 수 있다. 예를 들어 DB 확정 후 프로세스가 종료되면 INTERRUPTED와 반영 완료를 함께 표시한다. `saved`를 사용하는 기존 파일 로그는 각각 `false / true / null`로 대응한다.

### 6.2 공통 진입점과 웹 접수

`IngestionService`는 기존 작업을 공통 실행 관리 흐름에 연결한다. 웹 실행 서비스는 접수까지 기다리고 실행 ID를 반환하며, CLI와 Cron은 전체 실행 완료를 기다린다. 수집 스케줄과 CLI 종료 코드 0/1/2는 MVP2 기준을 유지한다.

1. WEB은 클라이언트가 만든 requestId로 기존 접수 행을 먼저 찾는다. 같은 ID가 있으면 해당 실행을 반환한다.
2. 기존 고정 키 `202610180001`의 세션 Advisory Lock을 전용 QueryRunner로 획득한다. 중복이면 WEB은 409, CLI는 2, Cron은 기존 중복 로그로 종료한다. WEB은 requestId를 다시 조회해 같은 요청의 접수 행이 보이면 기존 실행을 반환한다. 첫 요청이 잠금을 얻었지만 접수 행을 아직 COMMIT하지 않았다면 같은 requestId도 일시적으로 409와 currentRunId=NULL을 받을 수 있다. 이는 접수 확인 중이며 다른 요청이나 접수 실패로 단정하지 않는다. 클라이언트는 동일 requestId로 상태만 재조회한다.
3. 잠금 안에서 6.5절의 이전 활성 기록 정리를 수행한다. 실행 ID와 잠금 보유 세션의 PID 및 backend_start를 기록해 ACCEPTED 행을 확정한다. WEB의 requestId 충돌은 기존 실행 조회로 처리한다.
4. 접수 행의 COMMIT을 확인한 뒤 WEB에 202를 반환한다. 접수 응답이 유실돼도 기록과 실행은 유지한다. 접수 기록의 확정 여부가 불명확하면 같은 requestId를 새 연결로 확인하고, 확인 전 외부 수집 호출은 보류한다.
5. started_at과 RUNNING을 기록하고 기존 수집, 검증, 변환과 해시 계산을 실행한다. 기존 잠금 연결은 전체 작업 종료까지 유지한다.

HTTP 응답을 위한 접수 완료 신호와 전체 작업 Promise를 구분하되 작업은 같은 API 프로세스의 서비스가 소유한다. 종료된 HTTP 요청 객체나 브라우저 연결에 작업 생명주기를 묶지 않는다. 백그라운드 Promise의 예외는 실행 기록과 기존 로그 처리로 수렴시킨다.

실행 ID는 DB 행, 접수 응답, 모든 파일 로그 이벤트에 동일하게 사용한다. CLI와 Cron도 이 경로에서 ID를 만든다. 잠금을 보유한 채 접수와 작업을 이어가며, 웹 요청 접수를 위해 잠금을 풀었다가 다시 획득하는 구간을 두지 않는다.

### 6.3 수집 저장과 반영 증거

수집 단계는 API 조회, 변환, DATABASE 진입 등 큰 단계에서 갱신한다. 정책마다 반복되는 변환과 해시 계산은 메모리에서 진행하고, 오류가 나면 실제 오류 타입의 실패 단계를 기록한다.

DB 저장 직전에 commit_outcome을 UNKNOWN으로 영속화한다. 기존 `PolicyCollectionWriteService`에 같은 `EntityManager`와 확정 예정 결과를 받는 선택적 `beforeCommit` 콜백을 추가한다. Ingestion이 이 콜백으로 현재 실행 행을 COMMITTED, result, collected_at으로 갱신한다. 갱신 대상이 한 행인지 확인하고 후보 상태와 원본 저장까지 함께 COMMIT한다.

DB 저장은 수집 잠금을 보유한 기존 QueryRunner에서 실행한다. 잠금 연결이 끊겼으면 해당 작업을 중단하고 자원을 정리하며, 다시 연결한 저장 작업은 새 수집 실행으로 다룬다.

실행 시각은 DB 시계로 기록한다. collected_at도 전체 검증과 변환이 끝난 뒤 잠금 연결에서 한 번 읽어 기존 원본 저장의 collectedAt과 실행 증거에 함께 전달한다. `beforeCommit`은 기존 saveCollection 인자 뒤에 추가하는 선택적 인자이며 형식은 `(manager: EntityManager, result: PolicyCollectionSaveResult) => Promise<void>`다.

이 콜백은 모든 재시도 트랜잭션에서 다시 호출되며, 실패하면 전체 수집분이 롤백된다. 실행 요약은 출처가 일치하는 RUNNING 행만 갱신한다. Policies는 콜백 타입만 정의하고 Ingestion 모듈을 역참조하지 않는다. 수집 저장이 끝난 뒤에 종료 처리용 실행 행 잠금을 얻어 원본과 실행 기록 사이의 잠금 순환을 피한다.

일반 저장 오류로 롤백이 확인되면 NOT_COMMITTED로 기록한다. COMMIT 응답 유실은 기존 자동 재시도 대상에 추가하지 않고 새 연결에서 실행 행을 조회한다. COMMITTED 증거가 있으면 집계를 복원하고, 원래 세션의 트랜잭션이 아직 끝났는지 불명확하면 UNKNOWN을 유지한다. COMMITTED를 메모리의 오래된 UNKNOWN 또는 NOT_COMMITTED 값으로 덮어쓰지 않는다.

### 6.4 종료 기록과 잠금 반환

기존 `finally`의 롤백, 잠금 해제, 연결 반환과 로그 대체 기록을 유지한다. 새 실행이 막 시작되는 시점에 이전 실행을 중단으로 잘못 정리하지 않도록 다음 순서를 적용한다.

1. 정책 저장 트랜잭션 종료 후, 별도 DB 연결의 짧은 트랜잭션에서 해당 실행 행을 `FOR UPDATE`로 잠근다.
2. 이 행 잠금을 유지한 채 기존 수집 연결의 자원 정리를 끝낸다. 정리 중 오류도 종료 결과에 포함한다.
3. RUN_FINISHED 기록을 시도하고 SUCCESS 또는 FAILED와 안전한 오류, finished_at을 갱신해 확정한다.
4. 새 수집이나 상태 복구가 같은 활성 행을 만나면 행 잠금 뒤 다시 읽어 최종 상태를 확인한다.

종료 트랜잭션에는 lock_timeout 5초, statement_timeout 5초와 idle_in_transaction_session_timeout 20초를 적용하고, 클라이언트에서도 트랜잭션 시작부터 20초로 제한한다. 연결 정리와 로그 기록은 6.6절의 상한 안에서 수행한다. 기록 연결이나 실행 행 잠금을 확보하지 못해도 원래 수집 잠금과 연결의 정리는 계속한다. 최종 기록이 실패하면 대체 로그를 남기고 이후 복구가 남은 활성 행을 판정한다. 실행 기록 오류는 `RUN_STATE / RECORD_WRITE_FAILED`로 구분한다.

잠금 해제 실패 뒤 연결 종료까지 실패하면 잠금이 남을 수 있다. 현재 실행 여부는 실제 Advisory Lock을 기준으로 표시하며, FAILED 행만 보고 새 실행이 가능하다고 안내하지 않는다.

### 6.5 재시작과 상태 재확인

HTTP 부팅 시, 운영 상태 조회 시, 새 실행 접수 시에 같은 복구 함수를 사용한다. 복구는 수집 잠금과 실행 행의 현재 상태를 다시 확인하는 작업이다.

| 확인 결과 | 처리 |
| --- | --- |
| 전용 연결에서 같은 수집 잠금 획득 가능 | 활성 행을 FOR UPDATE로 다시 읽고 남아 있으면 INTERRUPTED로 정리 |
| 잠금 획득 불가, 실제 보유 세션과 활성 행의 owner 정보 일치 | 현재 실행 중으로 반환. API 밖의 CLI도 포함 |
| 잠금 획득 불가, 대응하는 활성 행 없음 | 실행 중으로 안내하되 currentRun=null, “수집 잠금 사용 중, 실행 정보 확인 중” 표시 |
| 잠금 검사 실패 | 확인 가능한 실행 정보와 isRunning=null 반환. DB 전체 조회 불가면 503 |

잠금을 획득한 복구 연결은 정리 후 반드시 해제한다. PID는 backend_start와 현재 DB 및 같은 잠금 키의 실제 보유 정보를 함께 비교한다. 경과 시간만으로 중단을 판정하지 않는다.

이전 작업의 잠금이 사라진 것을 배타적으로 확인하면 해당 작업의 미완료 DB 트랜잭션도 종료된 상태다. 원자적으로 저장한 COMMITTED 증거가 있으면 유지하고, 증거가 없으면 NOT_COMMITTED로 확정한다. 실행 상태는 INTERRUPTED, 실패 정보는 `RUN_STATE / PROCESS_INTERRUPTED`, updated_at은 발견 시각이다. 이전 작업의 외부 API 호출을 이어서 실행하지 않는다.

복구 시 관측한 실행 행이 다른 처리로 이미 종료됐으면 그대로 반환한다. 복구 도중 DB가 불안정해 증거를 읽지 못하면 확인 불가로 안내하고 후속 조회에서 다시 판정한다. 기록 정리와 새 접수는 같은 잠금 아래에서 진행해 활성 행 유일성을 유지한다.

FAILED 또는 INTERRUPTED에 UNKNOWN이 남은 경우도 잠금을 획득한 복구에서 같은 반영 증거 확인을 적용한다. 이때 실행 상태와 종료 시각은 보존하고 commit_outcome, result와 updated_at만 정리한다.

### 6.6 외부 작업의 대기 상한과 처리 불명

신규 실행 관리와 일괄 검수 호출에는 아래 상한을 적용한다. SQL 제한과 별개로 클라이언트의 실제 응답 대기를 제한하며, 전체 수집이나 100건 처리의 총 실행 시간을 제한하지 않는다. 기존 외부 API의 요청 시간 제한과 재시도는 유지한다.

| 작업 | 대기 상한 | 초과 시 처리 |
| --- | --- | --- |
| DB 연결 생성과 풀에서 연결 확보 | 5초 | 현재 작업을 오류로 종료하고 확보한 자원 정리 |
| 일괄 검수의 SQL과 COMMIT 응답 | 호출당 10초 | 해당 연결 폐기와 반영 여부 판정, 다음 후보는 새 연결 사용 |
| 수집 저장과 실행 기록, 상태 조회의 DB 응답 | 호출당 30초, 종료 트랜잭션은 6.4절의 더 짧은 상한 적용 | 현재 흐름 중단과 연결 폐기, 실행 기록 또는 후속 조회로 확인 |
| ROLLBACK, 잠금 해제와 연결 반환 또는 종료 | 작업당 5초 | 정상 풀 반환을 중단하고 해당 연결의 소켓 종료 및 풀에서 제거 |
| 파일 로그와 대체 로그 | 기록 수단별 5초 | 파일 지연 시 대체 기록, 둘 다 실패하면 LOG 오류로 정리 계속 |

기존 DB 설정은 연결 제한만 제공하므로 응답 대기와 풀 대기 및 연결 폐기를 구현 Step에서 함께 연결한다. 새 패키지나 작업 프로세스 없이 기존 QueryRunner, pg 연결과 로그 서비스를 확장한다. 대기 초과는 발생 단계와 안전한 `OPERATION_TIMEOUT` 원인으로 기록한다.

Promise의 대기 종료는 DB 명령의 취소 증거가 아니다. 시간 초과한 연결에서는 후속 SQL과 COMMIT을 실행하지 않고, 진행 중인 업무 흐름을 중단해 연결을 폐기한다. 늦은 응답이나 콜백은 종료된 흐름의 단계와 결과를 갱신하지 못하게 하고, 남은 Promise의 오류도 회수한다. 소켓 종료를 시도한 사실만으로 서버 세션과 잠금이 해제됐다고 안내하지 않는다.

COMMIT을 보냈으나 응답이 없으면 뒤이은 ROLLBACK의 성공만으로 미반영을 확정하지 않는다. 수집은 6.3절의 원자적 반영 증거를 새 연결에서 확인하고, 증거가 없을 때는 6.5절의 배타적 잠금 확인까지 UNKNOWN을 유지한다. 일괄 검수는 COMMIT 성공 또는 미반영을 입증하지 못하면 UNKNOWN으로 반환하고 4.3절로 현재 상태를 확인한다. 이 오류를 쓰기 자동 재시도에 추가하지 않는다.

정책 저장 트랜잭션의 종료를 확인하지 못했다면 해당 연결 폐기를 먼저 시도한다. 종료 기록용 행 잠금을 기다리느라 원래 연결 정리를 미루지 않는다. 종료 트랜잭션의 전체 상한을 넘겨도 같은 폐기 절차를 적용하고, 기록 확정이 불명확하면 후속 복구가 행을 다시 읽어 판정한다. 파일 기록이 늦게 완료돼도 DB 반영 결과와 종료 상태를 바꾸지 않는다.

## 7. API와 공용 타입

### 7.1 경로와 응답

접두사는 `/api/v1`이다. 신규 경로도 기존 관리자 쿠키 인증을 적용한다. POST는 Origin과 JSON 검사를 적용하며, 관리자 응답은 `Cache-Control: no-store`다.

| 방식과 경로 | 요청 | 응답 |
| --- | --- | --- |
| `GET /admin/reviews` | 3.1절의 query | 200, 기존 목록과 분류 요약 |
| `GET /admin/reviews/:id` | 기존 UUID | 200, 기존 상세의 review에 분류 요약 추가 |
| `POST /admin/reviews/batch-approve` | `BatchReviewRequest` | 200, `BatchReviewResponse` |
| `POST /admin/reviews/batch-reject` | `BatchRejectRequest` | 200, `BatchReviewResponse` |
| `POST /admin/reviews/batch-status` | `{ ids: string[] }` | 200, `BatchReviewStatusResponse` |
| `POST /admin/ingestion/runs` | `{ requestId: string }`, UUID | 신규 202 또는 같은 요청 재조회 200, `{ run: IngestionRunView }` |
| `GET /admin/ingestion/status` | 선택 query `requestId`, UUID | 200, `IngestionStatusResponse` |
| `GET /admin/ingestion/runs` | `IngestionRunListQuery` | 200, `IngestionRunListResponse` |
| `GET /admin/ingestion/runs/:id` | UUID | 200, `{ run: IngestionRunView }` |

정적 batch 경로는 `:id` 검증과 구분되도록 등록한다. 기존 개별 승인과 거절 API는 유지한다. status가 PENDING 이외인 이력 응답과 상세 review에도 현행 분류 요약을 제공한다.

수집 화면의 현재 상태는 `GET /admin/ingestion/status`로 조회한다. runId는 실제 수집 실행과 기록 상세의 식별자이며, requestId는 웹 시작 요청의 중복 접수 방지와 응답 유실 확인에만 사용한다. requestId의 생성과 보관은 8.3절을 따른다. 같은 requestId의 접수 행이 확인되면 종료된 실행도 200으로 동일 행을 반환한다. 잠금 중복은 409 `INGESTION_ALREADY_RUNNING`과 `currentRunId: UUID | null`을 반환하며, 같은 요청의 접수 COMMIT 전 일시적 409도 6.2절에 따라 처리한다.

실행 기록 목록은 `ingestion_runs`의 모든 실행 상태와 WEB, CLI, CRON 실행을 포함한다. query는 `page`만 받으며 기본 1, 페이지당 20건이다. page는 양의 안전한 정수 문자열로 검증하고 offset 계산도 안전한 정수 범위여야 한다. 중복 키, 배열과 알 수 없는 query 키는 400이다.

목록은 `accepted_at DESC → id ASC`로 정렬한다. 건수와 항목은 짧은 읽기 전용 REPEATABLE READ 트랜잭션에서 조회하고, 기존 Pagination 형식으로 page, limit=20, total, totalPages를 반환한다. 결과 0건이면 totalPages=0, 초과 페이지는 빈 items다. 목록과 실행별 상세는 같은 IngestionRunView 형식을 사용한다.

### 7.2 타입

기존 타입은 `packages/shared/src/admin.ts`에서 확장한다. 수집 타입은 `admin-ingestion.ts`, 해당 Zod 검증은 `admin-ingestion.schema.ts`에 두고 index에서 내보낸다. DB 엔티티와 내부 콜백은 소유 API 모듈에 둔다.

```ts
export type ReviewImportance = 'HIGH' | 'NORMAL' | 'LOW';
export type ReviewSort = 'IMPORTANCE' | 'OLDEST' | 'NEWEST';

export interface ReviewClassification {
  importance: ReviewImportance | null;
  unclassifiedFields: string[];
  classificationWarning: 'INVALID_REVIEW_SNAPSHOT' | null;
}
// 기존 ReviewListItem은 ReviewClassification을 함께 포함
// 기존 AdminReviewQuery에 importance?, sort? 추가

export interface BatchReviewItem {
  id: string;
  contentHash: string;
  baseContentHash: string | null;
}
export interface BatchReviewRequest { items: BatchReviewItem[] }
export interface BatchRejectRequest extends BatchReviewRequest { reason: string }

export type BatchReviewResult = {
  id: string;
  outcome: 'SUCCESS';
  result: ReviewActionResponse;
} | {
  id: string;
  outcome: 'CONFLICT' | 'FAILED' | 'UNKNOWN';
  code: string;
  message: string;
};
export interface BatchReviewResponse {
  items: BatchReviewResult[];
  summary: {
    total: number; success: number; conflict: number;
    failed: number; unknown: number;
  };
}
export interface BatchReviewStatusResponse {
  checkedAt: string;
  items: ({ id: string; found: false } | {
    id: string; found: true;
    status: ReviewStatus;
    contentHash: string; baseContentHash: string | null;
    reviewedBy: string | null; closedAt: string | null;
    rejectionReason: string | null;
    supersededReason: SupersededReason | null;
  })[];
}

export type IngestionRunStatus =
  'ACCEPTED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'INTERRUPTED';
export type IngestionCommitOutcome = 'NOT_COMMITTED' | 'COMMITTED' | 'UNKNOWN';
export type IngestionRunStage = 'LOCK' | 'API' | 'PAGE_VALIDATION'
  | 'COLLECTION_VALIDATION' | 'TRANSFORMATION' | 'HASH' | 'DATABASE'
  | 'LOCK_RELEASE' | 'LOG' | 'COMPLETE' | 'RUN_STATE';
export interface IngestionRunResult {
  counts: { NEW: number; CHANGED: number; UNCHANGED: number; MISSING: number };
  reviewCreatedCount: number;
  reviewSupersededCount: number;
  publicViewUpdatedCount: number;
}
export interface SafeIngestionFailure {
  stage: IngestionRunStage;
  reason: string;
  pageNum?: number; attempts?: number; httpStatus?: number;
  code?: string;
}
export interface IngestionRunView {
  id: string; source: 'youthcenter'; trigger: 'WEB' | 'CLI' | 'CRON';
  requestId: string | null; requestedBy: string | null;
  status: IngestionRunStatus; stage: IngestionRunStage;
  commitOutcome: IngestionCommitOutcome;
  result: IngestionRunResult | null;
  failures: SafeIngestionFailure[];
  acceptedAt: string; startedAt: string | null;
  collectedAt: string | null; finishedAt: string | null; updatedAt: string;
}
export interface IngestionRunListQuery { page?: number }
export interface IngestionRunListResponse {
  items: IngestionRunView[];
  pagination: Pagination;
}
export interface IngestionStatusResponse {
  checkedAt: string;
  isRunning: boolean | null;
  activityWarning: 'STATE_UNVERIFIED' | 'LOCK_WITHOUT_RUN' | null;
  currentRun: IngestionRunView | null;
  lastRun: IngestionRunView | null;
  lastSuccessfulRun: IngestionRunView | null;
  requestedRun: IngestionRunView | null;
}
```

시각은 UTC의 ISO 8601 문자열로 반환하고 화면에서는 한국 시각으로 표시한다.

lastRun은 accepted_at 내림차순, id 오름차순의 첫 실행이다. lastSuccessfulRun은 SUCCESS와 COMMITTED를 모두 만족하는 행 중 finished_at 내림차순, id 오름차순의 첫 행이다. 화면의 마지막 정상 수집 시각은 이 행의 collectedAt이다. DB 반영 후 로그나 정리 실패는 해당 실행의 반영 완료로 안내하고 마지막 정상 실행과 구분한다.

requestedRun은 requestId query가 있으면 해당 접수 행, 없거나 아직 접수되지 않았으면 NULL이다. 조회 시각의 값이며 NULL만으로 과거 POST가 영구 실패했다고 단정하지 않는다. currentRun은 실제 잠금 보유 세션과 대응하는 활성 행이다. owner PID와 세션 시작 시각은 내부 확인용으로만 사용한다.

failures는 기존 `describeFailure`가 생성한 코드에서 위 타입의 허용 항목만 골라 저장하고 응답한다. reason은 서버에서 정한 안전한 코드, code는 검증한 SQLSTATE다. 화면 메시지는 코드별 한국어 고정 문구로 변환한다. 기존 로그의 policyId, fields와 원본 예외 메시지는 웹 요약에 포함하지 않는다.

### 7.3 오류와 요청 제한

| 상황 | HTTP와 코드 |
| --- | --- |
| 요청 형식, enum, 개수, UUID, 사유 오류 | 400 BAD_REQUEST |
| 인증 또는 Origin 실패 | 기존 401 ADMIN_UNAUTHORIZED / 403 ADMIN_ORIGIN_FORBIDDEN |
| 없는 수집 실행 ID | 404 INGESTION_RUN_NOT_FOUND |
| 수집 잠금 사용 중, 같은 요청의 접수 COMMIT 전 구간 포함 | 409 INGESTION_ALREADY_RUNNING |
| 본문 한도, JSON 형식, 호출 한도 | 기존 413 / 415 / 429 |
| 내부 오류 또는 DB 접근 불가 | 기존 500 INTERNAL_SERVER_ERROR / 503 SERVICE_UNAVAILABLE |

일괄 검수의 개별 404, 409, 5xx는 4장의 항목 결과로 담는다. 인증과 전체 요청 검증 실패는 처리 시작 전에 HTTP 오류로 반환한다. 실행 중 인증 쿠키가 만료돼도 이미 접수한 업무는 계속하며, 후속 조회는 다시 인증한다.

일괄 처리와 batch-status의 JSON 본문 한도는 **64KiB**다. 나머지 경로는 기존 **16KiB**를 유지한다. 정확한 세 POST 경로에만 큰 본문 파서를 먼저 적용하고 기본 파서가 이를 다시 제한하지 않도록 구성한다. 경로 대소문자와 끝 슬래시는 실제 라우터 동작과 일치시킨다. Content-Length가 없는 요청도 실제 수신 바이트로 제한하고 압축 본문 거부는 유지한다.

관리자 일반 호출 제한은 기존 분당 120회를 유지한다. 상태 조회와 일괄 결과 재확인도 이 한도를 사용하며 429에서는 Retry-After를 따른다.

일괄 승인과 거절의 브라우저 요청 대기는 **30초**로 두어 현재 Next.js rewrites 프록시의 기본 응답 대기 30초와 맞춘다. 프록시의 전역 제한은 늘리지 않는다. 두 제한은 HTTP 응답 대기 기준이며 서버의 전체 처리 기한이 아니다. 실제 Next.js 프로덕션 프록시를 통과하는 100건 요청에서 제한 전 응답과 제한을 넘긴 연결 종료를 각각 검증한다. 프록시 동작이 바뀌면 이 기준과 브라우저 설정을 함께 대조한다.

## 8. 관리자 화면

**공통 인증 재확인**

최초 진입이나 로그인 전 인증 확인 중에는 기존처럼 보호 화면을 표시하지 않는다. 이미 로그인된 화면의 탭 복귀, 포커스와 페이지 이동에 따른 재확인은 백그라운드에서 수행하고, 인증 확인만을 이유로 기존 화면을 unmount(컴포넌트 해제)하거나 메모리 상태를 초기화하지 않는다. 실제 경로 이동으로 떠나는 페이지의 수명은 기존 라우팅을 따른다.

일괄 검수의 진행 대상과 결과 패널, 수집 실행 상세와 기록 목록 페이지는 탭 복귀 후에도 유지한다. 재확인 중복과 늦은 응답은 기존 인증 요청 순서 검사로 방어한다. 통신 오류, 시간 초과, 5xx와 429는 인증 만료로 바꾸지 않고 상태를 보존해 재확인을 제공하며, 429는 Retry-After를 따른다. 서버가 반환한 만료 시각 도달, 인증 401 또는 로그아웃 성공이 확인되면 보호 화면과 메모리를 제거한다. 늦은 인증 성공이 이를 되돌리지 못하게 하고 모든 API의 서버 인증과 Origin 검사는 유지한다.

### 8.1 목록 상태 복원과 선택

`/admin/reviews`에서 기존 제목 검색에 유형, 중요도, 정렬과 표시 개수를 연결한다. 필터 조합과 표시 형태는 PRD 3.3절, 실제 query 값은 3장을 따른다. 검색어는 제출 시 적용하며 한글 조합 Enter 처리도 유지한다.

탭 세션 키는 `youth-kkultong:admin:review-list:v1`이고 저장 형식은 `{ version: 1, keyword, kind, importance, sort, limit, page }`다. kind와 importance의 전체는 NULL로 저장한다. 저장 범위는 적용된 탐색 조건이며 결과, 체크박스, 거절 사유와 인증값은 메모리 또는 기존 인증 쿠키에서 관리한다.

- 최초 진입은 저장값 복원 후 한 번 조회한다. 신규와 특정 중요도가 함께 저장됐으면 중요도를 전체로 정리한다.
- 손상된 JSON, 다른 버전, 잘못된 타입이나 허용값은 기본값으로 복원한다. 기본값은 검색어 없음, 유형과 중요도 전체, IMPORTANCE, 20건, 1페이지다.
- 검색, 필터, 정렬, 표시 개수 변경 시 1페이지로 이동하고 선택을 초기화한다. 페이지 이동, 목록 재조회, 상세 진입과 복귀 후에도 선택은 새로 시작한다.
- 저장소 접근 실패 시 메모리 상태로 계속 사용한다. 로그아웃 또는 인증 401이면 이 키와 보호된 화면 메모리를 지운다.

대기 기간은 `max(0, 현재 시각-createdAt)`으로 계산한다. 1분 미만은 “방금”, 이후 분, 시간, 일 단위의 내림값을 표시하고 원래 생성 시각을 한국 시간으로 함께 제공한다. 열린 화면에서는 분 단위로 갱신한다.

행 체크박스와 현재 페이지 전체 선택을 제공한다. 전체 선택 체크박스는 일부 선택일 때 중간 상태를 표시한다. 선택 건수는 항상 표시하고 상세의 canReview와 별개로 서버가 최종 처리 가능 여부를 재검증한다.

### 8.2 확인 모달과 처리 결과

승인 모달은 선택 건수와 공개 반영 영향을 안내하고 “승인 확정”으로 제출한다. 거절 모달은 선택 건수, 필수 공통 사유와 다음 문구를 제공한다.

> 거절한 내용과 같은 해시가 다시 수집돼도 자동으로 검수 대기에 등록되지 않습니다. 다른 내용으로 변경되면 새 검수 대상이 될 수 있습니다.

모달은 열릴 때 초점 이동, 내부 초점 순환, 취소 또는 Escape 시 실행 버튼으로 초점 복귀를 지원한다. 제출 중 중복 제출과 모달 닫기를 막고 처리 상태를 알린다. 일괄 POST의 대기 한도는 7.3절을 따른다. 최대 100건은 그 안에 끝나지 않을 수 있으며, 브라우저 또는 프록시의 연결 종료 시 4.3절의 batch-status 조회로 전환한다. HTTP 연결 종료와 탭 복귀를 일괄 POST 재전송의 근거로 사용하지 않는다.

결과는 성공, 충돌, 실패, 확인 필요 건수와 후보별 제목, 결과, 안전한 사유, 상세 링크로 표시한다. 목록 재조회로 결과 패널이 사라지지 않게 유지하고 선택을 비운다. 다시 고르는 대상은 현재 목록의 후보로 한정한다. 화면 이동이나 새로고침 뒤에는 기존 처리 이력에서 결과를 확인할 수 있다.

### 8.3 수집 운영 화면

관리자 메뉴의 “수집 운영”은 `/admin/ingestion`으로 연결한다. 상단에 “수집 시작”과 “새로고침” 버튼을 두고 다음 영역을 표시한다.

| 영역 | 표시 |
| --- | --- |
| 현재 수집 상태 | 실제 수집 중 여부, 현재 실행 ID와 실행 방식, 시작 시각과 마지막 확인 단계, 마지막 정상 수집 시각 |
| 선택한 실행 상세 | 실행 ID, 실행 방식, 접수와 시작 및 종료 시각, 실행 결과, DB 반영 여부, 신규/변경/동일/누락 건수, 실패 단계와 안전한 원인 |
| 실행 기록 목록 | 접수 시각, WEB/CLI/CRON, 실행 상태, DB 반영 여부, 페이지 이동 |

**진입과 기록 선택**

- 진입 시 서버의 현재 상태와 실행 기록 첫 페이지를 조회한다. 미확정 requestId가 있으면 아래 보관 규칙에 따라 원래 요청의 접수 여부도 추가 확인한다. URL에 runId가 있으면 해당 실행을 상세 조회하고, 없으면 현재 실행 또는 마지막 실행을 표시한다. 기록이 없으면 빈 목록과 “실행 기록 없음”을 표시한다.
- 기록을 클릭하면 해당 ID의 상세 API를 조회해 같은 페이지의 상세 영역에 표시한다. 선택한 행을 강조하고 `/admin/ingestion?runId=<UUID>`에 선택을 반영해 재진입과 새로고침 후에도 복원한다.
- 과거 실행을 보거나 목록 페이지를 이동해도 현재 수집 상태는 상단에 유지한다. 목록 페이지 이동은 선택한 상세를 유지한다.
- 상세를 빠르게 바꿀 때 이전 선택의 늦은 응답은 무시한다. 목록과 상세의 로딩, 빈 결과, 조회 오류와 재시도는 각 영역에서 표시한다. 없는 실행 ID는 상세에서 안내한다.
- 목록은 7.1절의 순서와 페이지 크기를 따른다. 초과 페이지에서 total이 양수면 마지막 유효 페이지로 한 번 이동해 조회한다.

**수집 실행**

“수집 시작” 버튼 옆에 전체 정책을 수집하며 신규와 변경 내용은 검수 후 공개된다는 안내를 표시한다. 새 요청은 `crypto.randomUUID()`로 requestId를 만들고 아래 세션 저장을 확인한 뒤 바로 POST한다. 접수 대기 중에는 “접수 중”으로 표시한다. 수집 중 또는 실행 여부가 확인 불가인 동안에는 시작 버튼을 비활성화한다. 미확정 요청이 남아 있으면 새로운 requestId의 시작 대신 원래 요청 확인을 제공한다.

접수되면 해당 실행을 상세에 선택하고 목록을 첫 페이지부터 갱신한다. 다른 실행이 이미 진행 중이면 그 상태를 안내한다. 접수 응답 대기는 15초이며, 응답 유실 시 같은 requestId를 status query로 조회한다. 현재 실행과 마지막 실행도 함께 확인하고 접수 POST를 자동 반복하지 않는다.

**미확정 requestId 보관**

- 세션 키는 `youth-kkultong:admin:ingestion-request:v1`, 값은 `{ version: 1, requestId }`다. POST 전에 저장을 완료한다. 저장소 접근 실패 시 새 POST를 보내지 않고 저장 오류와 재시도를 안내한다. 현재 상태와 실행 기록 조회는 계속 제공한다.
- 새로고침, 화면 재진입과 재로그인 후 유효한 저장값이 있으면 현재 상태 조회에 requestId를 함께 보내 requestedRun을 추가 확인한다. 손상된 값은 형식 오류로 안내하고 자동 POST에 사용하지 않는다. requestId는 인증값이나 실행 중 여부의 판정 기준이 아니다.
- requestedRun=NULL, 일시적 409, 조회 오류와 인증 종료만으로 유효한 저장값을 지우지 않는다. 다른 currentRun 또는 lastRun을 원래 요청의 결과로 간주하지 않는다. 인증 종료 시 보호 화면과 메모리는 제거하되 이 키는 복구용 요청 ID만 보존한다.
- 동일 requestId의 실행이 확인되고, 그 실행이 SUCCESS / FAILED / INTERRUPTED로 종료됐으며 commitOutcome도 COMMITTED 또는 NOT_COMMITTED로 확인됐을 때 저장값을 정리한다. ACCEPTED / RUNNING 또는 UNKNOWN이면 계속 보관한다. HTTP 오류만으로 이전 요청의 미접수나 미반영을 단정하지 않는다.
- 접수 행이 아직 확인되지 않으면 5초 간격으로 최대 12회 확인하고, 이후에도 불명확하면 ID를 보존해 수동 재조회를 제공한다. 접수 행이 확인된 뒤에는 실행 종료까지 아래 갱신 규칙을 따른다. 자동 POST는 없으며, 현재 유휴 상태를 확인한 관리자가 원래 요청을 명시적으로 재시도하면 저장된 동일 requestId를 사용한다.

**진행 상태와 결과 갱신**

브라우저 탭 복귀와 “새로고침”에서 현재 상태, 목록의 현재 페이지와 선택한 상세를 다시 조회한다. 활성 실행이 있으면 5초 간격으로 갱신하되 조회 주기가 겹치지 않게 하고 숨겨진 탭에서는 반복 조회를 멈춘다. 미확정 requestId 확인은 같은 상태 조회에 합쳐 중복 호출을 피한다. 종료 결과까지 반영한 뒤 자동 조회를 멈춘다. 자동 갱신은 관리자가 선택한 과거 상세와 목록 페이지를 유지하고, requestedRun 조회만으로 현재 수집 상태나 과거 상세 선택을 바꾸지 않는다.

결과가 NULL이면 “건수 확인 불가”로 표시한다. INTERRUPTED에서는 “실행 종료 결과 확인 불가”와 별도로 DB 반영 여부를 보여준다. 잠금 정보가 불명확하거나 조회가 실패하면 수집이 멈춘 것으로 표시하지 않고 재조회를 제공한다. 현재 단계는 진행률이 아닌 마지막 서버 확인 정보로 안내한다.

## 9. 보안과 운영 전환

신규 API는 기존 인증, Origin, 입력 검증, 안전한 텍스트와 HTTP(S) 링크 표시를 재사용한다. 일괄 요청 본문과 거절 사유는 액세스 로그에 남기지 않는다. 실행 기록에는 관리자 식별자와 안전한 실패 정보만 보관하고 API 키, 쿠키, DB 접속 문자열, 원본 예외는 기존 로그 비밀값 제거 규칙을 적용한다.

운영 전환은 진행 중인 수집과 검수를 마친 뒤 기존 API와 CLI 쓰기를 중단하고 DB와 로그를 백업하는 순서로 진행한다. Migration을 적용한 새 코드로 API와 수집 CLI를 함께 전환한다. 활성 실행 기록을 남기지 않는 구버전 수집기는 전환 이후 사용하지 않는다.

MVP3 적용 후 첫 수집, 기존 후보의 중요도 조회, 일괄 검수와 상태 재확인, 새 테이블을 포함한 별도 빈 DB 복원으로 인수한다. 공개 UUID, 원본, 검수 상태와 기존 로그의 보존을 대조한다. Cron의 한국 시간 04:00 설정과 활성화 여부는 기존 운영 설정을 유지한다.

## 10. 검증 시나리오

아래는 구현 후 통과해야 할 기준이다. DB와 동시성은 실제 PostgreSQL, HTTP는 NestJS와 기존 Next.js 프록시, 화면은 브라우저에서 검증한다. 외부 온통청년 응답은 고정 자료나 모의 HTTP 서버로 재현하며 실제 외부 호출 근거와 구분한다.

| ID | 입력 또는 상황 | 기대 결과 |
| --- | --- | --- |
| T3-01 | 조사 원본 필드 60개와 매핑 표 대조 | 각 키가 정확히 한 번 정의되고 등급과 비교 제외 기준 일치 |
| T3-02 | 중요, 일반, 경미 단독 변경과 혼합 변경 | 최고 등급 적용, NEW는 importance=NULL |
| T3-03 | 미분류 필드의 추가, 삭제와 변경 | HIGH와 정렬된 미분류 키 반환, 상세 안내 |
| T3-04 | NULL, 누락, 공백, 배열과 중첩 객체 변경 | 기존 필드 비교와 같은 결과 |
| T3-05 | 조회수만 변경, 수정 시각만 변경 | 기존 수집 후보 규칙 유지, 조회수 차이 제외, 수정 시각 후보는 LOW |
| T3-06 | CHANGED 기준본 손상 또는 차이 없음 | HIGH와 분류 경고, 기존 승인 스냅샷 검증 유지 |
| T3-07 | 대기 목록과 과거 상세 조회 | 같은 스냅샷에 동일 분류, 원본과 현재 공개본 변화에 과거 비교 기준 보존 |
| T3-08 | 제목, 유형, 중요도 조합과 잘못된 query | AND 결과 일치, NEW+중요도 및 중복 키 400 |
| T3-09 | 중요도 그룹, 생성 시각과 ID가 섞인 후보 | 세 정렬의 전체 순서와 동률 기준 일치 |
| T3-10 | 중요 후보가 두 번째 페이지 밖에 존재 | 중요도 필터와 정렬 후 페이지 분리, 전체 total 일치 |
| T3-11 | 0건, 초과 페이지와 처리 후 페이지 감소 | 빈 응답과 마지막 유효 페이지 복구 |
| T3-12 | 대기 20/50/100, 이력과 누락 및 공개 조회 | 확장 범위만 변경, 이력과 누락 계약 유지 |
| T3-13 | 5,000건 대기 목록의 반복 조회 | 3.2절 성능 기준, 조회 횟수와 메모리 기록, 원문은 응답에 없음 |
| T3-14 | 목록 조건 변경 후 상세 복귀와 새로고침 | 검색어, 필터, 정렬, 개수, 현재 페이지 복원 |
| T3-15 | 잘못된 세션 값, 저장소 오류, 신규+중요도 복원 | 기본값 또는 정리된 조합으로 사용 가능 |
| T3-16 | 전체/일부 선택 후 페이지, 조건, 재조회와 상세 이동 | 현재 페이지만 선택, 선택 초기화, 저장소에 체크 상태 없음 |
| T3-17 | 승인과 거절 모달, 사유 검증과 중복 클릭 | 확인 후 한 번 제출, 거절 영향 안내, 키보드 초점 동작 |
| T3-18 | 0/1/100/101건, 중복 ID와 잘못된 한 항목 | 1~100건 허용, 잘못된 전체 요청은 업무 쓰기 0건 |
| T3-19 | 일괄 승인 성공 | 각 후보의 기존 잠금과 해시 검사, 공개 UUID와 최신 조회수 보존 |
| T3-20 | 공통 사유로 여러 후보 거절 후 동일 해시 재수집 | 각 rejection_reason 저장, 공개 유지와 기존 재검수 방지 |
| T3-21 | 정상, 종료, 오래된 해시, 없는 후보, 저장 오류 혼합 | 성공 유지, 항목별 결과와 집계 합계 일치, 뒤 후보도 처리 |
| T3-22 | 일괄과 개별 승인, 승인과 거절, 수집 저장의 경쟁 | 원본 우선 잠금과 기존 충돌 규칙, 중복 공개나 이력 없음 |
| T3-23 | 후보 잠금 시간초과와 DB가 확정한 교착 | 정의한 실패와 재시도, 다른 후보 계속 처리 |
| T3-24 | 일괄 COMMIT 응답 유실, 실제 프록시에서 100건 처리의 30초 전후 응답과 연결 종료, DB 무응답 | 6.6절의 대기 상한과 연결 폐기, UNKNOWN과 부분 성공 보존, 서버는 뒤 후보 처리, batch-status 확인과 자동 POST 반복 없음 |
| T3-25 | 결과 재조회 중 원래 일괄 요청 또는 다른 요청 완료, 처리 중 탭 전환과 복귀 | 관측 상태와 원래 요청 성공 구분, PENDING은 미확정, 인증 재확인 중 진행 대상과 결과 패널 유지 |
| T3-26 | 인증, Origin, 64KiB 경계와 나머지 16KiB 경계 | 각 경로 한도 유지, 압축과 잘못된 형식 거부 |
| T3-27 | Migration과 새 테이블 제약 위반 자료 | 정책과 검수 보존, 상태, 필수 키, 집계, 시각, 유일성 보호 |
| T3-28 | 수집 시작 버튼 클릭 후 장시간 외부 호출 | 즉시 접수 요청과 중복 클릭 방지, 완료 전 202와 실행 ID, 같은 프로세스에서 작업 계속 |
| T3-29 | 같은 requestId의 접수 COMMIT 전후 동시 요청과 완료 후 재요청 | COMMIT 전에는 일시적 409와 currentRunId=NULL 허용 후 동일 ID 조회, 접수 행이 보이면 동일 실행 반환, 수집과 이력 중복 없음 |
| T3-30 | 접수 응답 유실 후 새로고침과 재진입, 그 사이 CLI/Cron 실행, 저장소 오류 | POST 전 requestId 저장, 현재 상태와 원래 요청 추가 확인, NULL이나 다른 실행으로 정리 또는 자동 재요청 없음, 동일 ID의 종료와 반영 상태 확인 후 정리, 저장 실패 시 POST 없음 |
| T3-31 | 웹, CLI와 Cron이 서로 먼저 잠금 획득 | 하나만 수집, 나머지 중복 안내와 기존 CLI 코드 2 |
| T3-32 | 접수 기록 실패, 접수 COMMIT 응답 유실 또는 DB 무응답 | 확인 전 외부 수집 없음, 대기 상한과 연결 폐기, 안전한 재확인과 늦은 후속 작업 차단 |
| T3-33 | 정상 수집과 마지막 정상 시각 조회 | 반영 증거와 result 원자성, 같은 runId의 DB와 파일 로그 |
| T3-34 | 원본 저장 후 실행 증거 쓰기 실패 | 전체 수집 롤백, 원본, 후보, 조회수와 누락 보존 |
| T3-35 | API, 검증, 변환과 해시 단계 실패 | FAILED, NOT_COMMITTED, 안전한 실패 단계, 집계 NULL |
| T3-36 | DB COMMIT 응답 유실과 무응답, 시간 초과 후 늦은 응답과 후속 확인 | Promise 시간 초과나 후속 ROLLBACK만으로 미반영 확정 없음, 증거가 있으면 COMMITTED 복원, 불명일 때 UNKNOWN, 연결 재사용과 저장 자동 재시도 없음 |
| T3-37 | DB 반영 후 로그, ROLLBACK, 잠금 해제 또는 연결 정리의 실패와 무응답 | 작업별 상한과 연결 폐기 및 정리 계속, 반영 완료 유지, 실패 실행과 마지막 정상 실행 구분, 늦은 로그가 DB 상태를 바꾸지 않음 |
| T3-38 | 접수 후, 수집 중 또는 COMMIT 전 강제 종료와 재시작 | 배타적 잠금 확인 후 INTERRUPTED와 실제 반영 상태 구분 |
| T3-39 | COMMIT 후 종료 기록 전 강제 종료 | INTERRUPTED+COMMITTED와 확정 건수 보존 |
| T3-40 | API 재시작 중 별도 CLI 계속 실행 | CLI owner 세션 일치, 현재 실행 중 유지 |
| T3-41 | 오래된 활성 행, PID 재사용, 대응 행 없는 잠금 | 실제 세션 비교, 실행 중과 정보 확인 불가 안내 |
| T3-42 | 이전 종료와 새 접수 또는 복구의 경쟁, 종료 기록 중 로그 지연과 DB 무응답 | 종료 트랜잭션의 SQL 및 전체 대기 상한, 연결 폐기와 행 재확인, 확정된 정상 종료를 INTERRUPTED로 바꾸지 않음, 미확정 종료는 증거로 복구 |
| T3-43 | DB나 잠금 검사 불가 후 회복 | idle 또는 0건으로 오인 없음, 503/확인 불가와 후속 재조회 |
| T3-44 | 수집 화면 이동과 탭 복귀 중 인증 재확인 성공, 통신 오류, 401, 만료, 로그아웃과 429 | 최초 인증 보호, 로그인 후 재확인 중 unmount 없이 상태 유지, 만료나 로그아웃 확인 시에만 보호 화면 제거, 미확정 requestId 보존, 반복 조회 제어와 Retry-After |
| T3-45 | 원문 예외에 SQL, 키, URL과 HTML 포함 | 허용 실패 정보와 텍스트만 표시, 비밀값 비노출 |
| T3-46 | 기존 공개와 관리자 전체 회귀 | 공개 API와 UUID, 탐색, 개별 검수, 이력, 누락, CLI와 Cron 유지 |
| T3-47 | 실행 요약 포함 백업을 별도 빈 DB에 복원 | 정책, 검수, 실행 ID와 반영 증거 및 로그 보존 |
| T3-48 | 상태와 실행 방식이 섞인 실행 기록의 페이지 조회 | 접수 시각과 ID 정렬, 20건 페이지와 전체 건수 일치, query 오류와 인증 검사 |
| T3-49 | 과거 기록 선택, 목록 페이지 이동 후 탭 복귀와 선택 주소 새로고침 | DB에서 선택 상세 조회, 탭 복귀의 인증 재확인 중 상세와 목록 페이지 유지, 상단 현재 상태 유지, 늦은 이전 응답 무시 |
| T3-50 | 실행 중 과거 상세 조회, 자동 갱신과 새 실행 접수 | 중복 실행 방지, 자동 갱신은 선택 유지, 새 접수는 해당 상세와 목록 첫 페이지 표시 |
| T3-51 | 실행 기록 0건, 초과 페이지, 목록과 상세 조회 오류 및 없는 ID | 빈 상태, 유효 페이지 복구와 영역별 오류/재시도, 조회 오류를 수집 대기로 오인하지 않음 |

최종 결과에는 실제 실행 명령, 사용한 격리 환경과 고정 자료, 통과와 실패 또는 미실행 사유를 기록한다. PLAN Step 32에서 전체 회귀와 검증 대응표를 정리하고 후속 인수 항목은 미실행으로 남긴다. Step 34의 백업 복원과 전환 검증을 마친 뒤 Step 35에서 T3-01~51의 최종 충족 여부를 판정한다. 문서의 테스트 기준은 구현 완료 기록과 구분한다.
