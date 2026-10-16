# 청년꿀통(youth-kkultong) — MVP1 작업 결과

최종 확인일: 2026-10-16 (Asia/Seoul) · **Step 1~5 완료, Step 6~57 미착수**

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

## 6. Step 3 구현·검증 결과

사용자 요청에 따라 Step 2 변경을 `6a41346` (`chore: npm 작업공간과 타입 검사 환경 구성`)으로 커밋한 뒤 Step 3을 진행했다.

### 구현과 실제 결정사항

- API의 검증용 빈 `src/index.ts`를 제거하고 `src/main.ts`, `app.module.ts`, `health.controller.ts`를 작성했다. NestJS 기본 Express 어댑터를 사용하며 서비스 계층은 별도로 추가하지 않았다.
- `main.ts`는 공통 접두사 `/api/v1`을 적용한 애플리케이션을 생성하고 직접 실행할 때 `0.0.0.0:4000`에서 대기한다. 종료 신호에 연결을 정리하며 기동 오류는 기록 후 실패 종료한다. 테스트에서 가져올 때는 4000 포트를 자동으로 열지 않는다.
- `GET /api/v1/health`는 HTTP `200`, JSON `{ "status": "ok" }`를 반환한다. SPEC의 기본 서비스 상태 응답을 구체화한 것으로, 현재 API 프로세스의 응답 여부만 확인한다. DB 준비 상태 검사는 아직 구현하지 않았다.
- NestJS `12.1.3`, `reflect-metadata` `0.2.2`, `rxjs` `7.8.2`를 실행 의존성으로, Jest `30.5.2`, Supertest `7.3.1`, TypeScript 지원용 `ts-jest` `29.4.15`와 필요한 타입 선언을 개발 의존성으로 고정했다.
- API에는 데코레이터·메타데이터 컴파일 설정을 적용했다. 공통 TypeScript 설정은 자동 전역 타입을 비우고 API에서 Node 타입, 테스트 설정에서 Node·Jest 타입만 명시해 웹·공용 패키지에 테스트 전역 타입이 섞이지 않게 했다. API의 `typecheck`에는 테스트 소스도 포함한다.
- API는 CommonJS 출력과 Node.js의 ESM 불러오기 지원을 사용한다. NestJS 12의 ESM 의존성을 Jest에서도 읽도록 공식 문서의 `--experimental-vm-modules` 옵션을 테스트 명령에 반영했다. Jest의 동기 ESM 로딩에 필요한 Node.js `>=24.9.0 <25`를 API 패키지에 명시했다. 기존 `.nvmrc`의 `24.18.0`은 해당 범위를 충족한다.
- `test/health.spec.ts`에서 실제 애플리케이션을 로컬 임시 포트로 실행하고 Supertest로 요청한 뒤 연결을 닫는다. 단순 반환값을 반복 확인하는 별도 단위 테스트는 추가하지 않았다.
- 사용자 검수에서 편집기의 Jest 전역 이름 오류 7개가 발견됐다. `tsconfig.test.json`은 명령줄에서만 명시적으로 선택되고 편집기의 자동 탐색 대상이 아니어서 테스트 파일이 설정 없는 프로젝트로 열리는 문제였다. `test/tsconfig.json`이 기존 테스트 설정을 상속하도록 추가해 편집기에도 Node·Jest 타입과 strict 설정을 연결했다. 패키지를 다시 설치하거나 API 소스에 Jest 전역 타입을 추가하지 않았다.
- 기존 API 접두사·포트·DB 설계는 변경하지 않았다. PRD·ARCHITECTURE·SPEC의 수정은 없다. PLAN과 이 문서에 실제 완료 상태를 반영했다.

