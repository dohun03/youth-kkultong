# 청년꿀통(youth-kkultong) — MVP2 작업 결과

수정일: 2026-11-02 · 상태: Step 1~17 완료 · Step 18~41 미착수

## 1. Step 1 범위와 기준 문서

사용자 요청에 따라 `AGENT_RULES.md` → MVP2 PLAN Step 1 → 관련 SPEC → 기존 완료 기록 → 실제 소스·테스트 순으로 확인했다. 제품·구조 대조에는 PRD·ARCHITECTURE와 MVP1 SPEC·SUMMARY·OPERATIONS를 사용했다.

| 기준 | 확인 결과 |
| --- | --- |
| 제품·구조 | PRD v0.12 · ARCHITECTURE v0.7 |
| MVP2 상세·순서 | SPEC v0.5 · PLAN v0.4, 전체 41개 Step과 T2-01~49 정의 |
| 선행 구현 | MVP1 PLAN Step 1~57과 전체 인수 기준 완료. 최종 검증은 MVP1 SUMMARY 76장 |
| 착수 시 Git | `edb0a8b` 기준 변경 파일 없음. MVP1 최종 기록도 `c006194`로 커밋된 상태 |
| MVP2 시작 상태 | SUMMARY는 빈 파일. 관리자 공용 타입·엔티티·Migration·인증·API·화면·스케줄러는 미구현 |

이번 Step은 대조·검증·결과 기록이다. 애플리케이션 소스·공개 API·DB·의존성·환경변수는 변경하지 않았고 실제 수집·이관도 실행하지 않았다. `SPEC_SUMMARY.md`는 두 MVP 모두 존재하지 않아 생성하지 않았다.

## 2. 기존 구현에서 재사용할 위치

이 절과 3절은 Step 1 착수 당시의 MVP1 구현 대조 기록이다. Step 11에서 이전 즉시 공개 저장 서비스를 제거했으며 최신 수집 흐름과 파일 위치는 16절을 따른다.

아래 소스 경로는 별도 표기가 없으면 `apps/api/src/` 기준이다.

| 역할 | 실제 위치와 재사용 기준 |
| --- | --- |
| CLI와 공통 실행 | `import-policies.ts` → `modules/ingestion/services/ingestion.service.ts`. HTTP 서버 없이 공통 서비스를 호출하고 종료 0/1/2·애플리케이션 정리를 유지 |
| 외부 API 호출 | `modules/ingestion/youth-center/youth-center.client.ts`. 순차 조회·기본 50건/3초·최초 포함 최대 3회·일시 오류만 재시도·Retry-After 적용 |
| 페이지·전체 검증 | 같은 폴더의 `youth-center-response.schema.ts`, `youth-center-page.validation.ts`와 `IngestionService.collectPolicies()`. 필수값·페이지·총 건수 변화·중복 ID를 검증한 전체 자료만 저장으로 전달 |
| 정규화·내용 해시 | `youth-center-policy.transform.ts`, `youth-center-policy.hash.ts`. 기존 날짜·숫자·코드 변환과 최상위 inqCnt만 제외하는 SHA-256을 재사용. 승인 시에는 후보 스냅샷을 변환 |
| 수집 중복 잠금 | `modules/ingestion/services/ingestion-lock.service.ts`. 고정 출처 키의 PostgreSQL 세션 Advisory Lock과 같은 QueryRunner 사용, finally의 롤백·잠금 해제·연결 정리 유지 |
| 저장·DB 재시도 | `modules/policies/services/policies-write.service.ts`, `repositories/policy.repository.ts`. 같은 manager의 묶음 쓰기·전체 트랜잭션·40P01/40001만 최대 2회·기존 공개 UUID 보존 방식을 활용 |
| 파일 로그 | `modules/ingestion/services/ingestion-log.service.ts`. 기존 JSONL 경로·이벤트·파일 실패 시 Logger 대체·비밀값 제거를 유지하면서 MVP2 결과 형식 확장 |
| 공개 조회·탐색 | `modules/policies/`의 검색·상세 서비스와 `PolicyRepository`는 Policy만 조회. `modules/matching/` 순수 함수·지역 관계·신청 상태·전체 정렬 후 페이지 분리 유지 |
| 모듈 경계 | `policies.module.ts`·`meta.module.ts`는 forwardRef와 Repository export로 연결. 새 원본·검수 엔티티/저장소/업무 서비스는 Policies에, 인증·컨트롤러는 Admin에 추가 |
| API·웹 공통 기반 | `common/zod-validation.pipe.ts`, `common/api-exception.filter.ts`, `common/request-protection.ts`, `main.ts`, `packages/shared/src/`, `apps/web/next.config.ts`의 동일 출처 rewrites 활용 |
| DB·운영 | `database/data-source.ts`의 synchronize=false·migrationsRun=false·Migration 전체 트랜잭션, 기존 policies/regions Migration·지역 시드·Compose 볼륨·MVP1 OPERATIONS의 별도 DB 복원 절차 유지 |

## 3. MVP2와의 차이와 후속 Step

아래는 MVP1의 미완료 오류가 아니라 승인된 MVP2 설계에 따라 전환할 동작이다. 이번 Step에서 미리 구현하지 않았다.

| 현재 코드·자료 | MVP2에서 필요한 변경 | 담당 Step |
| --- | --- | --- |
| shared에는 공개 정책·메타 계약만 있음 | 관리자 계약·엄격한 본문/query 검증 추가. 공개 검색 스키마를 그대로 복사하면 추가 필드 거부 등의 관리자 기준을 충족하지 못함 | 2 |
| 엔티티·Migration은 policies/regions만 있음 | source_policies·policy_reviews 및 제약·부분/DESC 인덱스 추가, 기존 공개본을 원본으로 복사. 실제 수집 시각 NULL·후보 0건·공개 UUID/전체 행 보존 | 3~4 |
| prepareBatches는 공개 policies의 해시와 비교하며 응답에 있는 정책만 처리 | 직전 원본과 NEW/CHANGED/UNCHANGED/MISSING 비교, 연속 누락·재등장·정상 0건 응답 처리 | 5, 8, 10 |
| upsertPolicies가 수집 즉시 신규/변경 본문을 공개 | 원본·후보 저장과 승인 공개를 분리, 대기 한 건·스냅샷 보존·거절/과거 해시 복귀 규칙 적용 | 6, 9~11, 24 |
| UNCHANGED의 refreshPolicies도 공개 raw_json을 갱신 | 수집 시 공개 view_count만 NULL 포함 최신화. 공개 raw_json·해시·본문은 승인 경로에서만 변경 | 7, 10~11 |
| 수집 잠금은 있으나 원본·검수 행과 잠금 순서가 없음 | 수집은 원본을 정렬해 먼저 잠그고, 검수는 원본→후보→공개본 순서로 잠금. 같은 트랜잭션에서 다시 읽어 판단 | 5~6, 10, 12, 24~27 |
| 로그 counts는 세 판정, saved는 boolean만 지원 | 누락·후보 생성/대체·공개 조회수 건수 추가. COMMIT 결과 불명은 saved=null·확정 건수=null·commitOutcome=UNKNOWN으로 구분 | 11, 13 |
| 공통 오류 필터는 HTTP 상태에서 코드를 생성하고 임의 예외 본문을 버림 | 허용한 관리자 업무 코드·한국어 고정 메시지만 안전하게 보존. 기존 공통 오류 보호 유지 | 17 |
| 호출 제한은 전체 주소별 한 집계이며 JSON 전용 검사는 공개 검색에만 적용 | 공개/관리자 일반 집계 분리·로그인 추가 한도·관리자 JSON/Origin 검사·인증 쿠키 적용 | 15~19 |
| main과 CLI가 AppModule·공통 환경 검증을 공유 | 관리자 필수값 검증과 스케줄 등록은 HTTP에만 적용. CLI에 관리자 자격·타이머를 요구하지 않음 | 17, 36 |
| admin 웹·API·환경 설정과 @nestjs/schedule 의존성 없음 | 보호된 검수/이력/누락 조회·승인/거절·화면 추가, Step 36에서 스케줄 패키지 호환성 확인 후 도입. 최종 활성화는 Step 41 | 15~36, 41 |
| 수집·저장·CLI 테스트는 즉시 공개와 공개 원본 갱신을 기대 | Step 11에서 새 원본/후보/공개 기대값으로 함께 갱신하고 전체 API 테스트 통과. Step 38까지 미루거나 테스트를 제외하지 않음 | 11~14, 38 |

수집 검증·해시·잠금·묶음 저장·재시도·공개 읽기의 기존 테스트를 재사용하고, 새 DB/동시성 검증은 기존처럼 격리 스키마·별도 연결·독립 CLI를 사용한다. 대표 근거는 `apps/api/test/`의 `ingestion-success.integration`, `ingestion-failure.integration`, `policy-storage.integration`, `policy-storage-retry.integration`, `ingestion-run.integration`, `ingestion-lock.integration`, `ingestion-cli-process.integration`, `import-policies.integration` 테스트다. 검수·인증·Cron의 T2 시나리오는 후속 Step에서 추가해야 하며 기존 테스트 통과로 충족됐다고 간주하지 않는다.

기준 문서 사이에 승인된 기능·DB·API 규칙을 바꿔야 할 충돌은 발견하지 않았다. ARCHITECTURE의 PRD 기준 날짜를 실제 수정일로 맞추고, 실제로 존재하지 않는 MatchingModule 클래스 표기를 `modules/matching/` 순수 함수로 정정했다. 기존 구현을 설명하는 정정이며 모듈 경계·구현 변경은 없다.

## 4. 이전 MVP1 인수 근거

아래는 **2026-10-26의 완료 기록**이며 이번 환경에서 새로 실행한 결과와 구분한다.

- MVP1 SUMMARY 76장: 전체 타입 검사, API **50개 스위트·1,332개 테스트**, 브라우저 **65개 시나리오** 모두 통과. 실패·건너뜀 0건.
- 같은 기록에서 기존 공개 정책 **3,390건**, 전체 행 JSON MD5 `46a965ded0407e47a7af9816cd3e7b6e` 보존과 테스트 임시 스키마 0개를 확인했다.
- 75장 및 OPERATIONS: 별도 새 볼륨 초기화·Migration 2개·지역 537개·실제 API 73페이지/3,602건 수집·재기동·기존 3,390건의 새 DB 복원을 검증했다. 기존 운영 정책은 갱신하지 않았다.
- 당시 웹·API·DB는 healthy였다. 이 기록만으로 현재 서비스가 실행 중이라고 판단하지 않는다.

## 5. Step 1의 실제 검증

실행 환경은 Node.js v24.18.0·npm 11.16.0이며 기존 Docker 컨테이너와 로컬 PostgreSQL 연결을 사용했다.

```bash
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
node /tmp/mvp2-step1-verify.cjs before
node /tmp/mvp2-step1-verify.cjs tests
FONTCONFIG_FILE=/tmp/mvp2-step1-browser/fonts.conf LD_LIBRARY_PATH=/tmp/mvp2-step1-browser/root/usr/lib/x86_64-linux-gnu PLAYWRIGHT_MODULE=/home/leenohoon/youth-kkultong-before/node_modules/.pnpm/playwright@1.64.0/node_modules/playwright/index.mjs npm run test:e2e --workspace apps/web
node /tmp/mvp2-step1-verify.cjs after
(cd backups/step56-20261026 && sha256sum -c SHA256SUMS)
git diff --check
```

| 검증 | 결과·범위 |
| --- | --- |
| 전체 타입 검사 | shared·API·웹 모두 통과 |
| 전체 API·DB 테스트 | 실제 PostgreSQL·NestJS HTTP·독립 CLI를 포함한 **50개 스위트·1,332개 테스트 모두 통과**. 실패·건너뜀 0건 |
| 기존 DB 보존·스키마 | 정책 3,390건·지역 537개·Migration 2개와 전체 행 체크섬이 검증 전후 및 MVP1 최종 기록과 동일. 원본 해시 불일치·중복 정책·잔여 테스트 임시 스키마·ORM 스키마 차이 모두 0건. 기존 인덱스의 방향·유일성 확인 |
| 기존 백업 무결성 | `production.dump`, `ingestion-logs-before.tar`, `imported.dump`, `ingestion-logs-imported.tar` 4개 모두 SHA-256 일치. 이번에 복원을 재실행한 것은 아님 |
| 컨테이너·로컬 서비스 | 기존 볼륨을 유지한 채 컨테이너를 시작해 web·api·db 모두 healthy. localhost:3000 웹·4000 API·127.0.0.1:5433 DB 정상 연결 |
| 실제 브라우저 | 기존 웹·API를 대상으로 **65개 시나리오 모두 통과**. 목록·상세·조건·검색·정렬·세션 복원·오류 재시도·키보드·모바일 확인 |
| 문서 검사 | `git diff --check` 통과 |

API 실행기는 `.env`를 메모리에서 읽어 로컬 DATABASE_URL을 구성하고 전체 테스트를 실행했다. 결과는 `/tmp/mvp2-step1-api-full-results.json`, 가린 출력은 `/tmp/mvp2-step1-api-full-output.log`에 보관했다. 테스트 데이터는 임시 스키마에서만 생성·정리했으며 비밀값은 출력·문서에 기록하지 않았다.

## 6. 남은 문제와 다음 작업

