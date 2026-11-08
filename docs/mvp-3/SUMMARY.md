# 청년꿀통(youth-kkultong) — MVP3 작업 결과

수정일: 2026-11-08, 상태: Step 1 완료, Step 2~35 미착수

## 1. Step 1 범위와 시작 상태

`AGENT_RULES.md` → PLAN Step 1 → SPEC 1장과 9장 및 관련 계약 → MVP2 완료 기록 → 실제 소스를 확인했다. 제품과 모듈 경계는 PRD와 ARCHITECTURE에 대조했다.

| 확인 대상 | 결과 |
| --- | --- |
| 기준 문서 | PRD v0.14, ARCHITECTURE v0.9, MVP3 SPEC v0.3, PLAN v0.2 |
| 선행 완료 | MVP2 PLAN Step 1~41과 전체 완료 기준이 모두 체크됨. SUMMARY 46~53절에서 최종 회귀, 실제 수집, 자동 수집 활성화와 별도 Cron 재현의 범위를 구분 |
| Git 시작 상태 | `8951a2c`, 변경 파일 없음 |
| 현재 구현 | MVP2의 검수, 수집, 인증과 웹이 존재. 중요도, 일괄 검수, `ingestion_runs`와 수집 운영 화면은 미구현 |
| 현재 실행 환경 | Node.js v24.18.0, npm 11.16.0, Docker 29.7.2. 기존 프로젝트의 웹, API와 PostgreSQL 컨테이너는 정지 상태 |
| 설계 대조 | 승인된 기능, API, DB 또는 모듈 책임을 바꿔야 하는 충돌은 발견하지 못함. 아래 차이는 PLAN에 이미 포함된 확장 작업 |

Step 1은 시작 상태의 대조와 검증이다. 제품 소스, 의존성, API, DB 스키마와 환경설정은 변경하지 않았다. 기존 컨테이너와 볼륨은 정지 상태를 유지하고 별도 테스트 환경을 사용했다. `SPEC_SUMMARY.md`는 없어 생성하지 않았다.

## 2. 실제 코드에서 재사용할 위치

별도 표기가 없는 API 경로는 `apps/api/src/` 기준이다.

| 역할 | 현재 위치와 유지 기준 |
| --- | --- |
| 원본 필드 비교 | `modules/policies/rules/reviews/policy-field-diff.ts`의 `calculatePolicyFieldDiff`. 최상위 `inqCnt` 제외, 필드 유무와 NULL 구분, 공백과 배열 순서 보존, 중첩 객체 키 정렬을 재사용 |
| 목록과 상세 | `modules/policies/repositories/policy-review.repository.ts`, `services/reviews/policy-reviews-read.service.ts`. 보관 당시 제목, 기준본과 변경본, 상세의 읽기 전용 REPEATABLE READ, `canReview` 조립을 유지 |
| 후보 생성과 검수 조건 | 같은 모듈의 `rules/reviews/policy-review-decision.ts`, `policy-review-eligibility.ts`. 공개본 일치와 거절 해시의 재검수 방지, 최신 원본 및 두 해시와 공개 UUID 검사를 유지 |
| 개별 승인과 거절 | `services/reviews/policy-review-approval.service.ts`, `policy-review-rejection.service.ts`와 Repository의 `findReviewForUpdate`. 원본 → 후보 → 공개본 잠금, 독립 트랜잭션, `40P01` 또는 `40001`만 한 번 재시도하는 진입점을 재사용 |
| 승인 공개와 조회수 | 승인 서비스와 `repositories/policy.repository.ts`. 승인 스냅샷의 구조, 해시와 출처 식별자 재검증, 기존 공개 UUID와 원본의 최신 조회수 보존 |
| 전체 수집 저장 | `services/collection/policy-collection-write.service.ts`의 `saveCollection`. 같은 QueryRunner에서 원본, 누락, 후보와 공개 조회수를 한 트랜잭션으로 반영. COMMIT 결과 불명은 `PolicyCollectionCommitError`로 전달 |
| 공통 수집과 상세 로그 | `modules/ingestion/services/ingestion.service.ts`, `ingestion-log.service.ts`와 `youth-center/`. 전체 페이지 검증, 변환, 내용 해시와 기존 JSONL의 실행 ID, 단계, 확정 건수 및 안전한 실패 코드 변환을 유지 |
| 중복 실행과 CLI/Cron | `services/ingestion-lock.service.ts`의 고정 키 `202610180001`, `services/policy-schedule.service.ts`, `ingestion-schedule.module.ts`, `cli/import-policies.ts`. 세션 잠금과 정리, 매일 04:00 한국 시간, HTTP 전용 스케줄 등록, CLI 종료 코드 0/1/2를 유지 |
| 인증과 요청 보호 | `modules/admin/guards/admin.guard.ts`, `services/admin-cookie.service.ts`, `admin.module.ts`, `main.ts`, `common/request-protection.ts`, `api-exception.filter.ts`. 서명과 만료 검사, HttpOnly 쿠키, POST Origin, 엄격한 JSON, 호출 제한과 안전한 오류 응답을 재사용 |
| 공용 계약 | `packages/shared/src/admin.ts`, `admin.schema.ts`, `index.ts`. UUID, 두 해시와 명시적 NULL, 사유 trim 후 1~1000자, 엄격한 query 검증을 재사용 |
| 관리자 웹 | `apps/web/app/admin/admin-session.tsx`, `reviews/page.tsx`, `reviews/[id]/`, `history/`, `missing/`. 기존 개별 검수, 응답 유실 후 GET 재조회, 안전한 텍스트와 HTTP(S) 링크 표시를 유지. `apps/web/next.config.ts`의 같은 출처 프록시를 재사용 |
| 공개 조회와 운영 | 공개 조회는 `policies`만 사용. `database/data-source.ts`의 자동 스키마 동기화 금지, Migration 3개, 기존 DB와 로그 볼륨 및 MVP2 OPERATIONS의 백업과 복원 절차를 유지 |

