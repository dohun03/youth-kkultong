# 청년꿀통 (youth-kkultong) — MVP 0 핵심요약

> 목적: MVP 0 상세 기능 명세서를 빠르게 확인하기 위한 축약본

## 1. MVP 0의 목적

MVP 0은 사용자 화면을 만드는 단계가 아니다.

핵심 목표는 실제 지원 정책 30~50건을 정해진 데이터 형식으로 만들고 PostgreSQL에 안정적으로 넣는 것이다.

## 2. MVP 0에서 만드는 것

- PostgreSQL 기본 스키마
- 정책 데이터 스키마
- 지역 코드 시드
- 기준 중위소득 시드
- 정책 출처 시드
- 실제 정책 30~50건 JSON
- Zod 검증
- JSON import CLI
- PolicyWriteService
- 중복 방지 / 재import / rollback 테스트

## 3. MVP 0에서 안 만드는 것

- 사용자 화면
- 정책 목록 API
- 검색/매칭 API
- 로그인
- 프로필 저장
- 북마크
- 관리자 화면
- 자동 정책 수집
- Redis / BullMQ
- LLM / 알림

## 4. MVP 0 DB

MVP 0에서는 아래 4개 테이블만 만든다.

```text
regions
median_income_table
policy_sources
policies
```

## 5. Source Type / Source Status

### Source Type

```text
MANUAL
API
```

- `MANUAL`: 사람이 직접 입력한 정책
- `API`: 공공 API 등 자동 수집으로 가져온 정책

MVP 0에서는 `MANUAL`만 실제 사용한다.

### Source Status

```text
ACTIVE
NOT_SEEN
CLOSED
```

- `ACTIVE`: 정상 정책
- `NOT_SEEN`: 자동 수집에서 이전에는 있었지만 최근 수집에서 보이지 않음
- `CLOSED`: 종료된 정책으로 확인됨

`NOT_SEEN`은 Source Type이 아니라 Source Status다.

## 6. Seed란?

Seed는 빈 DB에 처음 넣어두는 초기 기준 데이터다.

예:

```text
regions → 행정구역 코드
median_income_table → 연도별/가구원 수별 기준 중위소득
policy_sources → MANUAL 출처
```

`seeds/` 폴더에는 이런 초기 데이터를 DB에 넣는 코드나 파일을 둔다.

- Migration = 테이블 구조를 만든다.
- Seed = 기본 데이터를 채운다.

## 7. MVP 0에서 확정하는 정책 스키마

MVP 0에서는 청년꿀통 내부에서 사용할 Canonical Policy Schema를 정한다.

정책 하나는 대체로 다음 정보를 가진다.

```text
정책명
기관
카테고리
지원 금액
신청 기간
공식 URL
마지막 확인일

나이 조건
지역 조건
소득 조건
현재 상태 조건
가구원 수 조건

표준화할 수 없는 추가 자격 조건
```

향후 공공 API마다 원본 구조가 달라도 내부에서는 이 공통 스키마로 변환한다.

## 8. 초기 사용자 매칭 조건 5개

초기 핵심 사용자 조건은 다음 5개다.

```text
1. 나이
2. 지역
3. 현재 상태
4. 가구원 수
5. 가구 소득
```

모든 값은 필수가 아니다.

사용자가 입력하지 않은 조건은 정책 탈락 근거로 사용하지 않는다.

## 9. 카테고리와 이름

- `카테고리`: 주거/복지/교육/취업/금융 등 정책 검색용 필터다. 사용자 자격 조건은 아니다.
- `이름`: 정책 매칭에는 필요하지 않는다.

## 10. 조건 확장

현재 5개 조건은 영구 고정이 아니다.

실제 정책을 넣으면서 필요하면 다음과 같은 조건을 추가할 수 있다.

```text
혼인 여부
학생 세부 상태
취업 기간
근속 기간
사업자 여부
자산 기준
부모 소득
자녀 여부
군 복무
학력
```

처음부터 모두 넣지는 않는다.

현재 구조로 표현하기 어려운 조건은:

```text
hasUnresolvedEligibilityCondition = true
unresolvedConditionNote = "..."
```

로 남긴다.

## 11. 정책 JSON Import

```text
공식 공고 확인
→ policies.json 작성
→ Zod 검증
→ DB 참조 검증
→ CLI import
→ PolicyWriteService
→ PostgreSQL
```

## 12. externalId

수동 정책마다 고정 식별자를 둔다.

예:

```text
2026-seoul-youth-rent-support
```

재import 시 같은 정책인지 판단하는 데 사용한다.

```text
새 정책 → CREATE
기존 정책 + 내용 변경 → UPDATE
완전히 동일 → UNCHANGED
```

## 13. Import 안전장치

정책 여러 건 중 한 건이라도 실패하면 전체 rollback 한다.

`--dry-run`으로 저장 전에 전체 검증하는 기능도 권장한다.

## 14. 왜 실제 정책 30~50건을 먼저 넣나?

다음을 실제 공고로 검증하기 위해서다.

```text
현재 데이터 구조가 실제 정책을 표현할 수 있는가?
5개 조건으로 어느 정도 매칭 가능한가?
UNKNOWN이 너무 많이 생기지 않는가?
추가해야 할 조건이 무엇인가?
```

## 15. MVP 0 완료 기준

```text
빈 DB
→ migration 성공
→ seed 성공
→ 실제 정책 30~50건 검증
→ import 성공
→ 재import 중복 없음
→ 수정 후 재import 시 update
→ 잘못된 데이터가 있으면 전체 rollback
```

## 16. MVP 1에서 이어서 할 일

MVP 0 데이터를 그대로 이용해:

```text
전체 정책 목록
→ 선택형 조건 입력
→ 규칙 기반 매칭
→ 정책 상세
→ 공식 공고 이동
```

을 구현한다.

## 17. 한 줄 결론

**MVP 0은 정책 수집 자동화 단계가 아니라, 청년꿀통이 정책을 어떤 형태로 이해하고 저장할지 실제 정책 30~50건으로 확정하고 검증하는 단계다.**