- 로컬 DB는 Step 4 이관을 완료했다. 공개 정책 3,390건·원본 3,390건·검수 0건·지역 537개·Migration 3개다. Step 7 검증을 위해 기존 DB만 시작해 healthy 상태이며, 착수 시 중지되어 있던 웹과 API는 그대로 유지했다.
- 최신 이관 전 DB·로그 백업은 `backups/mvp2-step4-20261028225754/`에 보관했다. Step 11에서 로컬 CLI의 새 수집 흐름 연결과 격리 검증을 완료했다. 실제 수집과 운영 전환은 최신 코드 및 이미지와 해당 시점 백업을 확인한 뒤 진행하며 기존 이미지의 CLI 실행 중단은 유지한다.
- 외부 API 정확한 호출 한도·e003 원인·삭제/비공개 규약·지역과 실제 거주 자격 대응·0~0 연령 의미는 MVP1에서 이어지는 미확인 사항이다. 기존 보수적 판정과 실패 시 데이터 유지 규칙을 따른다.
- 프록시를 통한 접속 주소별 호출 제한 공유, 수동 백업의 보관 기한·외부 복제 등 기존 운영 한계는 유지된다. MVP2 한도 분리는 SPEC 7.2대로 구현하되 실제 사용자별 제한을 해결한 것으로 보고하지 않는다.
- 다음 요청 대상은 **Step 12: 수집 저장 실패와 재시도 검증**이다. Step 11까지 완료했고 Step 12 이후 구현은 진행하지 않았다.

Step 1 핵심 읽는 순서: MVP2 SPEC 2·5·6장 → `ingestion.service.ts` → `policies-write.service.ts`·`policy.repository.ts` → 잠금·로그 서비스 → 기존 수집/저장/CLI 통합 테스트. 관리자 계약 기준은 SPEC 3·4·7장이다.

## 7. Step 2 관리자 API 타입과 입력 검증 (2026-10-28)

사용자가 확인한 Step 1 문서를 `6d72027` (`docs: MVP2 Step 1 기존 구현 대조와 시작 상태 기록`)로 커밋한 뒤 Step 2만 진행했다.

- `packages/shared/src/admin.ts`에 SPEC 3장의 요청·응답·스냅샷·필드 차이·상태 타입 20개를 정의했다. TypeScript 구문으로 비교해 SPEC의 선언과 일치함을 확인했다. DB 엔티티·트랜잭션 타입은 추가하지 않았다.
- `admin.schema.ts`에 로그인·빈 객체 로그아웃·검수 UUID·승인·거절·검수 query·누락 query 검증을 정의하고 `index.ts`에서 타입과 함께 내보냈다. 기존 공개 타입·검색 스키마는 유지했다.
- 요청 객체는 정의한 필드만 받는다. 두 해시는 소문자 16진수 64자리이며 신규 기준 해시의 NULL과 필드 생략을 구분한다. 거절 사유는 앞뒤 공백 제거 후 1~1000자이고 비밀번호는 1~256자 원문 공백을 보존한다.
- query는 정수 문자열을 검증한 뒤 안전한 정수로 변환한다. 기본 page=1·limit=20, 최대 limit=50이며 검수 기본 상태는 PENDING, 최소 누락 횟수는 기본 1·최대 2147483647이다. 중복 query의 배열·NULL·잘못된 필터·추가 필드를 거부하고 검색어의 앞뒤 공백만 제거한다.
- `apps/api/test/admin-validation.spec.ts`의 232개 테스트로 정상·경계·오류 입력을 확인했다. T2-31·T2-41의 입력 검증 부분이며 실제 관리자 HTTP 응답·목록 조회·정렬은 해당 후속 Step에서 검증한다.

### 검증

```bash
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
npm test --workspace apps/api -- --runTestsByPath test/admin-validation.spec.ts test/policy-search-validation.spec.ts --json --outputFile=/tmp/mvp2-step2-validation-results.json
node /tmp/mvp2-step2-verify.cjs before
node /tmp/mvp2-step2-verify.cjs tests
node /tmp/mvp2-step2-verify.cjs after
git diff --check
```

- 전체 타입 검사·shared/API 빌드 통과. 신규 관리자 232개와 기존 공개 검색 60개, **2개 스위트·292개** 모두 통과했다.
- 실제 PostgreSQL·HTTP·독립 CLI를 포함한 전체 API 회귀는 **51개 스위트·1,564개 모두 통과**, 실패·건너뜀 0건이다. 실행기는 `.env`를 메모리에서 읽어 127.0.0.1:5433에 연결하고 기존 방식의 임시 스키마만 생성·정리했다. 결과와 가린 출력은 `/tmp/mvp2-step2-api-full-results.json`, `/tmp/mvp2-step2-api-full-output.log`에 보관했다.
- 정책 3,390건·지역 537개·Migration 2개 및 전체 행 체크섬이 검증 전후 동일하다. 원본 해시 불일치·중복·잔여 임시 스키마·ORM 스키마 차이는 모두 0건이며 기존 웹·API·DB는 healthy다.
- 공개 API·DB 스키마·의존성·웹 화면 변경은 없다. 브라우저 E2E는 Step 1의 65개 통과 기록을 유지하고 이번에는 재실행하지 않았다. PLAN에서 Step 2만 완료 표시했으며 SPEC의 계약 변경은 없다.

Step 2 핵심 읽는 순서: `packages/shared/src/admin.ts` → `admin.schema.ts` → `index.ts` → `apps/api/test/admin-validation.spec.ts`. 미해결 실패는 없으며 사용자 요청으로 `9ffac15` (`feat: 관리자 API 공용 타입과 입력 검증 추가`)에 커밋했다.

## 8. Step 3 수집 원본과 검수 데이터 모델 (2026-10-28)

Step 2를 커밋한 뒤 SPEC 2.1~2.3과 PLAN Step 3에 따라 두 엔티티를 `apps/api/src/modules/policies/entities/`에 추가했다.

- `SourcePolicy`는 최신 원본·해시·조회수·실제 첫/최근 수집 시각·수집 결과·연속 누락을 정의한다. `(source, external_id)` 복합 UNIQUE, 누락 기본값 0, 실제 수집 시각·결과의 NULL 허용, 원본 객체·해시·0 이상 조회수/누락 횟수 CHECK를 둔다.
- `PolicyReview`는 변경본·공개 기준본 스냅샷과 처리 이력을 정의한다. 원본은 필수 다대일, 과거 공개본은 선택 다대일이며 두 FK 모두 ON DELETE RESTRICT다. 원본과 공개 정책은 별도 UUID를 갖고 기존 출처·외부 ID로 대응한다.
- NEW는 기준 ID·해시·원본 세 값이 모두 NULL, CHANGED는 모두 필수다. 상태 CHECK는 대기/승인/거절/대체의 처리자·사유·종료 시각 조합을 검사하며 SQL NULL이 제약을 우회하지 않도록 필수값에 IS NOT NULL을 명시했다.
- 후보의 원본 ID·종류·변경본/기준본 스냅샷·해시는 `update: false`로 일반 ORM 갱신에서 제외했다. 실제 저장 전 해시 일치·스냅샷 보존과 검수 충돌 판단은 해당 후속 Step에서 구현한다.
- 원본당 대기 최대 한 건인 부분 UNIQUE와 누락·목록·이력·거절 해시 인덱스는 이름과 `synchronize: false`를 선언하고 정확한 키 순서·부분 조건을 주석에 적었다. 실제 생성·유일성/방향/조건 검증은 Step 4 Migration에서 수행한다. `(source_policy_id, content_hash)` 전체 UNIQUE는 추가하지 않았다.
- 기존 DataSource의 엔티티 파일 자동 탐색을 사용한다. 공개 엔티티·API 계약·수집 저장 흐름·패키지·Migration은 변경하지 않았다.

### 검증

```bash
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
node /tmp/mvp2-step3-checks.cjs tests
node /tmp/mvp2-step3-verify.cjs before
node /tmp/mvp2-step3-verify.cjs tests
node /tmp/mvp2-step3-tables.cjs after
git diff --check
```

- 전체 타입 검사·shared/API 빌드 통과. `policy-review-model.spec.ts`에서 13개 원본 컬럼·15개 검수 컬럼·기본값·다대일 관계·삭제 제한·스냅샷 갱신 제외·Migration 소유 인덱스를 확인했다.
- `policy-review-checks.integration.spec.ts`는 읽기 전용 PostgreSQL 연결에서 엔티티의 필수값·CHECK 식을 SELECT로 평가한다. 새 테이블·스키마를 만들지 않고 실제 NULL·정규식·상태별 판정을 확인했다. 두 신규 스위트의 **67개 테스트 모두 통과**했다. 최초 검증 도구가 nullable JSON을 JSONB 'null'로 전달하던 부분은 ORM과 같은 SQL NULL 전달로 정정했다.
- 전체 API·DB 회귀는 **53개 스위트·1,631개 모두 통과**, 실패·건너뜀 0건이다. 결과와 가린 출력은 `/tmp/mvp2-step3-api-full-results.json`, `/tmp/mvp2-step3-api-full-output.log`에 보관했다.
- 정책 3,390건·지역 537개·Migration 2개와 전체 행 체크섬이 검증 전후 동일하다. 원본 해시 불일치·중복·잔여 테스트 임시 스키마는 0건이며 기존 policies/regions만 대상으로 한 ORM 스키마 차이도 0건이다. 새 두 테이블은 아직 없음을 확인했다. **새 엔티티를 포함한 전체 스키마 차이·실제 FK/CHECK/인덱스 검증은 Step 4에서 수행한다.**
- 웹·API·DB는 healthy 상태로 유지한다. 웹 화면 변경이 없어 브라우저 E2E·컨테이너 재빌드는 반복하지 않았다. PLAN Step 3을 완료 표시했고 SPEC의 계약 변경은 없다.

Step 3 핵심 읽는 순서: `source-policy.entity.ts` → `policy-review.entity.ts` → `policy-review-model.spec.ts` → `policy-review-checks.integration.spec.ts`. 미해결 실패는 없으며 사용자 요청으로 `19df3ba` (`feat: 수집 원본과 검수 데이터 모델 정의`)에 커밋했다.

## 9. Step 4 테이블 생성과 기존 정책 이관 (2026-10-28)

Step 3을 커밋한 뒤 `1793199600000-create-policy-review-tables.ts`와 `policy-review-migration.integration.spec.ts`를 추가했다. SPEC의 DB·API 계약과 Step 3 엔티티 정의는 변경하지 않았다.

- Migration은 트랜잭션 안에서만 실행한다. 기존 policies에 SHARE 잠금을 잡아 공개 SELECT를 유지하면서 쓰기를 막고, 중복 식별자·JSON 객체·기존 내용 해시를 검증한 뒤 두 테이블과 FK/CHECK/인덱스를 생성한다.
- 기존 공개본의 출처·외부 ID·제목·원본·해시·조회수를 INSERT SELECT로 초기 원본에 복사한다. 새 원본 UUID를 생성하고 실제 수집 시각·결과=NULL, 누락=0, 생성·갱신 시각=이관 시각으로 둔다. 공개 UUID·전체 행·지역은 수정하지 않으며 검수 후보·가상 승인 이력도 만들지 않는다.
- 부분·DESC 인덱스 6개는 이름·키 순서·부분 조건·유일성을 SQL로 고정했다. 원본당 PENDING은 최대 한 건이고 종료된 같은 해시 이력은 여러 건 저장할 수 있다. 자동 down은 데이터 삭제 없이 오류로 중단하고 백업 복원을 안내한다.
- 별도 생성한 검증 DB에서 정상 이관·빈 DB·해시 불일치·중복·원본 복사 후 실제 DB 오류의 롤백, 재실행 없음, 실제 FK/CHECK·대기 유일성·전체 ORM 스키마 일치를 확인했다. 검증 코드의 배열 파싱·삽입 객체 재사용·실패 주입 반환 형식을 정정한 뒤 전체 회귀를 다시 통과했다.

### 실제 백업·복원·로컬 적용

- 기존 출처별 Advisory Lock을 확보해 다른 CLI 수집을 막고, 현재 DB custom dump와 수집 로그 tar를 새로 백업했다. 보관 위치는 `backups/mvp2-step4-20261028225754/`이며 디렉터리 700·파일 600, 두 백업의 SHA-256 확인을 통과했다. Git·이미지 빌드 대상에서는 제외된다.
- 새 빈 복원 DB에 백업을 실제 복원하고 공개·지역·기존 Migration 전체 행의 일치를 확인한 뒤 새 Migration을 적용했다. 이관 결과와 전체 ORM 스키마 차이 0건을 먼저 확인한 다음 원래 로컬 DB에도 적용했다. 검증 DB는 이번에 생성한 것만 정리했다.
- 최종 상태는 **공개 3,390건·원본 3,390건·검수 0건·지역 537개·Migration 3개**다. 원본 대응·해시·조회수·초기 시각/누락 정보 불일치와 전체 ORM 스키마 차이는 0건이다. Migration 재실행은 반영 0개다.
- 공개 전체 행 JSON MD5 `46a965ded0407e47a7af9816cd3e7b6e`, 지역 `a51e60bd1ddaa0f13f1830ccbf751da2`는 이관 전후 동일하다. 새 원본·검수 인덱스 정의는 백업 폴더의 `restored-result.json`·`migration-result.json`에, 이전 기준값은 `baseline.json`에 보관했다.
- 새 API 이미지를 빌드하고 API 컨테이너만 갱신했다. 컨테이너의 migration:show에서 세 Migration 모두 `[X]`이며 웹·API·DB는 healthy다. 실제 API와 기존 웹 프록시의 health·지역·분야·서울/28세 맞춤 검색·상세 및 웹 목록은 모두 200이다. 기존 웹 컨테이너와 DB·수집 로그 볼륨은 유지했고 잔여 검증 DB·임시 스키마·Advisory Lock은 0개다.