새 파일은 ARCHITECTURE 6장의 소유 모듈과 역할별 폴더에 배치한다. Policies는 검수와 정책 저장, Ingestion은 실행 기록과 복구, Admin은 HTTP 인증과 진입을 맡는다. 실행 증거는 같은 EntityManager를 받는 콜백으로 연결하고 Policies에서 Ingestion을 역참조하지 않는다.

## 3. 현재 동작과 후속 Step의 경계

| 현재 코드 | SPEC에 따른 확장 기준 | 담당 Step |
| --- | --- | --- |
| 필드 차이만 계산하고 분류 타입과 함수 없음 | 60개 필드와 최고 등급, 미분류 HIGH, NEW의 NULL, 손상된 기준본 경고를 순수 함수로 계산 | 2 |
| 목록은 COUNT와 페이지 SELECT, 최신 생성순. query limit은 1~50 허용 | 대기는 두 스냅샷 일괄 조회 후 중요도 필터, 세 정렬, total과 페이지 산출. 대기만 20/50/100, 기본 IMPORTANCE. 이력과 누락의 기존 계약 보존 | 3~4 |
| 웹은 제목, 유형과 10/20/50건, 메모리 상태 | 중요도, 정렬, 대기 기간, 초과 페이지 복구, 세션 탐색 조건 복원과 현재 페이지 선택 | 5~7, 13 |
| 인증 재확인 시 `checking`으로 바꾸고 보호 화면을 해제 | 최초 인증 보호는 유지하고 로그인 후 재확인은 화면과 메모리를 보존. 통신 오류와 실제 만료 구분 | 6 |
| 개별 승인과 거절만 제공, 모든 JSON 본문 한도 16KiB | 기존 서비스를 후보별 호출. 1~100건 입력, 부분 성공, 결과 불명과 현재 상태 재조회. 세 batch POST만 64KiB, 요청 대기와 업무 수명 분리 | 8~16 |
| 수집 실행 ID와 결과는 파일 로그에만 존재 | Ingestion 소유 실행 테이블 한 개와 안전한 공용 계약 추가. 기존 JSONL은 보존하며 과거 로그를 실행 행으로 이관하지 않음 | 17~19 |
| 저장 전 실행 증거 콜백, 잠금 소유 정보, 종료 연결점과 복구 없음 | 같은 저장 트랜잭션에 확정 증거, PID와 세션 시작 시각, 단계별 대기 상한과 연결 폐기, 실제 잠금에 근거한 중단 및 반영 상태 판정 | 20~24 |
| Admin HTTP 설정은 Policies만 가져오며 수집 조회 API 없음 | HTTP 전용 설정에서 Ingestion을 가져와 현재 상태, 기록 목록과 상세 조회 제공. 웹에 선택 기록과 인증 재확인 중 상태 유지 연결 | 25~28 |
| 수집 시작은 CLI/Cron만 가능 | 웹 requestId를 보관하고 접수 확정 후 202 반환. 같은 실행 ID, 응답 유실 재확인, 단일 잠금과 프로세스 내 실행 | 29~31 |
| MVP2의 백업과 운영 기록 보유 | MVP3 전체 회귀, 실제 웹 인수, 실행 테이블 포함 별도 복원, API와 CLI 동시 전환 후 최종 판정 | 32~35 |