실행·접두사·테스트 구성은 [NestJS 시작 안내](https://docs.nestjs.com/first-steps), [NestJS 테스트 안내](https://docs.nestjs.com/fundamentals/testing), [Jest ESM 안내](https://jestjs.io/docs/ecmascript-modules)를 참고했다.

### 실행 방법

루트에서 실행한다. `start:api`는 이미 빌드된 파일을 실행하므로 소스를 바꾸면 먼저 빌드한다.

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run start:api
```

서버를 실행한 상태에서 다른 터미널에서 확인한다.

```bash
curl --fail http://localhost:4000/api/v1/health
```

예상 응답: `{"status":"ok"}`. API 작업공간만 선택할 때는 `npm run build --workspace apps/api`, `npm run start --workspace apps/api`, `npm run test --workspace apps/api`를 사용한다.

### 실제 검증과 남은 문제

- 잠금 파일을 갱신한 뒤 `npm ci --offline --cache /tmp/youth-kkultong-npm-cache`로 재설치: **통과**. 최초 의존성 다운로드에는 네트워크 허용 환경을 사용했다.
- `npm run build`, `npm run typecheck`: 웹·공용 패키지를 포함한 모든 작업공간 **통과**.
- `npm test`: 통합 테스트 **4개 통과**. 정상 JSON 응답, `/health`·`/api/health`의 `404`, `POST /api/v1/health`의 `404`를 확인했다. 최초 실행의 ESM 로딩 오류는 테스트 실행 옵션을 수정한 뒤 해소했다. VM 모듈 실험 기능 경고는 출력된다.
- 편집기 설정 수정 후 TypeScript 언어 서버(`tsserver`)로 `health.spec.ts`의 프로젝트 자동 선택과 의미 오류를 다시 확인: `test/tsconfig.json` 선택, 오류 **0개**. 명령줄 검사만으로 편집기 오류까지 없다고 판단했던 검증 누락을 보완했다. API 빌드·타입 검사·통합 테스트도 수정 후 다시 통과했다.
- `npm run start:api`를 실행한 뒤 Python 표준 라이브러리로 실제 `:4000`의 health 응답을 확인: **통과**. 같은 포트에 두 번째 프로세스를 시작하면 `EADDRINUSE` 기록과 실패 종료를 확인했다. 첫 프로세스의 `SIGTERM` 종료 및 포트 반환도 **통과**. 검증용 서버는 모두 종료했다. 로컬 포트 실행 검증은 샌드박스 밖에서 수행했다.
- `npm ls --workspace apps/api --depth=0`, `git diff --check`, 잠금 파일·완료 상태·전역 타입 범위·Git 제외 검사: **통과**.
- 네트워크를 이용한 `npm audit --omit=dev --json`: 실행 의존성 취약점 **0건**. 전체 `npm audit --json`에서는 Jest 계열의 `sprintf-js` 간접 의존성에 따른 **중간 등급 20건**이 보고되어 미해결로 남겼다. 제안된 Jest·ts-jest의 큰 버전 변경은 적용하지 않았다. 오프라인 설치가 출력한 audit 수치는 최신 보안 검사 근거로 사용하지 않는다.
- DB 연결·공통 오류 응답·공개 API 보안 최종 점검은 각각 Step 6·11·54 범위로 아직 완료하지 않았다. 실제 정책 수집이나 웹 화면 구현도 진행하지 않았다.

## 7. Step 4 구현·검증 결과

사용자 요청에 따라 Step 3의 편집기 타입 인식 오류를 수정하고 언어 서버·빌드·타입 검사·통합 테스트로 재검증했다. 수정 내용을 포함한 Step 3을 `79a7768` (`feat: NestJS API 서버 및 상태 확인 경로 구성`)로 커밋한 뒤 Step 4를 진행했다.

### 구현과 실제 결정사항

- Next.js `16.4.2`, React·React DOM `19.3.1` 및 필요한 Node·React 타입 선언을 웹 작업공간에 고정했다. 기존 검증용 `src/index.ts`는 제거했다.
- `app/layout.tsx`에 한국어 문서·메타데이터·서비스 헤더·본문 건너뛰기 링크를 구성했다. `app/page.tsx`는 `/policies`로 이동하고, `app/policies/page.tsx`는 빈 정책 목록을 표시한다. 기본 CSS만 사용했으며 별도 UI 패키지·외부 폰트·이미지는 추가하지 않았다.
- `next.config.ts`의 `rewrites`가 `/api/v1/:path*`를 NestJS의 같은 경로로 전달한다. 로컬 기본 주소는 `http://127.0.0.1:4000`이다. `API_INTERNAL_URL`은 Next.js가 설정을 읽을 때 사용하는 서버용 API 주소이며 브라우저의 환경변수로 노출하지 않는다. 다른 주소로 배포할 때는 **빌드 전에** 지정하고 다시 빌드한다. Compose의 내부 API 주소 설정은 Step 5에서 연결한다.
- 웹 명령을 `next dev`·`next build`·`next start`로 바꿨다. 개발·실행 포트는 `3000`이고 루트에 `dev:web`, `start:web` 명령을 추가했다.
- 웹 타입 검사는 `next typegen` 후 `tsc --noEmit`을 실행해 새 환경에서도 경로 타입을 먼저 생성한다. Next.js 타입 선언에 필요한 웹의 `lib`를 ES2024·DOM으로 구성하고 Node·React 전역 타입만 허용했다. 공통 strict 설정과 API의 Jest 타입 분리는 유지했다.
- Next.js 자동 생성 파일인 `next-env.d.ts`는 공식 안내에 따라 Git 추적에서 제외했다. `.next`와 타입 검사 산출물도 기존 규칙으로 제외된다.
- 실제 정책 API 연결·카드·조건 필터는 아직 구현하지 않았다. API 계약·DB 스키마·제품 판정 규칙·기술 스택의 변경 없이 Step 4의 기본 경로만 구성했다.

설정은 [Next.js 설치 안내](https://nextjs.org/docs/app/getting-started/installation), [rewrites 안내](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites), [TypeScript 안내](https://nextjs.org/docs/app/api-reference/config/typescript)를 참고했다.

### 실행 방법

루트에서 설치·빌드·타입 검사를 수행한다.

```bash
npm ci
npm run build
npm run typecheck
npm test
```

터미널 하나에서 `npm run start:api`, 다른 터미널에서 `npm run dev:web`를 실행한다. 빌드한 웹을 실행하려면 `npm run start:web`를 사용한다. `http://localhost:3000/`는 `/policies`로 이동하며, 웹의 API 전달은 다음으로 확인한다.

```bash
curl --fail http://localhost:3000/api/v1/health
```

예상 응답: `{"status":"ok"}`.

### 실제 검증과 남은 문제

- `npm ci --offline --cache /tmp/youth-kkultong-npm-cache`: 잠금 파일 기반 재설치 **통과**.
- `NEXT_TELEMETRY_DISABLED=1 npm run build`, `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`: 세 작업공간 모두 **통과**. 웹은 실제 Next.js 운영 빌드이며 루트·정책 목록 경로가 생성됐다. 초기 빌드의 TypeScript 하위 프로세스 실행 오류는 샌드박스의 `EPERM`이 원인이어서 샌드박스 밖에서 검증했다. 웹 타입 선언의 ES2024 요구도 설정에 반영했다. 타입 검사를 생략하지 않았다.
- `npm test`: 재설치 후 기존 API 통합 테스트 **4개 통과**.
- 실제 `start:api`·`start:web` 서버와 Python HTTP 검사: `/`의 `/policies` 이동, `/policies`의 한국어 빈 목록·본문·CSS 응답, 웹 `:3000/api/v1/health`를 통한 API `:4000`의 실제 JSON 응답, 미존재 API 경로의 `404` 전달 모두 **통과**. 검증용 웹·API 서버는 종료했고 두 포트 반환도 확인했다. 최초 HTTP 검사의 헤더 이름 대소문자 처리 오류는 검사 코드를 정정한 뒤 재확인했다.
- TypeScript 언어 서버로 테스트 파일과 웹의 `layout.tsx`·두 `page.tsx`·`next.config.ts`를 직접 열어 자동 프로젝트 선택과 의미 오류 **0개**를 확인했다.
- `git diff --check`, 패키지·잠금 파일 일치, 문서 완료 상태·Git 제외 검사: **통과**.
- 최종 네트워크 `npm audit --json`에서는 기존 Jest 계열 개발 의존성의 중간 등급 **20건**이 계속 보고됐다. 새 웹 패키지에 대한 별도 취약점 항목은 보고되지 않았다. 기존 후속 검토 사항을 유지한다.
- 브라우저 도구·실행 파일이 없어 실제 브라우저 렌더링·모바일 화면 검수는 **미실행**이다. HTTP 응답과 CSS 제공까지 확인했으며 시각 검수가 완료된 것으로 표시하지 않는다. Step 4의 경로·연결 완료 조건은 충족했다.

### 검수 항목의 의미와 후속 확인

사용자 요청에 따라 Step 4 구현과 관련 문서를 `545753e` (`feat: Next.js 정책 목록 진입 경로 구성`)로 커밋하고 아래 내용을 다시 확인했다.

- **브라우저 시각 검수:** 실제 브라우저에서 글자 잘림·요소 겹침·휴대폰 배치 등을 눈으로 확인하는 작업이다. 아직 그 검사를 하지 않았다는 뜻이며, 현재까지 확인한 오류를 뜻하지 않는다. 경로·응답·스타일 파일 제공은 앞선 HTTP 검사에서 통과했다. 브라우저 확인은 추후 화면 검수에서 진행한다.
- **개발 의존성 경고 20건:** 최신 네트워크 `npm audit --json`을 다시 조회해 원인 보안 공지는 `sprintf-js`의 [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) **1개**, 영향받는 패키지 집계는 중간 등급 **20건**임을 확인했다. `Jest/ts-jest → @jest/transform → babel-plugin-istanbul → @istanbuljs/load-nyc-config → js-yaml → argparse → sprintf-js` 경로의 개발 도구 의존성이다.
- **현재 영향 판단:** 공격자가 서식 문자열을 조작하면 처리 중 예외가 발생할 수 있는 문제다. 현재 이 의존성은 테스트 도구에 속하며 서비스 실행 패키지를 분리한 `npm audit --omit=dev --json` 결과는 **0건**이다. 이 근거로 현재 서비스 경로에 대한 직접 영향은 낮다고 판단하며 개발을 중단할 사유로 보지 않는다. 개발 도구의 보안 경고로 계속 추적한다.
- **간단한 수정 가능 여부:** 공식 공지는 수정 버전 없음으로 안내하며, `npm view sprintf-js version versions --json`에서도 최신 버전이 취약 범위에 속하는 `1.1.3`임을 확인했다. 따라서 단순 버전 업데이트로는 해소되지 않는다. 현재 Jest·TypeScript의 호환성을 바꿀 수 있는 강제 다운그레이드나 임의 패치는 적용하지 않았다. 공식 수정 버전 또는 상위 도구의 의존성 개선이 나오면 다시 검토한다.
- 이번 후속 확인에서는 앱 코드·의존성·Step 완료 상태를 바꾸지 않고 설명과 검증 근거만 보완했다.

## 8. Step 5 구현·검증 결과

### 구현과 실제 결정사항

- `compose.yaml`에 `web`, `api`, `db`를 구성했다. 공식 `node:24.18.0-bookworm-slim`, `postgres:17.11-bookworm` 태그가 존재함을 확인하고 사용했다. 시간대는 `Asia/Seoul`이다.
- 루트 `Dockerfile`은 잠금 파일로 의존성을 설치하고 웹·API를 각각 빌드한다. API 실행 이미지는 API 작업공간의 실행 의존성만 설치한다. 웹은 Next.js `standalone` 출력과 정적 파일만 복사한다. 두 실행 이미지는 일반 `node` 사용자로 실행한다.
- `apps/web/next.config.ts`에 `standalone` 출력과 저장소 루트 기준 파일 추적을 추가했다. Compose 빌드 인수 `API_INTERNAL_URL=http://api:4000`으로 웹 요청이 같은 네트워크의 API에 전달되도록 했다. 별도 서비스나 외부 패키지는 추가하지 않았다.
- `app` 네트워크는 웹·API를 연결한다. 외부와 격리된 `database` 네트워크에는 API·DB만 연결한다. DB의 `5432`는 호스트에 공개하지 않는다. API는 추후 외부 수집에도 사용할 수 있도록 `app` 네트워크를 통해 외부 통신이 가능한 구성을 유지한다.
- DB의 `pg_isready`가 TCP 접속 준비를 확인한 뒤 API, API의 health 확인 뒤 웹을 기동한다. 각 서비스의 준비 상태는 Compose healthcheck로 확인한다. API health는 아직 프로세스 응답 검사이며 DB 연결 상태를 응답에 포함하지 않는다.
- DB는 `db_data` 이름 있는 볼륨을 `/var/lib/postgresql/data`에 연결한다. DB 이름·사용자는 `youth_kkultong`이고 비밀번호는 `.env`의 `POSTGRES_PASSWORD`에서 받는다. API에는 이를 이용한 `DATABASE_URL`을 전달했다. DB 비밀번호는 URL에도 사용할 수 있는 영문·숫자 값으로 준비한다.
- `.env.example`에 필요한 비밀번호 항목을 안내했다. 로컬 `.env`의 기존 조사용 API 키를 보존하고 임의 생성한 DB 비밀번호를 추가했다. 값은 출력·커밋하지 않았고 파일 권한은 소유자 읽기·쓰기로 설정했다. `.dockerignore`로 `.env`·Git·로컬 의존성·빌드 결과·조사 자료를 이미지 빌드 문맥에서 제외했다.
- TypeORM·Migration·업무 테이블은 아직 없다. 이번에는 API 컨테이너에서 DB까지 TCP 연결과 DB 자체의 비밀번호 인증·SQL 응답을 확인했다. 애플리케이션의 실제 DB 연결은 Step 6에서 구현한다. API 계약·DB 스키마·제품 정책의 변경은 없다.

구성 근거: [Docker 기동 순서](https://docs.docker.com/compose/how-tos/startup-order/), [Docker 네트워크](https://docs.docker.com/reference/compose-file/networks/), [Next.js standalone 출력](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).

### 개발 환경 실행 방법

현재 로컬은 `.env` 설정과 이미지 빌드가 완료되어 있다. 새로 복제한 환경에서는 기존 `.env`를 보존하면서 `.env.example`의 `POSTGRES_PASSWORD` 항목에 고유한 값을 추가한다. Docker 엔진과 Compose가 실행 가능한 상태에서 저장소 루트에서 실행한다.

```bash
docker compose config --quiet
docker compose up --build -d --wait
docker compose ps
curl --fail http://localhost:3000/api/v1/health
```

| 서비스 | 접속·확인 위치 |
| --- | --- |
| 웹 | `http://localhost:3000/` → `/policies` |
| API | `http://localhost:4000/api/v1/health` |
| 웹을 통한 API | `http://localhost:3000/api/v1/health` |
| DB | 컨테이너 내부 `db:5432`, 호스트 포트 없음 |

웹·API 호스트 포트는 로컬 `127.0.0.1`에만 연결했다. 로컬에서 직접 실행하던 웹·API와 같은 포트를 동시에 사용할 수 없으므로 컨테이너 기동 전에 해당 로컬 프로세스를 종료한다. 소스를 수정하면 `docker compose up --build -d --wait`로 다시 빌드·기동한다.

로그는 `docker compose logs -f web api db`, 중지는 `docker compose down`으로 수행한다. `down`은 DB 볼륨을 유지한다. 기존 볼륨의 DB 비밀번호를 바꾸는 작업은 환경변수 변경만으로 완료되지 않으므로 별도 DB 변경 절차가 필요하다.

### 실제 검증과 남은 문제

- 환경: Docker Engine `29.7.2`, Compose `v5.4.0`. Docker 소켓은 기본 샌드박스에서 접근이 거부되어 Docker 검증은 허용된 실행 환경에서 수행했다.
- `docker compose config --quiet`, `docker compose build`: **통과**. 호스트의 설치·빌드 결과를 복사하지 않고 이미지 내부 `npm ci`와 API·Next.js 빌드를 수행했다.
- `docker compose up -d --wait --wait-timeout 120`, `docker compose ps`: **세 서비스 모두 healthy**.
- 실제 컨테이너 HTTP 검사: `/` 이동, `/policies`의 빈 목록, 웹→API health 전달 및 API 직접 응답 확인, **통과**. 웹의 정적 CSS 제공도 확인했다.
- API 컨테이너의 Node.js TCP 검사로 `DATABASE_URL`의 `db:5432` 연결 **통과**. DB 컨테이너의 TCP 비밀번호 인증과 SQL 응답에서 `PostgreSQL 17.11`·DB 이름 확인, **통과**.
- `docker compose down` 후 `up -d --wait --wait-timeout 120`로 컨테이너와 네트워크를 재생성하고 DB 클러스터 식별자가 동일함을 확인했다. 재기동 뒤 웹→API 응답도 **통과**. 볼륨은 삭제하지 않았으며 사용자 업무 테이블을 만들거나 지우지 않았다.
- 비밀번호 누락 시 Compose 설정 오류, DB 외부 포트 미공개·내부 네트워크, 컨테이너 로그의 비밀번호 미노출, 웹·API의 일반 사용자 실행 및 `.env`·Jest·ts-jest·sprintf-js 모듈 제외 검사 **통과**. 기존 개발 의존성 경고는 빌드 도구 쪽의 후속 검토 사항으로 남긴다.
- `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`, `git diff --check`, 문서 완료 상태·변경 범위·Git 제외 검사: **통과**.
- 기존 중지 컨테이너 `youth-kkultong-postgres-1`이 같은 Compose 프로젝트 이름으로 남아 있어 orphan 안내가 출력됐다. 기존 컨테이너와 데이터는 보존했고 제거 옵션은 사용하지 않았다. 이번 `db` 서비스는 별도 `db_data` 볼륨으로 검증했다.
- 검증 후 `web`, `api`, `db`는 **실행 중**이다. 브라우저 시각 검수와 TypeORM 연결·스키마 검증은 이번에 완료한 것으로 표시하지 않는다.

## 9. 다음 작업을 위한 상태

다음 요청 대상은 **Step 6: 환경변수 검증과 TypeORM 연결**이다. Step 6~57은 시작하지 않았다. Step 1의 인증키·API 호출·조사 자료 및 개발 도구의 후속 검토 사항은 그대로 남아 있다.

Step 5 구현·문서 커밋 메시지: `chore: 웹 API PostgreSQL 개발 컨테이너 구성`.