### 실행·검증

```bash
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
node /tmp/mvp2-step4-migration-tests.cjs tests
node /tmp/mvp2-step4-verify.cjs before
node /tmp/mvp2-step4-verify.cjs tests
node /tmp/mvp2-step4-verify.cjs after
docker compose -p youth-kkultong -f compose.yaml -f compose.local.yaml build api
node /tmp/mvp2-step4-operations.cjs
(cd backups/mvp2-step4-20261028225754 && sha256sum -c SHA256SUMS)
docker compose -p youth-kkultong -f compose.yaml -f compose.local.yaml up -d --no-deps --force-recreate --wait --wait-timeout 60 api
docker compose -p youth-kkultong -f compose.yaml -f compose.local.yaml exec -T api npm run migration:show --workspace apps/api
git diff --check
```

전체 타입 검사·shared/API 빌드·Docker API 빌드·diff 검사 통과. 신규 별도 DB 통합 **15개**, 전체 API·DB **54개 스위트·1,646개 테스트 모두 통과**, 실패·건너뜀 0건이다. 전체 결과와 가린 출력은 `/tmp/mvp2-step4-api-full-results.json`, `/tmp/mvp2-step4-api-full-output.log`에 있다. T2-01~02의 이관·롤백 기준을 확인했으며 동일 자료 재수집 판정은 새 수집 흐름을 연결하는 Step 11에서 검증한다. 웹 화면 변경이 없어 브라우저 전체 E2E는 반복하지 않았다.

2026-10-29 코드 검수: TypeORM 선언과 구현을 확인해 deprecated인 `QueryRunner.connection`을 권장 `dataSource`로 교체하고, 주석을 1~9번 핵심 실행 행위로 정리했다. API 타입 검사·shared/API 빌드·별도 DB 이관 통합 테스트 15개가 통과했다. 최초 재검증은 DB 연결 거부로 실패했고 기존 컨테이너를 시작한 뒤 통과했다. 결과는 `/tmp/mvp2-step4-review-results.json`에 보관했다.

Step 4 핵심 읽는 순서: `1793199600000-create-policy-review-tables.ts` → `policy-review-migration.integration.spec.ts` → Step 3 엔티티의 제약 정의. 이번 Step의 미해결 실패는 없다.

## 10. Step 5 수집 원본 조회·저장 (2026-10-29)

AGENT_RULES → PLAN Step 5 → SPEC 2.1·5.3~5.4 → Step 4 결과 → 기존 저장소·트랜잭션·통합 테스트를 확인하고 원본 저장소만 추가했다.

- `source-policy.repository.ts`의 `SourcePolicyRepository`를 PoliciesModule에 등록·내보냈다. 별도 연결을 만들지 않고 호출자가 전달한 진행 중인 트랜잭션의 EntityManager만 사용한다. 확정·취소·연결 반환은 호출자가 맡는다. 자동 확정 연결은 거부한다.
- `findBySourceForUpdate()`는 해당 출처의 원본 전체를 한 번에 조회하면서 `(source, external_id)` 오름차순으로 `FOR UPDATE` 잠금을 잡는다. 후보·공개본 판단 전에 호출할 메서드이며, 저장 서비스에서의 연결은 Step 10 범위다.
- `upsertCollectedPolicies()`는 복합 식별자 중복을 전체 입력에서 먼저 거부하고 정렬된 원본을 `POLICY_IMPORT_BATCH_SIZE`(기본·최대 200건)씩 저장한다. 원문·해시·제목·조회수·수집 결과를 갱신하고, 전달받은 공통 관찰 시각으로 최근 수집 시각을 기록한다. 첫 수집 시각은 NULL일 때만 채우며 UUID·생성 시각은 보존한다. 재관찰한 원본의 누락 횟수는 0으로 초기화한다.
- `updateMissingPolicies()`는 상위 서비스가 계산한 누락 횟수와 MISSING 결과·DB 갱신 시각만 묶음 갱신한다. 원문·해시·조회수·실제 첫/최근 수집 시각은 유지한다. 누락 ID 중복도 쓰기 전에 거부한다.
- 신규 입력 타입은 서버 저장소에만 정의했다. NEW·CHANGED·UNCHANGED 비교와 누락 증가·상한 계산은 Step 8, 후보 저장은 Step 6, 전체 저장 연결·CLI 전환은 Step 10~11에서 진행한다. 기존 공개 저장·수동 CLI는 변경하지 않았고 실제 외부 수집도 실행하지 않았다.
- `source-policy-storage.integration.spec.ts`는 무작위 임시 스키마에 기존 Migration을 적용해 실제 PostgreSQL에서 검증하고 종료 시 정리한다. 별도 연결의 잠금 시간 초과·일반 SELECT·다른 출처 갱신·잠금 반환 후 쓰기, 401건의 200·200·1건 저장/누락 갱신, 설정된 묶음 크기, 이관 NULL 시각, 첫 수집·UUID 보존, 중복·특수문자·NULL 조회수, 뒤 묶음 제약 실패와 호출자 전체 취소를 확인한다.

### 검증

```bash
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
node /tmp/mvp2-step5-verify.cjs before
node /tmp/mvp2-step5-verify.cjs focused
node /tmp/mvp2-step5-verify.cjs full
node /tmp/mvp2-step5-verify.cjs after
docker compose -p youth-kkultong -f compose.yaml -f compose.local.yaml ps
git diff --check
```

- 전체 타입 검사·shared/API 빌드·diff 검사 통과. 신규 실제 DB 통합 **17개**, 전체 API·DB **55개 스위트·1,663개 테스트 모두 통과**, 실패·건너뜀 0건이다. 실제 PostgreSQL·HTTP·독립 CLI를 포함하며 기존 수집 기대값은 그대로 유지했다.
- 실행기는 `.env`의 비밀값을 출력하지 않고 로컬 PostgreSQL URL을 구성한다. 결과와 가린 출력은 `/tmp/mvp2-step5-{focused,full}-results.json`, `/tmp/mvp2-step5-{focused,full}-output.log`에 보관했다. 최초 테스트의 타입 오류와 기존 원본 준비 전에 트랜잭션을 시작하던 자료 준비 순서를 바로잡은 뒤 재검증했다. PostgreSQL의 CURRENT_TIMESTAMP는 트랜잭션 시작 시각이므로 실제처럼 기존 원본을 먼저 확정한 뒤 수집 트랜잭션을 시작하도록 맞췄다.
- 검증 전후 공개 정책 3,390건·원본 3,390건·검수 0건·지역 537개·Migration 3개와 각 테이블 전체 행 체크섬이 동일하다. 공개 정책 체크섬은 기존 `46a965ded0407e47a7af9816cd3e7b6e`를 유지하고 잔여 테스트 임시 스키마는 0개다. 전후 비교 자료는 `/tmp/mvp2-step5-before.json`, `/tmp/mvp2-step5-after.json`에 있다.
- 기존 웹·API·DB는 모두 healthy다. 공개 API 계약·DB 스키마·Migration·의존성·환경변수·웹 화면 변경은 없다. 화면 변경이 없어 브라우저 E2E와 컨테이너 재빌드는 반복하지 않았다. PLAN Step 5만 완료 표시했으며 SPEC의 설계 변경은 없다.

Step 5 핵심 읽는 순서: `source-policy.repository.ts`의 입력 타입 → 원본 잠금 조회 → 관찰·누락 저장 → `policies.module.ts` → `source-policy-storage.integration.spec.ts`. 이번 Step의 미해결 실패는 없다. 누락 판정·후보 저장·CLI 연결은 각 후속 Step에서 진행하며, Step 11 전까지 기존 수동 수집 CLI 실행 중단 원칙을 유지한다.

2026-10-29 주석 정리: 사용자가 수정한 AGENT_RULES 10장에 맞춰 위 세 코드 파일의 주석을 역할과 실행 단계 중심으로 정리했다. 명사형 표현을 사용하고 가운데 점과 현재 로직에 불필요한 설명을 줄였다. TypeScript 구문 비교로 주석을 제외한 코드가 수정 전과 동일함을 확인했고 `git diff --check`를 통과했다. 주석만 수정했으므로 동작 테스트는 재실행하지 않았다.

사용자 요청으로 최종 코드의 전체 타입 검사와 원본 저장 통합 17개를 다시 통과시킨 뒤, 주석 규칙 수정을 포함해 `7bc553f` (`feat: 수집 원본 조회와 잠금 및 묶음 저장 구현`)로 Step 5를 커밋했다.

## 11. Step 6 검수 후보와 스냅샷 보관 (2026-10-29)

AGENT_RULES → PLAN Step 6 → SPEC 2.2·5.4·6.1~6.2·T2-34 → Step 5 결과 → 기존 엔티티와 저장소를 확인했다. 이번 범위는 후보 조회와 스냅샷 저장이며 후보 생성 여부 판단은 Step 9, 전체 수집 저장 연결은 Step 10에서 진행한다.

- `PolicyReviewRepository`는 전달받은 트랜잭션에서 대기 후보와 거절 해시를 최대 200개 원본 ID씩 조회한다. 입력 원본 ID는 중복 제거하며 거절 조회는 원본 ID와 해시만 DISTINCT로 반환한다. 원본 잠금 후 호출할 조회이므로 후보를 먼저 잠그지 않는다.
- `supersedePendingReviews()`는 대체 사유별로 묶어 PENDING 상태만 SUPERSEDED로 갱신한다. 상태와 대체 사유, 종료 시각만 변경하고 과거 스냅샷과 처리 이력을 보존한다. 대상이 없거나 이미 종료되어 예상 갱신 건수와 다르면 오류를 전달한다.
- `insertPendingReviews()`는 새 후보를 묶음 INSERT한다. 조회와 쓰기는 쿼리빌더를 사용하고 두 스냅샷은 JSON 매개변수로 전달한다. 신규 기준본은 SQL NULL로 저장하며 후보 원본당 대기 한 건 제약을 유지한다.
- `PolicyReviewsWriteService.saveReviewChanges()`는 전체 입력의 중복, 원본과 공개 기준본의 출처와 외부 ID, 두 스냅샷의 해시 일치를 쓰기 전에 검증한다. 검증한 원문은 깊은 복사로 보관하며 공개 기준본의 존재 여부에 따라 NEW 또는 CHANGED로 저장한다. 모든 대기 대체를 먼저 끝낸 뒤 새 후보를 추가한다.
- 트랜잭션 시작과 확정, 취소는 호출자가 맡는다. 같은 EntityManager로 원본과 후보 저장을 묶을 수 있으며 오류는 호출자에게 전달한다. 저장소와 서비스는 PoliciesModule에 등록하고 내보냈다. 승인과 거절 처리, 후보 판단, CLI 전환은 추가하지 않았다.
- `policy-review-storage.integration.spec.ts`는 임시 스키마의 실제 PostgreSQL에서 신규 기준본 NULL, 변경 기준본 보존, 이후 원본과 공개본 변경에도 과거 스냅샷 보존, 입력 객체의 중첩 값 변경 방어, 대기 유일성, 대체 후 추가 순서, 종료 이력 보호, 401건 묶음 처리, 잘못된 식별자와 해시, 후반 FK 오류 시 전체 취소를 검증한다. T2-34의 스냅샷 저장 보존 부분을 확인했으며 과거 상세 API와 차이 결과는 Step 20과 22에서 검증한다.

### 검증

```bash
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
node /tmp/mvp2-step6-verify.cjs before
node /tmp/mvp2-step6-verify.cjs focused
node /tmp/mvp2-step6-verify.cjs full
node /tmp/mvp2-step6-verify.cjs after
docker compose -p youth-kkultong -f compose.yaml -f compose.local.yaml ps
git diff --check
```

- 전체 타입 검사와 shared/API 빌드, diff 검사 통과. 신규 실제 DB 통합 **28개**, 전체 API와 DB **56개 스위트, 1,691개 테스트 모두 통과**했다. 실패와 건너뜀은 0건이다. HTTP와 독립 CLI를 포함한 기존 수집 기대값도 유지한다.
- 검증 실행기는 `.env`의 비밀값을 메모리에서 읽어 로컬 PostgreSQL에 연결하고 가린 출력만 보관한다. 테스트 결과와 출력은 `/tmp/mvp2-step6-{focused,full}-results.json`, `/tmp/mvp2-step6-{focused,full}-output.log`에 있다.
- 제품 DB의 공개 정책 3,390건, 원본 3,390건, 검수 0건, 지역 537개, Migration 3개와 각 테이블 전체 행 체크섬이 검증 전후 동일하다. 공개 정책 체크섬은 `46a965ded0407e47a7af9816cd3e7b6e`이며 잔여 임시 검증 스키마는 0개다. 전후 자료는 `/tmp/mvp2-step6-before.json`, `/tmp/mvp2-step6-after.json`에 있다.
- 기존 웹과 API, DB는 모두 healthy다. API 계약과 DB 스키마, Migration, 의존성, 환경변수, 웹 화면 변경은 없다. 화면 변경이 없어 브라우저 E2E와 컨테이너 재빌드는 반복하지 않았다. PLAN Step 6만 완료 표시했으며 SPEC 변경은 없다.

