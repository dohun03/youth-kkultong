# 청년꿀통(youth-kkultong) — MVP1 작업 결과

최종 확인일: 2026-10-16 (Asia/Seoul) · **Step 1 완료, Step 2~57 미착수**

## 1. 기준 문서와 현재 구현 상태

`AGENT_RULES.md`를 먼저 읽고 PLAN의 Step 1 범위, SPEC, 저장소 및 기존 조사 자료를 대조했다. Step 1은 선행 Step이 없는 문서·저장소 점검 단계다.

| 문서 | 확인한 버전·경로 |
| --- | --- |
| 작업 규칙 | `docs/AGENT_RULES.md` |
| 제품 요구사항 | `docs/PRD.md` v0.8 |
| 공통 구조 | `docs/ARCHITECTURE.md` v0.3 |
| MVP1 세부 명세 | `docs/mvp-1/SPEC.md` v0.4 |
| 작업 순서 | `docs/mvp-1/PLAN.md` v0.2 |

기준 문서는 모두 정식 경로에 존재한다. 별도 버전 표시 파일은 없어 이동·복사하지 않았다. `SPEC_SUMMARY.md`와 이전 MVP 기록(`docs/mvp-0/`)은 없으며 이번 Step에서 새로 만들지 않았다.

- Git 추적 대상은 `.gitignore`와 기준 문서다. 착수 시 추적 파일의 변경사항은 없었다.
- `apps/api`, `apps/web`, `packages/shared`, `package.json`, 잠금 파일, TypeScript 설정, Compose 설정은 없다.
- API·웹·DB·Migration·수집 CLI·매칭 기능 및 애플리케이션 테스트는 **미구현**이다. 조사용 Python 스크립트를 제품 기능의 완료 근거로 취급하지 않는다.
- 이번 변경은 문서 정리에 한정한다. API 계약·DB 스키마·제품 판정 규칙·기술 스택을 변경하지 않았다.

## 2. 기존 자료의 재사용과 차이

아래 자료는 로컬에 존재하지만 `.gitignore`의 `scripts`, `docs/api-research` 규칙으로 **전체가 Git 추적에서 제외**되어 있다. 새로 복제한 저장소에서는 자동으로 확보되지 않는다. 기존 자료와 제외 규칙은 보존했다.

| 자료 | 재사용할 부분 | 제품 구현 시 주의할 점 |
| --- | --- | --- |
| `docs/api-research/RESULT.md`, `RESULT-2.md` | 응답 구조·필드, 오류 사례, 공식 코드 자료의 출처와 조사 한계 | 조사 당시 기록이며 기능 명세를 대체하지 않음 |
| `docs/api-research/samples/`, `local/` | 원본 응답 39개, 고유 정책 3,255건, 대표 25건, 집계·검증 기록 | 실시간 정책 건수나 현재 API 동작의 보장으로 사용하지 않음 |
| `docs/api-research/official/API코드정보.xlsx`, `local/official-codes.json` | 취업·학력 코드와 한국어 표시명의 근거 | Step 29에서 공식 원본과 대조 후 서버 코드표로 구현 |
| `docs/api-research/official/research-2/`, `local/research-2/` | 현행·폐지 지역 자료, 출처·시행일, 코드 대조 결과 | Step 9에서 5자리 코드·직접 상위 관계를 검증해 시드 작성. 조사에 나온 코드 목록만으로 전체 선택지를 대체하지 않음 |
| `scripts/api-research/`의 Python 파일 5개 | 조사·집계·무결성 검사 방식, 저장 샘플 | TypeScript/NestJS 제품 수집기로 그대로 재사용하지 않음 |

기존 조사 수집기 `fetch.py`는 `YOUTH_API_KEY`를 읽고 기본 100건을 요청하며 오류 시 자동 재시도 없이 중단한다. DB 저장·트랜잭션·Advisory Lock도 없다. MVP1은 SPEC 5장의 `YOUTH_CENTER_API_KEY`, 기본 50건, 제한적 재시도와 잠금·저장을 새로 구현해야 한다. 조사 당시의 오류 후 대체 페이지 수집 절차도 제품 수집 흐름으로 옮기지 않는다.

