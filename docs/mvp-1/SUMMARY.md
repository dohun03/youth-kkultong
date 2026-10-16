# 청년꿀통(youth-kkultong) — MVP1 작업 결과

최종 확인일: 2026-10-16 (Asia/Seoul) · **Step 1~2 완료, Step 3~57 미착수**

## 1. 기준 문서와 Step 1 당시 구현 상태

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

## 4. Step 1 검증 결과

- `git ls-files`, `git status --short --ignored`, 파일 목록 확인: 기준 문서·조사 코드·무시 대상 및 애플리케이션 미구현 상태 확인.
- `PYTHONDONTWRITEBYTECODE=1 python3 scripts/api-research/verify.py`: **통과**. 저장 응답 39개의 해시·크기·인증키 가림, 정책 3,255건의 식별자 유일성, 60개 필드 통계, 대표 25건, XML·JSON 대조, 로컬 링크, 비밀값 비노출, Git 제외, Python 문법 확인. HTTP 400 응답 1개는 보관된 오류 사례이며 이번 검사 실패가 아님.
- Python 표준 라이브러리로 `local/research-2/official-source-checksums.json`의 공식 자료 SHA-256 **17개 통과**. 취업·학력 코드표와 지역 원본 압축 파일의 존재 확인. 제품 지역 시드의 계층 정확성이나 현재 공식 자료의 최신성을 검증한 것은 아님.
- 읽기 전용 Python 검사: 정식 문서 경로·버전 참조, 문서 내 로컬 링크, Step 1 체크 3개 및 이후 Step 미완료 상태 확인, **통과**.
- `git diff --check`: **통과**.
- 애플리케이션 빌드·단위/통합 테스트·Compose 실행: **미실행**. 실행 대상 코드·패키지·설정이 없는 Step 1 범위다. 외부 API 재호출은 하지 않았다.

## 5. Step 2 구현·검증 결과

사용자 요청에 따라 Step 1 변경을 `acfe179` (`docs: MVP1 기준 문서와 초기 상태 정리`)로 커밋한 뒤 Step 2를 진행했다.

### 구현과 실제 결정사항

- 루트 `package.json`에 `packages/shared`, `apps/api`, `apps/web`를 npm 작업공간으로 연결했다. 빌드·타입 검사는 공용 패키지 → API → 웹 순서로 실행한다.
- 각 작업공간은 비공개 패키지이며 `build`, `typecheck` 명령을 제공한다. 설치는 루트의 `npm install` 또는 `npm ci`가 세 작업공간을 함께 처리한다. 개별 작업공간 설치는 `npm install --workspace apps/api`처럼 선택할 수 있다.
- `.nvmrc`에 검증한 Node.js `24.18.0`, `packageManager`에 npm `11.16.0`을 기록했다. `engines`와 `.npmrc`의 `engine-strict=true`로 Node.js 24·npm 11 범위를 검사한다.
- 추가한 외부 개발 의존성은 계획에 포함된 TypeScript 하나다. npm 레지스트리에서 확인한 NestJS CLI `12.0.8`의 TypeScript 의존 범위(`~6.0.2`)를 참고해 `6.0.2`로 고정했다. NestJS·Next.js 패키지는 아직 설치하지 않았다.
- `tsconfig.base.json`에 ES2022, `strict=true`, `noEmitOnError=true`를 정의했다. API·공용 패키지는 NodeNext, 웹은 ESNext/Bundler와 DOM·JSX 설정을 사용한다. 공용 패키지는 빌드 시 타입 선언 파일도 생성한다.
- 각 `src/index.ts`는 설정 검증용 빈 모듈이다. 지금의 웹 `build`도 TypeScript 컴파일이며 Next.js 배포 빌드가 아니다. Step 3·4에서 프레임워크와 실행 명령을 구성하고 빈 모듈을 정리한다. 공용 API 계약·패키지 내보내기 경로는 Step 10 범위다.
- `package-lock.json`에 의존성·무결성 해시·작업공간 연결을 기록했다. `.gitignore`에는 의존성·빌드 산출물만 추가했다. 기존 `.env`·조사 자료 제외 규칙은 유지했다.
- API 계약·DB 스키마·제품 동작·기술 스택의 설계 변경은 없다. PRD·ARCHITECTURE·SPEC의 추가 수정도 없다.

작업공간 명령은 [npm 공식 문서](https://docs.npmjs.com/cli/using-npm/workspaces/), 실행 환경별 모듈 설정은 [TypeScript 공식 안내](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html)를 참고했다.

### 실행 방법

루트에서 실행한다. `nvm`을 사용하는 경우 먼저 `nvm install` 및 `nvm use`로 `.nvmrc`의 Node.js 버전을 선택한다.

```bash
npm ci
npm run build
npm run typecheck
```

작업공간 하나만 선택하는 명령은 다음과 같다. `--workspace`에는 경로나 패키지명(`@youth-kkultong/api` 등)을 사용할 수 있다.

```bash
npm run build --workspace apps/api
npm run typecheck --workspace apps/api
npm run build --workspace apps/web
npm run typecheck --workspace apps/web
npm run build --workspace packages/shared
npm run typecheck --workspace packages/shared
```

### 실제 검증

- 환경: Node.js `v24.18.0`, npm `11.16.0`, TypeScript `6.0.2`.
- `npm install --cache /tmp/youth-kkultong-npm-cache --fetch-retries=0 --fetch-timeout=20000`: **통과**. npm 레지스트리에서 설치하고 잠금 파일 생성. 기본 샌드박스의 DNS 접근 제한 때문에 네트워크 허용 환경에서 실행했다.
- `npm ci --offline --cache /tmp/youth-kkultong-npm-cache`: **통과**. 최초 설치 후 동일 잠금 파일·다운로드 캐시로 재설치했다. 다른 환경의 최초 설치에는 npm 레지스트리 접근이 필요하다.
- `npm run build`, `npm run typecheck`: 세 작업공간 모두 **통과**. JS 산출물 3개와 공용 타입 선언 1개 생성 확인.
- `npm ls --workspaces --depth=0`: 세 작업공간의 로컬 연결 확인, **통과**.
- 읽기 전용 설정 조회와 임시 오류 파일 검사: 각 작업공간의 실제 `strict` 상속을 확인했다. `number`에 `null` 대입 및 매개변수의 암시적 `any`를 넣었을 때 개별 `typecheck`·`build`가 각각 `TS2322`·`TS7006` 오류로 실패하는 것을 확인했다. 오류 시 기존 산출물은 유지됐으며 임시 파일은 모두 제거했다. 제거 후 전체 `typecheck`와 산출물 미변경도 확인, **통과**. 제품 테스트 파일은 추가하지 않았다.
- `git diff --check`, 문서 완료 상태·잠금 파일·Git 제외 검사: **통과**.
- 서버 기동·웹 화면·DB 연결·제품 단위/통합 테스트: **미실행**. 해당 구현은 Step 3 이후 범위다.

## 6. 다음 작업을 위한 상태

다음 요청 대상은 **Step 3: NestJS API 최소 실행**이다. Step 3~57은 시작하지 않았다. Step 1에서 기록한 인증키·API 호출·조사 자료의 후속 확인 사항은 그대로 남아 있다.

추천 커밋: `chore: npm 작업공간과 타입 검사 환경 구성` (Step 2 변경은 아직 커밋하지 않음).