Step 6 핵심 읽는 순서: `policy-review.repository.ts`의 대기와 거절 조회 → `policy-reviews-write.service.ts`의 스냅샷 검증과 저장 순서 → 저장소의 대체와 추가 → `policy-review-storage.integration.spec.ts`. 미해결 실패는 없다. 실제 CLI 전환과 외부 수집은 이번에 수행하지 않았다.

2026-10-30 사용자 요청으로 전체 타입 검사와 검수 저장 통합 28개를 다시 통과시킨 뒤 `ee7d2e6` (`feat: 검수 후보와 스냅샷 저장 구현`)로 Step 6을 커밋했다. 재검증 명령은 `node /tmp/mvp2-step7-verify.cjs commit6`이며 결과는 `/tmp/mvp2-step7-commit6-results.json`에 보관했다. 중지되어 있던 기존 DB 컨테이너만 볼륨을 유지해 시작했다.

## 12. Step 7 공개 본문 저장과 조회수 갱신 분리 (2026-10-30)

AGENT_RULES → PLAN Step 7 → SPEC 2.3·5.4·6.3·T2-13 → Step 6 결과 → 기존 정책 저장소와 수집 저장 서비스, 관련 통합 테스트를 확인했다. 공개 본문 저장과 수집 조회수 갱신에 사용할 두 메서드를 기존 `PolicyRepository`에 추가했다.

- `saveApprovedPolicy(manager, policy, basePolicyId)`는 최초 승인일 때 INSERT로 공개 UUID를 생성한다. 기존 승인은 검수 기준 UUID와 출처, 외부 ID가 모두 일치하는 행만 UPDATE한다. 갱신할 본문 컬럼을 명시해 기존 UUID와 식별자, 생성 시각을 보존하고 대상이 없으면 오류를 전달한다. 신규 식별자가 이미 공개되어 있으면 UNIQUE 오류로 중단해 기존 본문을 보호한다.
- 승인 저장 입력은 이후 승인 서비스가 검수 스냅샷을 기존 변환 함수로 변환한 값이며 조회수는 최신 원본 값을 전달한다. 원본의 시간대 없는 시각과 JSON은 매개변수로 저장한다. 실제 검수 조건 재확인, 해시 검증과 승인 이력 저장은 Step 24에서 연결한다.
- `refreshViewCounts(manager, policies)`는 출처와 외부 ID, 조회수만 받는다. 같은 식별자의 중복 입력을 거부하고 공개 행이 있는 정책의 `view_count`와 `updated_at`만 한 쿼리로 갱신한다. NULL과 0도 그대로 반영하며 갱신한 공개 행 수를 반환한다. 공개본이 없는 입력은 0건으로 처리하고 새 공개 정책을 생성하지 않는다. 묶음 크기는 기존 저장소 방식처럼 상위 저장 서비스에서 관리하며 200건의 단일 쿼리 처리를 검증했다.
- 두 메서드는 진행 중인 트랜잭션 관리자를 필수로 요구하고 확정과 취소는 호출자가 맡는다. 기존 공개 테이블에는 음수 조회수 CHECK가 없어 최초 테스트에서 DB가 음수를 허용하는 것을 확인했다. 스키마를 변경하지 않고 두 새 저장 경로에서 NULL 또는 0~2147483647 정수만 받도록 입력 검증을 추가했다. 음수, 소수, 정수 범위 초과, NaN, Infinity를 SQL 실행 전에 거부한다.
- 기존 `upsertPolicies()`와 `refreshPolicies()`, 수집 저장 서비스와 CLI는 Step 11 전환을 위해 유지했다. 새 수집 저장의 조회수 연결은 Step 10, CLI의 기존 공개 저장 경로 교체는 Step 11, 승인 전용 본문 저장 연결은 Step 24에서 수행한다. 실제 수동 수집은 실행하지 않았다.
- `policy-public-write.integration.spec.ts`는 임시 스키마의 실제 PostgreSQL에서 신규 UUID 생성, 기존 전체 본문 갱신과 UUID 보존, 기준 식별자 불일치와 중복 최초 승인 거부, 검수 원문의 과거 조회수와 최신 조회수 분리, NULL과 0 조회수, 원문과 해시를 포함한 나머지 전체 컬럼 보존, 미공개 입력, 200건 묶음, 입력 중복과 잘못된 조회수, 후반 실패 시 전체 취소를 검증한다. T2-13의 저장 계층 기준이며 UNCHANGED 판정과 실제 CLI 연결은 후속 Step에서 검증한다.

### 검증

```bash
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
node /tmp/mvp2-step7-verify.cjs before
node /tmp/mvp2-step7-verify.cjs commit6
node /tmp/mvp2-step7-verify.cjs focused
node /tmp/mvp2-step7-verify.cjs full
node /tmp/mvp2-step7-verify.cjs after
docker compose -p youth-kkultong -f compose.yaml -f compose.local.yaml ps -a
git diff --check
```

- 전체 타입 검사와 shared/API 빌드, diff 검사 통과. 신규 실제 DB 통합 **24개**, 전체 API와 DB **57개 스위트, 1,715개 테스트 모두 통과**했다. 실패와 건너뜀은 0건이다. 기존 수집과 독립 CLI의 기대값은 유지했다.
- 테스트 결과와 가린 출력은 `/tmp/mvp2-step7-{commit6,focused,full}-results.json`, `/tmp/mvp2-step7-{commit6,focused,full}-output.log`에 있다. 실행기는 `.env`의 비밀값을 출력하지 않고 메모리에서 로컬 PostgreSQL URL을 구성한다.
- 제품 DB의 공개 정책 3,390건, 원본 3,390건, 검수 0건, 지역 537개, Migration 3개와 각 테이블 전체 행 체크섬이 검증 전후 동일하다. 공개 정책 체크섬은 `46a965ded0407e47a7af9816cd3e7b6e`이며 잔여 임시 검증 스키마는 0개다. 전후 자료는 `/tmp/mvp2-step7-before.json`, `/tmp/mvp2-step7-after.json`에 있다.
- 기존 DB는 healthy로 유지하고 중지 상태였던 웹과 API는 변경하지 않았다. API 계약과 DB 스키마, Migration, 의존성, 환경변수, 웹 화면 변경은 없다. 화면 변경이 없어 브라우저 E2E와 컨테이너 재빌드는 수행하지 않았다. PLAN Step 7만 완료 표시했고 SPEC 변경은 없다.

Step 7 핵심 읽는 순서: `policy.repository.ts`의 `saveApprovedPolicy()` → `refreshViewCounts()` → `policy-public-write.integration.spec.ts`. 미해결 실패는 없다.

2026-10-30 사용자 요청으로 검증된 Step 7 코드와 문서를 확인한 뒤 `3ed7353` (`feat: 승인 본문 저장과 공개 조회수 갱신 분리`)으로 커밋했다.

## 13. Step 8 수집 결과와 누락 판정 (2026-10-30)

AGENT_RULES → PLAN Step 8 → SPEC 5.2~5.4 → Step 7 결과 → 수집 원본 저장소와 기존 수집 변환 및 해시 코드를 확인했다. 정상 전체 수집 결과를 직전 원본과 비교하는 순수 함수 `classifyPolicyCollection()`을 `modules/policies/policy-collection.ts`에 추가했다.

- 입력은 한 출처, 해당 출처의 직전 원본 목록, 전체 검증과 변환을 마친 이번 수집 목록이다. 식별자와 해시 및 기존 누락 횟수만 사용하고 원문과 DB 연결, 현재 시각에 의존하지 않는다. 다른 출처가 섞이거나 외부 ID가 중복되면 예외를 전달한다.
- 반환값은 수신 정책의 판정 목록 `collected`, 누락 원본의 ID와 새 누락 횟수 `missing`, 네 판정의 건수 `counts`다. 직전 원본이 없으면 NEW, 해시가 다르면 CHANGED, 같으면 UNCHANGED다. 비교 기준으로 공개 정책을 받지 않는다. 실제 최상위 inqCnt 제외 해시를 사용해 조회수만 변경된 자료는 UNCHANGED로 판정한다.
- 관찰된 정책은 누락 횟수 0을 반환하고, 미수신 기존 원본은 한 번 증가시켜 2147483647에서 유지한다. 정상 0건 응답이면 기존 원본 모두 누락으로 계산한다. 날짜별 중복 제거를 적용하지 않아 같은 날 성공한 실행마다 누락 횟수를 센다. 재등장은 직전 원본 해시와 비교해 CHANGED 또는 UNCHANGED로 판단한다.
- 입력 배열과 원본 객체는 수정하지 않는다. 누락 반환값에는 ID와 횟수만 포함해 원문과 조회수, 실제 첫 수집과 최근 수집 시각을 유지한다. 실제 관찰 시각 기록과 첫 수집 시각 보존은 Step 5 저장소가 담당하며, 전체 수집과 변환 완료 시각을 전달하는 연결은 Step 10~11에서 진행한다. 취소된 저장의 계산 결과는 다음 시도의 기존 상태로 사용하지 않는다.
- `policy-collection.spec.ts`의 34개 단위 테스트로 네 판정 혼합, 이관 원본의 동일 판정, 최상위와 중첩 조회수의 해시 차이, 정상 0건, 연속 누락, 같은 날 재실행, 재등장, 정수 상한, 입력 보존과 중복 및 출처 오류, 대량 수집 건수를 검증했다. T2-03·13·16~17·19~20의 비교 계산 부분이며 실제 CLI와 후보 판단 연결은 해당 후속 Step에서 검증한다.

### 검증

```bash
npm test --workspace apps/api -- --runTestsByPath test/policy-collection.spec.ts --json --outputFile=/tmp/mvp2-step8-unit-results.json
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
node /tmp/mvp2-step8-verify.cjs before
node /tmp/mvp2-step8-verify.cjs full
node /tmp/mvp2-step8-verify.cjs after
docker compose -p youth-kkultong -f compose.yaml -f compose.local.yaml ps -a
git diff --check
```

- 전체 타입 검사와 shared/API 빌드, diff 검사 통과. 신규 단위 테스트 **34개**, 실제 PostgreSQL과 HTTP, 독립 CLI를 포함한 전체 API와 DB **58개 스위트, 1,749개 테스트 모두 통과**했다. 실패와 건너뜀은 0건이다.
- 단위 테스트 결과는 `/tmp/mvp2-step8-unit-results.json`, 전체 결과와 가린 출력은 `/tmp/mvp2-step8-full-results.json`, `/tmp/mvp2-step8-full-output.log`에 보관했다. 전체 실행기는 `.env`의 비밀값을 출력하지 않고 메모리에서 로컬 PostgreSQL URL을 구성한다.
- 공개 정책 3,390건, 원본 3,390건, 검수 0건, 지역 537개, Migration 3개와 각 테이블 전체 행 체크섬이 검증 전후 동일하다. 공개 정책 체크섬은 `46a965ded0407e47a7af9816cd3e7b6e`이며 잔여 임시 검증 스키마는 0개다. 전후 자료는 `/tmp/mvp2-step8-before.json`, `/tmp/mvp2-step8-after.json`에 있다.
- DB는 healthy이며 기존 웹과 API의 중지 상태를 유지했다. API 계약과 DB 스키마, Migration, 의존성, 환경변수, 웹 화면 변경은 없다. 브라우저 E2E와 컨테이너 재빌드는 수행하지 않았다. PLAN Step 8만 완료 표시했고 SPEC 변경은 없다.

Step 8 핵심 읽는 순서: `policy-collection.ts`의 반환 타입 → 직전 원본 준비 → 수신 정책 판정 → 누락 횟수 계산 → `policy-collection.spec.ts`. 미해결 실패는 없다.

2026-10-30 사용자 요청으로 Step 8 코드와 문서를 확인한 뒤 `c0765ab` (`feat: 수집 결과와 연속 누락 판정 구현`)로 커밋했다.

## 14. Step 9 검수 후보 생성과 유지, 교체 판단 (2026-10-30)

AGENT_RULES → PLAN Step 9 → SPEC 6.1~6.2 → Step 8 결과 → 검수 저장 서비스와 저장소, 기존 스냅샷 통합 테스트를 확인했다. 원본 하나의 검수 처리를 결정하는 순수 함수 `decidePolicyReview()`를 `modules/policies/policy-review-decision.ts`에 추가했다.

