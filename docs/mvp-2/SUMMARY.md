# 청년꿀통(youth-kkultong) — MVP2 작업 결과

수정일: 2026-10-29 · 상태: Step 1~4 완료 · Step 5~41 미착수

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

- 로컬 DB는 Step 4 이관을 완료했다. 공개 정책 3,390건·원본 3,390건·검수 0건·지역 537개·Migration 3개이며 웹·API·DB는 healthy다. `http://localhost:3000/policies`에서 확인할 수 있다.
- 최신 이관 전 DB·로그 백업은 `backups/mvp2-step4-20261028225754/`에 보관했다. 새 수집 저장 흐름으로 전환하는 Step 11 전까지 기존 수동 수집 CLI 실행은 중단한다. 이후 실제 쓰기·운영 전환 전에는 해당 시점 백업을 다시 만든다.
- 외부 API 정확한 호출 한도·e003 원인·삭제/비공개 규약·지역과 실제 거주 자격 대응·0~0 연령 의미는 MVP1에서 이어지는 미확인 사항이다. 기존 보수적 판정과 실패 시 데이터 유지 규칙을 따른다.
- 프록시를 통한 접속 주소별 호출 제한 공유, 수동 백업의 보관 기한·외부 복제 등 기존 운영 한계는 유지된다. MVP2 한도 분리는 SPEC 7.2대로 구현하되 실제 사용자별 제한을 해결한 것으로 보고하지 않는다.
- 다음 요청 대상은 **Step 5: 수집 원본 조회·저장**이다. Step 4까지 완료했고 Step 5 이후 구현은 진행하지 않았다.

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
