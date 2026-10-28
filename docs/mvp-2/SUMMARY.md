# 청년꿀통(youth-kkultong) — MVP2 작업 결과

수정일: 2026-10-28 · 상태: Step 1 완료 · Step 2~41 미착수

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

## 5. 이번 Step의 실제 검증

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

- Step 1의 대조·시작 상태 기록과 기존 서비스·DB 보존 검증을 완료했다. 기존 웹·API·DB는 healthy 상태로 유지하며 `http://localhost:3000/policies`에서 확인할 수 있다.
- 기존 백업은 2026-10-26 자료다. Step 4의 실제 이관 전에는 쓰기를 중단하고 당시 DB·로그를 새로 백업해야 하며, 과거 백업 해시 확인으로 대신하지 않는다.
- 외부 API 정확한 호출 한도·e003 원인·삭제/비공개 규약·지역과 실제 거주 자격 대응·0~0 연령 의미는 MVP1에서 이어지는 미확인 사항이다. 기존 보수적 판정과 실패 시 데이터 유지 규칙을 따른다.
- 프록시를 통한 접속 주소별 호출 제한 공유, 수동 백업의 보관 기한·외부 복제 등 기존 운영 한계는 유지된다. MVP2 한도 분리는 SPEC 7.2대로 구현하되 실제 사용자별 제한을 해결한 것으로 보고하지 않는다.
- 다음 요청 대상은 **Step 2: 관리자 API 타입과 입력 검증**이다. Step 2 이후 구현은 진행하지 않았다.

핵심 읽는 순서: MVP2 SPEC 2·5·6장 → `ingestion.service.ts` → `policies-write.service.ts`·`policy.repository.ts` → 잠금·로그 서비스 → 기존 수집/저장/CLI 통합 테스트. Step 2 구현 시에는 SPEC 3·4·7장의 관리자 계약을 우선 확인한다.