- 입력은 수집 결과, 최신 원본의 식별자와 해시, 현재 공개본, 기존 대기, 거절 원본 ID와 해시 목록이다. 공개본의 출처와 외부 ID, 대기의 원본 ID와 PENDING 상태를 확인한다. 실제 DB 접근과 일괄 조회는 상위 수집 저장 서비스에서 연결할 Step 10 범위다.
- 반환값은 KEEP(기존 대기 ID 유지), SKIP(새 후보 생략과 필요한 기존 대기 대체), CREATE(후보 종류와 필요한 기존 대기 대체) 중 하나다. 누락 원본은 기존 대기를 유지하고 대기가 없으면 후보를 만들지 않는다.
- 수집된 원본은 SPEC 순서대로 공개본 일치 → 같은 원본의 거절 해시 일치 → 대기의 변경본 해시와 공개 기준 ID 및 해시 일치 → 기존 대기 대체와 새 후보 생성으로 판단한다. 공개본과 같아지면 MATCHES_PUBLIC, 거절했던 내용이면 PREVIOUSLY_REJECTED를 먼저 적용한다. 원본과 공개 기준이 함께 바뀌면 SOURCE_CHANGED를 우선하며 원본은 같고 기준만 바뀌면 PUBLIC_BASE_CHANGED다.
- 새 후보 종류는 현재 공개본의 존재 여부로 NEW와 CHANGED를 정한다. UNCHANGED 수집도 현재 공개 기준을 비교하며 UUID만 달라진 경우도 대체한다. 거절 이력은 같은 원본 ID의 해시에 한정하고 공개 기준이 달라져도 유효하다. 과거 승인 또는 대체 이력의 해시로 복귀한 내용은 현재 공개본과 다르고 거절 이력이 없으면 새 후보를 허용한다.
- 단위 테스트 43개로 명세 우선순위, 같은 대기 유지, 공개본과 거절본 복귀, 과거 승인과 대체 해시 복귀, 공개 기준의 UUID와 해시 변경, 후보 종류, 누락, 잘못된 식별자와 종료 이력, 입력 보존을 확인했다. 원문 복사와 스냅샷 해시 검증은 기존 Step 6 저장 서비스에 유지했다.
- 기존 `policy-review-storage.integration.spec.ts`에 실제 DB 시나리오 4개를 추가했다. B 대기 반복 후 C와 B 복귀, B 거절 뒤 C 생성과 공개 기준 변경 후 B 재검수 방지, 과거 승인 A와 현재 공개 B에서 A 새 후보 생성, 동일 원본에서 공개 기준을 직접 변경한 후 스냅샷 교체를 재현했다. 과거 승인과 거절, 대체 이력의 전체 행 보존과 대기 한 건을 확인한다. 공개 기준 변경은 격리된 테스트 스키마에서만 수행한다.
- T2-06~12와 T2-28의 후보 판단 및 저장 결과를 검증했다. 전체 수집 저장 연결과 재시도 및 동시 실행은 후속 Step에서 검증하며 기존 CLI와 공개 API는 변경하지 않았다.

### 검증

```bash
npm test --workspace apps/api -- --runTestsByPath test/policy-review-decision.spec.ts --json --outputFile=/tmp/mvp2-step9-unit-results.json
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
node /tmp/mvp2-step9-verify.cjs before
node /tmp/mvp2-step9-verify.cjs focused
node /tmp/mvp2-step9-verify.cjs full
node /tmp/mvp2-step9-verify.cjs after
docker compose -p youth-kkultong -f compose.yaml -f compose.local.yaml ps -a
git diff --check
```

- 전체 타입 검사와 shared/API 빌드, diff 검사 통과. 신규 단위 **43개**, 기존 28개에 4개를 추가한 검수 저장 통합 **32개**, 전체 API와 DB **59개 스위트, 1,796개 테스트 모두 통과**했다. 실패와 건너뜀은 0건이다. 전체 회귀에는 실제 PostgreSQL과 HTTP, 독립 CLI를 포함한다.
- 단위 결과는 `/tmp/mvp2-step9-unit-results.json`, 통합 및 전체 결과와 가린 출력은 `/tmp/mvp2-step9-{focused,full}-results.json`, `/tmp/mvp2-step9-{focused,full}-output.log`에 보관했다. 검증 실행기는 `.env`의 비밀값을 출력하지 않고 메모리에서 DB URL을 구성한다.
- 공개 정책 3,390건, 원본 3,390건, 검수 0건, 지역 537개, Migration 3개와 각 테이블 전체 행 체크섬이 검증 전후 동일하다. 공개 정책 체크섬은 `46a965ded0407e47a7af9816cd3e7b6e`이며 잔여 임시 검증 스키마는 0개다. 전후 자료는 `/tmp/mvp2-step9-before.json`, `/tmp/mvp2-step9-after.json`에 있다.
- DB는 healthy이며 기존 웹과 API의 중지 상태를 유지했다. API 계약과 DB 스키마, Migration, 의존성, 환경변수, 웹 화면 변경은 없다. 브라우저 E2E와 컨테이너 재빌드는 수행하지 않았다. PLAN Step 9만 완료 표시했고 SPEC 변경은 없다.

Step 9 핵심 읽는 순서: `policy-review-decision.ts`의 입력과 반환 타입 → `decidePolicyReview()`의 판단 순서 → `policy-review-decision.spec.ts` → `policy-review-storage.integration.spec.ts`의 추가 시나리오. 미해결 실패는 없다.

2026-10-30 사용자 요청으로 Step 9 코드와 검증 문서를 확인한 뒤 `db03edc` (`feat: 검수 후보 생성과 유지 및 대체 판단 구현`)로 커밋했다.

## 15. Step 10 수집분 일괄 저장 연결 (2026-10-30)

AGENT_RULES → PLAN Step 10 → SPEC 5.3~5.5 → Step 9 결과 → 기존 원본과 검수 저장소, 판정 함수, 공개 저장과 수집 잠금 코드를 확인했다. `PolicyCollectionWriteService`를 PoliciesModule에 등록하고 내보냈으며 기존 CLI는 Step 11 전환을 위해 유지했다.

- `saveCollection()`은 수집 잠금을 잡은 QueryRunner와 출처, 전체 검증과 변환 및 해시 계산을 마친 정책 목록, 공통 실제 수집 시각을 받는다. 같은 연결에서 READ COMMITTED 트랜잭션을 시작하고 기존 원본 전체를 정렬해 잠근 뒤 `classifyPolicyCollection()`으로 판정과 누락 계획을 계산한다.
- 원본과 누락 정보를 묶음으로 저장한 뒤 신규 원본 UUID를 포함한 현재 원본을 일괄 재조회한다. 관찰된 원본의 공개 기준본과 대기, 거절 이력은 원본 잠금 이후 묶음 조회한다. 공개 기준 조회를 위해 `PolicyRepository.findPublicSnapshots()`와 서버 내부 `PublicPolicySnapshot` 타입을 추가했다. 원본마다 DB를 조회하지 않는다.
- 원본 ID별 대기와 거절 정보를 준비하고 `decidePolicyReview()`로 생성과 유지, 대체를 판단한다. 기존 Step 6 서비스가 모든 대기를 먼저 대체하고 새 후보를 추가한다. 누락 원본은 후보 판단과 공개 조회수 갱신 대상에서 제외해 기존 검수 스냅샷과 실제 수집 시각을 유지한다.
- 공개 조회수는 기존 공개 행에 한해 최대 설정된 묶음 크기로 갱신한다. 공개 본문 저장 메서드는 호출하지 않는다. 신규 미승인 정책의 공개 행 생성과 기존 공개 원문 및 해시 변경 없이 최신 조회수만 NULL과 0을 포함해 반영한다.
- 모든 조회와 쓰기는 같은 `runner.manager`를 사용한다. 모든 저장이 성공한 뒤 한 번만 COMMIT하고 네 판정과 후보 생성 및 대체, 공개 조회수 갱신의 확정 건수를 반환한다. 오류가 나면 전체 트랜잭션을 취소하고 취소 실패는 원래 오류와 함께 전달한다. 연결과 수집 잠금 반환은 기존 호출자에게 맡긴다.
- 기존 저장 규칙대로 40P01과 40001만 최초 포함 최대 2회 시도한다. 롤백 후 같은 연결을 확인하고 원본 잠금과 판정부터 다시 수행한다. 재시도 횟수를 기록할 선택적 콜백을 제공한다. 이번에는 오류 코드 주입으로 기본 분기를 검증했으며 실제 교착과 직렬화 충돌 재현은 Step 12, 연결 및 COMMIT 결과 불명과 로그 정리는 Step 13에서 검증한다.
- `policy-collection-write.integration.spec.ts`의 실제 DB 테스트 20개로 T2-04~05의 원본과 후보 생성, 미승인 신규 공개 차단과 변경 본문 보존, 조회수 갱신, 이관 원본 첫 관찰, 대기 유지와 교체, 공개본 복귀와 거절 이력, 누락 및 재등장, 같은 관리자와 단일 트랜잭션을 확인했다. 401건에서 원본 전체 조회 2회와 공개 및 대기, 거절 각각 3회로 총 11회 조회를 확인했다. 후반 조회수 묶음의 실제 PostgreSQL 정수 범위 오류로 앞서 저장한 원본과 후보, 조회수까지 모두 취소되는 것도 검증했다.

### 검증

```bash
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
node /tmp/mvp2-step10-verify.cjs before
node /tmp/mvp2-step10-verify.cjs focused
node /tmp/mvp2-step10-verify.cjs full
node /tmp/mvp2-step10-verify.cjs after
docker compose -p youth-kkultong -f compose.yaml -f compose.local.yaml ps -a
git diff --check
```

- 전체 타입 검사와 shared/API 빌드, diff 검사 통과. 신규 실제 DB 통합 **20개**, 전체 API와 DB **60개 스위트, 1,816개 테스트 모두 통과**했다. 실패와 건너뜀은 0건이다. 전체 회귀에는 실제 PostgreSQL과 HTTP, 독립 CLI를 포함하며 CLI의 기존 저장 기대값은 유지했다.
- 테스트 결과와 가린 출력은 `/tmp/mvp2-step10-{focused,full}-results.json`, `/tmp/mvp2-step10-{focused,full}-output.log`에 보관했다. 검증 실행기는 `.env`의 비밀값을 출력하지 않고 메모리에서 로컬 DB URL을 구성한다.
- 공개 정책 3,390건, 원본 3,390건, 검수 0건, 지역 537개, Migration 3개와 각 테이블 전체 행 체크섬이 검증 전후 동일하다. 공개 정책 체크섬은 `46a965ded0407e47a7af9816cd3e7b6e`이며 잔여 임시 검증 스키마는 0개다. 전후 자료는 `/tmp/mvp2-step10-before.json`, `/tmp/mvp2-step10-after.json`에 있다.
- DB는 healthy이며 기존 웹과 API의 중지 상태를 유지했다. API 계약과 DB 스키마, Migration, 의존성, 환경변수, 웹 화면 변경은 없다. 브라우저 E2E와 컨테이너 재빌드는 수행하지 않았다. PLAN Step 10만 완료 표시했고 SPEC 변경은 없다.

Step 10 핵심 읽는 순서: `policy-collection-write.service.ts`의 `saveCollection()`과 `saveTransaction()` → `policy.repository.ts`의 `findPublicSnapshots()` → `policy-collection-write.integration.spec.ts`. 미해결 실패는 없다. 실제 온통청년 수집은 이번에 실행하지 않았다.

2026-10-30 사용자 요청으로 Step 10 코드와 문서를 확인한 뒤 `c694f3b` (`feat: 수집 원본과 검수 및 공개 조회수의 일괄 저장 연결`)로 커밋했다.

## 16. Step 11 기존 CLI를 새 수집 흐름으로 전환 (2026-10-30)

AGENT_RULES → PLAN Step 11 → SPEC 5.1~5.5 → Step 10 결과 → CLI와 수집 및 로그 서비스, 기존 수집과 저장 및 독립 CLI 테스트를 대조했다. 기존 수집 명령과 잠금, 외부 API의 페이지 호출 및 재시도, 종료 코드 0/1/2를 유지하고 저장 경로를 전환했다.

- `import-policies.ts` → `IngestionService.importPolicies()` → `runWithLock()` → `collectPolicies()` → 기존 변환과 해시 계산 → `PolicyCollectionWriteService.saveCollection()` → 결과 로그 → 잠금과 연결 정리 순서다. 모든 검증과 변환이 끝난 시각 한 값을 실제 수집 시각으로 전달한다. 신규와 변경 내용은 원본과 대기에 저장하고 공개 정책은 최신 조회수만 갱신한다.
- 성공 반환값에는 네 판정과 검수 후보 생성 및 대체, 공개 조회수 반영 건수를 담는다. CLI는 “정책 수집 DB 반영 완료”와 이 건수들을 출력하고 본문은 관리자 승인 후 공개됨을 알린다. 로그의 기존 counts 세 항목은 유지하고 missingCount, reviewCreatedCount, reviewSupersededCount, publicViewUpdatedCount를 추가했다.
- `saved=true`와 commitOutcome=COMMITTED는 수집 DB 확정을 뜻한다. 확정 전 실패와 중복 종료는 건수 0 및 saved=false를 유지한다. COMMIT 성공 뒤 로그나 잠금 정리가 실패해도 확정 상태와 건수를 보존하며 종료 코드는 1일 수 있다.
- COMMIT 단계에서 확정된 교착 및 직렬화 충돌 외의 응답 오류는 `PolicyCollectionCommitError`로 전달한다. 이 오류와 취소 오류가 함께 있어도 saved=null, 확정 건수 전부 null, commitOutcome=UNKNOWN으로 기록하고 저장을 재시도하지 않는다. 확정 응답 유실 뒤 실제 DB에는 저장된 상태와 다음 실행의 UNCHANGED 및 대기 보존을 실제 DB에서 확인했다. 추가 연결 장애와 로그 고장 조합은 Step 13에서 이어서 검증한다.
- 이전 즉시 공개 경로의 `PoliciesWriteService`와 `refreshPolicies()`를 제거했다. 서버 저장 입력 타입은 `policy-write.types.ts`로 옮기고 모듈 등록과 참조를 갱신했다. 공개본 bulk upsert는 테스트 초기 상태 준비에만 사용하며 실행 중인 수집 경로에서는 호출하지 않는다.
- 기존 수집 성공과 실패, 파일 로그, 잠금, 저장 준비와 묶음 저장 및 DB 재시도, 독립 CLI 테스트를 새 기대값으로 갱신했다. 원본과 검수 테이블을 포함한 임시 스키마를 사용하고 잘못된 기존 공개 샘플 해시는 실제 원문 해시로 교체했다. 실패 전후에는 원본과 후보, 공개 행 전체를 비교한다. 테스트 helper는 임시 스키마를 확인하고 외부 API는 fixture로 대체한다.
- 이전 저장 서비스 단위 테스트 48개는 중복 분류와 이전 저장 준비 검증을 전용 `policy-collection.spec.ts` 34개와 검수 판단 테스트로 통합하고 새 저장 서비스 경계 테스트 28개로 갱신했다. 기존 실제 직렬화 충돌과 교착, 연결 종료, 2,000번째 원본 CHECK 실패 및 앞 묶음 취소 시나리오는 새 저장 경로로 옮겨 유지했다. 새 CLI의 이관 동일 자료와 NULL 및 0 조회수, 정상 0건 누락, 신규 및 변경 후보와 공개 분리, COMMIT 결과 불명 및 재실행, 비밀값 비노출도 검증했다.
- 독립 CLI 두 개의 종료 코드 2, COMMIT 전 강제 종료 후 재실행, 실제 검색 API가 수집 중과 확정 후에도 승인 전 본문을 유지하는 것을 확인했다. T2-03~05·13~14·18과 T2-44의 이번 연결 및 결과 기록 기준을 검증했으며 정기 스케줄과 관리자 승인은 각 후속 Step 범위다.