## 3. 문서 정정과 미해결 확인 사항

**정정:** ARCHITECTURE와 SPEC의 기준 PRD 표시를 현재 파일의 v0.8로 맞췄다. ARCHITECTURE에 남아 있던 `PRD_youth_kkultong_v0.7.md`, `SPEC_MVP1.md` 참조 및 문서 트리를 정식 경로로 정정했다. 파일 경로·기준 표시만 수정했으며 설계 의미는 바꾸지 않았다. PRD·SPEC 본문의 수집·보수적 제외·점수·정렬 흐름에서 이번 Step을 막는 요구사항 충돌은 발견하지 못했다.

| 확인 사항 | 현재 상태와 후속 작업 |
| --- | --- |
| 인증키 환경변수 | 로컬 `.env`에는 조사용 `YOUTH_API_KEY`가 있고 제품용 `YOUTH_CENTER_API_KEY`는 없다. 키 값·유효성은 보고하지 않았다. Step 6·12에서 제품 설정을 준비하고 확인해야 함 |
| 목록 `pageType=1` | SPEC의 요청값이지만 보관된 조사 목록 요청에서는 생략됨. Step 12에서 실제 호출로 확인할 항목이며 지금은 검증 완료로 간주하지 않음 |
| 지역 시드·코드표 | 공식 원본은 로컬에 확보되어 있으나 제품 시드·코드표와 검증은 아직 없음. Step 9·29에서 구현·검증 |
| 공식 API 의미 | 호출 한도, `e003` 원인, 지역 코드와 실제 거주 자격의 대응, `0~0` 연령 의미 등은 조사상 미확인. SPEC의 보수적 판정·실패 처리를 유지 |
| 조사 자료의 전달 | Git 추적 제외로 다른 환경에 원본이 없을 수 있음. 관련 Step 착수 시 자료 존재를 확인하고 없으면 해당 Step을 보류·보고 |

Step 1 완료를 막는 자료 누락은 없다. 후속 Step에서 필요한 설정·제품 구현·실제 호출 검증은 위와 같이 미완료로 남겼다.

## 4. 실제 검증 결과

- `git ls-files`, `git status --short --ignored`, 파일 목록 확인: 기준 문서·조사 코드·무시 대상 및 애플리케이션 미구현 상태 확인.
- `PYTHONDONTWRITEBYTECODE=1 python3 scripts/api-research/verify.py`: **통과**. 저장 응답 39개의 해시·크기·인증키 가림, 정책 3,255건의 식별자 유일성, 60개 필드 통계, 대표 25건, XML·JSON 대조, 로컬 링크, 비밀값 비노출, Git 제외, Python 문법 확인. HTTP 400 응답 1개는 보관된 오류 사례이며 이번 검사 실패가 아님.
- Python 표준 라이브러리로 `local/research-2/official-source-checksums.json`의 공식 자료 SHA-256 **17개 통과**. 취업·학력 코드표와 지역 원본 압축 파일의 존재 확인. 제품 지역 시드의 계층 정확성이나 현재 공식 자료의 최신성을 검증한 것은 아님.
- 읽기 전용 Python 검사: 정식 문서 경로·버전 참조, 문서 내 로컬 링크, Step 1 체크 3개 및 이후 Step 미완료 상태 확인, **통과**.
- `git diff --check`: **통과**.
- 애플리케이션 빌드·단위/통합 테스트·Compose 실행: **미실행**. 실행 대상 코드·패키지·설정이 없는 Step 1 범위다. 외부 API 재호출은 하지 않았다.

## 5. 다음 작업을 위한 상태

다음 요청 대상은 **Step 2: npm 작업공간과 TypeScript 기본 설정**이다. Step 2 이후 작업은 시작하지 않았다.

추천 커밋: `docs: MVP1 기준 문서와 초기 상태 정리` (직접 커밋하지 않음).
