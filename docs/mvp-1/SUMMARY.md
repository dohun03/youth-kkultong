# 청년꿀통(youth-kkultong) — MVP1 작업 결과

최종 확인일: 2026-10-18 (Asia/Seoul) · **Step 1~20 완료, Step 21~57 미착수**

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
| 인증키 환경변수 | 로컬 `.env`의 제품용 `YOUTH_CENTER_API_KEY`는 미설정이다. Step 12 수동 검증에서만 기존 조사용 `YOUTH_API_KEY`를 프로세스 내부에 주입해 실제 호출에 성공했다. 제품 코드에 별칭 처리는 없으며 수집 운영 전 제품용 환경변수 설정 필요 |
| 목록 `pageType=1` | Step 12에서 명세대로 실제 1페이지·50건을 요청해 HTTP 200·`resultCode=200`과 반환 50건을 확인 |
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

## 9. Step 6 구현·검증 결과

### 구현과 실제 결정사항

- PLAN·SPEC·ARCHITECTURE의 설정 기준과 Step 5의 실제 실행 상태를 대조했다. 기존 세 서비스는 healthy였고 개발 DB에 업무 테이블은 없었다. 이번 범위는 환경변수 검증·DB 연결·Migration 실행 기반이며 정책·지역 엔티티와 테이블은 추가하지 않았다.
- `common/environment.ts`에 Zod 검증을 작성했다. 루트 `.env`를 읽고 실행 환경의 값을 우선한다. `.env`가 없는 컨테이너는 실행 환경만 사용하고, 읽기 권한 등의 오류는 실패로 처리한다. 비밀값은 검증 오류에 포함하지 않는다. Node.js 기본 `parseEnv`를 사용해 별도 설정 패키지를 추가하지 않았다.
- `DATABASE_URL`은 사용자·호스트·DB 이름이 있는 `postgres:` 또는 `postgresql:` URL을 필수로 받는다. `YOUTH_CENTER_PAGE_SIZE=50`, `YOUTH_CENTER_REQUEST_DELAY_MS=3000`, `YOUTH_CENTER_MAX_ATTEMPTS=3`, `POLICY_IMPORT_BATCH_SIZE=200`, `TZ=Asia/Seoul`을 기본값으로 적용한다. 숫자는 정수 문자열을 검증한 뒤 변환하며, 페이지 크기는 양의 안전한 정수, 요청 간격은 0~2,147,483,647ms, 시도 횟수는 1~3회, 저장 묶음은 1~200건으로 제한한다. 시간대는 한국 날짜 판정을 위해 `Asia/Seoul`만 허용한다. JavaScript 타이머 한도를 넘는 대기 시간도 거부한다.
- `YOUTH_CENTER_API_KEY`는 빈 값·공백을 미설정으로 다루며 조회 서버와 Migration 실행에는 요구하지 않는다. 실제 수집 시 필수 검사·인증 검증은 수집 Step에서 구현한다. 조사용 `YOUTH_API_KEY`를 제품 키로 자동 대체하지 않는다. 기존 로컬 `.env`와 인증키는 변경하거나 출력하지 않았다.
- TypeORM `1.1.2`, PostgreSQL 드라이버 `pg` `8.23.1`, Zod `4.6.7`을 API 실행 의존성에 고정했다. npm 공식 레지스트리에서 Node.js 호환 범위를 확인했다. NestJS 연동은 기본 비동기 provider(의존성 제공자)를 사용한다.
- `database/data-source.ts`의 연결 설정을 API와 CLI가 공유한다. `synchronize=false`, `migrationsRun=false`, Migration 전체 트랜잭션, DB 접속 제한 5초를 적용했다. DB 연결 세션에도 `Asia/Seoul`을 설정한다. 엔티티는 각 모듈의 `*.entity.ts/js`, Migration은 `database/migrations/`에서 읽는다. 이번 Step에는 배포용 빈 Migration 파일을 남기지 않았다.
- `DatabaseModule`은 설정 검증과 DB 초기화를 완료한 뒤 API 기동을 허용한다. 애플리케이션 종료·종료 신호에서는 연결 풀을 반환한다. DB 초기화 실패는 발생 단계와 확인된 오류 코드(`28P01`, `ECONNREFUSED` 등)만 기록해 접속 정보 노출을 피한다. health 응답 계약은 기존 `{ "status": "ok" }`를 유지하며 실행 중 DB 상태를 매번 검사하는 기능은 추가하지 않았다.
- 루트와 API 작업공간에 `migration:run`, `migration:show` 명령을 추가했다. TypeScript를 빌드한 뒤 TypeORM CLI로 실행한다. 실행 이미지에도 같은 명령이 포함된다. Compose에는 제품용 수집 환경변수를 전달하고 `.env.example`에 기본값·한도·로컬 직접 실행의 DB 주소 설정 방법을 안내했다.
- PLAN의 Step 6만 완료 표시하고 이 문서에 결과를 기록했다. API 계약·업무 DB 스키마·제품 판정 규칙의 설계 변경은 없어 PRD·ARCHITECTURE·SPEC은 수정하지 않았다.