### 검증

```sh
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
node /tmp/mvp2-step11-verify.cjs before
node /tmp/mvp2-step11-verify.cjs focused
node /tmp/mvp2-step11-verify.cjs full
node /tmp/mvp2-step11-verify.cjs after
docker compose -p youth-kkultong -f compose.yaml -f compose.local.yaml ps -a
git diff --check
```

- 전체 타입 검사와 shared/API 빌드, diff 검사를 통과했다. 수집과 저장 및 CLI 중심 **13개 스위트 144개 테스트**, 전체 API/DB **60개 스위트 1,801개 테스트**가 통과했으며 실패와 건너뜀은 0건이다. 이전 전체 1,816개에서 이전 서비스 단위 테스트 20개를 통합하고 새 시나리오 5개를 추가한 결과다. 분류와 검수 판단의 기존 전용 테스트도 모두 통과했다.
- 검증 실행기는 `.env`의 비밀값을 출력하지 않고 로컬 DB URL을 구성한다. 결과와 가린 출력은 `/tmp/mvp2-step11-{focused,full}-results.json`, `/tmp/mvp2-step11-{focused,full}-output.log`에 보관했다.
- 공개 정책 3,390건, 원본 3,390건, 검수 0건, 지역 537개, Migration 3개와 각 테이블 전체 행 체크섬이 검증 전후 동일하다. 공개 정책 체크섬은 `46a965ded0407e47a7af9816cd3e7b6e`이며 잔여 테스트 임시 스키마는 0개다. 전후 자료는 `/tmp/mvp2-step11-before.json`, `/tmp/mvp2-step11-after.json`에 있다.
- 공개 API 계약, DB 스키마, 의존성, 환경변수와 웹 화면은 변경하지 않았다. PLAN과 SUMMARY를 현재 상태로 갱신했으며 SPEC 의미 변경은 없다. 웹 화면 변경이 없어 브라우저 전체 E2E와 컨테이너 재빌드는 반복하지 않았다. 기존 DB는 healthy이며 착수 시 중지되어 있던 웹과 API는 그대로 유지했다. 외부 API는 격리 테스트 자료로 대체했으며 실제 온통청년 수집은 실행하지 않았다.

Step 11 핵심 읽는 순서: `import-policies.ts` → `ingestion.service.ts`의 `importPolicies()` → `policy-collection-write.service.ts`의 `saveCollection()` → `ingestion-log.service.ts` → CLI와 수집 통합 테스트. 미해결 실패는 없다. 2026-11-01 사용자 요청으로 Step 11 코드와 테스트, 문서를 커밋에 포함했다. 다음 작업은 Step 12다.

## 17. Step 12 수집 저장 실패와 재시도 검증 (2026-11-01)

AGENT_RULES → PLAN Step 12 → SPEC 5.3~5.5와 T2-21~22 → Step 10~11 완료 기록 → 실제 수집 저장 서비스와 저장 및 재시도 테스트를 확인했다. 기존 서비스가 명세를 충족해 실행 코드는 유지하고 실제 PostgreSQL 통합 테스트 두 파일을 보강했다.

- `policy-collection-write.integration.spec.ts`: 격리 스키마의 마지막 공개 행에 테스트용 CHECK 제약을 추가해 세 번째 조회수 묶음에서 실제 `23514` 오류를 발생시킨다. 같은 트랜잭션에서 원본 403건, 대기 생성 402건과 기존 대기 대체 401건, 누락 횟수 증가와 앞 두 묶음의 공개 조회수 400건 갱신이 진행된 것을 확인한다. 별도 연결에서는 확정 전 상태를 유지하고 오류 후에는 세 테이블 전체 행이 실행 전과 일치한다. 트랜잭션 시작과 취소는 각 한 번이며 COMMIT과 자동 재시도는 없다. 제약은 테스트 후 제거한다. 기존 2,000번째 원본의 CHECK 실패 검증도 유지했다.
- `policy-storage-retry.integration.spec.ts`: 별도 연결의 원본 잠금 순서를 뒤집어 실제 `40P01` 교착을 재현한다. 경쟁 연결이 확정한 최신 원본과 해시를 재시도에서 읽어 수집 판정을 UNCHANGED 2건으로 다시 계산하고, 이전 대기 두 건을 대체한 뒤 최신 해시의 후보 두 건만 남긴다.
- 실제 `40001`은 테스트 연결의 격리 수준을 REPEATABLE READ로 높인 뒤 별도 연결에서 공개본을 갱신해 재현한다. 기존 공개 기준 재조회 검증에 더해, 첫 시도의 전체 취소 후 별도 연결이 원본 B와 공개 기준 C의 후보를 확정한 경우를 추가했다. 재시도 시 최신 원본으로 UNCHANGED를 판정하고 최신 대기는 유지하며 최신 거절 이력에는 후보를 만들지 않는다. 두 경우 모두 공개본과 대기 및 거절 이력을 다시 조회하고, 확정된 검수 전체 행과 첫 수집 시각을 보존한다. 취소된 시도의 누락 횟수는 합산되지 않는다. 이 설정과 직접 상태 준비는 격리 테스트에만 적용하며 실제 서비스의 READ COMMITTED와 수집 잠금 규칙은 유지한다.
- 최대 시도 횟수는 DB의 `RAISE EXCEPTION`으로 `40P01`과 `40001`을 각 두 번 반환해 검증한다. 원본과 누락, 후보 생성 및 대체, 공개 조회수까지 쓴 후 두 시도 모두 취소되고 세 테이블 전체 행이 보존된다. 최초 포함 두 번에서 멈추며 COMMIT은 없다. 반복 한도 검증의 오류 주입과 위 실제 경쟁에 의한 충돌 재현을 구분한다.
- 기존 단위 테스트의 재시도 제외 코드와 COMMIT 및 롤백 경계, 실제 DB의 충돌 후 연결 종료 시 새 연결로 재시도하지 않는 검증도 함께 통과했다. T2-21~22를 충족하며 로그와 연결 장애 조합은 Step 13 범위로 남긴다.

### 검증

```sh
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
node /tmp/mvp2-step12-verify.cjs before
node /tmp/mvp2-step12-verify.cjs focused
node /tmp/mvp2-step12-verify.cjs full
node /tmp/mvp2-step12-verify.cjs after
docker compose -p youth-kkultong -f compose.yaml -f compose.local.yaml ps -a
git diff --check
```

- 전체 타입 검사와 shared/API 빌드, diff 검사를 통과했다. 전체 API/DB **60개 스위트 1,804개 테스트**, 최종 테스트 코드 정리 후 대상 **4개 스위트 65개 테스트**가 통과했다. 실패와 건너뜀은 0건이며, 기존 1,801개에서 재시도 시 최신 대기와 거절 이력 두 경우 및 직렬화 오류 반복 한도 한 경우를 추가했다. 전체 회귀에는 실제 PostgreSQL과 HTTP, 독립 CLI를 포함한다.
- 초기 타입 검사에서 테스트의 원문 타입과 TypeORM의 재귀적 JSON 갱신 타입 오류를 발견해 수정했다. 교착을 준비하는 원본 갱신은 매개변수 SQL로 정리했고 최종 전체 타입 검사와 관련 테스트를 다시 통과했다.
- 검증 실행기는 `.env`의 비밀값을 출력하지 않고 메모리에서 로컬 DB URL을 구성한다. 결과와 가린 출력은 `/tmp/mvp2-step12-{focused,full}-results.json`, `/tmp/mvp2-step12-{focused,full}-output.log`에 보관했다.
- 공개 정책 3,390건, 원본 3,390건, 검수 0건, 지역 537개, Migration 3개와 각 테이블 전체 행 체크섬이 검증 전후 동일하다. 공개 정책 체크섬은 `46a965ded0407e47a7af9816cd3e7b6e`이며 잔여 테스트 임시 스키마는 0개다. 전후 기록은 `/tmp/mvp2-step12-before.json`, `/tmp/mvp2-step12-after.json`에 있다.
- 착수 시 DB와 웹, API가 중지되어 있어 기존 볼륨을 유지한 채 DB만 시작했고 현재 healthy다. 웹과 API의 중지 상태는 유지했다. 공개 API 계약, 운영 DB 스키마와 Migration, 의존성, 환경변수, 웹 화면 변경은 없다. 브라우저 E2E와 컨테이너 재빌드는 수행하지 않았고 실제 온통청년 수집도 실행하지 않았다. PLAN Step 12와 SUMMARY만 현재 상태로 갱신했으며 SPEC 의미 변경은 없다.

Step 12 핵심 읽는 순서: `policy-collection-write.service.ts`의 `saveCollection()`과 `saveTransaction()` → `policy-collection-write.integration.spec.ts`의 세 번째 조회수 묶음 CHECK 실패 → `policy-storage-retry.integration.spec.ts`의 실제 교착과 직렬화 충돌, 최신 이력 재조회 및 두 번 실패. 미해결 실패는 없다. 다음 작업은 Step 13이다.

2026-11-01 사용자 요청으로 Step 12 테스트와 검증 문서를 커밋에 포함하고 Step 13~14를 이어서 진행한다.


## 18. Step 13 수집 로그와 연결 장애, 종료 정리 검증 (2026-11-01)

사용자 요청에 따라 Step 12 커밋 `aee50f4` 이후 Step 13~14를 연속 진행한다. PLAN Step 13과 SPEC 5.5, T2-44, 기존 수집 및 로그 서비스와 잠금 코드, 파일 로그와 CLI 통합 테스트를 대조했다. 실제 장애 검증을 보강했고 실행 코드는 기존 명세를 충족해 유지했다.

- `ingestion-run.integration.spec.ts`에서 PAGE_ATTEMPT와 SAVE_ATTEMPT, WORK_FINISHED와 RUN_FINISHED의 파일 및 기본 로그 이중 실패를 검증한다. 저장 전 실패는 saved=false와 확정 건수 0, 저장 후 실패는 saved=true와 확정 건수를 유지하며 COMMIT은 최대 한 번이다. 모든 경우 수집 연결을 반환하고 다른 연결에서 잠금을 재획득한다. 이후 전체 수집도 성공하고 이미 확정된 후보 전체 행은 바뀌지 않는다.
- 테스트가 확보한 수집 전용 PID만 `pg_terminate_backend()`로 종료하고 클라이언트의 실제 오류 통지를 기다린다. 저장 중 연결 종료는 NOT_COMMITTED와 건수 0, COMMIT 호출 시 연결 종료는 UNKNOWN과 모든 확정 건수 NULL, COMMIT 성공을 확인한 뒤 연결 종료는 COMMITTED와 확정 건수를 유지한다. 저장 중과 COMMIT 전 종료는 세 테이블 전체 행이 실행 전으로 돌아온다. 연결을 잃은 실행은 새 연결로 저장을 재시도하지 않는다.
- 실제 COMMIT 반영과 미반영 각각에 대해 응답 유실과 WORK_FINISHED의 파일 및 기본 로그 이중 실패를 함께 재현했다. 최종 기록에 COMMIT_OUTCOME_UNKNOWN과 FILE_AND_FALLBACK_FAILED, 잠금 정리 실패 원인을 함께 보존하고 saved 및 확정 건수는 NULL로 남긴다. 실제 세션 종료로 잠금이 해제되고 다음 수집은 반영된 상태라면 UNCHANGED, 미반영 상태라면 NEW로 계산한다. 확정된 후보와 첫 수집 결과를 중복 생성하지 않는다.
- 기존 파일 실패 시 기본 Logger 대체 기록, 비밀값 비노출, 실제 CLI 종료 및 잠금 정리 테스트도 함께 통과했다. 임시 스키마와 파일, 해당 테스트의 연결만 사용했으며 운영 DB 세션 종료와 실제 외부 API 호출은 수행하지 않았다.

### 검증

```sh
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
node /tmp/mvp2-step13-verify.cjs before
node /tmp/mvp2-step13-verify.cjs focused
node /tmp/mvp2-step13-verify.cjs after
git diff --check
```