기존 구현을 설명하는 기준은 MVP2 SPEC, 위 확장의 기능별 적용 기준은 MVP3 SPEC이다. 향후 요구사항을 현재 코드의 결함으로 간주하거나 Step 1에서 선행 구현하지 않았다.

## 4. 테스트 DB와 외부 응답 자료

- 운영 DB와 분리한 PostgreSQL `17.11-bookworm` 임시 컨테이너 `youth-mvp3-step1-db`를 생성하고 임의의 로컬 포트를 할당했다. 기존 테스트가 각자 만든 스키마, 별도 연결과 독립 CLI를 사용하며 실제 Migration을 적용한다. 테스트 키와 관리자 계정은 합성값이다.
- `apps/api/test/fixtures/youth-center-list.json`은 총 3,255건 중 첫 5건의 봉투와 최소 3개 필드를 담은 자료다. `youth-center-policy.json`은 21개 필드의 단일 정책이다. 이 두 자료만으로 전체 60개 필드를 검증했다고 간주하지 않는다.
- `docs/api-research/RESULT.md` 2장과 MVP3 SPEC 2.2절의 키는 각각 60개이고 누락, 중복과 추가 키가 모두 0개다. 실제 MVP2 수집 보관본 3,860건의 필드 합집합도 60개이고 분류표 밖 키는 0개다. 이는 자료 준비 확인이며 아직 없는 중요도 구현의 T3-01 통과 근거는 아니다.
- 원래 실제 호출 보관본 `backups/mvp2-step40-1793863062614-437079bf/`의 원문 SHA-256은 `7530e71e87c0d641fd70083aeec68fcd891e8f9b0a29a7097129c5e7115bfcfd`다. 이 보관본의 전체 결과는 후속 검수 실패로 **FAIL을 유지**한다. 같은 원문을 재입력한 최종 검수 보관본 `backups/mvp2-step40-1793863959754-2172ecfe/`의 **PASS와 구분**했다. 각 보관본의 SHA256SUMS 7개 파일, 합계 14개를 현재 다시 대조해 모두 일치했다.
- `ingestion-cli.preload.cjs`, `policy-schedule.integration.spec.ts`와 수집 통합 테스트의 고정 응답 및 모의 HTTP를 재사용할 수 있다. 이번 검증은 실제 온통청년을 새로 호출하지 않았다. 조사 자료와 `backups/`는 Git 제외 로컬 자료이므로 다른 환경에서는 별도 준비가 필요하다.

자료 대조의 기계 판독 결과는 `/tmp/mvp3-step1-materials.json`에 보관했다. 실제 외부 호출과 저장 원문의 재입력, 새 고정 자료 테스트의 결과는 계속 구분한다.

## 5. 이번 Step의 실제 검증

| 검증 | 결과와 범위 |
| --- | --- |
| 전체 타입 검사 | `npm run typecheck` 통과. shared, API 테스트와 웹 포함 |
| API 빌드 | `npm run build --workspace apps/api` 통과. shared 선행 빌드 포함 |
| 전체 API와 DB 회귀 | `npm test` 통과. **79개 스위트, 2,369개 테스트**, 실패와 건너뜀 0건, 약 182초. 실제 PostgreSQL, 검수 경쟁과 재시도, 공개 격리, 인증과 요청 보호, 실제 Next.js 프록시, 독립 CLI와 Cron 검증 포함 |
| 실제 관리자 웹 핵심 흐름 | `admin-flow.live.mjs`의 **5개 통과**. 격리 DB, 실제 NestJS와 별도 프로덕션 Next.js 프록시에서 승인과 거절, 공개 UUID와 최신 조회수, 재수집 충돌, 만료와 모바일 오류 복구 확인 |
| COMMIT 응답 유실 웹 복구 | `admin-recovery.live.mjs`의 **2개 통과**. 별도 Next.js 웹과 실제 격리 API에서 승인 또는 거절 COMMIT 뒤 응답을 끊어도 POST는 한 번만 보내고 GET으로 확정 상태와 이력을 확인. 핵심 흐름과 합계 **7개 고유 시나리오 확인** |
| 자료 무결성 | 위 60개 필드 대조와 보관본 14개 파일 SHA-256 일치 |
| 자원 정리와 문서 검사 | 잔여 테스트 스키마, Advisory Lock과 별도 DB 각각 0개. 테스트 컨테이너와 전용 볼륨 제거, 임시 프록시 프로젝트 정리, 기존 컨테이너 정지 상태 유지. `git diff --check` 통과 |