설정 근거: [Zod 기본 검증](https://zod.dev/basics), [TypeORM 연결 설정](https://typeorm.io/docs/data-source/data-source-options/), [Migration 설정](https://typeorm.io/docs/migrations/setup/), [빌드한 Migration 실행](https://typeorm.io/docs/migrations/executing/).

### 실행 방법

Compose에서는 기존 `.env`의 `POSTGRES_PASSWORD`를 사용해 내부 DB 주소를 구성한다. 저장소 루트에서 다음을 실행한다.

```bash
docker compose build api
docker compose up -d --no-deps --wait --wait-timeout 60 api
docker compose exec -T api npm run migration:run
docker compose exec -T api npm run migration:show
```

위 명령은 Step 5의 DB·웹이 이미 기동한 환경 기준이다. 새 환경은 `docker compose up --build -d --wait`로 세 서비스를 먼저 기동한다. Step 6 완료 당시에는 배포용 Migration이 없어 `migration:run`이 `No migrations are pending`으로 끝나고 `migration:show`에 나열할 항목도 없었다. Step 7 이후의 적용 상태는 아래 해당 Step 결과를 따른다. Migration은 API 시작 시 자동 실행되지 않는다.

호스트에서 직접 실행하려면 `.env` 또는 실행 환경에 **호스트에서 접근 가능한** `DATABASE_URL`을 별도로 설정한다. Compose DB는 호스트 포트를 공개하지 않는다. 빌드와 명령은 다음과 같다.

```bash
npm run build --workspace apps/api
npm run migration:run
npm run migration:show
npm test
npm run start:api
```

전체 테스트에는 실제 PostgreSQL이 필요하다. 기존 Docker DB를 이용하려면 아래 임시 덮어쓰기 설정으로 개발 의존성이 포함된 `api-build` 단계를 실행할 수 있다. 운영용 API 이미지는 개발 의존성을 계속 제외한다.

```bash
cat > /tmp/youth-kkultong-step6-test.compose.yaml <<'YAML'
services:
  api:
    image: youth-kkultong-api-step6-test
    build:
      target: api-build
YAML
docker compose -f compose.yaml -f /tmp/youth-kkultong-step6-test.compose.yaml run --rm --build --no-deps api npm test
```

### 실제 검증과 남은 문제

- `npm install --workspace apps/api --save-exact typeorm@1.1.2 pg@8.23.1 zod@4.6.7 ...`: **통과**. 잠금 파일 갱신 후 Docker 이미지 안의 `npm ci`로 재설치·빌드 재현도 확인했다. 최초 다운로드와 Docker 소켓 사용은 허용된 실행 환경에서 수행했다.
- `npm run build --workspace apps/api`, `npm run typecheck --workspace apps/api`, `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`, `git diff --check`: **통과**. 초기 Zod 숫자 변환의 타입 연결 오류는 문자열 검증 → 숫자 변환 → 범위 검증으로 정정했다. TypeScript 검사를 생략하지 않았다.
- 설정 검사 `environment.spec.ts`·`load-environment.spec.ts` **25개 통과**: 기본값, 정수 경계, 필수 DB 주소·허용 프로토콜, 재시도·묶음 한도, 시간대, 키 미설정, 비밀값 비노출, `.env` 우선순위·부재·읽기 실패를 확인했다.
- 실제 PostgreSQL 연결·health 통합 검사를 포함한 전체 `npm test`: **4개 테스트 모음, 31개 통과**. Docker DB에 같은 네트워크에서 연결하고 임시 포트의 실제 API를 호출했다. DB 세션의 한국 시간대, 빈 Migration 적용 전/후 조회, 중복 재실행 방지, 애플리케이션 종료 후 연결 풀 반환을 확인했다. Migration 테스트는 자체 생성한 임시 스키마를 정리한다.
- 호스트에서 Docker의 내부 DB IP에 직접 접근하려던 최초 통합 검사는 연결 제한으로 **실패**했다. 이 환경에서는 내부 DB 네트워크의 검증 컨테이너로 실행 위치를 변경해 전체 통과했다. Jest 제한 시간을 DB 접속 제한 5초보다 긴 15초로 설정해 연결 실패 원인도 확인할 수 있게 했다. 모의 DB나 요구사항 완화로 대체하지 않았다.
- 실행 이미지에서 설정 오류 5종(DB 주소 누락·형식, 재시도 한도, 묶음 한도, 시간대)과 DB 인증 실패·연결 거부: **7개 모두 종료 코드 1, 오류 원인 표시, 비밀값 비노출 통과**. Migration CLI도 필수 DB 주소 오류 시 명확한 항목명과 종료 코드 1을 반환했다.
- `docker compose config --quiet`, `docker compose build api`, API 재기동 및 실제 `migration:run`·`migration:show`: **통과**. 현재 DB의 업무 테이블은 없고 TypeORM의 빈 `public.migrations` 이력 테이블만 존재한다(적용 기록 0건). 임시 `step6_test_*` 스키마 잔여 **0개**를 확인했다.
- 최종 세 서비스 **healthy**, API 직접 health·웹을 통한 health 전달 **통과**. 검증용 일회성 컨테이너는 `--rm`으로 제거했다. 기존 DB 볼륨과 orphan 컨테이너는 보존했고 `web`, 새 API, `db`는 실행 중이다.
- 설치 과정의 실행 의존성 검사 **0건**, 기존 개발 의존성의 중간 등급 **20건** 경고는 유지됐다. 별도 보안 수정이나 강제 패키지 변경은 하지 않았다. Jest의 VM 모듈 경고도 계속 출력된다.
- 실제 제품용 API 키의 준비·유효성 확인, 온통청년 호출, 업무 테이블·지역 시드·정책 수집은 이번 Step에서 실행하지 않았다. Step 6 완료를 막는 미해결 항목은 없다.

핵심 코드 읽는 순서: `common/environment.ts` → `database/data-source.ts` → `database/database.module.ts` → `database/migration-data-source.ts` → `test/database.spec.ts`.

## 10. Step 7 구현·검증 결과

사용자 요청으로 Step 6을 `3c62f80` (`chore: 환경변수 검증과 TypeORM 마이그레이션 구성`)으로 커밋한 뒤 Step 7을 진행했다. 착수 시 작업 트리는 깨끗했고, 개발 DB에는 적용 기록이 없는 `migrations` 테이블만 있었다.

### 구현과 실제 결정사항

- `modules/policies/entities/policy.entity.ts`에 SPEC 2.1의 29개 컬럼을 정의했다. TypeScript 식별자는 camelCase, DB 컬럼은 명세의 snake_case를 사용한다. `PoliciesModule`을 만들고 `AppModule`에 연결했다. 조회·저장 서비스나 Repository는 아직 추가하지 않았다.
- 단일 Migration `database/migrations/1792162800000-create-policies.ts`에서 정책 테이블, UUID 기본키, `(source, external_id)` 복합 고유 제약, 분야·조회수 내림차순·원본 등록일 내림차순 인덱스를 생성한다. 테이블과 인덱스는 Migration 전체 트랜잭션 안에서 적용된다. `down`은 해당 정책 테이블과 소속 인덱스·제약을 제거한다.
- TypeORM의 인덱스 데코레이터는 PostgreSQL의 DESC 방향을 표현하지 못하므로 두 내림차순 인덱스는 SQL로 생성한다. 엔티티에는 같은 이름을 `synchronize: false`로 표시하고, 실제 방향은 DB 통합 검사로 확인한다. 공통 `synchronize=false`와 `migrationsRun=false`도 유지한다.
- UUID는 PostgreSQL 17 내장 `gen_random_uuid()`로 자동 생성한다. TypeORM 설정에 `uuidExtension: 'pgcrypto'`로 같은 함수 선택을 지정하고 `installExtensions: false`로 확장 자동 설치를 끈다. 이름과 달리 별도의 pgcrypto 확장을 설치하거나 사용할 필요는 없다. 실제 DB에 `pgcrypto`·`uuid-ossp`가 없고 UUID가 정상 생성되는 것을 확인했다.
- 원본 등록·수정 시각은 `timestamp`, 내부 생성·갱신일은 `timestamptz`와 자동 시각 컬럼으로 구분한다. 신청 시작·종료일은 `date` 컬럼과 `YYYY-MM-DD` 문자열로 다룬다. 코드 목록은 `text[]`, 원본 객체는 `jsonb`, 해시는 `char(64)`로 저장한다. 명세의 선택 항목은 NULL을 허용하며 숫자 0·빈 배열·코드의 앞자리 0을 보존한다.
- DB 단계에서는 명세의 NOT NULL·타입·길이·고유 제약을 적용한다. 빈 정책 ID·제목 검증과 내용 해시 생성 등은 예정된 수집 Step에서 구현한다. 나이·지역 코드의 의미를 추정한 추가 DB 제약은 만들지 않았다.
- Step 6의 DB 연결 테스트는 애플리케이션 Migration의 추가 여부에 의존하지 않도록 해당 테스트의 엔티티·Migration 목록을 명시했다. Step 7 테스트는 매번 별도 임시 스키마에서 실제 Migration 파일을 실행하고 종료 시 제거한다. 개발 DB의 기존 테이블이나 데이터를 초기화하지 않는다.
- 사용자 검수에서 ARCHITECTURE의 디렉터리 구성을 따르지 않은 점이 확인돼 정책 모듈을 `src/modules/policies/`, 엔티티를 그 아래 `entities/`, 공통 설정을 `src/common/environment.ts`로 이동하고 모든 import를 맞췄다. 파일 이동 뒤 예전 엔티티 산출물이 중복 로딩되지 않도록 API 빌드 시작 시 생성물인 `dist`를 정리한다.
- API 계약·제품 규칙·계획의 설계 변경과 외부 패키지 추가는 없다. PRD·ARCHITECTURE·SPEC은 유지하고 PLAN·이 문서에 실제 결과만 반영했다.

참고: [PostgreSQL 17 내장 UUID 함수](https://www.postgresql.org/docs/17/functions-uuid.html), [TypeORM PostgreSQL 연결 옵션](https://typeorm.io/docs/drivers/postgres/).

### 실행 방법

Step 6의 DB·웹이 실행 중인 환경에서 다음 순서로 적용한다. 이미 적용된 Migration은 재실행하지 않는다.

```bash
docker compose build api
docker compose run --rm --no-deps api npm run migration:run
docker compose run --rm --no-deps api npm run migration:show
docker compose up -d --no-deps --wait --wait-timeout 60 api
```

현재 `migration:show`에는 `[X] 1 CreatePolicies1792162800000`이 표시된다. 로컬 직접 실행은 앞 절의 DB 주소 설정 후 `npm run build --workspace apps/api` → `npm run migration:run` 순서다. 통합 테스트는 앞 절의 `api-build` 임시 Compose 설정에서 `npm test`를 실행하면 현재 소스 기준으로 재현된다.

### 실제 검증과 남은 문제

- `npm run build --workspace apps/api`, `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`, 최종 `npm run typecheck --workspace apps/api`, `git diff --check`: **통과**. API 실행 이미지 빌드도 **통과**.
- 실제 PostgreSQL을 사용하는 전체 `npm test`: **5개 테스트 모음, 49개 통과**. Step 7 검사 18개에서 29개 컬럼의 타입·길이·NULL 여부, 엔티티와 DB 사이 변경 SQL 0건, 기본키·복합 고유 제약·3개 조회 인덱스, UUID·저장일 생성, NULL·길이 초과 거부, 원본 JSON·배열·날짜 보존, 갱신일 처리를 확인했다.
- 디렉터리 정정 후 API 빌드·전체 타입 검사·설정 테스트 25개와 실제 PostgreSQL 17 전체 테스트 49개를 다시 통과했다. 예전 `dist/policies`·`dist/config`가 제거되고 새 경로의 산출물만 생성되는 것도 확인했다. 중지됐던 Docker Desktop을 다시 기동했으며 사용자 인증 설정은 보존했다.
- 최초 중복 검사에서는 TypeORM이 INSERT 입력 객체에 생성 ID를 추가해 다음 INSERT가 기본키 중복을 일으켰다. 각 호출에 새 객체를 전달하도록 테스트 자료를 수정했고, 최종 검사는 단순 `23505` 코드뿐 아니라 `UQ_policies_source_external_id` 제약 이름까지 확인한다. 출처가 다르면 같은 외부 ID를 저장할 수 있다.
- 실제 Migration의 적용 전/후 조회, 재실행 무변경, 되돌리기·재적용 **통과**. 되돌리기는 자체 생성한 테스트 스키마에서만 수행했다. 기존 Step 6 검사도 모두 통과했다.
- 운영용 API 이미지의 CLI로 개발 DB에서 미적용 표시 → Migration 적용 → 재실행 시 `No migrations are pending` → 적용 표시를 확인했다. 최종 DB에는 `public.policies` **0건**, 해당 Migration 적용 이력 **1건**이 있다. 실제 개발 DB와 엔티티 사이 변경 SQL도 **0건**이다.
- 임시 `step6_test_*`·`step7_test_*` 스키마 잔여 **0개**, UUID 확장 설치 **0개**를 확인했다. 검증용 일회성 컨테이너는 제거됐고 기존 볼륨·orphan 컨테이너는 보존했다.
- 새 API 재기동 후 세 서비스 **healthy**, API 직접·웹 경유 health 응답 **통과**. `web`, `api`, `db`는 실행 중이다.
- 스키마 차이 검사 중 `pg`의 동시 쿼리 사용 중단 예고 경고가 출력된다. 추적 결과 TypeORM 내부의 `RdbmsSchemaBuilder.log` → 배열 타입 조회에서 발생했으며 테스트·Migration·서비스 기동은 통과했다. 외부 패키지 내부 수정은 하지 않고 호환성 후속 검토로 남긴다. 기존 Jest VM 모듈·개발 의존성 경고도 유지한다.
- Step 7 완료를 막는 미해결 사항은 없다. 지역 테이블·시드, 정책 수집·조회 API는 아직 구현하지 않았다.

핵심 코드 읽는 순서: `modules/policies/entities/policy.entity.ts` → `database/migrations/1792162800000-create-policies.ts` → `test/policy-schema.spec.ts` → `database/data-source.ts`.

## 11. Step 8 구현·검증 결과

사용자 요청에 따라 ARCHITECTURE의 디렉터리 구성을 맞추고 Step 7을 재검증한 뒤 `e08f0ae` (`feat: 정책 저장 테이블과 고유 제약조건 생성`)으로 커밋했다. 정책은 `src/modules/policies/`, 공통 설정은 `src/common/`, DB 기반은 `src/database/`에 둔다. Step 8 착수 시 작업 트리는 깨끗했고 기존 DB의 정책 Migration 이력 1건을 확인했다.

### 구현과 실제 결정사항

- `modules/meta/entities/region.entity.ts`에 SPEC 2.2의 `code`, `name`, `province_name`, `parent_code`, `is_active` 5개 컬럼을 정의했다. `MetaModule`을 만들고 `AppModule`에 연결했다. 지역 Repository·메타 API는 후속 Step 범위다.
- `database/migrations/1792162801000-create-regions.ts` 하나로 지역 테이블을 생성한다. 코드는 `varchar(5)` 기본키와 5자리 숫자 CHECK 제약으로 검증하고 앞자리 0을 보존한다. 지역명·시도 그룹명은 `varchar(100)` 필수값, 현행 여부는 기본값 없는 필수 boolean이다.
- `parent_code`는 같은 테이블의 `code`를 참조하는 nullable 외래키다. 엔티티의 `parent` 관계로 직접 상위 지역을 조회할 수 있으며 코드 앞자리로 관계를 추정하지 않는다. 참조 중인 상위 코드의 삭제·변경은 `NO ACTION`으로 거부한다. 폐지 여부를 false로 바꾸는 작업은 관계를 유지한다. 상위 지역이 없는 경우에는 NULL을 저장한다.
- 지역 코드의 고유성·형식, 필수값, 길이, 부모 참조를 DB에서 보호한다. 실제 공식 코드의 이름·현행 여부·부모 관계를 채우는 시드는 Step 9에서 출처 자료를 검증한 뒤 구현한다. 이번 테스트의 가상 자료는 테스트 전용 임시 스키마에만 저장했고 개발 DB에는 지역 데이터를 넣지 않았다.
- 정책 스키마 테스트는 정책 엔티티·Migration을 명시해 이후 Migration 추가에 영향을 받지 않도록 했다. 새 지역 테스트는 실제 정책 → 지역 Migration 순서를 함께 검증하고, health 테스트는 실제 애플리케이션이 두 엔티티를 정상 로딩하는지도 확인한다.
- API 계약·제품 판정 규칙·외부 패키지·공통 구조의 추가 변경은 없다. ARCHITECTURE에 정의된 경로를 그대로 따르며 SPEC의 의미 변경도 없어 기준 문서는 유지했다. PLAN과 이 문서에 Step 8의 실제 상태를 반영했다.

참고: [TypeORM 부모 참조 관계](https://typeorm.io/docs/relations/many-to-one-one-to-many-relations/), [PostgreSQL CHECK·외래키 제약](https://www.postgresql.org/docs/17/ddl-constraints.html).

### 실행 방법

기존 DB가 실행 중인 상태에서 앞 절과 같은 명령으로 API를 빌드하고 `npm run migration:run`·`migration:show`를 실행한다. 현재 적용 이력은 정책·지역 2건이며 재실행해도 중복 적용하지 않는다. API 시작 시 자동 Migration 실행은 하지 않는다.

통합 테스트는 Step 6에 기록한 `api-build` 임시 Compose 설정에서 `npm test`로 실행할 수 있다. 이번에는 기존 검증 이미지에 현재 소스·테스트를 읽기 전용으로 연결해 다음 명령으로 수행했다.

```bash
docker compose -f compose.yaml -f /tmp/youth-kkultong-step7-test.compose.yaml run --rm --pull never --no-deps \
  --volume "$PWD/apps/api/src:/app/apps/api/src:ro" \
  --volume "$PWD/apps/api/test:/app/apps/api/test:ro" api npm test
```

`step7-test.compose.yaml`은 앞 절의 검증용 설정과 같고 이미지 이름만 `youth-kkultong-api-step7-test`로 지정했다. 새 환경에서는 먼저 해당 설정으로 이미지를 빌드한다.

### 실제 검증과 남은 문제

- `npm run build --workspace apps/api`, `npm run typecheck --workspace apps/api`, `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`, `git diff --check`: **통과**.
- 실제 PostgreSQL 17의 전체 `npm test`: **6개 테스트 모음, 71개 통과**. 새 지역 검사 22개에서 컬럼·기본키·CHECK·외래키·엔티티 일치, 앞자리 0·NULL 보존, 명시적 부모 조회, 현행/폐지 조회, 중복·형식·NULL·길이 오류, 부모 삭제 거부, 폐지 전환 시 관계 보존을 확인했다.
- 정책 → 지역 Migration 연속 적용, 지역 Migration 재실행 무변경, 지역만 되돌리기·재적용 후 정책 데이터 유지 **통과**. 되돌리기와 가상 자료 저장은 매번 자체 생성한 임시 스키마에서만 수행한다. 기존 49개 검사도 통과했다.
- Docker Desktop이 중지돼 처음에는 컨테이너 검증을 실행하지 못했다. 기존 Desktop과 DB를 다시 기동해 이전 볼륨·Migration 이력을 보존했다. 공개 이미지 조회의 Windows 자격 증명 도우미 오류는 사용자 설정을 바꾸지 않고 `/tmp/youth-kkultong-docker-config/config.json`에 `{"auths": {}}`를 둔 임시 설정으로 우회했다. `docker --config /tmp/youth-kkultong-docker-config compose build api` **통과**. 사용자 Docker 로그인·인증 설정은 수정하지 않았다.
- 실행 이미지에서 지역 Migration 미적용 표시 → 적용 → 재실행 무변경 → 정책·지역 모두 적용 표시 **통과**. 최종 개발 DB의 `policies`·`regions`는 각 **0건**, Migration 이력은 **2건**이다. 공식 지역 시드는 미실행 상태다.
- 최종 실행 이미지에서 새 경로의 `Policy`·`Region` 엔티티만 중복 없이 로딩되고, 실제 DB와 엔티티 사이 변경 SQL **0건**, `step6_test_*`·`step7_test_*`·`step8_test_*` 잔여 스키마 **0개**임을 확인했다.
- API 직접·웹 경유 health 응답 **통과**, `web`·`api`·`db` 모두 **healthy**로 실행 중이다. 기존 DB 볼륨·orphan 컨테이너를 보존했다.
- 기존 TypeORM 스키마 검사 중 `pg` 사용 중단 예고·Jest VM 모듈·개발 의존성 경고는 유지하며 외부 패키지 변경은 하지 않았다. Step 8 완료를 막는 코드·DB 불일치는 없다.

핵심 코드 읽는 순서: `modules/meta/entities/region.entity.ts` → `database/migrations/1792162801000-create-regions.ts` → `test/region-schema.spec.ts`.

## 12. Step 9 구현·검증 결과

사용자 요청으로 Step 8을 `b4262d5` (`feat: 공식 지역 코드 테이블 생성`)로 커밋한 뒤 Step 9를 진행했다. 착수 시 작업 트리는 깨끗했고, 실제 개발 DB의 지역 테이블은 0건이었다.

### 공식 자료와 범위 결정

- [행정표준코드관리시스템 전체자료](https://www.code.go.kr/stdcode/regCodeL.do?menuNo=101010100010)의 법정동코드·공식 명칭·폐지 여부를 기준으로 삼았다. 10자리 코드 중 하위 5자리가 `00000`인 행만 5자리로 표현해 시도·시군구·일반구의 상위 시를 모두 포함했다. 전체 원본 53,403행에서 시드 **537개(현행 284, 폐지 253)**를 추출했다. 조사에서 관측한 261개 코드에 한정한 목록이 아니며, 해당 261종도 전부 포함됨을 별도로 확인했다.
- [행정안전부 2026.7.1. 시행 공지](https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000052&nttId=127039)(게시 2026-06-19)의 말소 포함 법정동 XLSX로 시도명·생성/말소일을 대조했다. 537개 모두 해당 자료에 있고 폐지 상태도 일치했다. 전체자료 자체에는 별도 버전 날짜가 없어 **2026-10-17 다운로드 검증일**과 **행정안전부 기준 시행일 2026-07-01**을 구분해 기록했다.
- 로컬 보관 원본 17개의 해시를 먼저 확인하고, 시드의 근거인 공식 전체자료 ZIP과 행정안전부 말소 포함 ZIP을 다시 내려받아 보관본과 SHA-256이 같음을 확인했다. 출처·다운로드 방식·원본 해시·시드 해시·자료 범위는 `database/seeds/regions.json`의 `source` 한곳에 보관한다.
- 부모는 코드 앞자리로 만들지 않았다. 공식 시군구 전체 명칭의 직접 상위 명칭을 정확히 조회하고 생성/말소 기간이 자식의 존속 기간을 포함하는 단일 코드를 선택했다. 같은 이름의 창원시·마산시 과거 코드도 이 기준으로 구분했다. `code.go`의 상위지역코드 필드는 일반구를 시도로 직접 연결하기도 하므로 SPEC에서 요구한 상위 시 관계에는 그대로 복사하지 않았다. 예: 수원시 장안구의 부모는 공식 명칭에 확인되는 수원시 `41110`이다.
- 행정안전부 자료에만 있는 출장소·일부 시도 표현 등 27개 코드는 공식 전체 법정동 자료의 5자리 범위에 없어 새로 보태지 않았다. 예를 들어 세종은 실제 존재하는 `36110`을 사용하며 `36000`을 가정해 만들지 않는다. 제외된 참조 코드 목록도 스냅샷의 `source.referenceOnlyCodes`에 남겼다.
- 과거 코드 `47012`의 명칭은 전체자료·공식 개별 조회가 `경상북도 대구시 중구`, 행정안전부 7월 XLSX가 `경상북도 대구시 동구`로 달랐다. 2026-10-17 공식 개별 조회까지 일치하는 전체자료 명칭을 저장하고, 원본 간 차이와 선택 근거를 `source.nameDifferences`·`nameDecision`에 명시했다. 코드는 폐지 상태로 보존하며 다른 코드로 치환하지 않는다.

### 구현과 실제 결정사항

- `database/seeds/prepare-regions.py`는 Python 표준 라이브러리만으로 검증된 공식 ZIP·XLSX를 읽고 스냅샷을 결정적으로 재생성한다. 고정한 원본 해시·건수·날짜·미검토 명칭 차이·부모 관계가 맞지 않으면 실패한다. 네트워크·환경변수를 읽지 않고 DB에도 연결하지 않는다.
- 생성한 `regions.json`은 Git 추적 대상에 포함된다. 조사 폴더가 없는 새 환경이나 API 실행 이미지에서도 저장된 스냅샷만으로 시드를 실행할 수 있다. 원본에서 재생성할 때만 공식 원본 파일이 필요하며, 원본의 출처와 해시는 JSON에 포함돼 있다.
- `database/seeds/regions.seed.ts`는 Zod로 5자리 코드·이름·시도명·부모 코드·현행 여부를 검증하고, 중복 코드·현행 이름 중복·없는 부모·자기 참조·잘못된 직접 상위 명칭/시도를 거부한다. 공식 역사 자료에는 같은 이름의 다른 코드가 있으므로 폐지 명칭 중복을 임의로 제거하지 않는다.
- 한 트랜잭션의 묶음 upsert로 537개를 입력·갱신한다. 코드 기본키로 중복을 막고 내용이 같으면 불필요한 갱신을 건너뛴다. 이번 자료에 없는 기존 행은 삭제하지 않으며 DB 오류가 발생하면 전체 작업을 취소한다.
- 루트와 API 작업공간에 `seed:regions` 명령을 추가했다. CLI는 스냅샷 해시·설정을 검사한 뒤 DB에 연결하고 결과 건수·자료 기준일을 기록한다. 실패 단계와 오류를 구분하며 모든 종료 경로에서 연결 정리를 시도한다. DB 접속 URL·비밀값은 출력하지 않는다.
- API `tsconfig.json`에 `resolveJsonModule`을 적용해 TypeScript 빌드가 JSON을 실행 산출물에 함께 복사한다. 실행 이미지에는 Python이나 조사 원본이 필요 없다. 외부 패키지·DB 스키마·Migration·API 계약·제품 판정 규칙은 변경하지 않았다. PLAN과 이 문서에 완료 상태를 반영했다.

### 실행 방법

기존 DB와 Migration이 준비된 Compose 환경에서 실행한다. 이미 빌드·적용된 현재 환경에서는 `seed:regions`만 다시 실행해도 된다.

```bash
docker compose build api
docker compose up -d --no-deps --wait --wait-timeout 60 api
docker compose exec -T api npm run seed:regions
```

앞 Step의 Docker 자격 증명 도우미 오류가 있는 이 세션에서는 기존 임시 설정으로 `docker --config /tmp/youth-kkultong-docker-config compose build api`를 사용했다. 사용자 Docker 인증 설정은 변경하지 않았다.

호스트에서 직접 실행하려면 접근 가능한 `DATABASE_URL`을 설정한 뒤 실행한다. 새 DB는 먼저 Migration을 적용한다.

```bash
npm run build --workspace apps/api
npm run migration:run
npm run seed:regions
```

공식 원본이 있는 경우에만 스냅샷을 재생성한다. 기본 입력은 Git 제외된 조사 원본 경로이며 `--source-dir`로 다른 보관 디렉터리를 지정할 수 있다.

```bash
python3 apps/api/src/database/seeds/prepare-regions.py
python3 apps/api/src/database/seeds/prepare-regions.py --output /tmp/youth-regions-reproduced.json
cmp apps/api/src/database/seeds/regions.json /tmp/youth-regions-reproduced.json
```

전체 테스트는 앞 Step의 검증용 Compose 설정에서 `npm test`로 수행한다. 이번에는 기존 이미지에 소스·테스트와 최신 JSON 설정을 함께 연결했다.

```bash
docker compose -f compose.yaml -f /tmp/youth-kkultong-step7-test.compose.yaml run --rm --pull never --no-deps \
  --volume "$PWD/apps/api/src:/app/apps/api/src:ro" \
  --volume "$PWD/apps/api/test:/app/apps/api/test:ro" \
  --volume "$PWD/apps/api/tsconfig.json:/app/apps/api/tsconfig.json:ro" api npm test
```

### 실제 검증과 남은 문제

- 공식 원본 17개 보관 해시, 시드 근거 원본 2개의 재다운로드 해시, 스냅샷 재생성 후 `cmp`: **통과**. 공식 공지의 게시일·시행일과 `47012` 개별 조회도 확인했다. 정규화된 시드는 원본의 명칭·상태를 보존하고 코드 앞자리로 부모를 추측하지 않는다.
- `npm run build --workspace apps/api`, `npm run typecheck --workspace apps/api`, `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`, `git diff --check`: **통과**. Docker 안의 잠금 파일 기반 `npm ci`와 API 빌드도 **통과**했고 실행 이미지에 시드 JS·JSON이 포함됨을 확인했다.
- 전체 `npm test`: **8개 테스트 모음, 93개 통과**. 기존 71개에 자료 검증 17개·실제 DB 시드 검사 5개를 추가했다. 537개 전체와 현행/폐지 건수·해시, 주요 현행/과거 코드와 부모, 잘못된 자료 거부를 확인했다.
- 실제 PostgreSQL 17에서 자식부터 나열한 전체 입력, 같은 자료 반복 입력, 공식 값 갱신, 자료에 없는 기존 행 보존, 검증 실패 시 무변경, 저장 중 DB 제약 오류 시 기존 값·신규 입력 롤백 **통과**. 테스트는 자체 생성 스키마에서만 수행하고 정리했다.
- 실행용 API 이미지의 `npm run seed:regions`를 실제 개발 DB에서 **2회 성공**했다. 최종 지역은 **537개(현행 284, 폐지 253)**이며 수원시–장안구, 창원시–의창구, 폐지된 마산시–합포구와 인천 중구·세종의 관계를 실제 SQL로 확인했다.
- 실행 이미지에서 잘못된 필수 설정에 종료 코드 1·항목명 표시·접속 URL 비노출 **통과**. 최종 검증 스키마 잔여 **0개**, 정책 **0건**, 기존 Migration 이력 **2건**을 확인했다.
- 새 API 기동 및 직접·웹 경유 health 응답 **통과**, `web`·`api`·`db` 모두 **healthy**로 실행 중이다. 기존 볼륨·orphan 컨테이너는 보존했다. 기존 TypeORM·Jest·개발 의존성 경고는 유지하며 이번에 강제 수정하지 않았다.
- Step 9 완료를 막는 자료 누락·코드/DB 불일치는 없다. 스냅샷은 검증한 기준의 자료이며 향후 공식 개편 시 원본과 해시·명칭/기간 차이를 다시 검토해 갱신한다. 실제 정책 수집이나 지역 메타 API는 이번 범위가 아니다.

핵심 코드 읽는 순서: `database/seeds/regions.seed.ts` → `database/seeds/regions.json`의 `source` → `database/seeds/prepare-regions.py` → `test/region-seed.integration.spec.ts`.

## 13. Step 10 구현·검증 결과

사용자 요청으로 Step 9를 `018eab9` (`feat: 공식 지역 코드 초기 데이터 구성`)로 커밋한 뒤 Step 10을 진행했다. 커밋 직후 작업 트리는 깨끗했다.

### 구현과 실제 결정사항

- `packages/shared/src/policies.ts`에 SPEC 3장의 `SortKey`, `ApplicationStatus`, `MatchTag`, `UserConditions`, `PolicySearchRequest`, `PolicyCard`, `PolicySearchResponse`, `PolicyDetail`을 그대로 정의했다. 선택 입력과 응답의 필수 nullable 필드를 구분하고, 상세는 카드를 확장한다. 날짜·점수·숫자 범위는 명세의 자료형과 주석을 유지한다.
- `src/index.ts`는 8개 타입만 다시 내보낸다. 공용 패키지의 `types`·`exports`는 루트와 `/policies`에서 같은 소스 타입을 읽도록 구성했다. DB 엔티티·TypeORM·NestJS 의존성과 런타임 내보내기는 없다. 따라서 별도 공용 빌드 없이 웹의 Bundler 설정과 API의 NodeNext 설정에서 모두 사용할 수 있다.
- 웹·API는 공용 작업공간 `0.1.0`을 개발 의존성으로 선언하고 잠금 파일을 동기화했다. 타입 전용이므로 실행 이미지의 운영 의존성에 추가하지 않았다. 외부 패키지는 추가하지 않았다.
- Dockerfile의 API·웹 빌드 단계에 `packages/shared/src` 복사만 추가했다. 설치 단계에서 이미 복사하는 공용 `package.json`과 연결되며 실행 이미지에는 공용 소스가 필요 없다.
- 새 엔드포인트·DB 스키마·Migration·런타임 판정 규칙은 추가하지 않았다. 요청값 검증은 Step 11, 정책·메타 API 구현은 해당 후속 Step에서 진행한다. SPEC의 계약 변경 없이 PLAN과 이 문서에 완료 상태만 반영했다.

웹·API에서 동일하게 다음 경로를 사용한다. 두 경로가 내보내는 타입은 같다.

```ts
import type { PolicySearchRequest, PolicySearchResponse } from '@youth-kkultong/shared';
import type { PolicyDetail } from '@youth-kkultong/shared/policies';
```

### 실제 검증과 남은 문제

- `npm install --package-lock-only --ignore-scripts --offline --no-audit --no-fund`: **통과**. 기존 작업공간 연결을 사용하며 외부 패키지 버전 변경은 없다.
- `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`: **공용·API·웹 모두 통과**. API의 기존 테스트 소스도 타입 검사에 포함했다.
- 실제 API·웹 tsconfig를 읽는 TypeScript 컴파일러 검사에서 루트·하위 경로의 **8개 타입이 동일**하고 실제 해석 경로가 모두 `packages/shared/src`임을 확인했다. 정상 검색 요청·nullable 카드·상세 확장·검색 응답을 양쪽에서 통과시키고 잘못된 정렬·상태·태그·나이 자료형·마감 포함 자료형·필수 제목 null·필수 nullable 필드 누락·상세 링크 표시명 등 **오류 8종을 양쪽에서 거부**했다. 임시 가상 소스를 사용해 제품 코드에 검사 예시를 남기지 않았고, 변환 결과에 공용 패키지의 런타임 import가 없는 것도 확인했다.
- `NEXT_TELEMETRY_DISABLED=1 npm run build`: **공용·API·웹 모두 통과**. 첫 샌드박스 실행은 Next.js가 TypeScript `--showConfig` 출력을 해석하지 못해 실패했다. Node 자식 프로세스의 단순 출력도 비는 현상을 재현한 뒤, 같은 빌드를 샌드박스 밖에서 재실행해 통과했다. 이 문제를 우회하는 제품 코드 변경은 하지 않았다.
- `docker --config /tmp/youth-kkultong-docker-config compose build api web`: **두 이미지 모두 통과**. 잠금 파일 기반 `npm ci`, API 운영 의존성 설치, 공용 소스 복사, 양쪽 빌드 및 실행 이미지 생성까지 확인했다. 앞 Step의 임시 Docker 인증 설정을 재사용했으며 사용자 설정은 변경하지 않았다.
- `git diff --check`: **통과**. 이번 변경은 타입·빌드 입력에 한정되어 DB 통합 테스트는 재실행하지 않았다. Step 9의 93개 통과 기록은 앞 절에 남겼다. DB와 실행 중인 컨테이너는 변경하지 않았다.
- Step 10 완료를 막는 불일치는 없다. 타입 선언만으로 숫자 범위·실제 날짜·공식 코드 값이 검증되지는 않으며, 요청의 실행 시점 검증은 Step 11에서 구현한다.

핵심 코드 읽는 순서: `packages/shared/src/policies.ts` → `packages/shared/src/index.ts` → `packages/shared/package.json` → `Dockerfile`.

## 14. Step 11 구현·검증 결과

Step 10의 실제 커밋 `f102143` (`feat: 정책 조회 공용 타입 정의`)과 깨끗한 작업 트리를 확인한 뒤 진행했다.

### 구현과 실제 결정사항

- `packages/shared/src/policy-search.schema.ts`의 `createPolicySearchSchema`에 요청 검증을 정의했다. 페이지는 1 이상의 정수, 크기는 1~50의 정수, 나이는 1~120의 정수이며 숫자·불리언 문자열을 자동 변환하지 않는다. 기본값은 `page=1`, `limit=20`, `includeClosed=false`다. 분야는 빈 문자열을 허용하고 정확 일치 비교를 위해 원문을 보존한다.
- 정렬은 명세의 4개 값만 허용한다. 조건에 따른 기본 정렬과 조건 없는 맞춤순의 인기순 전환은 Step 40의 검색 처리에 남겨두고 검증에서는 요청한 정렬을 보존한다.
- 지역·취업·학력은 호출자가 전달한 허용 코드 집합에 포함된 값만 허용한다. 지역은 5자리 형식도 검사한다. 지역 집합에는 DB의 현행 코드만, 취업·학력 집합에는 검증된 서버 코드표만 전달해야 한다. 목록이 비었을 때 임의 코드를 통과시키는 대체 동작은 없다.
- 실제 지역 조회는 Step 30, 취업·학력 전체 코드표는 Step 29의 범위이므로 선행 구현하지 않았다. 테스트는 Step 9의 실제 현행·폐지 지역 스냅샷과 SPEC에 명시된 제한 없음 취업·학력 코드의 부분 목록을 사용한다. 이를 제품용 전체 코드표로 등록하지 않았다. Step 41에서 준비된 메타 자료를 스키마에 전달하고 검색 API에 연결한다.
- `apps/api/src/common/zod-validation.pipe.ts`는 임의의 Zod 스키마를 `@Body`·`@Param`에 연결할 수 있는 재사용 파이프다. 검증 실패는 `BadRequestException`으로 처리하고 입력값을 포함할 수 있는 Zod 오류 원문을 응답·로그에 내보내지 않는다. 검증 전용 Nest 컨트롤러에서 검색 본문과 UUID 경로값에 실제 연결해 HTTP 동작을 확인했다.
- `common/api-exception.filter.ts`를 `main.ts`의 공통 애플리케이션 설정에 전역 등록했다. API 오류는 `{ code, message }`만 반환한다. 주요 코드는 `BAD_REQUEST`(400), `NOT_FOUND`(404), `INTERNAL_SERVER_ERROR`(500), `SERVICE_UNAVAILABLE`(503)다. HTTP 예외의 상태 코드는 유지하고, 예상하지 못한 오류·SQL 문법/제약 오류는 500으로 처리한다.
- PostgreSQL·네트워크 연결 오류 코드, 연결되지 않은 TypeORM DataSource, `pg`·`pg-pool`의 코드 없는 연결 종료·연결 대기 시간 초과 오류는 503으로 구분한다. 코드 없는 오류의 문구는 설치된 드라이버 소스와 대조했다. 5xx는 공개 오류 코드·상태만 기록하고 SQL·접속 정보·사용자 본문·예외 원문을 노출하지 않는다.
- 공용 패키지에 기존에 사용하는 Zod `4.6.7` 의존성과 루트·하위 경로의 실행 파일 내보내기를 추가했다. 타입 경로와 기존 타입 계약은 유지한다. Zod의 URL 타입 선언을 읽기 위해 공용 tsconfig에 DOM 타입을 추가했다. API는 공용 패키지를 운영 의존성으로 옮기고 `prebuild`·`pretest`에서 먼저 빌드한다. Dockerfile에도 공용 tsconfig와 운영 이미지의 공용 빌드 결과를 포함했다. 새로운 외부 패키지·DB 스키마·Migration·제품 엔드포인트는 추가하지 않았다.
- API 계약과 설계의 의미를 바꾸지 않아 SPEC·SPEC_SUMMARY·PRD·ARCHITECTURE는 수정하지 않았다. PLAN 완료 표시와 실제 결과를 이 문서에 반영했다.
- 후속 주석 검수에서 스키마·인터페이스·검증 파이프·오류 필터·서버 시작 함수와 테스트용 컨트롤러의 역할을 간결한 한국어로 명시했다. 실행 코드는 변경하지 않았다.

### 실행 방법

DB 없이 이번 요청 검증만 확인하려면 다음을 실행한다. 공용 패키지 빌드는 `pretest`에서 자동 수행한다.

```bash
npm run test --workspace apps/api -- --runTestsByPath test/policy-search-validation.spec.ts test/request-validation.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
NEXT_TELEMETRY_DISABLED=1 npm run build
```

전체 DB 테스트는 실행 중인 Compose DB와 같은 네트워크의 테스트 이미지에서 수행했다. `/tmp/youth-kkultong-step11-test.compose.yaml`은 `api`의 `image: youth-kkultong-api-step11-test`, `build.target: api-build`만 덮어쓰는 임시 설정이다.

```bash
docker --config /tmp/youth-kkultong-docker-config compose build api web
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f /tmp/youth-kkultong-step11-test.compose.yaml build api
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f /tmp/youth-kkultong-step11-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/test:/app/apps/api/test:ro" api npm test
```

### 실제 검증과 남은 문제

- `npm install --package-lock-only --ignore-scripts --offline --no-audit --no-fund`: **통과**. 새 의존성 버전은 도입하지 않고 공용 런타임 연결을 잠금 파일에 반영했다.
- 전체 테스트: **10개 테스트 모음, 189개 통과**. 기존 93개와 신규 단위 60개·HTTP 통합 36개를 포함한다. 페이지·크기·나이 경계, 자료형·null·비정상 정렬, 폐지/알 수 없는 지역 및 허용 목록 밖 취업·학력 코드 거부, 기본값, UUID 파이프 재사용, JSON 구문 오류, 400/404/500/503 및 429 상태 보존, 민감값 비노출을 확인했다. 기존 PostgreSQL 스키마·Migration·시드 검증도 함께 통과했다.
- 최초 단독 HTTP 테스트는 샌드박스의 로컬 포트 사용 제한(`listen EPERM`)으로 실패했고, 같은 테스트를 샌드박스 밖에서 실행해 통과했다. 첫 전체 실행에서는 API 접두사 밖 `/health`·`/api/health`에도 JSON 오류 본문을 기대한 테스트 2개가 실패했다. 설치된 NestJS 12 어댑터가 접두사 밖 404를 기본 처리함을 확인하고, API 계약 대상이 아닌 두 경로는 기존의 404 상태 검사로 정정했다. `/api/v1`의 없는 경로와 잘못된 메서드는 공통 JSON 오류 형식까지 검증하며 전체 재실행에 통과했다.
- `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`: **공용·API·웹 통과**. `NEXT_TELEMETRY_DISABLED=1 npm run build`: **공용·API·웹 통과**. 빌드의 첫 샌드박스 실행은 Step 10과 같은 Next.js 자식 프로세스 출력 해석 문제로 실패했고, 동일 명령을 샌드박스 밖에서 재실행해 통과했다.
- Docker 잠금 파일 기반 `npm ci`, API·웹 빌드와 최종 운영 이미지 생성: **통과**. 최종 API 이미지의 임시 컨테이너에서 공용 스키마 로딩·기본값·잘못된 페이지 거부·실제 DB 연결·health 200·공통 JSON 404 응답·앱 종료를 확인했다. 실행 중인 API·웹·DB는 교체하지 않았다.
- `git diff --check`: **통과**. 전체 테스트 종료 후 검증 스키마 잔여 **0개**, 기존 정책 **0건**·지역 **537개**·Migration **2건**을 읽기 전용 SQL로 확인했다.
- Step 11 완료를 막는 불일치는 없다. 코드 목록의 실제 조회·검색 API 연결은 예정된 후속 Step의 작업이다. 기존 개발 의존성의 경고와 `pg`·Jest 경고는 이번 범위에서 변경하지 않았다.

핵심 코드 읽는 순서: `packages/shared/src/policy-search.schema.ts` → `apps/api/src/common/zod-validation.pipe.ts` → `apps/api/src/common/api-exception.filter.ts` → `apps/api/src/main.ts` → `apps/api/test/request-validation.spec.ts`.

## 15. Step 12 구현·검증 결과

Step 11의 실제 커밋 `55ad49f` (`feat: API 요청 검증과 공통 오류 응답 적용`)과 깨끗한 작업 트리를 확인한 뒤 진행했다.

### 구현과 실제 결정사항

- `IngestionModule`에 `YouthCenterClient`를 등록·내보내고 `AppModule`에 연결했다. 기존 `DatabaseModule`에서 검증한 환경변수를 주입받는다. 클라이언트 생성 시 인증키를 강제하지 않아 키 없는 조회 서버는 계속 실행할 수 있고, `fetchPage(pageNum)` 호출 시에만 필수 키를 검사한다.
- SPEC 5.1의 엔드포인트에 `GET`으로 `apiKeyNm`, `pageType=1`, `rtnType=json`, 지정한 `pageNum`, 설정한 `pageSize`를 전송한다. 페이지는 1 이상의 안전한 정수만 허용한다. Node.js 내장 `fetch`를 사용해 외부 패키지를 추가하지 않았다.
- 응답은 `httpStatus`, `httpOk`, `apiSuccess`, `body`, `retryAfter`로 구분한다. `apiSuccess`는 본문의 숫자형 `resultCode === 200`만 판단하며 HTTP 성공 여부와 독립적이다. 호출자는 두 성공 값을 함께 확인해야 한다. HTTP 400·401·403·429·5xx도 받은 본문을 그대로 반환하고, JSON이 아닌 HTML·깨진 JSON·빈 본문은 문자열로 보존한다. 성공 값만으로 정책 배열·페이지 구조가 유효하다고 간주하지 않으며 상세 구조 검증은 Step 14에서 진행한다.
- 요청과 본문 읽기 전체에 30초 제한을 적용했다. 연결·본문 읽기 실패는 `NETWORK`, 시간 초과는 `TIMEOUT`으로 구분하는 `YouthCenterRequestError`를 전달한다. 오류에는 페이지·실패 종류만 담고 URL·인증키·원본 오류·`cause`는 포함하지 않는다. 키가 포함된 URL의 리다이렉트를 따르지 않으며 클라이언트는 로그를 출력하지 않는다.
- 지정한 페이지를 한 번만 요청한다. `Retry-After`는 후속 처리를 위해 보존하며 재시도·대기·전체 페이지 순회·Zod 구조 검증·DB 저장·CLI는 이번 Step에 추가하지 않았다.
- API 계약·DB·Migration·설계 의미의 변경은 없다. PLAN 완료 표시와 실제 검증 결과만 문서에 반영했다.

### 실행 방법

DB 없이 단일 페이지 모의 호출을 검증한다.

```bash
npm run test --workspace apps/api -- --runTestsByPath test/youth-center.client.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
```

전체 회귀 테스트는 Step 11의 기존 테스트 이미지에 현재 API 소스·테스트를 읽기 전용으로 연결해 실행했다. 의존성과 공용 패키지는 Step 11 이후 변경하지 않았다. 테스트의 임시 스키마를 사용하며 실행 중인 서비스는 교체하지 않는다.

```bash
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f /tmp/youth-kkultong-step11-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" api npm test
```

### 실제 검증과 남은 문제

- 신규 모의 호출 테스트 **30개 통과**: 지정 페이지·기본/변경 크기·특수문자 키 인코딩, HTTP 오류와 API 오류의 구분, 숫자형 성공 코드, 원문 보존, 잘못된 페이지·키 누락의 호출 전 거부, 연결·본문 읽기 실패, 실제 AbortSignal 취소 경로와 민감값 비노출을 확인했다. 오류 시에도 재시도하지 않는 것을 확인했다.
- 전체 회귀 테스트 **11개 테스트 모음·219개 통과**. 실제 PostgreSQL 스키마·시드·기존 HTTP 테스트를 포함하며 새 `IngestionModule`의 의존성 주입과 키 없는 서버 기동도 통과했다.
- `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`: **공용·API·웹 통과**. `npm run build --workspace apps/api`: **공용 선행 빌드·API 빌드 통과**. 웹 소스 변경이 없어 Next.js 배포 빌드는 재실행하지 않았다.
- `/tmp/youth-kkultong-step12-check.cjs`로 보관된 `docs/api-research/samples/initial-page-0001-size-5.json`을 클라이언트에 전달해 HTTP/API 성공과 본문 보존을 확인했다. 이 조사 자료와 임시 검증 스크립트는 Git 추적 대상이 아니며 자동 테스트는 독립적인 모의 응답을 사용한다.
- **2026-10-17 실제 호출 성공:** 명세의 `pageType=1`, `rtnType=json`, `pageNum=1`, `pageSize=50` 요청에서 HTTP **200**, `resultCode=200`, 응답 페이지 **1**, 크기 **50**, 반환 **50건**, 당시 `totCount=3264`를 확인했다. 전체 건수는 관측값이며 고정 기준으로 사용하지 않는다.
- 제품용 키는 미설정이므로 수동 검증 프로세스에서만 기존 조사용 키를 제품 설정에 주입했다. `.env`와 제품 코드에는 별칭·자동 대체를 추가하지 않았고 키·요청 URL·실제 응답 원문을 출력·저장하지 않았다. 첫 수동 검증은 로컬 `.env`에 `DATABASE_URL`이 없어 호출 전에 종료됐으며, DB를 사용하지 않는 검증용 주소를 전달해 수정했다. 샌드박스의 외부 네트워크·Docker 접근 제한은 샌드박스 밖에서 동일 검증을 실행해 해결했다. 클라이언트 자체의 자동 재시도는 없다.
- `git diff --check`: **통과**. Step 12 완료를 막는 불일치는 없다. 기존 `pg`·Jest 경고와 고아 컨테이너 안내는 이번 범위에서 변경하지 않았다.

핵심 코드 읽는 순서: `apps/api/src/modules/ingestion/youth-center.client.ts` → `apps/api/src/modules/ingestion/ingestion.module.ts` → `apps/api/src/app.module.ts` → `apps/api/test/youth-center.client.spec.ts`.

## 16. Step 13 구현·검증 결과

사용자의 명시적 커밋 요청에 따라 Step 12 변경사항 6개 파일을 `baa6f45` (`feat: 온통청년 정책 한 페이지 조회 구현`)로 커밋했다. 깨끗한 작업 트리를 확인한 뒤 Step 13만 진행했다.

### 구현과 실제 결정사항

- `YouthCenterClient.fetchPageWithRetry(pageNum)`를 추가했다. Step 12의 `fetchPage`는 한 번만 호출하는 저수준 함수로 유지하며, 새 함수가 동일 페이지의 재시도와 순차 수집 시 페이지 간 대기를 담당한다. 성공 응답에는 실제 `attempts`를 추가한다.
- 연결 실패·시간 초과·HTTP 429·500~599만 재시도한다. `YOUTH_CENTER_MAX_ATTEMPTS`를 적용해 기본 최대 3회이며 **첫 시도도 포함**한다. 기본 대기는 첫 실패 후 1초, 두 번째 실패 후 2초다. 성공한 페이지를 자동으로 다시 호출하지 않으며 최대 횟수에 도달하면 추가 대기 없이 종료한다.
- HTTP `400/401/403` 등 비재시도 상태, HTTP 200의 JSON/성공 값 오류는 즉시 실패한다. 본문의 `errorCode` 또는 `resultCode`가 `e003`이면 HTTP 429·5xx나 성공 값과 충돌해도 재시도하지 않는다. 5xx의 HTML 본문은 HTTP 일시 오류로 분류한다. 정책 배열·페이지·필수 필드의 상세 구조 검증은 Step 14에 남겼다.
- 단일 호출의 통신 오류를 세분화했다. Node.js·내장 HTTP 클라이언트의 확인된 연결 오류 코드는 `NETWORK`, AbortSignal 및 연결·헤더·본문 시간 초과는 `TIMEOUT`으로 분류한다. 인증서·요청 설정·응답 해석 등 그 밖의 통신 예외는 `REQUEST`로 안전하게 변환해 반복하지 않는다. 원본 `cause`를 포함한 오류나 URL·키를 외부로 전달하지 않는다.
- `Retry-After`가 유효하면 기본 대기보다 우선한다. 0 이상의 정수 초와 HTTP 날짜를 지원하며 날짜는 GMT 기준이다. 0초·이미 지난 날짜는 추가 대기하지 않고, 잘못된 값은 기본 대기로 돌아간다. 구형 asctime 날짜의 시간대가 서버의 한국 시간대로 해석되지 않도록 보정했다. Node.js 타이머 상한을 넘는 유효 대기는 여러 구간으로 나눠 기다린다. 기준: [RFC 9110의 Retry-After](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after), [Node.js 타이머 상한](https://nodejs.org/api/timers.html#settimeoutcallback-delay-args).
- 순차 호출의 다음 페이지는 이전 페이지 작업의 최종 응답·실패 이후 `YOUTH_CENTER_REQUEST_DELAY_MS`(기본 3000ms)가 지난 뒤 시작한다. 이미 지난 시간은 빼며, 첫 페이지는 바로 시작한다. 같은 페이지의 재시도에는 3초를 중복 적용하지 않는다. 호출 간격 측정에는 시스템 날짜 변경의 영향을 받지 않는 `performance.now()`를 사용한다.
- 최종 실패는 `YouthCenterPageError`로 전달한다. `pageNum`, 실제 `attempts`, `reason`(`RETRY_EXHAUSTED`/`NON_RETRYABLE`), `failure`, 확인 가능한 `httpStatus`만 포함한다. 원문·인증키·URL은 담지 않으며 파일 로그 연결은 Step 24에서 진행한다.
- 기존 단일 호출 테스트 2곳은 실제 소켓 오류 코드가 있는 모의 예외로 보강했고, 새 재시도 테스트를 별도 파일에 추가했다. 새 외부 패키지·모듈·공개 API·DB·Migration 변경은 없다. 설계 의미가 같아 SPEC은 변경하지 않았다.

### 실행 방법

```bash
npm run test --workspace apps/api -- --runTestsByPath test/youth-center.client.spec.ts test/youth-center-retry.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
```

전체 회귀 테스트는 Step 12와 동일하게 기존 테스트 이미지에 현재 소스·테스트를 읽기 전용으로 연결했다.

```bash
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f /tmp/youth-kkultong-step11-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" api npm test
```

### 실제 검증과 남은 문제

- 단일 호출·재시도 테스트 **2개 모음·104개 통과**(기존 30개 + 신규 74개). Jest 가상 시간으로 정확한 호출 시점과 횟수를 확인했다. 연결·본문 읽기·시간 초과 후 성공, HTTP 429·5xx, 최대 1/2/3회 설정, e003·인증·형식·인증서·미분류 오류의 즉시 중단, 동일 페이지 재요청, 성공 페이지 유지, Retry-After 초·세 가지 HTTP 날짜 형식·오류 값·타이머 상한, 페이지 간 기본/변경 간격, 실패 후 새 요청, 민감값 비노출을 검증했다.
- 최초 실행에서 **2개 실패**: 실행 문맥에 따라 `DOMException`이 `Error`의 인스턴스로 판별되지 않는 문제와 asctime HTTP 날짜가 한국 시간대로 해석되는 문제였다. 오류의 `name`을 구조적으로 확인하고 구형 HTTP 날짜를 GMT로 해석하도록 수정한 뒤 104개 모두 통과했다.
- 실제 PostgreSQL·HTTP 경로를 포함한 전체 회귀 테스트 **12개 모음·293개 통과**. 실행 중인 API·웹·DB 서비스를 교체하지 않았다.
- `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`: **공용·API·웹 통과**. `npm run build --workspace apps/api`: **공용 선행 빌드·API 빌드 통과**. 웹 소스 변경이 없어 Next.js 배포 빌드는 재실행하지 않았다.
- `git diff --check`: **통과**. 실제 온통청년 API의 오류를 유발하는 호출은 하지 않았고, 일시 오류는 모의 응답으로 검증했다. 실제 정상 단일 페이지 호출 근거는 Step 12 기록을 따른다.
- Step 13 완료를 막는 불일치는 없다. 전체 페이지 순회는 Step 16에서 새 재시도 함수를 순차 호출하도록 연결해야 한다. 기존 `pg`·Jest 경고와 고아 컨테이너 안내는 이번 범위에서 변경하지 않았다.

핵심 코드 읽는 순서: `apps/api/src/modules/ingestion/youth-center.client.ts`의 `fetchPageWithRetry` → `fetchPage`의 통신 오류 분류 → `retryDelay`·`wait` → `apps/api/test/youth-center-retry.spec.ts`.

## 17. Step 14 구현·검증 결과

사용자의 명시적 요청에 따라 Step 13 구현과 사용자가 수정한 `AGENT_RULES.md`의 주석 규칙을 `9e17954` (`feat: 온통청년 API 일시 오류 재시도 처리`)로 커밋했다. 사용자 주석은 보존하고 줄 끝 공백 2곳만 정리했으며, 커밋 후 깨끗한 작업 트리를 확인했다.

### 구현과 실제 결정사항

- `youth-center-response.schema.ts`에 온통청년 목록 응답의 Zod 구조 검증을 정의했다. 숫자형 성공 값 `resultCode=200`, 문자열 `resultMessage`, 객체 `result`, 배열 `youthPolicyList`, 객체 `pagging`을 확인한다. `pagging.totCount`는 0 이상의 안전한 정수, `pageNum`·`pageSize`는 1 이상의 안전한 정수만 허용하며 문자열 숫자를 자동 변환하지 않는다.
- 정책 항목은 객체여야 하고 `plcyNo`·`plcyNm`은 공백만 있지 않은 필수 문자열이어야 한다. 문자열에 공백이 있는지 검사하되 원문을 잘라내거나 변환하지 않는다. 모든 객체에 추가 필드를 허용해 이후 변환·원본 보관에 필요한 값도 유지한다. 반환 데이터의 객체 키 순서는 달라질 수 있으나 필드와 값은 보존한다.
- `parseYouthCenterPageResponse`는 실패를 `YouthCenterResponseValidationError`로 변환한다. 수집 단계 `PAGE_VALIDATION`, 요청 페이지, 실제 시도 횟수, 중복을 제거한 실패 필드 경로를 전달한다. 루트 오류는 `$`, 정책 항목 오류는 `result.youthPolicyList.0.plcyNo`처럼 배열 위치까지 식별한다. 입력값·인증키·URL·Zod 원본 오류·`cause`는 담지 않는다.
- `fetchPageWithRetry`에서 HTTP/API 성공을 확인한 뒤 반환 직전에 구조를 검증한다. 반환 타입은 `YouthCenterValidatedPageResponse`로 구체화했다. 검증 실패는 재시도 분기 밖으로 전달하므로 잘못된 구조를 반복 요청하지 않으며, 일시 오류 이후 검증에 실패하면 해당 실제 시도 횟수를 유지한다. `finally`의 페이지 종료 시각 기록과 다음 페이지 간격도 유지된다. 저수준 `fetchPage`의 응답 본문 구분 동작은 유지했다.
- `test/fixtures/youth-center-list.json`은 기존 `docs/api-research/samples/initial-page-0001-size-5.json`에서 응답 봉투·페이지 정보·정책 5건의 ID·제목·조회수만 발췌한 테스트 자료다. 원본 전체나 접속 정보를 복제하지 않았다. 기존 재시도 테스트의 최소 성공 값도 이 구조가 완전한 자료로 보강했다.
- 수정된 주석 규칙에 따라 스키마·타입·오류·함수의 역할을 한국어로 명시하고, 클라이언트의 긴 처리 흐름에 요청 간격·응답 보관·구조 검증·오류 분류·재시도 대기·종료 시각 갱신 주석을 추가했다. 통신 오류의 종류에는 비재시도 `REQUEST`도 있어 기존의 '일시적 에러' 주석을 실제 역할에 맞게 정정했다.
- 요청·응답 페이지 번호/크기 비교, 페이지당 건수, 정책 ID 중복·전체 수집 검증은 후속 Step에 남겼다. 공개 API·DB·Migration·외부 패키지·설계 의미는 변경하지 않았고 SPEC은 수정하지 않았다.

### 실행 방법

```bash
npm run test --workspace apps/api -- --runTestsByPath test/youth-center.client.spec.ts test/youth-center-retry.spec.ts test/youth-center-response.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
```

전체 회귀 테스트는 기존 테스트 이미지에 현재 소스·테스트를 읽기 전용으로 연결했다.

```bash
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f /tmp/youth-kkultong-step11-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" api npm test
```

### 실제 검증과 남은 문제

- 수집 클라이언트 테스트 **3개 모음·164개 통과**(기존 104개 + 신규 60개). 실제 응답 발췌본·0건 응답·추가 필드/원문 보존, 봉투·배열·페이지·필수 정책 필드의 누락/자료형/빈 값 오류, 오류의 필드 경로·페이지·횟수·민감값 비노출을 검증했다. 구조 검증 실패 직후 중단, 재시도 뒤 구조 오류, 검증 실패 후 다음 페이지 간격도 확인했다.
- 실제 PostgreSQL·기존 HTTP 테스트를 포함한 전체 회귀 테스트 **13개 모음·353개 통과**. 실행 중인 API·웹·DB 서비스를 교체하지 않았다.
- `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`: **공용·API·웹 통과**. `npm run build --workspace apps/api`: **공용 선행 빌드·API 빌드 통과**. 웹 소스 변경이 없어 Next.js 배포 빌드는 재실행하지 않았다.
- 빌드한 검증 함수로 로컬 조사 자료의 **정상 목록 응답 36개 전체 통과**, 검증 후 객체의 필드·값 보존도 확인했다. 상세 응답 1개와 오류 응답 1개는 목록 성공 응답 검증 대상에서 제외했다. 실제 네트워크 요청·DB 저장 없이 수행했으며 조사 원본은 기존처럼 Git 추적에서 제외된다. 자동 테스트는 저장소에 포함한 발췌본을 사용하므로 조사 원본에 의존하지 않는다.
- `git diff --check`: **통과**. Step 14 완료를 막는 불일치는 없다. 기존 `pg`·Jest 경고와 고아 컨테이너 안내는 이번 범위에서 변경하지 않았다.

핵심 코드 읽는 순서: `apps/api/src/modules/ingestion/youth-center-response.schema.ts` → `apps/api/src/modules/ingestion/youth-center.client.ts`의 성공 응답 검증 → `apps/api/test/youth-center-response.spec.ts` → `apps/api/test/fixtures/youth-center-list.json`.

## 18. Step 15 구현·검증 결과

사용자의 명시적 요청에 따라 Step 14 변경사항 7개 파일을 `0845cb8` (`feat: 온통청년 목록 응답 구조 검증 추가`)로 커밋하고, 깨끗한 작업 트리를 확인한 뒤 Step 15만 진행했다.

### 구현과 실제 결정사항

- `youth-center-page.validation.ts`의 `validateYouthCenterPage`는 구조 검증을 통과한 본문의 페이지 번호·크기를 요청값과 비교한다. 정책 배열이 요청 크기를 초과하면 중단하며, 해당 응답의 `totCount`로 계산한 예상 건수 `min(pageSize, max(0, totCount - (pageNum - 1) × pageSize))`와 실제 반환 건수도 비교한다. 마지막 페이지의 일부 건수·총 0건·마지막 이후 빈 페이지를 구분해 처리한다.
- 같은 페이지의 ID 집합과 수집 작업의 기존 ID 집합을 `Set`으로 비교해 `plcyNo` 중복을 검출한다. 페이지 전체 검증에 성공한 뒤에만 기존 집합을 갱신하므로, 중간에 중복이 발견되어도 해당 페이지의 새 ID가 일부만 반영되지 않는다. 원본 응답은 변경하지 않는다.
- 실패는 `YouthCenterPageValidationError`로 전달한다. `PAGE_NUMBER_MISMATCH`, `PAGE_SIZE_MISMATCH`, `PAGE_SIZE_EXCEEDED`, `PAGE_COUNT_MISMATCH`, `DUPLICATE_POLICY_ID`를 구분하고, 단계 `PAGE_VALIDATION`·요청 페이지·실제 시도 횟수·필드 경로를 포함한다. `details`에는 비교한 예상/실제 숫자 또는 중복된 정책 ID만 담는다. 응답 본문·정책 제목·원본 통신 오류는 포함하지 않는다.
- `fetchPageWithRetry(pageNum, seenIds)`에 선택적인 수집 작업별 ID 집합을 연결했다. 구조 검증 직후 페이지·중복 검증을 실행하며, 실패하면 자동 재시도 없이 전달한다. 인수를 생략한 단일 페이지 호출은 매번 새 집합을 사용해 독립적인 조회·수집 간 ID가 섞이지 않는다. Step 16의 전체 순회에서는 한 작업의 동일 집합을 모든 페이지에 전달해야 한다.
- 기존 재시도 테스트는 샘플과 같은 크기 5건을 사용하고, 모의 응답에 요청 페이지 번호를 반영하도록 보강했다. 구조 검증 테스트의 정상 후속 페이지도 실제 요청값에 맞췄다. 필수 필드가 잘못된 응답에 대한 기존 거부 기준은 유지했다.
- 함수·오류·테스트 자료의 역할과 페이지 비교·건수 계산·중복 검사·ID 집합 반영 구간에 간결한 한국어 주석을 작성했다. 공개 API·DB·Migration·새 외부 패키지·설계 의미는 변경하지 않았고 SPEC은 수정하지 않았다. 전체 페이지 순회·최종 총합/누락 검증은 Step 16에 남겼다.

### 실행 방법

```bash
npm run test --workspace apps/api -- --runTestsByPath test/youth-center.client.spec.ts test/youth-center-retry.spec.ts test/youth-center-response.spec.ts test/youth-center-page-validation.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
```

전체 회귀 테스트는 기존 테스트 이미지에 현재 소스·테스트를 읽기 전용으로 연결했다.

```bash
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f /tmp/youth-kkultong-step11-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" api npm test
```

### 실제 검증과 남은 문제

- 수집 관련 테스트 **4개 모음·194개 통과**(기존 164개 + 신규 30개). 정상/마지막/0건/범위 밖 빈 페이지, 번호·크기 불일치, 크기 초과·반환 건수 오류, 같은 페이지·이전 페이지 ID 중복, 실패 시 ID 집합 보존, 수집별 독립성, 원문 보존, 재시도 뒤 검증 실패 횟수, 검증 오류의 즉시 중단을 확인했다.
- 최초 타입 검사에서 JSON 파일의 `resultCode`가 리터럴 `200`이 아닌 일반 `number`로 추론되어 테스트 2곳에서 오류가 발생했다. 테스트 기준 샘플도 기존 구조 검증 함수를 통과시켜 타입을 확보하도록 수정한 뒤 전체 타입 검사에 통과했다. 타입 단언으로 우회하지 않았다.
- 실제 PostgreSQL·기존 HTTP 테스트를 포함한 전체 회귀 테스트 **14개 모음·383개 통과**. 실행 중인 API·웹·DB 서비스를 교체하지 않았다.
- `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`: **공용·API·웹 통과**. `npm run build --workspace apps/api`: **공용 선행 빌드·API 빌드 통과**. 웹 소스 변경이 없어 Next.js 배포 빌드는 재실행하지 않았다.
- 빌드한 검증 함수로 보관된 **정상 목록 응답 36개 전체 통과**. 각 응답을 보관된 `.meta.json`의 요청 페이지 번호·크기와 대조했으며, 서로 겹치는 조사 샘플도 있어 각 샘플은 독립적인 ID 집합으로 검사했다. 별도로 `full/page-0001.json`·`full/page-0002.json`은 하나의 ID 집합으로 검증해 고유 정책 ID **200개**를 확인했다. 실제 네트워크 요청·DB 저장은 하지 않았다.
- `git diff --check`: **통과**. Step 15 완료를 막는 불일치는 없다. 기존 `pg`·Jest 경고와 고아 컨테이너 안내는 이번 범위에서 변경하지 않았다.

핵심 코드 읽는 순서: `apps/api/src/modules/ingestion/youth-center-page.validation.ts` → `apps/api/src/modules/ingestion/youth-center.client.ts`의 구조 검증 이후 처리 → `apps/api/test/youth-center-page-validation.spec.ts`.

## 19. Step 16 구현·검증 결과

사용자의 명시적 요청에 따라 Step 15 변경사항 7개 파일을 `8f63843` (`feat: 수집 페이지 번호와 중복 정책 검증`)로 커밋하고, 깨끗한 작업 트리를 확인한 뒤 Step 16만 진행했다.

### 구현과 실제 결정사항

- `IngestionService.collectPolicies`를 추가하고 `IngestionModule`의 제공·내보내기에 연결했다. 첫 페이지에서 검증된 `totCount`와 `pageSize`로 마지막 페이지를 계산하고, 이후 `fetchPageWithRetry`를 하나씩 기다리며 호출한다. 페이지 간 대기·해당 페이지 재시도·구조/메타데이터 검증은 기존 클라이언트를 그대로 사용한다. 총 0건이면 첫 페이지만 확인하고 빈 배열을 반환하며 마지막 이후 페이지는 추가로 요청하지 않는다.
- 수집 작업마다 새 정책 ID 집합과 수신 페이지 기록·원본 정책 배열을 만든다. 모든 페이지에 같은 ID 집합을 전달해 페이지 간 중복을 검출하고 원본 정책을 순서대로 메모리에 모은다. 최종 실패한 작업을 다시 호출하면 첫 페이지와 새 집합부터 시작한다.
- 이후 페이지의 `totCount`가 첫 응답과 다르면 즉시 중단한다. 반환 직전 `validateYouthCenterCollection`에서 페이지 누락·페이지 수·첫 응답 대비 최종 총합·최종 배열 자체의 ID 중복을 독립적으로 다시 검사한다. 검증이 모두 통과한 배열만 반환하므로 호출·검증 실패 시 부분 배열을 다음 처리로 전달하지 않는다.
- 전체 검증 오류는 `YouthCenterCollectionValidationError`로 전달한다. 단계 `COLLECTION_VALIDATION`, `TOTAL_COUNT_CHANGED`/`TOTAL_COUNT_MISMATCH`/`PAGE_MISSING`/`PAGE_COUNT_MISMATCH`/`DUPLICATE_POLICY_ID`, 예상·실제 숫자 또는 중복 ID를 담는다. 총 건수 변화는 발생 페이지·실제 시도 횟수도 유지한다. 페이지별 오류는 기존 오류를 그대로 전달한다.
- 스키마에서 원본 정책 타입 `YouthCenterRawPolicy`를 내보내 다음 변환 단계에서도 필수 ID·제목과 추가 필드를 함께 사용할 수 있게 했다. 함수·타입·오류·수집 및 검증 구간에 간결한 한국어 역할 주석을 작성했다.
- 원본 변환·해시·DB 잠금/저장·파일 로그·수집 CLI는 해당 후속 Step에 남겼다. 현재 서비스는 수집·검증된 원본 배열을 반환하며 DB 저장 의존성을 갖지 않는다. 공개 API·DB·Migration·새 외부 패키지·설계 의미는 변경하지 않았고 SPEC은 수정하지 않았다.

### 실행 방법

```bash
npm run test --workspace apps/api -- --runTestsByPath test/ingestion-collection.spec.ts test/youth-center.client.spec.ts test/youth-center-retry.spec.ts test/youth-center-response.spec.ts test/youth-center-page-validation.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
```

전체 회귀 테스트는 기존 테스트 이미지에 현재 소스·테스트를 읽기 전용으로 연결했다.

```bash
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f /tmp/youth-kkultong-step11-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" api npm test
```

### 실제 검증과 남은 문제

- 수집 관련 테스트 **5개 모음·224개 통과**(기존 194개 + 신규 30개). 0건·한 페이지·여러 페이지·마지막 일부 건수, 순차 호출과 기본 대기, 중간 시간 초과 시 해당 페이지만 재시도, 최종 호출 실패·구조/페이지/건수/중복/e003 오류 후 즉시 중단, 총 건수 변화, 반복/실패 후 재수집의 첫 페이지 시작, 최종 총합·누락·중복 검증을 확인했다. 실패 시 다음 처리 함수가 호출되지 않는 것도 검증했다.
- 최초 테스트에서 누락 페이지 배열을 Jest `it.each`의 인수 목록으로 잘못 전달해 **3개 실패** 및 타입 오류가 발생했다. 배열을 담는 객체 형식으로 테스트 자료를 수정하고 재실행해 모두 통과했다. 제품 코드의 요구사항이나 거부 기준은 변경하지 않았다.
- 실제 PostgreSQL·기존 HTTP 테스트를 포함한 전체 회귀 테스트 **15개 모음·413개 통과**. 새 서비스의 NestJS 의존성 주입과 기존 health 경로도 통과했으며 실행 중인 API·웹·DB 서비스를 교체하지 않았다.
- `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`: **공용·API·웹 통과**. `npm run build --workspace apps/api`: **공용 선행 빌드·API 빌드 통과**. 웹 소스 변경이 없어 Next.js 배포 빌드는 재실행하지 않았다.
- `node /tmp/youth-kkultong-step16-check.cjs`: **통과**. 로컬 조사 `collection.json`의 정상 페이지에서 원본 정책 **3,255건**을 재구성하고, 기본 50건씩 **66페이지**로 오프라인 응답을 재생했다. 실제 서비스·클라이언트로 순차 수집한 반환 배열 **3,255건**, 고유 ID **3,255개**, 원본 전체 필드·값 보존을 확인했다. 보관 자료를 재생한 검증이며 현재 API 총 건수나 실시간 수집 결과가 아니다. 검증 프로세스에서만 대기를 0ms로 설정했고 제품 기본 3초 대기는 변경하지 않았다. 실제 API 키·네트워크·DB 저장은 사용하지 않았다.
- 조사 자료와 `/tmp` 검증 스크립트는 Git 추적 대상이 아니며 자동 테스트는 독립적인 모의 응답을 사용한다. 첫 조사 자료 구조 확인 명령은 정수형 `coverage_records`를 배열로 가정해 실패했으며, 실제 구조를 확인한 후 오프라인 검증을 수행했다.
- `git diff --check`: **통과**. Step 16 완료를 막는 불일치는 없다. 기존 `pg`·Jest 경고와 고아 컨테이너 안내는 이번 범위에서 변경하지 않았다.

핵심 코드 읽는 순서: `apps/api/src/modules/ingestion/ingestion.service.ts`의 `collectPolicies` → `validateYouthCenterCollection` → `apps/api/src/modules/ingestion/ingestion.module.ts` → `apps/api/test/ingestion-collection.spec.ts`.

## 20. Step 17 구현·검증 결과

`AGENT_RULES.md` → PLAN Step 17 → SPEC 2.1·5.3·5.4 → Step 16 완료 기록 → 관련 소스 순서로 확인했다. 착수 시 작업 트리는 깨끗했으며 Step 17의 기본 정보 변환만 구현했다.

### 구현과 실제 결정사항

- `youth-center-policy.transform.ts`의 순수 함수 `transformYouthCenterPolicyBasicInfo`가 원본 정책번호·제목·대/중분류·설명·지원 내용·신청/참고 링크·조회수·등록/수정일을 `YouthCenterPolicyBasicInfo`로 매핑한다. 출처는 `youthcenter`이며, `rawJson`에는 추가 필드와 중첩 값까지 포함한 입력 객체 전체를 유지한다. 변환 중 원본을 수정하지 않는다.
- 선택 문자열의 누락·NULL·빈 문자열·공백만 있는 값은 NULL이다. 내용이 있는 ID·제목·설명·링크는 앞뒤 공백과 줄바꿈도 보존한다. 문자열이 아닌 값은 변환 오류이며, 정책 ID·분류는 기존 DB의 최대 길이도 검사한다. 링크의 HTTP(S) 유효성 검사는 SPEC대로 상세 응답을 구현하는 Step 42에 남긴다.
- 조회수는 앞뒤 공백을 제거한 0 이상의 정수 문자열만 숫자로 바꾼다. `'0'`은 0이며, 숫자 자료형·음수·소수·지수 표기·해석 불가·PostgreSQL INTEGER 최대값 초과는 NULL이다. 이는 SPEC 5.3의 조회수 예외 처리이며 수집 실패로 바꾸지 않는다. 원본 조회수 문자열은 그대로 유지한다.
- 등록·수정일은 `YYYY-MM-DD HH:mm:ss` 형식과 윤년·월별 일수·시/분/초를 검증한다. 빈 값은 NULL이고 잘못된 형식이나 존재하지 않는 날짜는 오류다. 변환 결과는 시간대 없는 문자열이며 `Date`나 UTC로 바꾸지 않는다. 이 자료형은 DB 조회 엔티티(`Policy`의 `Date` 속성)와 구분되는 변환 중간 결과로, 실제 저장 연결은 후속 Step 범위다.
- `YouthCenterPolicyTransformError`는 단계 `TRANSFORMATION`, `policyId`, 원본 `field`, 실패 원인 `INVALID_TYPE`/`REQUIRED`/`TOO_LONG`/`INVALID_TIMESTAMP`를 전달한다. 오류 메시지에도 정책 ID·필드·원인을 포함하며, 실패 입력값·본문·URL·원본 오류는 포함하지 않는다.
- `test/fixtures/youth-center-policy.json`은 기존 조사 `initial-page-0001-size-5.json`의 첫 정책에서 기본 정보와 미변환 코드 필드를 발췌한 자료다. 자동 테스트는 Git에 포함된 자료를 사용하므로 로컬 조사 원본에 의존하지 않는다.
- 공개 API·DB·Migration·외부 패키지·설계 의미는 변경하지 않았고 SPEC도 수정하지 않았다. 기존 `collectPolicies`는 원본 배열 반환을 유지한다. 자격 조건·신청기간·해시·저장·CLI 연결은 후속 Step에 남겼다.

### 실행 방법

```bash
npm run test --workspace apps/api -- --runTestsByPath test/youth-center-policy-transform.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
```

전체 회귀 테스트는 기존 테스트 이미지에 현재 소스·테스트를 읽기 전용으로 연결했다.

```bash
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f /tmp/youth-kkultong-step11-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" api npm test
```

### 실제 검증과 남은 문제

- 신규 기본 정보 변환 테스트 **1개 모음·62개 통과**. 실제 응답 발췌본 매핑, 선택 필드의 누락·NULL·빈 값, 문자열 공백·줄바꿈, 원본 추가/중첩 필드 보존, 조회수 0·잘못된 값·정수 범위, 시간대 없는 시각·윤년·달력/형식 오류, 필수값·자료형·길이 오류 및 정책 ID·필드·민감값 비노출을 확인했다.
- 실제 PostgreSQL·기존 HTTP 테스트를 포함한 전체 회귀 테스트 **16개 모음·475개 통과**. 실행 중인 API·웹·DB 서비스를 교체하지 않았다.
- `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`: **공용·API·웹 통과**. `npm run build --workspace apps/api`: **공용 선행 빌드·API 빌드 통과**. 웹 소스 변경이 없어 Next.js 배포 빌드는 재실행하지 않았다.
- `TZ=Asia/Seoul`, `TZ=UTC`, `TZ=America/New_York` 환경에서 각각 `node /tmp/youth-kkultong-step17-check.cjs`: **모두 통과**. 로컬 조사 `collection.json`의 원본 정책 **3,255건**을 매번 전부 변환해 기본 정보 매핑·조회수·시간대 없는 시각·원본 전체 필드/값 보존을 확인했다. 실제 API 요청·DB 저장 없이 보관 자료로 검증했으며 조사 원본과 `/tmp` 스크립트는 Git 추적 대상이 아니다.
- `git diff --check`: **통과**. Step 17 완료를 막는 불일치는 없다. 기존 `pg`·Jest 경고와 고아 컨테이너 안내는 이번 범위에서 변경하지 않았다.

핵심 코드 읽는 순서: `apps/api/src/modules/ingestion/youth-center-policy.transform.ts`의 `YouthCenterPolicyBasicInfo` → `transformYouthCenterPolicyBasicInfo` → `readTimestamp`·`readViewCount`·`YouthCenterPolicyTransformError` → `apps/api/test/youth-center-policy-transform.spec.ts` → `apps/api/test/fixtures/youth-center-policy.json`.

## 21. Step 18 구현·검증 결과

사용자의 명시적 요청에 따라 Step 17 변경사항 5개 파일을 `7ca57b8` (`feat: 정책 기본 정보 정규화 구현`)로 커밋했다. 사용자가 다듬은 주석을 보존했으며, 깨끗한 작업 트리를 확인한 뒤 Step 18만 진행했다.

### 구현과 실제 결정사항

- 기존 `youth-center-policy.transform.ts`에 `YouthCenterPolicy`와 `transformYouthCenterPolicy`를 추가했다. Step 17 기본 정보에 최소/최대 나이·취업/학력/지역 코드·추가 자격·참여 제한·신청기간 코드/원문/시작일/종료일을 합친다. `rawJson`은 원본 전체를 유지하며 입력 객체는 수정하지 않는다.
- 나이의 누락·NULL·빈 문자열·공백은 NULL이고, 정수 문자열은 숫자로 변환한다. `'0'`은 0이다. 음수·역전 범위·120 초과 등 DB 정수로 표현 가능한 값은 임의 수정하지 않고 후속 매칭 단계에서 UNKNOWN으로 판단하도록 유지한다. 자료형 오류는 기존 `INVALID_TYPE`, 정수로 해석할 수 없거나 PostgreSQL INTEGER 범위를 넘은 값은 `INVALID_INTEGER`로 정책 ID·필드를 전달한다.
- 코드 문자열은 쉼표로 나누고 각 코드의 앞뒤 공백만 제거한다. 앞자리 0·순서·중복·미확인/폐지 코드와 비어 있는 토큰도 임의 제거하지 않는다. 미확인 토큰을 버려 조건이 명확한 것처럼 보이지 않도록 하기 위한 처리이며, 코드 유효성·제한 없음·지역 관계는 후속 판정 단계에 남긴다. 코드 필드 전체가 비어 있으면 NULL이다.
- 추가 자격·참여 제한은 내용이 있는 원문의 공백·줄바꿈을 보존하고, 비어 있으면 NULL이다. 신청기간 코드는 주변 공백을 제거하며 기존 DB 최대 길이 20자를 검사한다. 미확인 기간 코드도 값 그대로 보관한다.
- 신청기간은 전체 문자열이 `YYYYMMDD` 또는 `YYYY-MM-DD` 날짜 두 개를 `~`로 연결한 단일 구간일 때만 처리한다. 양 끝 날짜가 실제 달력에 존재하고 시작일이 종료일 이하이면 시간대 변환 없이 `YYYY-MM-DD` 문자열로 반환한다. 같은 날도 허용하며 윤년·월별 일수 검증을 기존 등록/수정 시각 검증과 공유한다.
- 복수 구간·설명 포함·날짜 누락·잘못된 날짜·역전은 시작일과 종료일을 모두 NULL로 두고 원문을 보존한다. 상시/마감 코드로 날짜를 만들거나 사업기간에서 신청기간을 추정하지 않는다. 신청기간 코드와 날짜의 모순·현재 신청 상태는 Step 32에서 판단한다.
- 기존 실제 응답 발췌본에 같은 정책의 자격·신청기간 필드 8개를 추가하고 `youth-center-eligibility-transform.spec.ts`를 작성했다. 기존 기본 정보 테스트와 사용자 주석은 유지했으며, 등록/수정 시각의 달력 검증만 공통 함수로 옮겼다.
- 공개 API·DB·Migration·외부 패키지·설계 의미는 변경하지 않았고 SPEC도 수정하지 않았다. 기존 수집 서비스는 원본 배열 반환을 유지하며 해시·잠금·저장·CLI 연결은 후속 Step 범위다.

### 실행 방법

```bash
npm run test --workspace apps/api -- --runTestsByPath test/youth-center-policy-transform.spec.ts test/youth-center-eligibility-transform.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
```

전체 회귀 테스트는 기존 테스트 이미지에 현재 소스·테스트를 읽기 전용으로 연결했다.

```bash
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f /tmp/youth-kkultong-step11-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" api npm test
```

### 실제 검증과 남은 문제

- 신규 자격 조건·신청기간 테스트 **74개 통과**. 실제 샘플의 0~0·코드·추가 자격, 누락·NULL·공백, 나이 정수·역전/큰 상한·변환 오류, 코드 공백·앞자리 0·순서·미확인/빈 토큰, 단일 날짜 구간·동일일·윤년·복수 구간·날짜 오류·역전, 코드와 날짜의 독립성·사업기간 미사용·원본 보존·오류의 정책 ID/필드 및 민감값 비노출을 확인했다.
- 최초 변환 테스트 실행은 기존 62개+신규 73개로 **2개 모음·135개 통과**했다. 이후 사업기간에서 신청일을 추정하지 않는 테스트 1개를 추가했고, 실제 PostgreSQL·기존 HTTP 테스트를 포함한 최종 전체 회귀 테스트는 **17개 모음·549개 모두 통과**했다. 실행 중인 API·웹·DB 서비스를 교체하지 않았다.
- `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`: **공용·API·웹 통과**. `npm run build --workspace apps/api`: **공용 선행 빌드·API 빌드 통과**. 웹 소스 변경이 없어 Next.js 배포 빌드는 재실행하지 않았다.
- `TZ=Asia/Seoul`, `TZ=UTC`, `TZ=America/New_York` 환경에서 각각 `node /tmp/youth-kkultong-step18-check.cjs`: **모두 통과**. 보관된 원본 정책 **3,255건**의 나이·코드·추가 조건·기간 및 원본 전체 필드/값을 대조했다. 각 환경에서 유효 단일 기간 **1,557건**, 날짜 NULL **1,698건**(빈 값 1,695·복수 기간 2·역전 1), 최대 나이 999의 원본 값 유지 **5건**이 동일했다. 실제 API 요청·DB 저장 없이 검증했으며 로컬 조사 원본과 `/tmp` 스크립트는 Git 추적 대상이 아니다.
- `git diff --check`: **통과**. Step 18 완료를 막는 불일치는 없다. 기존 `pg`·Jest 경고와 고아 컨테이너 안내는 이번 범위에서 변경하지 않았다.

핵심 코드 읽는 순서: `apps/api/src/modules/ingestion/youth-center-policy.transform.ts`의 `YouthCenterPolicy` → `transformYouthCenterPolicy` → `readAge`·`readCodes` → `readApplicationDates`·`isValidCalendarDate` → `apps/api/test/youth-center-eligibility-transform.spec.ts`.

## 22. Step 19 구현·검증 결과

사용자의 명시적 요청에 따라 Step 18 변경사항 5개 파일을 `0369785` (`feat: 정책 자격 조건과 신청기간 변환 구현`)로 커밋했다. 사용자가 다듬은 주석을 보존하고 깨끗한 작업 트리를 확인한 뒤 Step 19만 진행했다.

### 구현과 실제 결정사항

- `youth-center-policy.hash.ts`의 순수 함수 `createYouthCenterPolicyContentHash`는 검증된 원본 정책을 받아 최상위 `inqCnt`만 제외한 내용의 SHA-256을 64자리 소문자 16진수 문자열로 반환한다. Node.js 내장 `node:crypto`를 사용하며 외부 패키지를 추가하지 않았다.
- 객체는 모든 깊이에서 키를 문자열 순서로 정렬해 직렬화하고 배열은 원소 순서·중복을 유지한다. 숫자처럼 보이는 객체 키도 정렬된 순서대로 직접 JSON 문자열을 작성한다. 문자열의 공백·줄바꿈·코드 문자열·미확인 필드·중첩 `inqCnt`는 해시 내용에 포함한다. 키와 문자열의 이스케이프는 `JSON.stringify`를 사용한다.
- 원본을 복사해 조회수만 제외하고 중첩 객체·배열을 읽기만 하므로 `rawJson`에 보관할 원본의 조회수·키·값·배열 순서는 바뀌지 않는다. 정상적인 JSON이 아닌 값(`undefined`, 비유한 숫자, BigInt, 함수, Date 등)을 묵시적으로 누락/NULL 처리하지 않고 거부한다. 순환 참조는 오류이며 같은 객체를 여러 필드에서 참조하는 경우와 구분한다.
- `YouthCenterPolicyHashError`는 단계 `HASH`, `policyId`, 실패 `field` 경로, 원인 `INVALID_JSON_VALUE`/`CYCLIC_REFERENCE`/`HASH_FAILED`를 전달한다. 예상 밖 오류도 원본 메시지·입력값·`cause` 없이 안전한 오류로 바꾼다.
- 해시 생성은 Step 17~18의 정규화와 구분되는 함수다. 해시는 변환값이 아닌 원본 전체를 기준으로 계산해야 하며, 수집→변환→해시→저장 흐름의 연결은 후속 Step에 남겼다. 기존 변환 자료형의 주석도 해시를 원본으로 별도 계산한다는 현재 상태로 정정했다.
- 공개 API·DB·Migration·설계 의미는 변경하지 않았고 SPEC도 수정하지 않았다. NEW/CHANGED/UNCHANGED 판정과 DB 저장·잠금·CLI는 구현하지 않았다.

### 실행 방법

```bash
npm run test --workspace apps/api -- --runTestsByPath test/youth-center-policy-hash.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
```

전체 회귀 테스트는 기존 테스트 이미지에 현재 소스·테스트를 읽기 전용으로 연결했다.

```bash
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f /tmp/youth-kkultong-step11-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" api npm test
```

### 실제 검증과 남은 문제

- 신규 해시 테스트 **1개 모음·40개 통과**. 알려진 SHA-256 값·실제 샘플·조회수 변경/누락·중첩 키 정렬·숫자 모양 키·실제 내용 변경·중첩 조회수·배열 순서·문자열 공백/자료형·특수 문자/키·원본 보존·비JSON 값·순환 참조·오류의 정책 ID/필드 및 민감값 비노출을 확인했다.
- 최초 타입 검사에서 테스트 객체의 `constructor` 필드에 문자열을 직접 대입한 코드가 기본 `Function` 타입과 충돌했다. 해당 특수 키를 `Reflect.set`으로 설정하도록 고쳤고, 최종 `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`는 **공용·API·웹 모두 통과**했다. 타입 검사를 우회하지 않았다.
- 실제 PostgreSQL·기존 HTTP 테스트를 포함한 최종 전체 회귀 테스트 **18개 모음·589개 통과**. 실행 중인 API·웹·DB 서비스를 교체하지 않았다.
- `npm run build --workspace apps/api`: **공용 선행 빌드·API 빌드 통과**. 웹 소스 변경이 없어 Next.js 배포 빌드는 재실행하지 않았다.
- Python 표준 라이브러리로 보관 원본의 키 정렬 JSON·SHA-256 기준값을 별도 생성한 뒤 `node /tmp/youth-kkultong-step19-check.cjs`: **통과**. 원본 정책 **3,255건 전체**가 기준값과 일치했고, 각 정책의 객체 키 순서 반전·조회수만 변경은 같은 해시, 제목 변경은 다른 해시였다. 원본 전체 필드/값도 보존됐다. 실제 API 요청·DB 저장 없이 검증했으며 조사 원본·`/tmp` 검증 스크립트와 기준값은 Git 추적 대상이 아니다.
- `git diff --check`: **통과**. Step 19 완료를 막는 불일치는 없다. 기존 `pg`·Jest 경고와 고아 컨테이너 안내는 이번 범위에서 변경하지 않았다.

핵심 코드 읽는 순서: `apps/api/src/modules/ingestion/youth-center-policy.hash.ts`의 `createYouthCenterPolicyContentHash` → `serializePolicyContent` → `YouthCenterPolicyHashError` → `apps/api/test/youth-center-policy-hash.spec.ts`.

## 23. Step 20 구현·검증 결과

사용자의 명시적 요청에 따라 Step 19 변경사항 5개 파일을 `d5c6e48` (`feat: 정책 내용 변경 판정용 해시 추가`)로 커밋했다. 사용자가 보강한 해시 설명·주석을 보존하고 깨끗한 작업 트리를 확인한 뒤 Step 20만 진행했다.

### 구현과 실제 결정사항

- `IngestionLockService.runWithLock`를 추가해 `IngestionModule`의 제공·내보내기에 등록했다. 실행마다 전용 `QueryRunner`를 만들고 `pg_try_advisory_lock($1::bigint)`으로 세션 잠금을 획득한다. 온통청년 수집 전용 키는 문자열 상수 `202610180001`로 고정했으며 모든 프로세스가 같은 키를 사용한다. SQL 값은 매개변수로 바인딩한다.
- 획득 결과가 정확히 true이면 전달받은 작업을 실행하고, 작업이 끝날 때까지 같은 연결을 유지한다. 작업에는 해당 `QueryRunner`를 전달하므로 후속 저장도 같은 `manager`에서 수행할 수 있다. 잠금 서비스는 수집 전에 트랜잭션을 열지 않는다. false이면 작업을 호출하지 않고 기본 로그와 내부 결과 `ALREADY_RUNNING`만 남긴다. 정상 완료는 `COMPLETED`와 작업 반환값으로 구분한다.
- `finally`에서 획득한 잠금만 해제하고 `pg_advisory_unlock`의 true 반환을 확인한 뒤 연결을 반환한다. 획득 응답이 불확실하거나 해제에 실패하면 `connect()`가 반환한 PostgreSQL 클라이언트의 공개 `end()`로 세션을 종료해 잠금 보유 연결이 풀에 재사용되지 않도록 한다. 연결 반환 자체가 실패한 경우에도 세션 종료를 시도한다.
- 작업이 트랜잭션을 끝내지 않았으면 잠금 해제 전에 롤백한다. 미확정 작업을 정상 완료로 처리하지 않으며, 롤백이 실패해도 잠금 해제·세션 종료·연결 반환을 계속 시도한다. 남은 트랜잭션이 있는 연결은 세션을 종료한다.
- `IngestionLockError`는 `LOCK`/`LOCK_RELEASE` 단계와 접속·획득·해제·미종료 트랜잭션·롤백·세션 종료·연결 반환의 실패 원인을 전달한다. DB 원본 오류·접속 정보·`cause`는 포함하지 않는다. 작업 오류는 원래 객체로 전달하고, 정리 오류가 함께 나면 `AggregateError`에 모두 담아 어느 한쪽도 잃지 않는다. 중복 로그 기록이 실패해도 연결 정리는 진행한다.
- 현재 잠금 경계는 `runWithLock`에 전달하는 작업 전체다. 통합 테스트에서 기존 `collectPolicies`와 조합해 두 번째 수집이 API 호출 전에 건너뛰는 것을 확인했다. 저수준 원본 수집 함수 자체의 계약은 유지하며, CLI에서 잠금→수집→변환→해시→저장 전체를 연결하는 작업은 Step 25에 남겼다. 파일 결과 로그 통합은 Step 24 범위다.
- [PostgreSQL 17 세션 Advisory Lock 문서](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS)와 [잠금 함수 문서](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS), [TypeORM QueryRunner 문서](https://typeorm.io/docs/query-runner/)를 대조했다. 설치된 TypeORM의 PostgreSQL 연결 반환 구현도 확인한 뒤 실제 세션 종료·풀 재사용 여부를 통합 테스트로 검증했다.
- 공개 API·DB 스키마·Migration·외부 패키지·설계 의미는 변경하지 않았고 SPEC도 수정하지 않았다. 정책 저장·변경 분류·저장 재시도·CLI는 구현하지 않았다.

### 실행 방법

```bash
npm run test --workspace apps/api -- --runTestsByPath test/ingestion-lock.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
```

이번 환경에서는 기존 `/tmp` Docker 설정·오버레이가 없어 다시 준비했다. Docker 설정 파일은 `/tmp/youth-kkultong-docker-config/config.json`의 `{}`이며, 테스트 오버레이 `/tmp/youth-kkultong-step20-test.compose.yaml`은 다음과 같다. 기존 테스트 이미지를 재사용하고 소스·테스트만 읽기 전용으로 연결한다.

```yaml
services:
  api:
    image: youth-kkultong-api-step11-test
    build:
      target: api-build
```

```bash
docker --config /tmp/youth-kkultong-docker-config compose up -d db
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f /tmp/youth-kkultong-step20-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" api npm test
docker --config /tmp/youth-kkultong-docker-config compose stop db
```

### 실제 검증과 남은 문제

- 신규 잠금 검증 **26개 통과**(단위 19개·실제 DB 통합 7개). 획득/작업/해제/반환 순서, 비획득 시 작업·해제 미실행, 응답 검증, 오류 시 정리, 중복 로그 실패, 오류 단계·민감값 비노출 및 작업/정리 오류 동시 보존을 확인했다.
- 실제 PostgreSQL의 독립 연결에서 첫 수집 중 두 번째 API 미호출·첫 작업 후 재획득, 같은 서비스의 중첩 실행 차단, COMMIT/ROLLBACK 이후 세션 잠금 유지, 실패/반복 실행 뒤 재획득을 확인했다. 서버에서 잠금을 획득한 뒤 응답 확인에 실패하는 경우와 해제 쿼리가 실패하는 경우도 실제 연결 종료 후 다른 세션이 재획득했다. 해제 실패 시 기존 세션 PID가 다시 쓰이지 않는 것도 확인했다.
- 초기 잠금 테스트 **22개**, 첫 전체 회귀 **20개 모음·611개 통과** 후 코드 검토에서 미종료 트랜잭션 반환 경로를 발견해 롤백 안전장치와 테스트 4개를 추가했다. 최종 실제 DB·HTTP 포함 전체 회귀는 **20개 모음·615개 모두 통과**했다.
- 최종 `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`: **공용·API·웹 통과**. `npm run build --workspace apps/api`: **공용 선행 빌드·API 빌드 통과**. 웹 소스 변경이 없어 Next.js 배포 빌드는 재실행하지 않았다.
- 기존 PostgreSQL 서비스가 정지 상태여서 테스트를 위해 시작했으며, 검증 후 다시 정지해 시작 전 상태로 복원했다. 기존 DB 볼륨은 유지했고 API·웹 서비스는 시작하지 않았다. 잠금 통합 테스트는 정책 테이블을 변경하지 않으며 실제 외부 API 대신 모의 HTTP 응답을 사용한다. 기존 회귀 테스트의 DB 쓰기도 각 테스트의 별도 검증 스키마 안에서 실행됐다.
- `git diff --check`: **통과**. Step 20 완료를 막는 불일치는 없다. 기존 `pg`·Jest 경고와 고아 컨테이너 안내는 이번 범위에서 변경하지 않았다.

핵심 코드 읽는 순서: `apps/api/src/modules/ingestion/ingestion-lock.service.ts`의 `runWithLock` → `finally`의 롤백·해제·반환 → `IngestionLockError` → `apps/api/src/modules/ingestion/ingestion.module.ts` → `apps/api/test/ingestion-lock.integration.spec.ts` → `apps/api/test/ingestion-lock.spec.ts`.

## 24. 다음 작업을 위한 상태

다음 요청 대상은 **Step 21: 저장 전 정책 변경 분류**이다. Step 21~57은 시작하지 않았다. Step 12~20에서 수집·검증·정규화·해시 함수와 전용 연결의 중복 실행 잠금 경계를 구현·검증했다. 수집 운영 전 `YOUTH_CENTER_API_KEY` 설정과 기존 개발 도구의 후속 검토는 남아 있다. 공식 지역 시드는 Step 9에서 완료했으며 취업·학력 공식 코드표는 Step 29에서 준비한다.

Step 20 추천 커밋 메시지: `feat: 정책 수집 중복 실행 잠금 추가`.