- 전체 타입 검사와 shared/API 빌드 통과. 수집 결과와 로그, 잠금 및 CLI **6개 스위트 71개 테스트 모두 통과**했으며 실패와 건너뜀은 0건이다. 기존 테스트 보강 외 실제 연결 종료 세 경우와 응답 유실 및 로그 실패 조합 두 경우를 추가했다. 전체 회귀는 이어지는 Step 14 변경까지 포함해 수행한다.
- 결과와 가린 출력은 `/tmp/mvp2-step13-focused-results.json`, `/tmp/mvp2-step13-focused-output.log`에 보관했다. 기존 공개 정책 3,390건, 원본 3,390건, 검수 0건, 지역 537개, Migration 3개와 전체 행 체크섬이 전후 동일하고 잔여 임시 스키마는 0개다. 전후 기록은 `/tmp/mvp2-step13-{before,after}.json`에 있다.
- API 계약과 운영 DB 스키마, Migration, 의존성, 환경변수, 웹 화면 변경은 없다. PLAN Step 13을 완료 표시했다. 미해결 실패는 없으며 다음 작업은 Step 14다.

Step 13 핵심 읽는 순서: `ingestion.service.ts`의 확정 상태와 최종 기록 → `ingestion-lock.service.ts`의 finally 정리 → `ingestion-run.integration.spec.ts`의 disconnect()와 로그 이중 실패, 연결 종료 및 응답 유실 테스트.

## 19. Step 14 동시 수집과 공개 조회 검증 (2026-11-01)

PLAN Step 14와 SPEC 5.4~5.5, T2-23과 T2-45, 기존 독립 CLI 프로세스 테스트와 테스트 전용 로더를 확인했다. 실제 CLI 진입점을 별도 Node 프로세스로 실행하고 외부 API만 fixture로 대체한다. 실행 코드는 기존 기준을 충족해 유지했다.

- `fixtures/ingestion-cli.preload.cjs`에 후보 저장 후 대기(REVIEW_PAUSE), DB 확정 직후 대기(COMMIT_PAUSE), API 403 실패(API_FAIL)를 추가했다. 임시 스키마 이름을 검사하고 각 자식 프로세스의 임시 로그 경로를 사용한다. 기존 API 대기와 원본 저장 후 대기도 유지하며 프로세스 간 IPC(진행 알림과 재개 신호)로 검증 시점을 맞춘다.
- `ingestion-cli-process.integration.spec.ts`에서 API 대기, 원본 저장 후, 후보 저장 후, COMMIT 직후의 네 지점마다 독립 CLI 두 개를 실행한다. 첫 CLI만 API를 한 번 호출하고 두 번째 CLI는 호출과 저장 없이 종료 코드 2와 확정 건수 0을 기록한다. 첫 CLI는 종료 코드 0과 확정된 신규/변경/누락, 후보 생성 및 공개 조회수 건수를 남긴다.
- API 대기와 원본 및 후보 저장 후에 SIGKILL로 종료하면 원본과 검수, 공개 정책의 전체 행이 실행 전과 일치한다. 다른 연결에서 잠금을 다시 획득한 뒤 다음 CLI가 정상 수집한다. COMMIT 직후 강제 종료하면 확정된 전체 행은 보존되고 다음 CLI는 UNCHANGED로 판단해 기존 후보 전체 행을 유지한다. 정상 완료된 수집마다 누락 횟수는 한 번씩 증가한다. 강제 종료된 프로세스에는 최종 로그가 없을 수 있음을 검증한다.
- API 403으로 종료 코드 1을 반환하는 경우에도 세 테이블 전체 행이 보존되고 다음 CLI가 정상 수집한다. 프로세스 종료와 무관하게 해당 테스트의 자식 프로세스와 임시 로그를 정리한다.
- 실제 NestJS HTTP 서버를 CLI와 별도 DB 연결로 시작하고, API 대기와 원본 및 후보 저장 후 각각 검색과 기존 정책 두 건의 상세를 조회한다. CLI를 재개하기 전에 기존 응답과 같은 본문을 반환하고, 잠금 때문에 조회가 멈추면 응답 제한 시간으로 실패하도록 검증한다. 수집 확정 후에도 공개 UUID와 본문은 그대로이며 조회수만 최신 값이다. 미승인 신규 원본 UUID의 상세는 404이고 미승인 제목 검색은 빈 결과다. 읽기 API 호출 전후 DB 전체 행도 동일하다.
- T2-23의 독립 CLI 경쟁과 종료 복구, T2-45의 수집 중 공개 조회 범위를 충족했다. 스케줄러와 CLI 경쟁은 Step 36, 검수와 수집 경쟁 및 승인 중 공개 조회는 해당 검수 구현과 후속 검증 범위에 유지한다.

### 검증

```sh
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
node /tmp/mvp2-step14-verify.cjs before
node /tmp/mvp2-step14-verify.cjs focused
node /tmp/mvp2-step14-verify.cjs full
node /tmp/mvp2-step14-verify.cjs after
docker compose -p youth-kkultong -f compose.yaml -f compose.local.yaml ps -a
git diff --check
```

- 전체 타입 검사와 shared/API 빌드, diff 검사 통과. Step 14 대상 **4개 스위트 85개 테스트**, Step 13~14 최종 변경을 포함한 전체 API/DB **60개 스위트 1,817개 테스트 모두 통과**했다. 실패와 건너뜀은 0건이다. Step 12의 1,804개에서 Step 13 연결 장애 조합 5개와 Step 14 독립 CLI 시나리오 8개를 추가했다. 독립 CLI 파일 자체는 기존 4개에서 12개 테스트가 됐다.
- 검증 실행기는 `.env`를 메모리에서 읽어 로컬 DB URL을 구성하고 비밀값을 출력하지 않는다. 결과와 가린 출력은 `/tmp/mvp2-step14-{focused,full}-results.json`, `/tmp/mvp2-step14-{focused,full}-output.log`에 보관했다. Step 13 대상 검증 기록은 18절을 따른다.
- 공개 정책 3,390건, 원본 3,390건, 검수 0건, 지역 537개, Migration 3개와 모든 테이블 전체 행 체크섬이 검증 전후 동일하다. 공개 정책 체크섬은 `46a965ded0407e47a7af9816cd3e7b6e`이며 잔여 임시 테스트 스키마는 0개다. 전후 기록은 `/tmp/mvp2-step14-{before,after}.json`에 있다.
- DB는 healthy이며 웹과 API의 기존 중지 상태를 유지했다. 테스트 HTTP 서버와 CLI만 별도로 실행하고 정리했다. API 계약, 운영 DB 스키마, Migration, 의존성, 환경변수, 웹 화면 변경은 없다. 브라우저 E2E와 컨테이너 재빌드, 실제 온통청년 수집은 수행하지 않았다. PLAN Step 14 완료와 SUMMARY를 갱신했으며 SPEC 의미 변경은 없다.

Step 14 핵심 읽는 순서: `fixtures/ingestion-cli.preload.cjs`의 진행 제어 → `ingestion-cli-process.integration.spec.ts`의 startCli()와 state()/expectCollected() → 잠금 경쟁과 강제 종료 복구 → 검색 및 상세 조회 시나리오. 미해결 실패는 없다. 사용자 요청 범위인 Step 14에서 중단하며 다음 작업은 Step 15다.

## 20. Step 15 관리자 자격 설정과 비밀번호 검증 (2026-11-01)

AGENT_RULES → PLAN Step 15 → SPEC 7.1~7.2와 T2-36·40 → Step 14 완료 기록 → 공통 환경 설정, HTTP 및 수집 CLI 진입점, shared 로그인 검증과 관련 테스트를 확인했다. 문서와 실제 코드의 충돌은 없다.

- `modules/admin/admin-credentials.ts`에 공백 없는 1~64자 관리자 식별자와 비밀번호 해시의 명시적 설정 검증을 추가했다. 오류에는 설정 항목명과 안전한 설명만 포함한다. 공통 환경 설정과 AppModule은 유지하므로 수집·Migration·시드 CLI에 관리자 자격이 요구되지 않는다. HTTP 시작점에서 필수 설정을 연결하는 작업은 Step 17 범위다.
- `admin-credentials.ts`의 해시 생성과 로그인 확인은 Node 내장 비동기 scrypt(N=16384, r=8, p=1, 무작위 salt 16바이트, key 64바이트)를 사용한다. 저장 형식의 비용과 전체 길이, 표준 base64 및 디코딩 길이를 검사한다. 비밀번호는 1~256자이며 공백을 보존한다. 계산 키를 고정 길이 timingSafeEqual로 비교한 뒤 임시 키 버퍼를 지운다.
- `AdminCredentialsService.authenticate()`는 계정 불일치에도 비밀번호 계산을 수행한다. 잘못된 계정과 비밀번호는 동일한 401 `ADMIN_UNAUTHORIZED` 및 `관리자 인증이 필요합니다.` 예외를 반환한다. 성공 시 관리자 식별자만 반환한다. 쿠키, Guard, HTTP 오류 필터 연결과 로그인 API는 Step 16~18에서 진행한다.
- `prepare-admin-password.ts`는 표준 입력만으로 비밀번호를 받아 새 파일에 해시를 저장한다. 화면에 비밀번호나 해시를 출력하지 않고, 파일은 소유자만 읽고 쓸 수 있는 권한 600으로 생성한다. 기존 파일과 심볼릭 링크를 덮어쓰지 않는다. 입력 바이트 수와 UTF-8 형식을 검사하고 입력 버퍼를 정리한다. CLI 오류는 원문이나 경로가 없는 고정 문구로 출력한다.
- `admin-credentials.spec.ts`는 설정 누락과 형식 오류, 비용 변경 및 비표준 base64, 독립적으로 만든 scrypt 벡터, 계정 불일치 시 실제 scrypt와 64바이트 비교 실행, 동일 인증 오류, 한글 및 공백과 길이 경계, 무작위 salt 및 내부 계산 오류를 확인한다. `prepare-admin-password.spec.ts`는 파일 권한과 덮어쓰기 방지, 입력 실패 및 UTF-8 경계와 실제 CLI의 표준 출력 및 오류 출력 비노출을 확인한다.

### 비밀번호 해시 준비 방법

프로젝트 루트의 Bash에서 다음 명령으로 준비한다. 비밀번호는 숨김 프롬프트에 직접 입력하며 명령행 인자나 환경변수로 전달하지 않는다. `printf`는 줄바꿈을 추가하지 않아 비밀번호의 앞뒤 공백이 그대로 유지된다.

```bash
npm run build --workspace apps/api
(
  set +x
  IFS= read -r -s -p '관리자 비밀번호: ' admin_password
  printf '\n' >&2
  printf '%s' "$admin_password" | node apps/api/dist/prepare-admin-password.js /tmp/youth-admin-password.hash
  unset admin_password
)
```

성공 시 출력 없이 `/tmp/youth-admin-password.hash`에 해시 한 줄이 저장된다. 기존 파일이 있으면 다른 새 경로를 사용한다. 파일은 로컬 편집기로 열어 `ADMIN_PASSWORD_HASH` 설정을 준비하며 로그나 Git에 복사하지 않는다. `.env`에 넣을 때는 `$`를 포함한 해시 전체를 작은따옴표로 감싼다. 설정이 끝나면 임시 파일을 삭제한다. `.env.example` 및 Compose 전달과 HTTP 기동 검증은 계획대로 Step 17에서 연결한다. 이번 검증에서는 테스트 전용 비밀번호만 사용했고 실제 관리자 자격과 로컬 `.env`는 변경하지 않았다.

### 검증

```sh
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
npm test --workspace apps/api -- --runTestsByPath test/admin-credentials.spec.ts test/prepare-admin-password.spec.ts test/environment.spec.ts test/admin-validation.spec.ts
node /tmp/mvp2-step15-verify.cjs before
node /tmp/mvp2-step15-verify.cjs full
node /tmp/mvp2-step15-verify.cjs after
git diff --check
```

- 전체 타입 검사와 shared/API 빌드, diff 검사 통과. 초기 대상 4개 스위트 311개 테스트가 통과했고, 실제 CLI 비노출 두 경우를 추가한 최종 전체 API/DB 회귀는 **62개 스위트 1,869개 테스트 모두 통과**했다. 실패와 건너뜀은 0건이며 이전 1,817개에서 이번 자격 및 해시 준비 검증 52개를 추가했다. 기존 독립 수집 CLI 및 Migration·시드 관련 테스트도 전체 회귀에 포함했다.
- 검증 실행기는 비밀값을 출력하지 않고 로컬 DB URL을 구성한다. 전체 결과와 가린 출력은 `/tmp/mvp2-step15-full-results.json`, `/tmp/mvp2-step15-full-output.log`에 보관했다. 공개 정책 3,390건, 원본 3,390건, 검수 0건, 지역 537개, Migration 3개와 각 테이블 전체 행 체크섬이 검증 전후 동일하며 잔여 테스트 스키마는 0개다. 전후 기록은 `/tmp/mvp2-step15-{before,after}.json`에 있다.
- 공개 API 계약, 운영 DB 스키마와 Migration, 의존성, 공통 환경 설정, Compose와 웹 화면 변경은 없다. DB는 healthy이며 기존 웹과 API의 중지 상태는 유지했다. 브라우저 E2E와 컨테이너 재빌드, 실제 온통청년 수집은 수행하지 않았다. SPEC 의미 변경 없이 PLAN Step 15와 SUMMARY를 갱신했다.

Step 15 핵심 읽는 순서: `admin-credentials.ts`의 parseAdminCredentials() → authenticate() → createAdminPasswordHash()와 공통 deriveKey() → `prepare-admin-password.ts`의 안전한 파일 생성 → 두 신규 테스트 파일. 미해결 실패는 없다. 다음 작업은 Step 16이며 이번 요청 범위에서 중단한다.