실행 명령은 아래와 같다. DATABASE_URL은 임시 컨테이너에만 연결하고, 브라우저 라이브러리는 기존 로컬 Playwright 1.64.0을 지정했다.

```bash
npm run typecheck
npm run build --workspace apps/api
# 격리 DB URL, 합성 API 키와 POLICY_SCHEDULE_ENABLED=false를 환경변수로 전달
npm test
cd apps/web
node --test --test-concurrency=1 test/admin-flow.live.mjs test/admin-recovery.live.mjs
# 별도 임시 Next.js 서버가 READY를 알린 뒤 recovery만 다시 실행
node /tmp/mvp3-step1-recovery.cjs
```

브라우저 최초 시도는 시스템 `libnspr4.so`, `libnss3.so`와 `libasound.so.2` 누락으로 시작에 실패했다. 세 라이브러리의 배포 패키지를 `/tmp/mvp3-step1-browser/`에 다운로드하고 추출해 `LD_LIBRARY_PATH`로 연결했다. 시스템 설치나 프로젝트 의존성 추가는 없다. 이후 핵심 흐름 5개는 통과했으나 별도 웹을 요구하는 recovery 2개는 기존 `localhost:3000`이 정지된 상태여서 연결 실패했다. 기존 프록시 fixture로 임시 포트에 웹을 준비한 최종 재검증에서 해당 2개도 통과했다. 최초 환경 실패와 보완 후 결과를 구분하며 제품 코드 수정은 없었다.

출력은 `/tmp/mvp3-step1-` 접두사의 `typecheck.log`, `api-build.log`, `jest.log`, `web-live.log`, `web-recovery.log`에 보관했다. 자료 대조는 `materials.json`, 테스트 DB 정리는 `test-cleanup.json`이다. `/tmp` 결과는 임시 검증 자료이고 저장소의 지속 기록은 이 문서다.

전체 API 실행의 결과 파일 옵션은 루트 npm 명령에서 Jest까지 전달되지 않아 npm 경고가 발생했다. 실제 전체 테스트와 종료 코드 0은 `jest.log`의 최종 집계로 확인했으며 별도 Jest 결과 JSON이 생성됐다고 보고하지 않는다. Node VM Modules와 기존 TypeORM 내부 pg 동시 query 경고도 있었고 테스트 실패는 없었다.

## 6. 남은 문제와 다음 작업

- MVP3 기능과 T3-01~51의 인수는 미실행이다. 이번 회귀 통과는 기존 MVP2의 시작 기준이며 MVP3 기능 완료를 의미하지 않는다. 5,000건 목록의 조회 비용과 p95 측정은 Step 7에서 수행한다.
- 기존 공개 브라우저 65개와 관리자 전체 화면 124개의 재실행은 이번 범위에 포함하지 않았다. MVP2 SUMMARY 47절의 과거 통과 근거와 이번 실제 흐름 7개를 구분하며, 전체 웹 회귀와 MVP3 최종 인수는 Step 32~33에서 진행한다.
- 기존 웹, API와 DB는 정지 상태이므로 현재 사이트와 운영 Cron 성공을 확인한 것으로 보고하지 않는다. MVP2 SUMMARY 53절의 별도 Cron 재현 성공과 실제 운영 예약 실행의 미확인 상태를 유지한다.
- 기존 운영 설정과 매일 04:00 한국 시간 정책을 유지한다. MVP3 전환에서는 SPEC 9장에 따라 쓰기를 중단하고 백업한 뒤 Migration, API와 CLI를 함께 전환해야 한다.
- API 정확한 호출 한도와 `e003` 의미, 삭제 규약, 지역과 실제 거주 자격의 대응 등 이전 미확인 사항은 기존 보수적 판정과 실패 시 데이터 보존 기준을 따른다.
- 다음 요청 대상은 **Step 2: 변경 중요도 계산 함수**다. 이번 작업은 Step 1에서 중단한다.

핵심 코드 읽는 순서: `policy-field-diff.ts` → `policy-review.repository.ts`와 `policy-reviews-read.service.ts` → 개별 승인과 거절 서비스 → `policy-collection-write.service.ts` → `ingestion.service.ts`와 잠금 서비스 → `admin-session.tsx`.

추천 커밋: `docs: MVP3 Step 1 기존 구현 대조와 시작 검증 기록`.
