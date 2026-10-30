# 청년꿀통(youth-kkultong) — MVP2 작업 결과

수정일: 2026-10-30 · 상태: Step 1~9 완료 · Step 10~41 미착수

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
- 최신 이관 전 DB·로그 백업은 `backups/mvp2-step4-20261028225754/`에 보관했다. 새 수집 저장 흐름으로 전환하는 Step 11 전까지 기존 수동 수집 CLI 실행은 중단한다. 이후 실제 쓰기·운영 전환 전에는 해당 시점 백업을 다시 만든다.
- 외부 API 정확한 호출 한도·e003 원인·삭제/비공개 규약·지역과 실제 거주 자격 대응·0~0 연령 의미는 MVP1에서 이어지는 미확인 사항이다. 기존 보수적 판정과 실패 시 데이터 유지 규칙을 따른다.
- 프록시를 통한 접속 주소별 호출 제한 공유, 수동 백업의 보관 기한·외부 복제 등 기존 운영 한계는 유지된다. MVP2 한도 분리는 SPEC 7.2대로 구현하되 실제 사용자별 제한을 해결한 것으로 보고하지 않는다.
- 다음 요청 대상은 **Step 10: 수집분 일괄 저장 연결**이다. Step 9까지 완료했고 Step 10 이후 구현은 진행하지 않았다.

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

Step 9 핵심 읽는 순서: `policy-review-decision.ts`의 입력과 반환 타입 → `decidePolicyReview()`의 판단 순서 → `policy-review-decision.spec.ts` → `policy-review-storage.integration.spec.ts`의 추가 시나리오. 미해결 실패는 없다. 다음은 Step 10 수집분 일괄 저장 연결이며 이번 변경사항은 검토를 위해 미커밋 상태로 둔다.