사용자 검수 후 위 세 실행 코드 파일의 주석을 입력 → 처리 → 결과 중심으로 정리했다. 입력 묶음(chunk), 누적 바이트 수(size), 전체 입력 바이트(bytes)와 문자열 변환 및 파일 저장 흐름을 명시했다. 동작 변경 없이 주석과 공백만 수정했으며 `git diff --check`를 통과했다. 테스트는 재실행하지 않았다.

사용자 요청으로 Step 15 코드를 읽기 쉽게 정리했다. 설정 검사, 로그인 확인, 초기 해시 생성을 `admin-credentials.ts` 한 파일로 모으고 `admin-password.ts`는 제거했다. 한 줄 길이 검사와 한 번만 사용하는 해시 해석 및 비밀번호 비교 함수를 호출 위치에 합쳤다. 해시 생성과 로그인에서 함께 쓰는 비동기 scrypt 계산만 `deriveKey()`로 유지한다. 초기 준비 CLI는 별도 실행 도구이므로 기존 파일을 유지한다. 테스트도 내부 보조 함수 대신 설정 검사와 실제 인증 결과를 확인하도록 수정했다. 인증 규칙, API 및 DB 계약 변경은 없다.

리팩터링 검증: `npm run build --workspace apps/api`, `npm run typecheck --workspace apps/api`, `git diff --check` 통과. 관리자 자격, 해시 준비, 공통 환경 설정 및 관리자 입력 검증의 4개 스위트 313개 테스트 모두 통과했다. 최초 CLI 테스트는 샌드박스의 자식 프로세스 생성 제한(`spawnSync EPERM`)으로 실패해 실행 가능한 환경에서 같은 테스트를 다시 수행했다. 이번 내부 정리는 DB 접근과 웹 화면 변경이 없어 전체 DB 회귀와 브라우저 검증을 반복하지 않았다.

## 21. Step 16 관리자 인증 쿠키 (2026-11-02)

사용자 요청에 따라 Step 15의 검수와 코드 정리를 커밋 `109bb3a`(`feat: 관리자 자격 검증과 비밀번호 해시 준비 구현`)에 포함한 뒤 Step 16을 진행했다. AGENT_RULES → PLAN Step 16 → SPEC 7.1~7.2 및 T2-36~37 → Step 15 완료 기록 → 자격 검증과 공통 환경 설정 및 API 계약을 대조했다. 충돌은 없다.

- `modules/admin/admin-cookie.ts` 한 파일에 설정 확인과 쿠키 발급, 검증, 삭제를 모았다. `parseAdminCookieSettings()`는 표준 base64로 저장된 32바이트 이상 서명 키와 웹 출처를 확인한다. 웹 출처 기본은 `http://localhost:3000`이고 HTTPS에는 Secure, localhost 및 127.0.0.1의 HTTP에는 Secure 미적용으로 결정한다. 오류에는 비밀값과 출처 원문을 포함하지 않는다. 필수 설정의 HTTP 기동 연결은 Step 17에서 진행한다.
- `AdminCookieService.issue()`는 관리자 식별자와 발급 및 만료 Unix 초만 payload에 넣고, 인코딩한 payload 전체에 HMAC-SHA256 서명을 붙인다. `youth_admin_auth`의 Set-Cookie 문자열과 공용 `AdminIdentity`를 반환한다. 쿠키는 HttpOnly, SameSite=Strict, Path=/api/v1/admin, Max-Age=28800을 사용하며 출처에 따라 Secure를 적용한다.
- `verify()`는 최대 2048자와 두 조각의 base64url 형식을 확인하고, 고정 길이 서명을 timingSafeEqual로 비교한 후 payload를 해석한다. UTF-8과 JSON, 정확한 세 필드 및 관리자 식별자, 정수 시간과 정확한 8시간 간격, `iat <= 현재 시각 < exp`를 확인한다. 형식 오류와 변조 및 만료는 Step 15와 같은 401 `ADMIN_UNAUTHORIZED` 및 안전한 메시지로 처리한다. 조회로 만료가 연장되지 않는다.
- `clear()`는 발급과 같은 이름 및 Path와 보안 속성으로 Max-Age=0인 삭제 쿠키를 반환한다. HTTP 로그인 및 Guard 연결, 실제 브라우저 쿠키 처리는 Step 17~19 범위다.
- 신규 `admin-cookie.spec.ts`에서 설정 누락 및 오류, 출처와 NODE_ENV 조합, 독립 HMAC 서명 대조, 필드 및 관리자 오류, 서명 변조와 키 교체, 비표준 base64url 및 잘못된 UTF-8/JSON, 2048자 경계, 발급 직전과 발급 초 및 만료 직전과 만료 초, 발급과 삭제 속성 일치를 검증했다.

### 검증

```sh
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
npm run typecheck --workspace apps/api
npm test --workspace apps/api -- --runTestsByPath test/admin-cookie.spec.ts test/admin-credentials.spec.ts test/prepare-admin-password.spec.ts test/environment.spec.ts test/admin-validation.spec.ts
git diff --check
```

- 전체 shared/API/web 타입 검사와 shared/API 빌드 통과. 최종 관련 **5개 스위트 383개 테스트 모두 통과**, 실패와 건너뜀은 0건이다. 신규 쿠키 테스트 70개와 기존 자격, 실제 해시 준비 CLI, 환경 및 관리자 입력 검증을 포함한다. 실제 CLI 자식 프로세스 실행이 가능한 환경에서 최종 대상 테스트를 수행했다.
- DB 접근과 공개 API 및 웹 화면 변경이 없어 전체 DB 회귀와 브라우저 E2E, 컨테이너 재빌드를 반복하지 않았다. DB 데이터와 스키마, 의존성, `.env` 및 Compose, AppModule과 공통 환경 검증은 변경하지 않았다. 실제 관리자 비밀값을 만들거나 기록하지 않았다. SPEC 의미 변경 없이 PLAN과 SUMMARY를 완료 상태로 갱신했다.

Step 16 핵심 읽는 순서: `admin-cookie.ts`의 parseAdminCookieSettings() → issue() → verify() → clear() → `admin-cookie.spec.ts`. 미해결 실패는 없다. 다음 작업은 Step 17이며 이번 요청 범위에서 중단한다.

## 22. Step 17 관리자 서버 권한과 요청 출처 검사 (2026-11-02)

사용자 검수 후 Step 16을 `04133b8`(`feat: 관리자 인증 쿠키 발급과 검증 구현`)로 커밋하고 Step 17을 진행했다. AGENT_RULES → PLAN Step 17 → SPEC 4.5, 7.1~7.2, T2-36·38·40 → 이전 완료 기록 → HTTP 및 CLI 진입점, 공통 환경 설정과 오류 필터, 기존 요청 보호 및 인증 코드를 대조했다. 계획과 실제 코드의 충돌은 없다.

- `AdminModule.forHttp()`는 자격 및 쿠키 설정을 검사하고 두 인증 서비스와 전역 `AdminGuard`를 등록한다. `main.ts`의 `createApplication()`에서 기존 AppModule에 HTTP 전용 모듈만 추가하므로 설정 오류는 DB 초기화 및 listen 전에 실패한다. HTTP 공통 설정 중 실패하면 앱을 닫는다. 기존 수집 CLI는 AppModule을 그대로 사용하고 Migration 및 시드는 공통 DB 설정만 사용한다. 공통 환경 검증과 모듈 생성자에 관리자 필수값을 강제하지 않는다.
- `common/environment.ts`의 `.env` 및 실행 환경 읽기를 `loadEnvironmentValues()`로 분리해 HTTP 전용 설정도 같은 우선순위로 읽는다. 기존 `loadEnvironment()`의 검증 및 시간대 설정은 유지한다. 기존 HTTP 통합 테스트에는 테스트 전용 합성 자격을 명시적으로 전달하며 실제 로컬 `.env`를 수정하지 않는다.
- `AdminGuard`는 매칭된 관리자 라우트에서 인증 쿠키를 검사하고 `request.admin`에 관리자 식별자와 만료 시각을 전달한다. 로그인 POST만 쿠키 검사를 생략하며 GET을 포함한 다른 관리자 경로에는 인증이 필요하다. 중복된 인증 쿠키는 거부한다. 상태 변경은 Origin이 설정과 정확히 일치해야 하며 Referer 및 전달 헤더로 보충하지 않는다. 인증은 검증 파이프와 컨트롤러의 데이터 접근 전에 실행된다. 현재 관리자 경로가 아닌 공개 API에는 기존 동작을 유지한다.
- 공통 오류 필터는 명세의 관리자 전용 코드와 해당 HTTP 상태가 일치할 때만 코드 및 고정된 안전한 한국어 문구를 제공한다. 임의 예외 메시지는 응답으로 복사하지 않으며 기존 400·500·503을 보존한다. 기존 본문 16KB, 압축 거부, no-store와 보안 헤더 및 공개 CORS 설정을 유지하고 관리자 POST에도 JSON 전용 검사를 적용했다. 호출 제한 영역 분리 및 로그인 추가 한도는 Step 18 범위다.
- `.env.example`과 Compose api 환경에 네 관리자 설정을 추가했다. 자격 세 항목은 Compose에서 빈 값도 전달하도록 하고 HTTP 기동에서만 필수 검사한다. ADMIN_WEB_ORIGIN 기본은 `http://localhost:3000`이다. 실제 관리자 계정과 비밀값을 생성하거나 `.env`에 저장하지 않았다. 이후 HTTP API 실행 전에는 관리자 자격 및 서명 키 설정이 필요하다. 해시 준비 방법은 20절을 따른다.
- `admin-access.spec.ts`의 테스트 전용 컨트롤러로 실제 HTTP Guard 등록, 인증 선검사, 정상 쿠키와 대소문자 및 끝 슬래시, 중복 쿠키, Origin 누락과 불일치, 로그인 예외 범위, JSON 및 크기 제한, 관리자 업무 오류 및 안전한 메시지와 기존 공개 보호를 확인했다. 실제 로그인·me·로그아웃 API는 Step 18에서 구현한다.
- `admin-cli.integration.spec.ts`는 관리자 네 설정을 빈 값으로 전달한 독립 프로세스에서 실제 Migration CLI를 실행해 격리 스키마에 Migration 3개를 적용하고, 실제 시드 CLI를 두 번 실행해 지역 537개 및 중복 없는 상태를 확인한다. 검증 로더는 테스트 이름의 격리 스키마만 허용한다. 기존 독립 수집 CLI 테스트도 네 관리자 값을 명시적으로 비워 정상 및 경쟁·실패·재실행을 검증했다. 모든 CLI는 기존 스케줄러 없는 경로를 유지한다.

### 검증

```sh
npm run build --workspace apps/api
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm test --workspace apps/api -- --runTestsByPath test/admin-access.spec.ts test/admin-cookie.spec.ts test/admin-credentials.spec.ts test/prepare-admin-password.spec.ts test/load-environment.spec.ts test/environment.spec.ts test/request-validation.spec.ts test/request-protection.spec.ts test/import-policies.spec.ts
ADMIN_USERNAME= ADMIN_PASSWORD_HASH= ADMIN_AUTH_SECRET= ADMIN_WEB_ORIGIN= docker compose -p youth-kkultong -f compose.yaml -f compose.local.yaml config --quiet
node /tmp/mvp2-step17-verify.cjs before
node /tmp/mvp2-step17-verify.cjs full
node /tmp/mvp2-step17-verify.cjs after
git diff --check
```

- shared/API 빌드 및 전체 shared/API/web 타입 검사, diff 검사 통과. 대상 **9개 스위트 240개 테스트**, 전체 API/DB **65개 스위트 1,975개 테스트 모두 통과**했다. 실패와 건너뜀은 0건이다. 이전 전체 검증 1,869개에 Step 16 쿠키 70개와 이번 HTTP 권한 및 설정 검사 35개, 실제 Migration 및 시드 CLI 1개를 추가했다. 전체 회귀에는 실제 HTTP와 PostgreSQL, 독립 수집 프로세스 및 CLI 복구를 포함한다.
- Compose 설정 검증은 네 관리자 설정을 비운 상태에서도 통과했다. 검증 결과와 비밀값을 가린 출력은 `/tmp/mvp2-step17-full-results.json`, `/tmp/mvp2-step17-full-output.log`에 있다. 공개 정책 3,390건, 원본 3,390건, 검수 0건, 지역 537개, Migration 3개와 각 테이블 전체 행 체크섬이 검증 전후 동일하다. 공개 정책 체크섬은 `46a965ded0407e47a7af9816cd3e7b6e`이며 잔여 테스트 스키마는 0개다. 전후 기록은 `/tmp/mvp2-step17-{before,after}.json`에 보관했다.
- 공개 API 계약, 운영 DB 스키마 및 Migration, 의존성과 웹 화면 변경은 없다. 기존 DB는 healthy이고 웹과 API의 중지 상태는 유지했다. 웹 변경이 없어 브라우저 E2E 및 컨테이너 재빌드는 수행하지 않았고 실제 온통청년 수집은 실행하지 않았다. SPEC 의미 변경 없이 PLAN과 SUMMARY를 완료 상태로 갱신했다.

Step 17 핵심 읽는 순서: `main.ts`의 createApplication() → `admin.module.ts`의 forHttp() → `admin.guard.ts` → `api-exception.filter.ts` → `admin-access.spec.ts`와 `admin-cli.integration.spec.ts`. 미해결 실패는 없다. 다음 작업은 Step 18이며 이번 요청 범위에서 중단한다.
