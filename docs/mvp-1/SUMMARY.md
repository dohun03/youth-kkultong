# 청년꿀통(youth-kkultong) — MVP1 작업 결과

최종 확인일: 2026-10-22 (Asia/Seoul) · **Step 1~53 완료, Step 54~57 미착수**

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

핵심 코드 읽는 순서: `apps/api/src/modules/ingestion/youth-center/youth-center.client.ts` → `apps/api/src/modules/ingestion/ingestion.module.ts` → `apps/api/src/app.module.ts` → `apps/api/test/youth-center.client.spec.ts`.

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

핵심 코드 읽는 순서: `apps/api/src/modules/ingestion/youth-center/youth-center.client.ts`의 `fetchPageWithRetry` → `fetchPage`의 통신 오류 분류 → `retryDelay`·`wait` → `apps/api/test/youth-center-retry.spec.ts`.

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

핵심 코드 읽는 순서: `apps/api/src/modules/ingestion/youth-center/youth-center-response.schema.ts` → `apps/api/src/modules/ingestion/youth-center/youth-center.client.ts`의 성공 응답 검증 → `apps/api/test/youth-center-response.spec.ts` → `apps/api/test/fixtures/youth-center-list.json`.

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

핵심 코드 읽는 순서: `apps/api/src/modules/ingestion/youth-center/youth-center-page.validation.ts` → `apps/api/src/modules/ingestion/youth-center/youth-center.client.ts`의 구조 검증 이후 처리 → `apps/api/test/youth-center-page-validation.spec.ts`.

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

핵심 코드 읽는 순서: `apps/api/src/modules/ingestion/services/ingestion.service.ts`의 `collectPolicies` → `validateYouthCenterCollection` → `apps/api/src/modules/ingestion/ingestion.module.ts` → `apps/api/test/ingestion-collection.spec.ts`.

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

핵심 코드 읽는 순서: `apps/api/src/modules/ingestion/youth-center/youth-center-policy.transform.ts`의 `YouthCenterPolicyBasicInfo` → `transformYouthCenterPolicyBasicInfo` → `readTimestamp`·`readViewCount`·`YouthCenterPolicyTransformError` → `apps/api/test/youth-center-policy-transform.spec.ts` → `apps/api/test/fixtures/youth-center-policy.json`.

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

핵심 코드 읽는 순서: `apps/api/src/modules/ingestion/youth-center/youth-center-policy.transform.ts`의 `YouthCenterPolicy` → `transformYouthCenterPolicy` → `readAge`·`readCodes` → `readApplicationDates`·`isValidCalendarDate` → `apps/api/test/youth-center-eligibility-transform.spec.ts`.

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

핵심 코드 읽는 순서: `apps/api/src/modules/ingestion/youth-center/youth-center-policy.hash.ts`의 `createYouthCenterPolicyContentHash` → `serializePolicyContent` → `YouthCenterPolicyHashError` → `apps/api/test/youth-center-policy-hash.spec.ts`.

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

핵심 코드 읽는 순서: `apps/api/src/modules/ingestion/services/ingestion-lock.service.ts`의 `runWithLock` → `finally`의 롤백·해제·반환 → `IngestionLockError` → `apps/api/src/modules/ingestion/ingestion.module.ts` → `apps/api/test/ingestion-lock.integration.spec.ts` → `apps/api/test/ingestion-lock.spec.ts`.

## 24. Step 21 구현·검증 결과

작업 규칙 → Step 21 PLAN → SPEC 2.3·5.3 및 관련 검증 항목 → Step 20 완료 기록 → 실제 코드를 대조했다. 착수 시 작업 트리는 깨끗했고 선행 Step의 누락이나 이번 범위의 문서 충돌은 없었다. 커밋은 실행하지 않았다.

### 구현과 실제 결정사항

- `PoliciesModule`에 명세에 있는 `PolicyRepository`와 `PoliciesWriteService`를 등록하고 저장 서비스를 내보냈다. 모듈은 기존 `DatabaseModule`에서 환경변수를 받는다. 수집 서비스와 CLI의 실제 연결은 후속 Step에 남겼다.
- `PolicyRepository.findContentHashes`는 호출자가 전달한 `EntityManager`로 출처·외부 ID·해시 세 컬럼만 조회한다. 각 출처와 ID를 한 쌍으로 매개변수 바인딩하며 빈 목록은 DB 조회 없이 반환한다. 전체 원본·긴 본문을 읽거나 정책마다 별도 조회하지 않는다.
- `PoliciesWriteService.prepareBatches`는 전체 검증·변환·해시 계산을 마친 중복 없는 정책 배열을 받는다. 기존 `POLICY_IMPORT_BATCH_SIZE` 설정(기본 200, 허용 1~200)으로 나눠 조회하고, `(source, externalId)`의 기존 해시가 없으면 `NEW`, 다르면 `CHANGED`, 같으면 `UNCHANGED`를 반환한다. 출처·ID에 구분 문자가 있어도 충돌하지 않도록 두 값을 JSON 배열로 표현한 키를 사용한다.
- `PolicyWriteInput`은 엔티티에서 DB 자동 생성 ID·저장 시각을 제외하고 원본 등록·수정 시각을 시간대 없는 문자열로 받는 내부 저장 자료형이다. Policies가 Ingestion의 구현 자료형에 의존하지 않으며, 기존 변환 결과에 해시를 붙인 자료를 그대로 받을 수 있다.
- 신규·변경 자료에는 정규화 컬럼·해시·원본·조회수를 모두 담는다. 동일 자료에는 출처·외부 ID·최신 `rawJson`·`viewCount`만 담아 내용 컬럼·해시를 덮어쓰지 않도록 구분한다. 조회수만 바뀌거나 0/NULL로 바뀌어도 `UNCHANGED`이며, 완전히 동일한 자료도 최신화 대상으로 남긴다.
- 반환값은 입력 순서를 유지한 분류 묶음과 `NEW/CHANGED/UNCHANGED` 합계다. 이 건수는 **저장 준비 결과**이며 DB 반영 성공 건수가 아니다. 조회 실패는 부분 결과 없이 호출자에게 전파한다. 이 메서드는 DB 쓰기·트랜잭션 시작/종료·연결 반환을 수행하지 않으며, Step 22에서 같은 `QueryRunner.manager`를 넘겨 전체 저장 트랜잭션에 참여시킨다.
- 공개 API·DB 스키마·Migration·외부 패키지·설계 의미는 변경하지 않았다. PLAN 완료 표시와 SUMMARY만 갱신했고 SPEC 수정은 없다. 실제 묶음 저장·저장 재시도·결과 로그·CLI는 후속 Step 범위다.

### 실행 방법

```bash
npm run test --workspace apps/api -- --runTestsByPath test/policies-write.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
```

실제 DB·HTTP를 포함한 전체 테스트는 Step 20의 기존 테스트 이미지·오버레이에 현재 소스와 테스트를 읽기 전용으로 연결했다. 오버레이 내용은 위 Step 20 실행 방법과 같다.

```bash
docker --config /tmp/youth-kkultong-docker-config compose up -d db
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f /tmp/youth-kkultong-step20-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" api npm test
docker --config /tmp/youth-kkultong-docker-config compose stop db
```

### 실제 검증과 남은 문제

- 신규 단위 테스트 **17개**, 실제 PostgreSQL 통합 테스트 **4개** 통과. 새 정책·내용 변경·조회수만 변경·동일 자료, 조회수 0/NULL, 출처별 ID 구분, 복합 키 충돌 방지, 빈 입력, 199/200/201/401건 경계, 설정한 작은 묶음, 여러 묶음 건수 합산·입력 순서, 조회 실패 전파·입력 보존을 확인했다.
- 실제 DB에서 세 컬럼만 읽는 단일 조회·정확한 복합 조건·SQL 매개변수 바인딩, 201건의 두 번 조회, 호출자가 넘긴 트랜잭션의 미확정 행 조회, 분류 전후 DB 전체 행 불변·수집에서 빠진 기존 정책 유지·연결/트랜잭션 유지도 확인했다. 테스트 쓰기는 임의 이름의 별도 스키마에서만 수행하고 각 테스트를 롤백한 뒤 스키마를 제거했다.
- 최초 타입 검사에서 테스트 준비용 `insert`가 `rawJson: Record<string, unknown>`을 TypeORM의 깊은 갱신 타입으로 받지 못했다. 준비 자료 입력에 `save`를 사용하도록 수정해 타입 단언으로 우회하지 않았다. 최종 `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`: **공용·API·웹 모두 통과**.
- 수정 후 최종 실제 DB·HTTP 포함 전체 회귀 테스트: **22개 모음·636개 모두 통과**. NestJS 앱 기동 시 저장 서비스의 모듈 의존성 주입도 정상 완료됐다.
- `npm run build --workspace apps/api`: **공용 선행 빌드·API 빌드 통과**. 웹 소스 변경이 없어 Next.js 배포 빌드는 재실행하지 않았다.
- 테스트를 위해 기존 정지 상태의 DB만 시작했고 검증 후 다시 정지했다. DB 볼륨은 유지했으며 API·웹 서비스는 시작하지 않았다. 실제 외부 API는 호출하지 않았다.
- `git diff --check`: **통과**. Step 21 완료를 막는 불일치는 없다. 기존 `pg`·Jest 경고와 고아 컨테이너 안내는 이번 범위에서 변경하지 않았다.

핵심 코드 읽는 순서: `apps/api/src/modules/policies/policies-write.service.ts`의 입력·분류 자료형 → `prepareBatches` → `apps/api/src/modules/policies/policy.repository.ts`의 `findContentHashes` → `apps/api/src/modules/policies/policies.module.ts` → `apps/api/test/policies-write.spec.ts` → `apps/api/test/policies-write.integration.spec.ts`.

## 25. Step 22 구현·검증 결과

사용자의 명시적 요청에 따라 Step 21 구현·주석·작업 규칙 변경을 `e1c76f2` (`feat: 정책 신규 변경 동일 판정 구현`)로 커밋한 뒤, 다음 Step 요청으로 Step 22만 진행했다. 작업 규칙·PLAN·SPEC 2.3/5.3/5.4·Step 21 완료 상태를 코드와 대조했고 착수 시 작업 트리는 깨끗했다. 기존 코드와 사용자가 다듬은 주석은 보존했다.

### 구현과 실제 결정사항

- `PoliciesWriteService.savePolicies(queryRunner, policies)`를 추가했다. 전달받은 전용 연결에서 트랜잭션을 한 번 열고, `prepareBatches`의 조회부터 모든 묶음 저장까지 같은 `queryRunner.manager`를 사용한다. 모든 묶음이 성공한 뒤 한 번만 확정하고 `NEW/CHANGED/UNCHANGED` 건수를 반환한다.
- 각 묶음은 기존 설정에 따라 최대 200건이다. 신규·변경은 `PolicyRepository.upsertPolicies`로 묶음 INSERT하고 `(source, external_id)` 충돌 시 전체 내용을 UPDATE한다. 동일은 `refreshPolicies`의 묶음 UPDATE로 원본 JSON·조회수·마지막 DB 반영일만 갱신한다. UUID·최초 저장일과 수집에서 빠진 기존 정책은 유지한다.
- 신규·변경 저장은 TypeORM QueryBuilder의 `insert().values().orUpdate()`를 사용한다. SQL 생성·식별자 처리·매개변수 번호 지정은 TypeORM에 맡기며 UUID·최초 저장일을 갱신 대상에서 제외한다. 원본 등록·수정 시각은 바인딩한 문자열을 `timestamp`로 변환해 저장하고, 원본 JSON도 문자열로 바인딩해 `jsonb`로 저장한다. 입력 객체에 생성 ID 등을 쓰지 않도록 `updateEntity(false)`를 사용한다.
- 동일 정책 갱신은 `manager.sql` 태그와 PostgreSQL의 `jsonb_to_recordset`을 사용한다. 정책 배열을 JSON 매개변수 하나로 전달해 최대 200개 행을 한 번에 갱신한다. 테이블명은 내부 엔티티 정의에서 가져와 이름을 처리하며, 정책 값은 SQL 태그가 자동 바인딩한다. `manager.query` 호출과 수동 `$1` 번호 계산은 제거했다. 이 태그는 내부적으로 같은 관리자의 `query`를 호출하므로 전달받은 트랜잭션을 유지한다.
- 사용자 검수에서 지적한 `manager.connection`은 설치된 TypeORM `1.1.2`의 사용 중단 예정 별칭이었다. 현재는 `dataSource`를 반환하지만 앞으로의 호환성과 편집기 경고 해소를 위해 `manager.dataSource`로 바꿨다. 설치된 선언·구현과 [공식 변경 안내](https://dev.typeorm.io/docs/releases/1.0/upgrading-from-0.3/), [QueryBuilder 안내](https://typeorm.io/docs/query-builder/insert-query-builder/), [SQL 태그 안내](https://typeorm.io/docs/guides/sql-tag/)를 대조했다. DB·API·분류 규칙은 변경하지 않았다.
- 조회·저장·확정 오류 시 활성 트랜잭션을 취소하고 원래 오류를 전달한다. 취소도 실패하면 두 오류를 `AggregateError`에 보존한다. 다른 작업의 트랜잭션이 이미 열린 연결은 시작 전에 거부한다. 빈 목록은 0건을 반환하며 정책을 삭제하지 않는다.
- 저장 서비스는 전달받은 연결의 잠금을 해제하거나 연결을 반환하지 않는다. 실제 DB 테스트에서 저장 확정·취소 뒤에도 같은 세션과 잠금이 유지되고 바깥 `IngestionLockService`가 작업 종료 후 정리하는 것을 확인했다.
- 수집→변환→저장·CLI 연결은 Step 25, DB 충돌 재시도는 Step 23, 파일 로그·공통 종료 처리는 Step 24에 남겼다. Step 22 당시 저장 함수는 실패한 트랜잭션을 자동 재시도하지 않았다.
- 공개 API·DB 스키마·Migration·외부 패키지·설계 의미는 변경하지 않았다. PLAN 완료 표시와 SUMMARY를 갱신했고 SPEC 수정은 없다. 주석은 기존 잠금 서비스처럼 각 코드가 하는 일을 짧게 적었다.

### 실행 방법

```bash
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
```

Docker Desktop이 꺼져 있어 `docker desktop start`로 기존 Docker를 시작했다. 기존 테스트 이미지를 재사용하며, `/tmp/youth-kkultong-docker-config/config.json`은 `{}`이고 `/tmp/youth-kkultong-step22-test.compose.yaml`은 다음과 같다.

```yaml
services:
  api:
    image: youth-kkultong-api-step11-test
    build:
      target: api-build
```

```bash
docker --config /tmp/youth-kkultong-docker-config compose up -d db
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f /tmp/youth-kkultong-step22-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" api npm test
docker --config /tmp/youth-kkultong-docker-config compose stop db
```

### 실제 검증과 남은 문제

- 신규 저장 단위 테스트 **12개**, 실제 PostgreSQL 17 통합 테스트 **10개** 통과. 트랜잭션 한 번 시작/확정, 같은 관리자 사용, 분류별 저장, 조회·저장·확정·시작 실패, 취소 실패 시 두 오류 보존, 기존 트랜잭션 거부·빈 입력을 확인했다.
- 실제 DB에서 **401건** 신규 저장·내용 변경·조회수 갱신이 각각 **200/200/1건의 세 번 벌크 쿼리**로 반영됐다. 확정 직전 다른 연결에는 첫 묶음도 보이지 않았고 최종 확정 후 전체가 조회됐다. 입력 데이터와 UUID·최초 저장일, NULL·0·코드 배열·원본 JSON·특수 문자·출처별 ID 구분도 보존됐다.
- **2,000번째 정책**에 실제 `varchar(100)` 길이 제약 오류(`22001`)를 발생시켰다. 앞서 성공한 9개 묶음과 기존 정책의 내용 변경까지 모두 취소됐고, 다른 연결에서 읽은 DB 전체 행·시각이 저장 전과 같았다. 별도 사례에서는 앞 묶음의 동일 정책 원본·조회수 갱신도 취소됐다.
- 호스트 시간대 `UTC`·`America/New_York`에서 서머타임 전환 시각을 포함한 등록·수정 시각과 DATE를 DB 저장값으로 대조해 보존을 확인했다. 설치된 PostgreSQL 드라이버의 기본 시각 변환을 별도로 실행하면 `America/New_York`의 `2026-03-08 02:30:00`이 현지 시각 03:30인 `Date`로 바뀌는 것도 확인했다. QueryBuilder에서도 이 자동 변환을 건너뛰는 처리를 유지한다. 저장 확정·취소 뒤 동일 세션 PID와 잠금 유지·작업 종료 후 잠금 재획득도 통과했다.
- 최초 타입 검사에서 테스트가 읽기 전용 `QueryRunner.isTransactionActive`에 직접 대입한 오류를 발견했다. 별도 상태 변수와 읽기용 접근자로 테스트를 수정했고 최종 `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`는 **공용·API·웹 모두 통과**했다.
- 사용자 검수에 따른 QueryBuilder·SQL 태그 변경 후 최종 실제 DB·HTTP 포함 전체 회귀 테스트: **23개 모음·658개 모두 통과**. SQL 태그의 단일 JSON 매개변수에서도 200/200/1건 묶음을 확인하도록 통합 테스트를 맞췄고, 특수 문자가 포함된 정책 ID·원본 JSON 보존과 전체 롤백도 다시 통과했다. `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`: **공용·API·웹 통과**. `npm run build --workspace apps/api`: **공용 선행 빌드·API 빌드 통과**. 웹 소스 변경이 없어 Next.js 배포 빌드는 재실행하지 않았다.
- 테스트 쓰기는 임의 이름의 별도 검증 스키마에서만 수행했고 종료 시 스키마를 제거했다. 검증을 위해 시작한 기존 DB는 다시 정지했고 볼륨은 유지했다. 사용자 검수 후 재검증 종료 시 다른 프로젝트의 컨테이너가 실행 중이어서 Docker Desktop은 종료하지 않았다. 해당 컨테이너에는 명령을 실행하지 않았으며 이 프로젝트의 API·웹 서비스는 시작하지 않았다. 실제 외부 API도 호출하지 않았다.
- `git diff --check`: **통과**. Step 22 완료를 막는 불일치는 없다. 기존 `pg`·Jest 경고와 고아 컨테이너 안내는 이번 범위에서 변경하지 않았다.

핵심 코드 읽는 순서: `apps/api/src/modules/policies/policies-write.service.ts`의 `savePolicies` → `prepareBatches` → `apps/api/src/modules/policies/policy.repository.ts`의 `upsertPolicies`·`refreshPolicies` → `apps/api/test/policy-storage.integration.spec.ts`.

## 26. Step 23 구현·검증 결과

사용자의 요청으로 Step 22의 최종 구현·테스트·문서 7개 파일을 `77b2caf` (`feat: 정책 전체 트랜잭션 묶음 저장 구현`)로 커밋한 뒤 Step 23만 진행했다. 커밋 전 발견한 빈 줄의 줄 끝 공백 한 곳만 정리했고 사용자 주석·코드는 보존했다. 작업 규칙·PLAN·SPEC 5.4·Step 22 완료 상태를 코드와 대조했으며 선행 작업 누락이나 설계 충돌은 없었다.

### 구현과 실제 결정사항

- 기존 한 번의 저장 처리를 `PoliciesWriteService.saveTransaction`으로 옮기고, `savePolicies`에서 첫 실패가 `QueryFailedError`의 PostgreSQL 코드 `40P01` 또는 `40001`일 때만 한 번 더 호출한다. 첫 시도를 포함해 최대 2회이며, 두 번째 실패는 추가 재시도 없이 전달한다.
- 각 시도는 기존 해시 조회·변경 분류·전체 묶음 저장을 모두 수행한다. 이전 시도의 건수를 더하지 않고 마지막에 확정된 시도의 건수만 반환한다. 재시도 범위에는 API 호출·변환·해시 계산을 포함하지 않으며, 같은 정책 배열과 같은 `QueryRunner.manager`를 사용한다.
- 첫 시도의 롤백이 완료돼 트랜잭션이 끝났고 연결도 반환되지 않았을 때, 기존 연결에서 `SELECT 1`을 실행해 사용 가능 여부를 확인한다. 새 연결·QueryRunner는 만들지 않는다. 연결 확인이 실패하면 충돌 오류와 연결 오류를 `AggregateError`에 보존하고 두 번째 저장을 시작하지 않는다.
- 롤백 실패·미종료 트랜잭션·반환된 연결·다른 SQLSTATE 코드·일반 작업 오류는 재시도하지 않는다. 잠금 획득·해제와 연결 반환은 기존 `IngestionLockService`의 책임을 유지한다.
- [PostgreSQL 17의 재시도 지침](https://www.postgresql.org/docs/17/mvcc-serialization-failure-handling.html)과 [오류 코드표](https://www.postgresql.org/docs/17/errcodes-appendix.html)를 대조했다. 충돌 때 판정에 사용한 조회를 포함한 전체 트랜잭션을 다시 실행한다. 재시도 코드·횟수는 프로젝트 SPEC의 두 코드·최대 2회로 제한했다. 설치된 TypeORM의 기존 QueryRunner 연결 재사용·오류 구조도 확인했다.
- 공개 API·DB 스키마·Migration·외부 패키지·설계 의미는 변경하지 않았다. PLAN 완료 표시와 SUMMARY만 갱신했다. 저장 시도·실패 단계의 파일 로그 연결은 Step 24에 남겼다.

### 실행 방법

```bash
npm run test --workspace apps/api -- --runTestsByPath test/policies-write.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
```

실제 DB·HTTP 포함 전체 테스트는 Step 22의 기존 Docker 설정·테스트 이미지·오버레이를 재사용했다. 소스와 테스트만 읽기 전용으로 연결한다.

```bash
docker --config /tmp/youth-kkultong-docker-config compose up -d db
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f /tmp/youth-kkultong-step22-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" api npm test
docker --config /tmp/youth-kkultong-docker-config compose stop db
```

### 실제 검증과 남은 문제

- 신규 재시도 단위 테스트 **19개**와 기존 분류·저장 단위 테스트를 합쳐 **48개 통과**. 두 코드의 첫 실패 후 성공·두 번째 실패 종료, 조회/확정 단계 충돌, 롤백→연결 확인→재시도 순서, 성공한 시도의 재분류·건수만 반환, 재시도하지 않을 오류·연결/롤백 실패를 확인했다.
- 신규 실제 PostgreSQL 17 통합 테스트 **4개 통과**. 두 세션이 반대 순서로 행을 잠그게 해 실제 `40P01`을 발생시켰고, 전체 저장의 두 번째 시도에서 최종 내용이 반영됐다. 교착 상태 감지 시간을 조절한 설정은 테스트 트랜잭션 안에만 적용했다.
- 테스트에서만 `REPEATABLE READ`를 사용하고 다른 세션이 같은 행을 먼저 갱신하게 해 실제 `40001`을 발생시켰다. 첫 시도의 동일 정책이 재조회 후 변경 정책으로 분류됐고 최종 건수 `NEW=1/CHANGED=1/UNCHANGED=0`으로 저장됐다. API는 모의 응답을 **한 번만 호출**했으며 두 저장 시도의 세션 PID가 같고 다른 수집은 계속 잠금 획득에 실패했다. 정상 종료 후 잠금 재획득도 통과했다. 제품의 기본 격리 수준은 변경하지 않았다.
- 두 시도 모두 두 번째 묶음에서 DB 충돌을 반환하게 한 사례는 **트랜잭션 2회·롤백 2회** 후 종료했고 앞 묶음의 저장도 모두 취소돼 기존 DB가 그대로였다. 별도 사례에서 롤백 직후 실제 클라이언트를 닫으면 **트랜잭션 1회**에서 종료했고 새 QueryRunner를 만들거나 데이터를 저장하지 않았다.
- 최종 실제 DB·HTTP 포함 전체 회귀 테스트: **24개 모음·681개 모두 통과**. `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`: **공용·API·웹 통과**. `npm run build --workspace apps/api`: **공용 선행 빌드·API 빌드 통과**. 웹 소스 변경이 없어 Next.js 배포 빌드는 재실행하지 않았다.
- 테스트 데이터·행 잠금·충돌은 매번 새로 만든 검증 전용 스키마에 한정했고 종료 시 스키마와 연결을 정리했다. 시작한 DB는 다시 정지하고 기존 볼륨과 다른 프로젝트의 실행 중 컨테이너는 유지했다. 이 프로젝트의 기존 API·웹 컨테이너는 시작하지 않았고 실제 외부 API를 호출하지 않았다.
- `git diff --check`: **통과**. Step 23 완료를 막는 불일치는 없다. 기존 `pg`·Jest 경고와 고아 컨테이너 안내는 이번 범위에서 변경하지 않았다.

핵심 코드 읽는 순서: `apps/api/src/modules/policies/policies-write.service.ts`의 `savePolicies` → `saveTransaction` → `apps/api/test/policies-write.spec.ts`의 재시도 사례 → `apps/api/test/policy-storage-retry.integration.spec.ts`.

## 27. Step 24 구현·검증 결과

사용자 요청으로 Step 23을 `72c0ad1` (`feat: DB 트랜잭션 충돌 복구 처리`)로 커밋한 뒤 다음 Step 요청에 따라 Step 24만 진행했다. 작업 규칙·PLAN·SPEC 5장·Step 23 완료 상태를 대조했고 착수 시 작업 트리는 깨끗했다. 로그 경로·보관은 ARCHITECTURE 6장·9장의 `/app/logs/` 및 볼륨 기준을 확인했다.

### 구현과 실제 결정사항

- `IngestionService.importPolicies`로 잠금 → 전체 수집·검증 → 변환·해시 → 저장 → 결과 기록을 연결했다. 기존 `collectPolicies`의 원본 배열 반환은 유지하며, CLI 진입점·명령·종료 코드는 Step 25에 남겼다. 서비스 생성자에 기존 잠금·저장 서비스와 새 파일 로그 서비스를 주입하고 `IngestionModule`에서 제공한다. 기존 테스트 3개 파일도 생성자 의존성만 맞췄다.
- `IngestionLogService`는 저장소 루트의 `logs/policies-import.jsonl`, 컨테이너의 `/app/logs/policies-import.jsonl`에 UTF-8 JSON 한 줄씩 추가한다. 실행 UUID·UTC ISO 시각·이벤트·단계·상태·페이지·페이지 시도 횟수·저장 시도 횟수·신규/변경/동일 확정 건수·실패 원인을 남긴다. 이벤트는 `RUN_STARTED`, `PAGE_ATTEMPT`, `SAVE_ATTEMPT`, `WORK_FINISHED`, `RUN_FINISHED`다. 파일은 소유자 읽기·쓰기 권한(`0600`)으로 생성한다.
- 클라이언트·저장 함수에 선택적인 기록 콜백을 추가했다. 페이지 재시도나 DB 재시도 횟수와 이전 실패의 HTTP 상태/SQLSTATE까지 기록하며 기존 재시도 대상·횟수·대기 규칙은 유지한다. 콜백에서 기록이 실패하면 수집/저장을 더 진행하지 않고 공통 정리로 전달한다.
- 잠금 해제 전에는 `WORK_FINISHED`를 기록하고, 기존 `IngestionLockService.runWithLock`의 `finally`가 롤백·잠금 해제·연결 반환을 시도한 뒤 `RUN_FINISHED`를 기록한다. 작업 오류·정리 오류·최종 기록 오류가 겹치면 `AggregateError`로 함께 전달한다. 로그 오류가 잠금 정리를 건너뛰지 않는다.
- `counts`는 확정된 DB 반영 건수이며, 롤백된 실행은 0건이다. `saved`로 DB 확정 여부를 별도로 기록한다. 확정 후 로그나 잠금 정리에 실패하면 최종 상태는 실패이지만 `saved=true`와 확정 건수는 유지한다. 이미 확정한 데이터를 롤백했다고 잘못 기록하지 않는다.
- 원본 오류의 메시지·스택·SQL·매개변수·응답 원문은 로그에 넘기지 않는다. 알려진 오류에서 단계·원인 코드·정책 ID·필드·HTTP 상태·SQLSTATE만 추출하고, 모르는 오류는 `UNEXPECTED_ERROR`로 기록한다. 파일 작성 시 허용한 속성만 복사하고 문자열 값에서 인증키·DB URL·인코딩 전후 비밀번호를 제거한다. 필드명이나 정책 ID에 비밀값이 들어간 경우도 가린다.
- 파일 기록이 실패하면 같은 안전한 기록을 NestJS 기본 로그에 `FILE_LOG_FAILED`로 남긴다. 기본 로그까지 실패하면 `IngestionLogError`를 전달한다. 로그 파일은 Git 및 Docker 빌드 문맥에서 제외했다.
- Compose에 계획된 `ingestion_logs:/app/logs` 볼륨을 추가했고, API 실행 이미지에서 로그 폴더를 `node` 사용자 소유로 만든다. 공개 API·DB 스키마·Migration·외부 패키지·설계 의미는 변경하지 않았다. 파일명·형식·운영상 세부 결정은 이 문서에 기록하고 SPEC은 수정하지 않았다.
- 사용자 요청에 따라 수집 모듈의 실행·잠금·로그 서비스 3개를 `ingestion/services/`로, 온통청년 API 호출·응답/페이지 검증·변환·해시 파일 5개를 `ingestion/youth-center/`로 묶었다. 모듈 선언은 기존 위치에 두고 소스·테스트의 import, 문서의 읽기 경로와 주석 기준 파일 경로를 갱신했다. 로그 서비스의 상대 경로도 이동한 깊이에 맞춰 수정해 저장소 루트 `logs/`와 컨테이너 `/app/logs/` 저장 위치를 유지한다.

### 실행 방법

```bash
npm run test --workspace apps/api -- --runTestsByPath test/ingestion-log.spec.ts test/ingestion-run.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
docker --config /tmp/youth-kkultong-docker-config compose build api
```

전체 테스트에는 기존 테스트 이미지를 재사용했다. `/tmp/youth-kkultong-step24-test.compose.yaml`은 다음과 같다. 테스트가 운영 로그 볼륨에 쓰지 않도록 `/tmp` 경로로 덮어쓴다. Docker 설정 파일은 기존 `{}`를 사용한다.

```yaml
services:
  api:
    image: youth-kkultong-api-step11-test
    build:
      target: api-build
    volumes:
      - /tmp/youth-kkultong-step24-test-logs:/app/logs
```

```bash
mkdir -p /tmp/youth-kkultong-step24-test-logs
docker --config /tmp/youth-kkultong-docker-config compose up -d db
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f /tmp/youth-kkultong-step24-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" api npm test
docker --config /tmp/youth-kkultong-docker-config compose stop db
```

### 실제 검증과 남은 문제

- 신규 파일 로그 테스트 **6개**, 실행/정리 단위 테스트 **13개**, 실제 PostgreSQL 17 통합 테스트 **13개** 통과. 정상·중복·API/검증/변환/해시/DB 실패의 결과 기록, 파일 실패의 기본 로그 대체, 파일·기본 로그 동시 실패의 오류 보존과 자원 정리를 확인했다.
- 실제 DB에서 처리 전 실패와 묶음 저장 중 오류는 기존 행·시각을 그대로 유지했다. 페이지·저장 시도·작업 결과·최종 결과 기록 지점의 양쪽 로그 실패 후에도 다른 세션이 잠금을 재획득했다. 잠금 해제 쿼리의 실패는 기존 세션을 종료해 잠금이 남지 않았으며 최종 로그에 저장 완료와 정리 실패가 함께 나타났다.
- 모의 HTTP `503` 이후 성공과 실제 DB가 반환한 `40P01` 이후 성공을 한 실행에서 확인했다. 페이지 시도 `1/2`, 다음 페이지 `1`, 저장 시도 `1/2`와 이전 실패 원인이 기록됐고 확정 신규 건수는 중복 합산 없이 3건이었다. 실제 외부 API는 호출하지 않았다.
- 파일 속성 허용 목록, 인증키·DB 비밀번호 가림, SQL·원본 메시지 제외, 동시 파일 추가, `0600` 권한을 확인했다. 테스트 파일·스키마·잠금·연결은 종료 시 정리했다.
- 통합 테스트의 QueryRunner 쿼리 감시 코드를 TypeORM의 오버로드에 맞게 수정한 뒤 최종 `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`: **공용·API·웹 통과**. 최종 실제 DB·HTTP 포함 전체 회귀 테스트: **27개 모음·713개 모두 통과**. `npm run build --workspace apps/api`: **공용 선행 빌드·API 빌드 통과**.
- `docker compose build api`: **통과**. API 실행 이미지의 별도 임시 컨테이너에서 UID **1000**·로그 볼륨 소유자 **1000**으로 진단 파일을 썼고, 다음 컨테이너에서 읽어 볼륨 유지를 확인한 뒤 해당 진단 파일만 제거했다. 기존 API·웹 서비스는 교체하거나 기동하지 않았다. 새 로그 볼륨은 빈 상태로 유지한다.
- 테스트를 위해 시작한 DB는 다시 정지했고 기존 DB 볼륨과 다른 프로젝트의 실행 중 컨테이너는 유지했다. 웹 소스 변경이 없어 Next.js 배포 빌드는 재실행하지 않았다.
- `git diff --check`, 로그 경로 Git 제외 확인: **통과**. Step 24 완료를 막는 불일치는 없다. 기존 `pg`·Jest 경고와 고아 컨테이너 안내는 이번 범위에서 변경하지 않았다. CLI에서는 원본 예외를 그대로 출력하지 않도록 Step 25에서 종료 메시지를 연결한다.
- 폴더 재배치 후에도 전체 **27개 모음·713개 테스트**, 공용·API·웹 타입 검사, API 빌드와 Docker API 이미지 빌드가 모두 통과했다. 빌드 결과에서 이전 경로의 생성물이 제거되고 기본 로그 경로가 저장소 루트 `logs/`로 유지되는 것을 확인했다. 운영 이미지의 임시 컨테이너에서도 새 경로의 서비스가 로딩되고 `/app/logs/`에 UID 1000 사용자의 쓰기 권한이 있음을 확인했다.

핵심 코드 읽는 순서: `apps/api/src/modules/ingestion/services/ingestion.service.ts`의 `importPolicies` → `ingestion-log.service.ts`의 `write` → `ingestion-lock.service.ts`의 `finally` → `apps/api/test/ingestion-run.integration.spec.ts`.

## 28. Step 25 구현·검증 결과

작업 규칙을 먼저 읽고 PLAN Step 25, SPEC 5.1~5.4, Step 24의 완료 기록과 실제 수집 서비스를 대조했다. 선행 작업 누락이나 설계 충돌은 없었고 착수 시 작업 트리는 깨끗했다. Step 25의 CLI 연결·검증만 진행했으며 커밋은 실행하지 않았다.

### 구현과 실제 결정사항

- `apps/api/src/import-policies.ts`에서 `NestFactory.createApplicationContext(AppModule)`으로 웹 API와 같은 모듈·DB 설정을 사용한다. HTTP 서버나 포트를 열지 않고 `IngestionService.importPolicies`를 한 번 호출한다. 수집·검증·변환·해시·저장·잠금·로그의 기존 업무 규칙은 유지한다.
- API 작업공간에 `import:policies`를 추가하고 루트 명령도 해당 작업공간으로 연결했다. 기존 Migration·시드처럼 빌드된 JavaScript를 실행하므로 로컬에서는 API를 먼저 빌드한다. 운영 API 이미지에는 빌드 결과와 명령이 함께 포함되며 TypeScript 실행 도구나 새 패키지를 요구하지 않는다.
- 종료 코드는 **성공 `0`, 최종 실패 `1`, 중복 실행 `2`**다. 성공은 신규/변경/동일 건수를, 중복은 실행을 건너뛴 사실을 출력한다. 수집 서비스가 잠금·전용 연결을 반환한 뒤 `app.close()`로 연결 풀까지 닫고 최종 메시지를 출력한다. 컨텍스트 종료가 실패하면 성공·중복 결과 대신 실패 메시지와 코드 `1`을 반환한다.
- `process.exit()`로 강제 종료하지 않고 `process.exitCode`를 설정한다. `abortOnError=false`로 NestJS 초기화 오류도 CLI에서 처리한다. NestJS 로그 수준은 `warn`만 허용해 원본 초기화 오류·스택의 노출을 막고 기존 `FILE_LOG_FAILED` 경고는 유지한다. CLI의 오류 메시지에는 원본 예외·SQL·접속 URL·인증키를 넣지 않는다. 확정 뒤 정리에 실패할 수도 있으므로 실패 메시지에서 데이터가 롤백됐다고 단정하지 않는다.
- 공개 API·DB 스키마·Migration·외부 패키지·설계 의미는 변경하지 않았다. PLAN 완료 표시와 이 SUMMARY만 갱신했으며 종료 코드·실행 방법은 구현 세부 결정으로 기록한다.

### 실행 방법

로컬에서는 루트 `.env` 또는 실행 환경에 `DATABASE_URL`·`YOUTH_CENTER_API_KEY`를 설정하고 DB와 Migration을 준비한 뒤 실행한다.

```bash
npm run build --workspace apps/api
npm run import:policies
# API 작업공간을 직접 지정해도 같은 CLI를 실행한다.
npm run import:policies --workspace apps/api
```

Compose에서는 API 이미지 빌드·DB Migration 준비 후 같은 이미지의 별도 컨테이너로 실행할 수 있다. 기존 API 서버를 다시 시작하거나 교체하지 않는다.

```bash
docker compose run --rm api npm run import:policies --workspace apps/api
```

테스트는 Step 24의 Docker 설정·테스트 이미지·로그 격리를 재사용했다. Docker 명령의 설정과 테스트 오버레이는 앞 절의 실행 방법을 따른다.

```bash
npm run test --workspace apps/api -- --runTestsByPath test/import-policies.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
docker --config /tmp/youth-kkultong-docker-config compose build api
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f /tmp/youth-kkultong-step24-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" api npm test
```

### 실제 검증과 남은 문제

- 신규 단위 테스트 **8개**, 실제 PostgreSQL 17 + NestJS 컨텍스트 통합 테스트 **3개** 통과. 정상·중복·수집/초기화/서비스 조회 실패, 정상·실패·중복 후 컨텍스트 종료 실패를 확인했다. 원본 예외를 출력하지 않고 종료 코드와 결과 메시지를 구분한다.
- 실제 컨텍스트에서 잠금 → 모의 API → 정책 저장 → 작업 결과 기록 → 잠금 해제 → 연결 반환 → 최종 기록 → 연결 풀 종료 → 결과 출력 순서를 확인했다. API 실패 후 잠금 재획득, 중복 실행 시 API 미호출·파일 기록, 컨텍스트 종료 후 `DataSource.isInitialized=false`도 확인했다.
- 최초 통합 테스트의 Migration 연결에 검증 스키마 검색 경로가 빠져 기존 테이블 생성이 거부됐다. 테이블을 변경하지 않았으며 검증 연결의 `search_path`를 지정해 격리를 바로잡았다. QueryRunner 감시 함수의 매개변수 타입 오류도 수정한 뒤 최종 타입 검사와 전체 테스트를 통과했다.
- 실제 DB·HTTP 포함 전체 회귀 테스트: **29개 모음·724개 모두 통과**. `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`: **공용·API·웹 통과**. `npm run build --workspace apps/api`: **공용 선행 빌드·API 빌드 통과**. `docker compose build api`: **통과**. 웹 소스 변경이 없어 Next.js 배포 빌드는 재실행하지 않았다.
- 운영 API 이미지의 별도 임시 컨테이너에서 루트·API 작업공간의 **실제 npm 자식 프로세스 8회**를 실행했다. 각 위치에서 성공 `0`, API 최종 실패 `1`, 다른 DB 연결의 잠금으로 인한 중복 `2`, 환경변수 초기화 실패 `1`을 반환하고 자연 종료했다. 출력의 인증키·DB URL 제외, 파일의 최종 상태, 반복 성공 후 정책 중복 없음도 통과했다. 외부 API만 임시 사전 로딩 스크립트로 대체했고 NestJS 컨텍스트·잠금·저장·연결 종료는 실제 실행했다.
- 테스트 쓰기는 매번 새 이름의 검증 스키마·임시 로그에 한정했고 종료 시 제거했다. 실제 외부 API는 호출하지 않았으며 개발 정책과 운영 로그 볼륨은 유지했다. 검증을 위해 시작한 DB는 다시 정지하고 기존 볼륨을 유지했다. 기존 API·웹 서비스는 교체하거나 기동하지 않았다.
- `git diff --check`: **통과**. Step 25 완료를 막는 불일치는 없다. 기존 `pg`·Jest 경고·개발 의존성 점검 과제·고아 컨테이너 안내는 이번 범위에서 변경하지 않았다.

핵심 코드 읽는 순서: `apps/api/src/import-policies.ts` → `apps/api/src/modules/ingestion/services/ingestion.service.ts`의 `importPolicies` → `apps/api/test/import-policies.spec.ts` → `apps/api/test/import-policies.integration.spec.ts`.

## 29. Step 26 구현·검증 결과

사용자 요청에 따라 Step 25의 코드·테스트·문서 7개 파일을 `c34a47a` (`feat: 정책 수동 수집 명령 연결`)로 커밋한 뒤 Step 26만 진행했다. 작업 규칙·PLAN Step 26·SPEC 5장과 T-20·T-21·Step 25 완료 기록을 실제 코드와 대조했다. 선행 작업 누락이나 설계 충돌은 없었다.

### 구현과 실제 결정사항

- `apps/api/test/ingestion-success.integration.spec.ts`에 성공 경로 통합 테스트 7개를 추가했다. HTTP `fetch`만 모의 응답으로 교체하고 잠금 → 페이지별·전체 검증 → 변환·해시 → 단일 트랜잭션 저장 → 파일 기록 → 잠금·연결 반환은 기존 실제 서비스를 사용한다. 제품 코드는 수정하지 않았다.
- 기존 원본 샘플과 최소 필드·자격 조건·단일 신청기간이 있는 3개 정책을 2페이지로 나눠 첫 수집을 검증한다. 정규화 컬럼·0과 NULL·시간대 없는 시각·코드 배열·DATE·알려지지 않은 중첩 필드까지 원본 JSON 보관을 DB에서 확인한다.
- 동일 자료를 세 번 추가 수집하는 T-21, 제목·지원 내용 변경 후 재수집, 조회수만 증가하는 T-20, 신규·변경·조회수 변경·동일 자료가 섞인 수집을 각각 검증한다. 매 실행에서 반환 건수와 최종 파일 로그의 확정 건수를 대조하고 `(source, external_id)` 중복이 0건인지 실제 SQL로 확인한다. UUID·최초 저장일을 유지하며, 조회수만 변경되면 내용 해시와 정규화 내용도 유지하고 조회수·원본만 최신화한다.
- 같은 외부 ID를 가진 다른 출처 정책이 바뀌지 않는지와, 빈 목록을 정상 수집해도 기존 정책을 삭제하지 않는지를 확인한다. 별도 사례에서는 201건을 50건씩 5페이지로 받아 200건 저장 경계를 넘긴 뒤 동일 자료 재수집·전체 조회수 갱신에도 201건과 원본·해시·UUID가 유지되는지 확인한다.
- 모든 쓰기는 매번 생성한 `step26_test_<임의값>` 스키마와 `/tmp/ingestion-success-*` 임시 로그에 한정한다. 테스트가 끝나면 데이터·스키마·로그·DB 연결을 정리한다. 공개 API·DB 스키마·Migration·외부 패키지·설계 의미는 변경하지 않았고 PLAN·SUMMARY만 갱신했다.

### 실행 방법과 실제 검증

Step 24~25의 Docker 설정·테스트 이미지·로그 격리를 재사용했다. DB는 검증 전에 시작하고 검증 후 다시 정지했다.

```bash
docker --config /tmp/youth-kkultong-docker-config compose up -d db
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f /tmp/youth-kkultong-step24-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" api npm run test --workspace apps/api -- --runTestsByPath test/ingestion-success.integration.spec.ts
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f /tmp/youth-kkultong-step24-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" api npm test
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
docker --config /tmp/youth-kkultong-docker-config compose stop db
```

- 신규 통합 테스트 **7개 모두 통과**, 실제 DB·HTTP 포함 전체 회귀 테스트 **30개 모음·731개 모두 통과**. `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`: **공용·API·웹 통과**. 테스트·문서만 변경했으므로 API·웹·운영 Docker 이미지 빌드는 재실행하지 않았다.
- 개발 DB의 `public.policies`는 테스트 전후 **0건**이며 전체 행 내용의 MD5 지문도 같았다. Step 26 임시 스키마가 모두 제거된 것을 별도 SQL로 확인했다. 실제 온통청년 API를 호출하거나 정책을 개발 DB에 적재하지 않았다. 테스트 로그는 검증 후 삭제했으며 운영 로그 볼륨에 수집 기록을 추가하지 않았다.
- 검증을 위해 시작한 DB는 다시 정지하고 기존 볼륨을 보존했다. 기존 API·웹 서비스와 다른 프로젝트 컨테이너는 기동·교체하지 않았다. `git diff --check`: **통과**. Step 26 완료를 막는 불일치는 없다. 기존 `pg`·Jest 경고와 고아 컨테이너 안내는 이번 범위에서 변경하지 않았다.

핵심 코드 읽는 순서: `apps/api/test/ingestion-success.integration.spec.ts`의 `initialPolicies` → `createService`·`expectImport` → T-20·T-21과 혼합·201건 사례. 실제 처리 흐름은 기존 `apps/api/src/modules/ingestion/services/ingestion.service.ts`의 `importPolicies`를 따른다.

## 30. 실제 온통청년 API 전체 수집·DB 보존·DBeaver 연결 검증

사용자가 실제 API 전체 수집과 저장 데이터·로그 보존, 단계별 결과 보고, Windows DBeaver 접속을 추가 요청했다. Step 27을 진행한 것은 아니며 커밋하지 않았다. 최초 확인에서는 `YOUTH_CENTER_API_KEY`가 없어 중단했고, 사용자가 `.env`에 설정한 뒤 재개했다. 비밀값은 출력하거나 문서에 기록하지 않았다.

### 실제 실행 결과

- 실행: 기존 운영 API 이미지의 독립 CLI에서 `npm run import:policies --workspace apps/api`. 실제 온통청년 API를 호출했으며 모의 응답·테스트 스키마·임시 정책을 사용하지 않았다. 시작 전 적용된 Migration 2개와 `public.policies` 0건을 확인했다.
- 실행 ID: `d7cc935c-09cb-4d38-9304-31b51e8abd16`. 한국 시간 **2026-10-20 16:04:11.059~16:08:17.156**, 소요 **246.097초**. CLI 종료 코드 **0**, 최종 파일 상태 **SUCCESS**, `saved=true`.
- 실제 응답 기준 **3,390건·68페이지**를 수집했다. 기본 페이지 크기는 50건이고 마지막 페이지는 40건이다. 8·58페이지에서 각각 HTTP 500이 한 번 발생했으나 해당 페이지의 두 번째 시도에서 성공했다. 전체 HTTP 요청은 **70회**, DB 저장 시도는 **1회**다. 인증·구조·전체 검증·변환·해시·저장의 최종 실패는 없었다.
- 수집 중 실제 DB에서 전용 연결 PID 72의 Advisory Lock과 열린 트랜잭션 없음, 정책 0건을 확인했다. 모든 페이지 검증·변환·해시 이후 16:08:15.891에 저장 시도를 기록하고, 최대 200건씩 **17개 묶음(200건 × 16 + 190건)**을 전체 트랜잭션 하나로 처리했다. 결과는 **NEW=3390 / CHANGED=0 / UNCHANGED=0**이다. DB의 행 생성 트랜잭션 ID(`xmin`)도 전체에서 1개였다.
- 저장 후 3,390건 전체의 `raw_json`을 기존 변환·해시 함수에 다시 넣고 실제 DB 컬럼·내용 해시와 대조했다. **정규화 값 불일치 0건, 해시 불일치 0건, 잘못된 원본 JSON 0건, `(source, external_id)` 중복 0건**이다. 최종 로그 기록 후 수집 잠금 0개, PID 72 연결 잔존 0개를 확인했다. 실제 원본 JSON은 정책 테이블에 보존했다.

### 데이터와 로그 보존

- 실제 정책은 **`youth_kkultong` DB의 `public.policies` 3,390건**으로 유지한다. 기존 `youth-kkultong_db_data` 볼륨을 계속 사용했고 DBeaver 포트 설정에 따른 DB 컨테이너 재생성 후에도 같은 볼륨·3,390건을 확인했다. 데이터·테이블·볼륨을 삭제하거나 초기화하지 않았다. DB는 사용자가 바로 조회할 수 있도록 **실행 중**으로 둔다.
- 로그 원본은 `youth-kkultong_ingestion_logs` 볼륨의 **`/app/logs/policies-import.jsonl`**에 74줄로 보존한다. `RUN_STARTED` → `PAGE_ATTEMPT` 70회 → `SAVE_ATTEMPT` → `WORK_FINISHED` → `RUN_FINISHED`가 기록됐다. 마지막 행은 `SUCCESS`, `saved=true`, 확정 신규 3,390건이다.
- IDE에서 바로 읽을 수 있도록 저장소 루트 **`logs/policies-import.jsonl`**에도 읽기용 복사본을 만들었다. 이 파일은 이번 실행 시점의 복사본이며 Docker 로그 원본과 자동 동기화하지 않는다. 파일 권한 `0600`·Git 제외·인증키 미포함을 확인했다. 이후 수집 로그의 원본은 계속 Docker 볼륨에 추가된다.

### Windows DBeaver 연결

- 기본 Compose의 DB는 내부 전용 네트워크여서 호스트 포트를 사용할 수 없다. 사용자가 요청한 로컬 조회용 `compose.local.yaml`을 추가해 **`127.0.0.1:5433 → DB:5432`**를 연결했다. 내부 전용 네트워크만으로는 포트 설정이 실제 공개되지 않아 DB만 참여하는 `db_local` 브리지 네트워크를 함께 구성했다. 공유 `app` 네트워크에 DB를 연결하는 방식은 자동 승인 검토에서 접근 범위 확대를 이유로 거절되어 적용하지 않았고, DB 전용 네트워크 대안으로 해결했다.
- Windows PowerShell의 실제 TCP 연결과 WSL의 PostgreSQL 클라이언트에서 비밀번호 인증·SQL 조회가 모두 성공했다. 적용된 포트가 `127.0.0.1:5433`, `db_local`의 컨테이너가 DB 하나뿐이고 원래 `database` 네트워크가 유지되는 것도 확인했다. DBeaver GUI 자체는 조작하지 않았다.
- DBeaver에서 새 PostgreSQL 연결을 만들고 **Host=`127.0.0.1`, Port=`5433`, Database=`youth_kkultong`, Username=`youth_kkultong`, Password=로컬 `.env`의 `POSTGRES_PASSWORD`**를 입력한다. 연결 테스트 후 `Schemas → public → Tables → policies`에서 데이터를 조회한다. 컨테이너 IP나 WSL IP를 입력할 필요는 없다.
- 같은 로컬 구성을 유지한 재기동과 직접 DB 조회 명령은 다음과 같다. `up`은 아래처럼 두 파일을 함께 지정해야 DBeaver 포트 설정을 유지한다.

```bash
docker compose -f compose.yaml -f compose.local.yaml up -d db
docker compose exec db psql -U youth_kkultong -d youth_kkultong
```

```sql
SELECT count(*) FROM public.policies;
SELECT external_id, title, view_count, created_at FROM public.policies ORDER BY external_id LIMIT 20;
SELECT source, external_id, count(*) FROM public.policies GROUP BY source, external_id HAVING count(*) > 1;
```

실제 실행에서는 앞 Step들과 같은 `/tmp/youth-kkultong-docker-config` 설정을 사용했다. Docker Desktop의 포트 전달 방식은 [Docker 공식 문서](https://docs.docker.com/desktop/features/networking/), 접속 항목은 [DBeaver PostgreSQL 공식 문서](https://dbeaver.com/docs/dbeaver/Database-driver-PostgreSQL/)와 대조했다. `compose.local.yaml`·`.env.example`·`ARCHITECTURE`를 실제 로컬 접속 구성과 맞췄다. 제품 수집 코드·DB 스키마·Migration·패키지는 변경하지 않았다. Compose 구성 확인, 실제 전체 수집, 전체 행 검증, 포트·인증·SQL 검증, `git diff --check`를 수행했다. 이전 Step 26의 테스트·문서 변경도 미커밋 상태로 유지한다.

## 31. Step 27 구현·검증 결과

사용자 요청에 따라 Step 26 테스트·문서를 `7859ea4` (`test: 정책 수집과 재수집 정상 경로 검증`), 실제 API 수집 기록·로컬 DB 접속 설정을 `3355a46` (`chore: 실제 정책 수집 기록과 로컬 DB 접속 구성`)로 분리해 커밋한 뒤 Step 27만 진행했다. `.env`와 실제 수집 로그는 커밋에 포함하지 않았다. 작업 규칙·PLAN Step 27·SPEC 5.4와 관련 테스트 기준·Step 26 및 실제 수집 완료 상태를 대조했으며 선행 작업 누락이나 설계 충돌은 없었다.

### 구현과 실제 결정사항

- `ingestion-failure.integration.spec.ts`에 9개 사례를 추가했다. 중간 페이지 타임아웃 후 해당 페이지만 재시도하는 성공, `e003` 즉시 종료, HTTP 429·503 최대 3회 후 종료, 페이지 간 ID 중복, 변환·해시 실패를 실제 PostgreSQL·모의 HTTP 응답으로 확인한다. 저장 전 실패는 저장 서비스를 호출하지 않으며, 최종 로그의 단계·페이지·시도 횟수·미확정 건수와 기존 행·시각 보존·잠금 재획득을 대조한다.
- 2,000건을 수집하는 사례에서는 검증 스키마에만 CHECK 제약을 추가해 마지막 정책이 실제 DB 오류 `23514`를 발생시키게 했다. 앞서 성공한 200건 묶음 9개와 기존 정책 내용 변경이 모두 롤백됐으며, 재시도 없이 저장 1회에서 종료했다. 정상 변환 가능한 자료로 DB 저장 단계 실패를 재현하고 테스트 제약은 `finally`에서 제거한다. 다른 사례에서는 첫 묶음 반영 후 수집 전용 클라이언트 연결을 실제로 닫아 부분 변경 취소·연결 반환·새 연결 재시도 없음까지 확인했다.
- `ingestion-cli-process.integration.spec.ts`에 실제 독립 Node CLI 프로세스 2개를 겹쳐 실행하는 잠금 경쟁과, 첫 묶음 반영 후 COMMIT 전에 `SIGKILL`로 종료하는 복구 사례를 추가했다. IPC(프로세스 간 알림)로 실제 API·저장 도달 시점을 맞추며 임의의 긴 대기 시간에 의존하지 않는다. 먼저 실행한 CLI만 API를 호출하고 다른 CLI는 코드 2·`ALREADY_RUNNING`을 기록한다. 강제 종료된 실행의 부분 갱신은 취소되고 잠금이 풀린 뒤 다음 CLI가 코드 0으로 정상 저장한다. 강제 종료 시 최종 로그가 없을 수 있다는 기존 SPEC도 확인했다.
- 테스트 전용 `fixtures/ingestion-cli.preload.cjs`는 기존 TypeScript 개발 의존성으로 CLI 소스의 데코레이터를 변환해 실제 진입 파일을 새 프로세스로 실행한다. DB는 `step27_cli_<임의값>` 스키마인지 검사한 뒤 그 경로로만 연결하고, 로그는 자식 프로세스별 임시 폴더에 기록한다. 외부 HTTP만 모의 응답을 사용한다. 운영 코드에 테스트용 실행 옵션이나 공개 API를 추가하지 않았다.
- 기존 Step 23~24의 실제 교착·직렬화 충돌, 저장 재시도 한도, 파일 로그 실패·기본 로그 대체·양쪽 로그 실패의 정리 검증은 재작성하지 않고 전체 회귀 테스트에 포함했다. 제품 코드·공개 API·DB 스키마·Migration·패키지·모듈 구조는 변경하지 않았고 PLAN·SUMMARY만 갱신했다.

| SPEC 기준 | 실제 검증 근거 |
| --- | --- |
| T-18·T-18a·T-19 | 신규 실패 통합 테스트의 중간 타임아웃·e003·429/503·페이지 간 중복 |
| T-25·T-26 | 신규 프로세스 통합 테스트의 CLI 2개 잠금 경쟁·COMMIT 전 강제 종료 후 재실행 |
| T-27 | 신규 실패 통합 테스트의 2,000번째 정책 CHECK 오류·전체 롤백 |
| T-27a | 기존 `policy-storage-retry.integration.spec.ts`의 실제 40P01·40001 및 `ingestion-run.integration.spec.ts`의 API/DB 제한적 재시도 |
| T-27b | 신규 실패 통합 테스트의 변환·해시 실패·저장 미호출 |
| T-27c | 기존 `ingestion-run.integration.spec.ts`의 파일 실패 대체 기록·여러 기록 지점의 양쪽 로그 실패 후 잠금 반환 |
| T-27d | 신규 실패 통합 테스트의 실제 수집 연결 끊김·전체 취소·자동 재연결 없음 |

### 실행 방법과 실제 검증

이미 실행 중인 실제 DB는 재시작하지 않았다. 기존 테스트 이미지·로그 격리 설정을 재사용하고 DBeaver용 로컬 Compose 설정도 함께 지정했다. `--no-deps`로 검증 컨테이너만 실행하므로 DB 컨테이너·포트를 재구성하지 않는다.

```bash
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f compose.local.yaml -f /tmp/youth-kkultong-step24-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" api npm run test --workspace apps/api -- --runTestsByPath test/ingestion-failure.integration.spec.ts test/ingestion-cli-process.integration.spec.ts
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f compose.local.yaml -f /tmp/youth-kkultong-step24-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" api npm test
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
```

- 신규 **11개 모두 통과**, 실제 DB·HTTP 포함 전체 회귀 테스트 **32개 모음·742개 모두 통과**. 자식 프로세스 표준 출력의 nullable(비어 있을 수 있는) 타입을 명시적 `pipe` 설정과 맞춘 뒤 최종 타입 검사도 **공용·API·웹 통과**했다. 테스트·문서만 변경했으므로 API·웹·운영 Docker 이미지 빌드는 재실행하지 않았다.
- 테스트 전후 실제 `public.policies`는 **3,390건**이고 전체 행·시각의 MD5 지문이 같았다. 실제 수집 로그 원본과 로컬 복사본은 모두 **74줄·같은 SHA-256 지문**을 유지했다. Step 27 검증 스키마 0개·수집 잠금 0개를 별도 SQL로 확인했다. 데이터·운영 로그·DB 볼륨을 삭제하거나 갱신하지 않았다.
- DB는 기존 컨테이너와 **`127.0.0.1:5433`** 포트를 유지해 계속 실행 중이다. 자식 프로세스·검증 스키마·임시 로그·연결은 정리했으며 실제 외부 API는 호출하지 않았다. `git diff --check`: **통과**. Step 27 완료를 막는 불일치는 없으며 기존 `pg`·Jest 경고와 고아 컨테이너 안내는 이번 범위에서 변경하지 않았다.

핵심 코드 읽는 순서: `ingestion-failure.integration.spec.ts`의 `expectPreserved` → 2,000번째 정책·연결 끊김 사례 → `ingestion-cli-process.integration.spec.ts`의 `startCli`·T-25·T-26 → `fixtures/ingestion-cli.preload.cjs`의 실행 일시 정지 지점.

## 32. Step 28 구현·검증 결과

작업 규칙을 먼저 읽고 PLAN Step 28·SPEC의 저장 원칙, 상세·분야 조회, 상태·자격·정렬 기준과 Step 27 완료 상태를 기존 코드에 대조했다. 선행 작업 누락이나 설계 충돌은 없었으며 Step 28만 진행했다. 착수 시 Git 변경사항은 없었고 이번 작업에서도 커밋하지 않았다.

### 구현과 실제 결정사항

- `PolicyRepository.findCandidates(manager)`는 목록 평가에 필요한 내부 ID·외부 ID·제목·분야·조회수·원본 등록일·신청기간·나이·취업·학력·지역 코드를 한 번의 SQL로 읽는다. 서버 내부 타입 `PolicyCandidate`로 전체 엔티티와 구분했다. 마감 정책을 포함한 전체 후보를 반환하며 필터·점수·정렬·페이지 나누기는 후속 검색 서비스에서 수행한다.
- 긴 지원 내용은 DB의 `LEFT`로 앞 **200자**만 `benefitPreview`에 담는다. 추가 자격·참여 제한 설명은 공백을 제외한 글자가 있는지 DB에서 확인해 `hasExtraText`로 반환한다. 원본 JSON·설명 본문·지원 본문 전체·추가 자격 본문·링크·해시·내부 저장 시각은 후보 결과에 담지 않는다. 200자는 목록 조회의 내부 미리보기 길이이며 API 계약이나 원본 저장 값을 변경하지 않는다.
- 원시 조회(`getRawMany`)에서는 엔티티의 DATE 변환을 거치지 않아 최초 검증에서 날짜가 `Date`로 반환됐다. 신청 시작·종료일을 DB의 `TO_CHAR`로 명시적으로 `YYYY-MM-DD` 문자열로 반환하도록 보완했으며 NULL은 유지한다. 0·NULL·미확인 코드도 임의로 보정하지 않는다.
- `findById(manager, id)`는 UUID로 원본·긴 본문까지 전체 엔티티를 조회하며 없으면 `null`이다. UUID 입력 검증·404 응답은 후속 API 계층의 책임이다. `findCategories(manager)`는 실제 DB 대분류의 고유값을 정렬해 반환하고 NULL·빈 문자열·공백뿐인 값은 제외한다. 유효한 분야 문자열은 수정하지 않는다.
- 기존 저장 메서드와 동일하게 호출자가 `EntityManager`를 전달하며, 자체 연결·트랜잭션을 생성하지 않는다. `PoliciesModule`은 후속 조회 서비스와 메타 모듈에서 사용할 수 있도록 `PolicyRepository`를 내보낸다. DB 스키마·Migration·공개 API·공용 타입·외부 패키지는 변경하지 않았다. SPEC의 설계 의미 변경은 없어 PLAN·SUMMARY만 갱신했다.

### 실행 방법과 실제 검증

기존 DB 컨테이너와 DBeaver용 로컬 포트를 유지하고 기존 테스트 이미지·임시 로그 설정을 재사용했다. 신규 통합 테스트는 임의 이름의 `step28_test_<임의값>` 스키마에만 데이터를 저장하며 사례별 롤백과 종료 시 스키마·연결 정리를 수행한다.

```bash
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f compose.local.yaml -f /tmp/youth-kkultong-step24-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" api npm test
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
git diff --check
```

- 신규 통합 테스트 **8개**, 전체 회귀 테스트 **33개 모음·750개 모두 통과**. 후보 단일 조회·긴 본문 제외·Unicode 미리보기·날짜 문자열·NULL·0·코드 배열·추가 조건 존재 여부·UUID 상세와 없는 UUID·분야 고유값·호출자 트랜잭션 사용을 확인했다. 최초 날짜 변환 실패는 위 수정 후 전체 회귀 테스트에서 해소됐다.
- 공용·API·웹 **타입 검사 통과**, API **빌드 통과**, `git diff --check` **통과**. 웹·운영 Docker 이미지 빌드는 변경 범위에 해당하지 않아 재실행하지 않았다.
- 테스트 전후 실제 `public.policies` **3,390건**, 전체 행·시각의 MD5 지문 **`46a965ded0407e47a7af9816cd3e7b6e`로 동일**. 테스트 후 Step 28 임시 스키마 **0개**를 별도 SQL로 확인했다. 실제 외부 API는 호출하지 않았고 운영 로그·볼륨·DB 컨테이너를 변경하지 않았다. DB는 기존 `127.0.0.1:5433` 포트로 계속 실행 중이다.
- Step 28 완료를 막는 미해결 문제는 없다. 기존 Jest VM Modules·`pg` 경고와 고아 컨테이너 안내는 변경하지 않았다.

핵심 코드 읽는 순서: `policy.repository.ts`의 `PolicyCandidate` → `findCandidates` → `findById`·`findCategories` → `policies.module.ts` → `policy-read.integration.spec.ts`.

## 33. Step 29 구현·검증 결과

사용자 요청에 따라 Step 28의 코드·테스트·문서 5개 파일을 `697ceee` (`feat: 정책 조회 전용 Repository 메서드 구성`)로 커밋한 뒤 Step 29만 진행했다. 작업 규칙·PLAN Step 29·SPEC의 코드표·입력 검증·제한 없음 기준과 Step 28 완료 기록을 확인했다. 선행 작업 누락이나 설계 충돌은 없었다.

### 구현과 실제 결정사항

- `apps/api/src/modules/meta/eligibility-codes.ts`에 공식 취업 선택지 `JOB_OPTIONS` 10개, 학력 선택지 `SCHOOL_OPTIONS` 10개를 서버 자료로 정의했다. 각 항목은 문자열 `code`와 한국어 `label`이며 앞자리 0·공백·문장 부호를 공식 원본과 동일하게 보존한다. TypeScript에서는 읽기 전용 목록·항목으로 제공한다.
- `JOB_UNRESTRICTED_CODE='0013010'`, `SCHOOL_UNRESTRICTED_CODE='0049010'`을 따로 정의해 '기타'·미확인 코드와 구분했다. 공식 표시명은 `제한없음`이다. 점수·태그 판정은 후속 매칭 Step에서 구현한다.
- 공식 엑셀의 `코드정보` 시트에서 `jobCd`, `schoolCd`를 Python 표준 라이브러리 `zipfile`·XML 파서로 직접 추출했다. 그룹별 10건·코드 중복 없음과 기존 `docs/api-research/local/official-codes.json`의 코드·표시명 전체 일치를 확인했다. 일부 실제 응답에서 관측되지 않은 코드도 공식 표에 있으면 유지한다.
- 원본과 독립적으로 추출한 기대값 20개·출처·검증일·원본 SHA-256을 `test/fixtures/eligibility-codes.official.json`으로 보관했다. 조사 폴더는 Git 제외 대상이므로 테스트가 로컬 조사 자료나 네트워크에 의존하지 않도록 했다. 기존 요청 스키마에 이 서버 표를 전달했을 때 전체 20개 선택지가 허용되고 미확인·다른 그룹·잘못된 형식이 거부되는지 검증했다. 실제 검색 API 연결은 후속 Step 범위다.
- 메타 API 제공은 Step 31 범위이므로 이번에는 컨트롤러·공용 응답 타입·DB·Migration·새 패키지를 추가하지 않았다. SPEC·제품 동작·모듈 경계 변경 없이 PLAN·SUMMARY에 결과를 반영했다.

### 출처 대조

원본은 기존 조사에서 확보한 [온통청년 공식 API 코드정보](https://www.youthcenter.go.kr/downloadform/API%EC%BD%94%EB%93%9C%EC%A0%95%EB%B3%B4.xlsx)의 로컬 파일 `docs/api-research/official/API코드정보.xlsx`이며, SHA-256은 **`81cd89ddc7bd49dfa9e53dec4f093bc8372d241505b5e8374cbfaf018245a5ef`**이다. **2026-10-20은 로컬 원본 대조일**이며 이번 Step에서 원격 최신본을 다시 내려받은 것은 아니다. 공식 코드의 업무 의미를 추가로 추측하거나 기존 보수적 판정 규칙을 바꾸지 않았다.

### 실제 검증

```bash
npm run test --workspace apps/api -- --runTestsByPath test/eligibility-codes.spec.ts test/policy-search-validation.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
git diff --check
```

- 공식 엑셀 직접 추출·기존 조사 JSON 대조: **취업 10개·학력 10개 일치, 중복·누락 0개**.
- 신규 코드표 테스트 **31개**, 기존 검색 요청 검증 **60개**, 합계 **2개 모음·91개 통과**. 원본 기대값·명칭·순서·중복·제한 없음 구분·전체 코드 허용·잘못된 입력 거부를 확인했다.
- 공용·API·웹 **타입 검사 통과**, API **빌드 통과**, `git diff --check` **통과**.
- DB·HTTP 통합 테스트 및 웹·운영 Docker 이미지 빌드는 미실행이다. 정적 서버 코드표와 그 단위 테스트만 추가한 범위이며 DB·네트워크·기존 제품 실행 경로를 변경하지 않았다. DB에 접속하거나 실제 정책·수집 로그·컨테이너를 변경하지 않았다. Step 29 완료를 막는 문제는 없다.

핵심 코드 읽는 순서: `meta/eligibility-codes.ts` → `test/fixtures/eligibility-codes.official.json` → `test/eligibility-codes.spec.ts`.

## 34. Step 30 구현·검증 결과

사용자 요청에 따라 Step 29의 코드·테스트·문서 5개 파일을 `3412de6` (`feat: 취업 학력 공식 코드표 구성`)으로 커밋한 뒤 Step 30만 진행했다. 작업 규칙·PLAN Step 30·SPEC의 지역 저장·메타 조회·공통 오류 기준과 선행 Step 완료 상태를 대조했으며 설계 충돌이나 선행 작업 누락은 없었다.

### 구현과 실제 결정사항

- `MetaModule`에 `RegionRepository`·`MetaController`를 등록하고 `DatabaseModule`을 연결했다. 후속 조건 검증·지역 판정에서도 사용할 수 있도록 지역 Repository를 내보낸다. 단순 조회이므로 전달만 하는 별도 서비스는 추가하지 않았다.
- `GET /api/v1/meta/regions`는 실제 DB에서 `is_active=true`인 지역만 코드 오름차순으로 조회한다. 코드·공식 이름·시도 그룹·직접 상위 코드를 반환하며 상위가 없으면 `parentCode=null`이다. DB의 `parent_code`를 그대로 사용하고 코드 앞자리 추측이나 시드 파일로 응답을 대체하지 않는다. 결과가 없으면 `200`과 빈 배열이다.
- 공용 `RegionOption` 타입을 `packages/shared/src/meta.ts`에 추가하고 공용 진입점에서 내보냈다. 엔티티를 직접 반환하지 않고 `{ code, name, provinceName, parentCode }`만 담은 객체로 변환한다. 부모별 추가 조회 없이 한 번의 SQL로 필요한 컬럼을 읽는다.
- 실제 연결 종료 검증에서 TypeORM이 `TypeORMError('Driver not Connected')`를 발생시키는 것을 확인했다. 기존 공통 필터가 이 오류를 500으로 분류하던 누락을 보완해 SPEC의 DB 연결 불가 `503`을 반환한다. 내부 오류는 기존처럼 원문 노출 없이 `500`이며 DB 오류를 빈 선택지로 숨기지 않는다.
- SPEC 4.2에 기존 지역 응답 요구사항의 구체적인 필드·공용 타입·순서를 명시했다. 기존 API 의미·DB 스키마·Migration·제품 판정 규칙·패키지·모듈 경계는 변경하지 않았다. PLAN·SUMMARY에 완료 상태와 검증 결과를 반영했다. SPEC_SUMMARY 파일은 없다.

### 실행 방법과 실제 검증

실제 `AppModule`·`MetaModule`·공통 설정을 그대로 사용하며 테스트에서는 DB 연결 대상만 `step30_test_<임의값>` 스키마로 바꿨다. 공식 시드·테스트 값 저장은 해당 스키마에만 한정하고 앱·DB 연결·스키마를 종료 시 정리한다. 기존 DB 컨테이너를 재시작하거나 포트를 변경하지 않았다.

```bash
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f compose.local.yaml -f /tmp/youth-kkultong-step24-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" --volume "$PWD/packages/shared/src:/app/packages/shared/src:ro" api npm test
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
git diff --check
```

- 신규 지역 DB·HTTP 통합 테스트 **8개**와 공통 오류 회귀 테스트 **1개**를 포함한 전체 **35개 모음·790개 통과**. 공식 537개 중 현행 284개 반환·폐지 253개 DB 보존·장안구 `41111`의 부모 수원시 `41110`·최상위 NULL을 확인했다. DB 값 변경 반영·임의 코드의 명시적 부모 관계 보존·단일 SQL·빈 결과·접두사·HTTP 방식·내부 500·실제 연결 종료 503도 검증했다.
- 최초 검증에서 부분 엔티티에 남는 undefined 속성과 실제 드라이버 종료 오류의 500 분류를 발견했고 위와 같이 보완한 뒤 전체 회귀 테스트를 다시 통과했다.
- 공용·API·웹 **타입 검사 통과**, API **빌드 통과**, `git diff --check` **통과**. 웹·운영 Docker 이미지 빌드는 재실행하지 않았다. 운영 API 컨테이너를 재배포한 상태는 아니며 API 실행에는 최신 소스 빌드 또는 이미지 재빌드가 필요하다.
- 테스트 전후 `public.policies` **3,390건**·전체 행/시각 MD5 **`46a965ded0407e47a7af9816cd3e7b6e`**, `public.regions` **537건**·전체 행 MD5 **`a51e60bd1ddaa0f13f1830ccbf751da2`**로 모두 동일하다. Step 30 임시 스키마 **0개**를 별도 SQL로 확인했다. 실제 외부 API를 호출하거나 운영 수집 로그·볼륨을 변경하지 않았다. DB는 기존 DBeaver용 `127.0.0.1:5433` 포트로 계속 실행 중이다.
- Step 30 완료를 막는 문제는 없다. 기존 Jest VM Modules·`pg` 경고와 고아 컨테이너 안내는 이번 범위에서 변경하지 않았다.

핵심 코드 읽는 순서: `packages/shared/src/meta.ts` → `region.repository.ts` → `meta.controller.ts`·`meta.module.ts` → `meta-regions.integration.spec.ts` → `api-exception.filter.ts`의 DB 연결 오류 분류.

## 35. 사용자 요청에 따른 모듈 내부 폴더 정리

2026-10-21 사용자 요청으로 Step 30 구현을 `d20f94d` (`feat: 지역 선택 목록 API 구현`)로 먼저 커밋하고 `meta`·`policies`의 파일 위치를 역할별로 정리했다. Step 31 기능은 진행하지 않았다.

- `meta/meta.controller.ts` → `meta/controllers/meta.controller.ts`
- `meta/region.repository.ts` → `meta/repositories/region.repository.ts`
- `policies/policy.repository.ts` → `policies/repositories/policy.repository.ts`
- `policies/policies-write.service.ts` → `policies/services/policies-write.service.ts`

기존 `entities/`·`ingestion/services/`와 일관되게 Controller·Repository·Service를 구분한다. 모듈 등록 파일과 `eligibility-codes.ts`는 루트에 유지하며 아직 사용하지 않는 역할의 빈 폴더는 추가하지 않았다. 모듈 간 책임·공개 API·DB·기능은 바꾸지 않았고, 이동한 네 파일은 import 경로를 제외한 구현 본문이 기존과 같음을 별도 비교했다. 모듈 등록·수집 서비스·관련 테스트·독립 CLI 검증 fixture의 경로도 함께 수정했다. ARCHITECTURE 6장의 디렉터리 구성을 동기화했으며 이전 Step 기록의 파일 위치는 당시 경로다.

검증은 Step 30과 같은 Docker 테스트 명령으로 실행했다. **전체 35개 모음·790개 통과**, `NEXT_TELEMETRY_DISABLED=1 npm run typecheck` **공용·API·웹 통과**, `npm run build --workspace apps/api`·`git diff --check` **통과**. 기존 정책 **3,390건**·지역 **537건**과 전체 행 지문이 테스트 전후 동일했다. 기존 DB 컨테이너·운영 로그·볼륨을 변경하지 않았다. 폴더 이동만 수행해 새 테스트는 추가하지 않았고 운영 Docker 이미지 재빌드·재배포는 하지 않았다.

핵심 코드 읽는 순서: `meta/meta.module.ts` → `meta/controllers/meta.controller.ts` → `meta/repositories/region.repository.ts` → `policies/policies.module.ts` → `policies/services/policies-write.service.ts` → `policies/repositories/policy.repository.ts`.

## 36. Step 31 구현·검증 결과

작업 규칙·PLAN Step 31·SPEC의 분야·자격 메타 조회·공용 타입 기준과 선행 Step 완료 상태를 확인했다. 폴더 정리는 `465373c` (`refactor: 메타와 정책 모듈의 파일을 역할별 폴더로 정리`)로 커밋 완료된 상태이며 착수 시 변경사항은 없었다. 선행 누락·설계 충돌 없이 Step 31만 진행했고 이번 변경은 커밋하지 않았다.

### 구현과 실제 결정사항

- `MetaModule`에서 기존 `PoliciesModule`을 가져오고 내보내진 `PolicyRepository`를 주입한다. `GET /api/v1/meta/categories`는 Step 28의 `findCategories`를 통해 실제 DB 분야 고유값을 문자열 배열로 반환한다. 중복·NULL·빈 문자열·공백뿐인 값을 제외하고 DB 정렬 순서를 유지한다. `금융･복지･문화`, `참여･기반` 같은 저장 문자열은 하나의 선택지로 유지하며 기호·공백을 임의로 정규화하거나 분리하지 않는다. 정책이 없으면 `200`과 빈 배열이다.
- `GET /api/v1/meta/eligibility-codes`는 Step 29의 `JOB_OPTIONS`·`SCHOOL_OPTIONS`를 `{ jobCodes, schoolCodes }`로 반환한다. 각 배열은 공식 순서의 `{ code, label }` 10개이고 `0013010`·`0049010` 제한 없음 선택지도 포함한다. DB 조회·실제 외부 API 호출은 하지 않는다.
- `EligibilityCodeOption`을 서버 파일에서 공용 `packages/shared/src/meta.ts`로 옮기고 `EligibilityCodesResponse`를 추가해 내보냈다. 실제 코드값·한국어 명칭은 계속 서버에만 두며 서버 자료도 공용 타입을 참조한다. SPEC 4.2에 분야 배열·문자열 보존·자격 응답 필드를 구체화했다. DB 스키마·Migration·패키지·판정 규칙 변경은 없고, 기존 모듈 책임을 유지했다.
- 별도 서비스나 Repository를 중복 추가하지 않고 기존 메타 Controller와 조회 메서드를 연결했다. DB 조회 오류는 기존 공통 필터를 통해 500/503을 반환하며 빈 배열로 숨기지 않는다. 앱이 실행 중인 상태에서 DB 연결이 끊겨도 정적 자격 코드표는 200으로 응답한다. DB 초기화가 필요한 기존 앱 기동 방식은 그대로다.

### 실행 방법과 실제 검증

실제 `AppModule`·`MetaModule`·공통 설정을 사용하고 DB 연결 대상만 `step31_test_<임의값>` 스키마로 교체했다. 정책 쓰기는 해당 임시 스키마에만 수행하며 종료 시 앱·연결·스키마를 정리한다.

```bash
docker --config /tmp/youth-kkultong-docker-config compose -f compose.yaml -f compose.local.yaml -f /tmp/youth-kkultong-step24-test.compose.yaml run --rm --no-deps --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" --volume "$PWD/packages/shared/src:/app/packages/shared/src:ro" api npm test
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
git diff --check
```

- 신규 DB·HTTP 통합 테스트 **12개**, 전체 회귀 테스트 **36개 모음·802개 통과**. 빈 분야·고유값·DB 변경 반영·묶음 분야명 및 서로 다른 가운뎃점 보존·공식 원본 기대값과 자격 응답 일치·자격 조회의 DB 미접근·접두사·HTTP 방식·내부 오류 500·실제 연결 종료 503과 정적 코드표 200을 확인했다. 기존 지역 메타 API도 전체 회귀에서 통과했다.
- 공용·API·웹 **타입 검사 통과**, API **빌드 통과**, `git diff --check` **통과**. 웹·운영 Docker 이미지 빌드와 운영 재배포는 수행하지 않았다.
- 테스트 전후 `public.policies` **3,390건**·전체 행/시각 MD5 **`46a965ded0407e47a7af9816cd3e7b6e`**, `public.regions` **537건**·전체 행 MD5 **`a51e60bd1ddaa0f13f1830ccbf751da2`**로 동일하다. Step 31 임시 스키마 **0개**를 별도 SQL로 확인했다. 운영 로그·볼륨·기존 DB 컨테이너·DBeaver 포트는 변경하지 않았다.
- Step 31 완료를 막는 문제는 없다. 기존 Jest VM Modules·`pg` 경고와 고아 컨테이너 안내는 변경하지 않았다. SPEC_SUMMARY 파일은 없다.

핵심 코드 읽는 순서: `packages/shared/src/meta.ts` → `meta/controllers/meta.controller.ts` → `meta/meta.module.ts` → `policies/repositories/policy.repository.ts`의 `findCategories` → `meta-options.integration.spec.ts`.

## 37. Step 32 구현·검증 결과

작업 규칙을 먼저 읽고 PLAN Step 32·SPEC 6장과 T-12~T-15·선행 완료 기록·실제 코드를 대조했다. Step 31은 `9b59876` (`feat: 정책 분야와 자격 선택 목록 API 구현`)으로 커밋되어 있었고 착수 시 변경사항은 없었다. Step 32만 진행했으며 이번 변경은 커밋하지 않았다.

### 구현과 실제 결정사항

- `policies/application-status.ts`에 `getKoreaToday(now)`와 `calculateApplicationStatus(period, today)`를 추가했다. 호출자가 전달한 시각을 `Asia/Seoul` 달력 날짜로 바꾸고, 정규화된 신청기간과 오늘 날짜로 공용 `ApplicationStatus`를 반환한다. 함수 안에서 현재 시각·DB·외부 API를 읽지 않고 입력도 변경하지 않는다. 이후 검색·상세 서비스에서 요청 시각을 한 번 정해 사용할 수 있다.
- 명시적 마감 `0057003`은 날짜 누락·잘못된 날짜·역전·복수 기간·미래 시작일보다 우선한다. 상시 `0057002`는 양쪽 날짜가 없고 원문도 없거나 빈 값·`상시`인 경우 `ALWAYS_OPEN`이다. 유한 날짜가 붙었거나 다른 미해석 기간 원문이 남으면 `UNKNOWN`으로 보류한다. 상시와 날짜의 충돌 사례는 테스트에 기록했다.
- 나머지는 단일 유효 시작·종료일을 검증하고 시작 전 `UPCOMING`, 접수 중 8일 이상 `OPEN`, 7~0일 `CLOSING_SOON`, 종료 다음날부터 `CLOSED`로 계산한다. 코드가 없거나 미확인 코드여도 유효한 단일 날짜가 있으면 날짜 기반으로 판단한다. 누락·날짜 역전·형식 오류는 `UNKNOWN`이다.
- 복수 기간·형식 오류를 수집 단계에서 양쪽 날짜 NULL로 남기는 기존 변환과 연결해 검증했다. 원문에서 일부 날짜를 다시 추출하지 않는다. 달력 일수는 UTC 날짜 좌표로 비교해 서버 시간대·일광 절약 시간의 영향을 피하며 1~99년의 자바스크립트 연도 보정도 피했다. 잘못 전달된 오늘 날짜·기준 시각은 `RangeError`로 드러낸다.
- API 응답 계약·DB·Migration·패키지·모듈 경계·SPEC 변경은 없다. PLAN과 SUMMARY만 갱신했다. 검색 API의 기본 마감 제외·`includeClosed` 필터 연결은 후속 Step 범위로 남겼고 이번에는 T-13의 전제인 `CLOSED` 계산을 검증했다. SPEC_SUMMARY 파일은 없다.

### 실행 방법과 실제 검증

```bash
npm run test --workspace apps/api -- --runTestsByPath test/application-status.spec.ts
TZ=America/Los_Angeles npm run test --workspace apps/api -- --runTestsByPath test/application-status.spec.ts test/youth-center-eligibility-transform.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
git diff --check
```

- 신규 상태 계산 테스트 **59개 통과**. 시작 전·시작일·종료 8/7/0일 전·종료 다음날, 하루 접수, 상시·명시적 마감·미확인 코드, 누락·역전·복수 기간·형식 오류, 윤년·월말·연말·작은 연도, 한국 자정 직전/직후와 입력 불변성을 확인했다.
- 미국 서부 시간대로 실행한 신규 테스트와 기존 자격·기간 변환 테스트 **2개 모음·133개 통과**. 한국과 다른 서버 시간대에서도 상태가 한국 자정에 바뀐다. 공용·API·웹 **타입 검사 통과**, API **빌드 통과**, `git diff --check` **통과**.
- Docker Compose 상태 조회는 Docker 소켓 권한 부족(`permission denied`)으로 실패했다. 전체 DB·HTTP 회귀 테스트는 미실행이며, 이번 검증은 DB에 접근하지 않는 관련 단위 테스트로 수행했다. DB·운영 로그·컨테이너·볼륨은 변경하지 않았다. 운영 이미지 빌드·재배포도 수행하지 않았다.

핵심 코드 읽는 순서: `policies/application-status.ts` → `application-status.spec.ts` → 기존 `youth-center-policy.transform.ts`의 `readApplicationDates`.

## 38. Step 33 구현·검증 결과

사용자 요청으로 Step 32의 코드·테스트·문서 4개 파일을 `bdfdd2f` (`feat: 날짜 기준 신청 상태 계산 구현`)로 먼저 커밋했다. 사용자 변경 주석도 그대로 포함했다. 작업 규칙·PLAN Step 33·SPEC 7.1~7.2와 T-02~T-05·선행 완료 상태·실제 코드 및 ARCHITECTURE의 매칭 책임을 대조했고 설계 충돌이나 선행 누락은 없었다. Step 33만 진행했으며 이번 변경은 커밋하지 않았다.

### 구현과 실제 결정사항

- 설계에 예정된 `matching` 폴더에 `age-match.ts`를 추가했다. `checkAge(policy, age)`는 최소·최대 나이만 받아 `MATCHED`(부합), `EXCLUDED`(나이 항목 불일치), `UNKNOWN`(확인 필요), `NOT_PROVIDED`(사용자 미입력)를 반환하는 순수 함수다. 이 결과는 서버 내부 타입이며 API 계약에는 추가하지 않았다. DB·외부 호출·현재 시각 조회·입력 수정은 하지 않는다.
- 정책 구간은 SPEC 그대로 정수 `1 <= ageMin <= ageMax <= 120`만 유효하다. 양 끝 나이를 포함하며, 같은 나이만 허용하는 구간도 판정한다. `0~0`, 한쪽 또는 양쪽 NULL, 음수·0, 역전, 121·999 등의 비정상 상한, 소수·비유한 수는 `UNKNOWN`이다. 수집에서 빈 문자열·공백이 NULL로 변환되는 기존 동작도 연결해 검증했다.
- 사용자 나이가 `undefined`면 정책 구간과 무관하게 `NOT_PROVIDED`로 먼저 반환한다. 미입력을 확인 필요나 불일치로 섞지 않아 후속 종합 판정에서 점수·태그·제외를 건너뛸 수 있다. 사용자 나이는 기존 요청 스키마가 먼저 검증하지만 내부에서 1~120 정수 이외의 값으로 호출해도 `RangeError`로 드러낸다.
- `EXCLUDED`는 나이 항목의 불일치 결과이며 최종 목록 제외를 직접 수행하지 않는다. 추가 자격·참여 제한 설명이 있을 때 제외를 보류하는 T-04와 최종 점수·태그 처리는 계획된 Step 37의 책임으로 남겼다. NestJS 모듈 등록·서비스·새 패키지를 미리 추가하지 않았다.
- API·DB·Migration·공용 타입·SPEC 변경 없이 PLAN 완료 표시와 SUMMARY를 갱신했다. SPEC_SUMMARY 파일은 없다.

### 실행 방법과 실제 검증

```bash
npm run test --workspace apps/api -- --runTestsByPath test/age-match.spec.ts test/youth-center-eligibility-transform.spec.ts test/policy-search-validation.spec.ts test/application-status.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
git diff --check
```

- 신규 나이 판정 테스트 **55개**, 기존 수집 자격·기간 변환·검색 입력 검증·신청 상태 계산을 포함해 **4개 모음·248개 모두 통과**. T-02·T-03의 나이 항목 결과, T-05, 경계 나이·단일 나이 구간·사용자 미입력·오류 입력·수집 변환 연계·추가 설명과 항목 판정의 분리·입력 불변성을 확인했다.
- 공용·API·웹 **타입 검사 통과**, API **빌드 통과**, `git diff --check` **통과**. DB·HTTP 변경이 없는 순수 함수 작업이므로 전체 DB·HTTP 통합 테스트와 운영 Docker 이미지 빌드·재배포는 수행하지 않았다. DB·운영 로그·컨테이너·볼륨을 변경하지 않았다.

핵심 코드 읽는 순서: `matching/age-match.ts` → `age-match.spec.ts` → 기존 `youth-center-policy.transform.ts`의 `readAge`.

## 39. Step 34 구현·검증 결과

사용자 요청으로 Step 33의 코드·테스트·문서 4개 파일을 `e7e2322` (`feat: 정책 나이 조건 판단 구현`)로 먼저 커밋했다. 사용자가 다듬은 나이 판정 주석은 그대로 포함했다. 작업 규칙·PLAN Step 34·SPEC 7.1~7.2와 T-07·T-08·선행 완료 상태·기존 나이 함수 및 공식 취업 코드표를 대조했고 충돌이나 선행 누락은 없었다. Step 34만 진행했으며 이번 변경은 커밋하지 않았다.

### 구현과 실제 결정사항

- `matching/job-match.ts`에 `checkJob(policy, jobCode)` 순수 함수를 추가했다. 정책의 정규화된 취업 코드 목록과 사용자 선택 코드만 받아 `MATCHED`·`EXCLUDED`·`UNKNOWN`·`NOT_PROVIDED`·`UNRESTRICTED`를 반환한다. 결과는 서버 내부 타입이며 DB·외부 API·시각에 접근하거나 입력 배열을 수정하지 않는다.
- 기존 `JOB_OPTIONS`와 `JOB_UNRESTRICTED_CODE`를 재사용했다. 앞자리 0을 유지한 문자열로 정확히 비교하고, `기타`도 공식 유효 코드로 처리한다. 사용자 코드가 없으면 정책과 무관하게 `NOT_PROVIDED`, 공식 코드표 밖의 사용자 값은 기존 요청 검증과 별도로 내부에서도 `RangeError`로 드러낸다.
- 정책 목록이 NULL·빈 배열이면 `UNKNOWN`이다. 목록에 `0013010` 제한 없음이 있으면 다른 코드·미확인 값과 섞여 있어도 OR 규칙에 따라 `UNRESTRICTED`로 구분한다. 이 결과는 부합 가점 대상인 `MATCHED`와 달라 후속 종합 판정에서 점수·일치 태그를 만들지 않을 수 있다.
- 제한 없음이 없을 때 확인된 사용자 코드가 하나라도 존재하면 미확인·빈 토큰이 함께 있어도 `MATCHED`다(T-07). 일치 코드가 없으면 모든 정책 코드가 공식 코드표에 있는 경우에만 `EXCLUDED`, 하나라도 미확인·빈 토큰·다른 분류 코드가 있으면 `UNKNOWN`이다(T-08). 정규화는 기존 수집 단계의 책임으로 유지했다.
- `EXCLUDED`는 취업 항목의 불일치 결과다. 추가 자격·참여 제한 설명에 따른 최종 제외 보류와 점수·태그는 예정된 Step 37에 남겼다. 학력 판정(Step 35)은 진행하지 않았다. API·DB·Migration·패키지·공용 타입·SPEC 변경 없이 PLAN과 SUMMARY를 갱신했다. SPEC_SUMMARY 파일은 없다.

### 실행 방법과 실제 검증

```bash
npm run test --workspace apps/api -- --runTestsByPath test/job-match.spec.ts test/age-match.spec.ts test/eligibility-codes.spec.ts test/youth-center-eligibility-transform.spec.ts test/policy-search-validation.spec.ts test/application-status.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
git diff --check
```

- 신규 취업 판정 테스트 **64개**, 관련 회귀를 포함해 **6개 모음·343개 모두 통과**. 단일·복수·중복 코드, 일치 코드의 순서, 미확인·빈 토큰 혼합, 제한 없음 우선, 사용자 미입력, 잘못된 사용자 값, 공식 원본 기대값의 전체 취업 코드, 실제 수집 변환과의 연결, 입력 불변성을 확인했다.
- 공용·API·웹 **타입 검사 통과**, API **빌드 통과**, `git diff --check` **통과**. DB·HTTP 변경이 없는 순수 함수 작업이므로 전체 DB·HTTP 통합 테스트와 운영 Docker 이미지 빌드·재배포는 수행하지 않았다. DB·운영 로그·컨테이너·볼륨은 변경하지 않았다.

핵심 코드 읽는 순서: `matching/job-match.ts` → `job-match.spec.ts` → 기존 `meta/eligibility-codes.ts`의 취업 코드표.

## 40. Step 35 구현·검증 결과

작업 규칙·PLAN Step 35·SPEC 7.1~7.2와 T-06·선행 완료 상태·실제 취업 판정과 학력 코드표를 대조했다. Step 34는 이전 사용자 요청에 따라 `8507803` (`feat: 취업 상태 조건 판단 구현`)으로 커밋되어 있었고 착수 시 변경사항은 없었다. 충돌이나 선행 누락 없이 Step 35만 진행했으며 이번 변경은 커밋하지 않았다.

### 구현과 실제 결정사항

- `matching/school-match.ts`에 `checkSchool(policy, schoolCode)` 순수 함수를 추가했다. 기존 취업 함수와 같은 방식으로 `MATCHED`·`EXCLUDED`·`UNKNOWN`·`NOT_PROVIDED`·`UNRESTRICTED`를 반환한다. 정책의 정규화된 학력 코드 목록과 사용자 선택 코드만 사용하며 DB·외부 API·시각에 접근하거나 입력 배열을 변경하지 않는다.
- 기존 `SCHOOL_OPTIONS`·`SCHOOL_UNRESTRICTED_CODE`를 사용한다. 앞자리 0과 공식 `기타` 코드를 유지하고 정확한 코드 일치만 판정한다. 학력의 서열을 추정해 대졸자를 고졸 코드에 자동 부합시키거나 재학·졸업을 같은 조건으로 보지 않는다.
- 사용자 미입력은 정책과 무관하게 `NOT_PROVIDED`, 정책 NULL·빈 목록은 `UNKNOWN`이다. 공식 학력 코드표 밖의 사용자 값은 요청 검증과 별도로 내부에서도 `RangeError`로 드러낸다. 학력 목록에 취업 코드·빈 토큰·미확인 코드가 섞였더라도 유효한 사용자 코드가 하나라도 일치하면 `MATCHED`, 전부 불일치할 때는 전체 코드가 유효한 경우에만 `EXCLUDED`다.
- 목록에 제한 없음 `0049010`이 있으면 다른 코드·미확인 값이 섞여 있어도 OR 규칙으로 `UNRESTRICTED`다. T-06의 제한 없음을 부합 가점 대상인 `MATCHED`와 구분했다. 실제 점수 0·일치 태그 미생성과 추가 설명에 따른 최종 제외 보류는 예정된 Step 37에서 조합한다.
- 기존 취업·나이 함수는 수정하지 않았다. API·DB·Migration·패키지·공용 타입·SPEC 변경 없이 PLAN 완료 표시와 SUMMARY를 갱신했다. SPEC_SUMMARY 파일은 없다.

### 실행 방법과 실제 검증

```bash
npm run test --workspace apps/api -- --runTestsByPath test/school-match.spec.ts test/job-match.spec.ts test/age-match.spec.ts test/eligibility-codes.spec.ts test/youth-center-eligibility-transform.spec.ts test/policy-search-validation.spec.ts test/application-status.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
git diff --check
```

- 신규 학력 판정 테스트 **67개**, 관련 회귀를 포함해 **7개 모음·410개 모두 통과**. 제한 없음, 단일·복수·중복·순서가 다른 코드, 미확인·빈 토큰·취업 코드 혼합, 공식 원본 기대값의 전체 학력 코드, 사용자 미입력·잘못된 값, 학력 서열 미추정, 실제 수집 변환과의 연결, 추가 설명과 항목 판정의 분리, 입력 불변성을 확인했다.
- 공용·API·웹 **타입 검사 통과**, API **빌드 통과**, `git diff --check` **통과**. DB·HTTP 변경이 없는 순수 함수 작업이므로 전체 DB·HTTP 통합 테스트와 운영 Docker 이미지 빌드·재배포는 수행하지 않았다. DB·운영 로그·컨테이너·볼륨은 변경하지 않았다.

핵심 코드 읽는 순서: `matching/school-match.ts` → `school-match.spec.ts` → 기존 `meta/eligibility-codes.ts`의 학력 코드표.

## 41. Step 36 구현·검증 결과

사용자 요청으로 당시 전체 변경 5개 파일을 `f363be0` (`feat: 학력 조건 판단 구현`)으로 먼저 커밋했다. 학력 주석을 취업 함수와 맞춘 수정과 사용자의 나이 주석 띄어쓰기 수정도 포함했다. 작업 규칙·PLAN Step 36·SPEC 2.2·7.1~7.2와 T-09~T-11·선행 완료 상태·실제 지역 엔티티와 조회·공식 시드 자료를 대조했고 충돌이나 선행 누락은 없었다. Step 36만 진행했으며 이번 변경은 커밋하지 않았다.

### 구현과 실제 결정사항

- `matching/region-match.ts`에 `checkRegion(policy, regionCode, activeRegions)` 순수 함수를 추가했다. 정책 지역 코드·선택 지역·공식 현행 코드의 부모 조회표만 받고 `{ score: 0 | 0.5, tags }`를 반환한다. 지역 결과에는 제외 필드 자체를 두지 않았다. DB·외부 API·시각에 접근하거나 입력 자료를 변경하지 않는다.
- 호출자는 기존 `RegionRepository.findActive`의 현행 목록으로 `Map<code, { parentCode }>`를 한 번 준비해 여러 정책에 재사용할 수 있다. 함수에서 정책마다 DB를 조회하거나 제품 실행 시 시드 JSON을 직접 읽지 않는다. 실제 검색 처리 연결은 후속 Step 범위다.
- 사용자 지역 또는 공식 `parentCode` 사슬로 확인된 상위 지역이 정책 목록에 있으면 `score=0.5`, `REGION_RELATED`를 반환한다(T-10). 구→시→시도처럼 저장된 관계만 따라가고 코드 앞자리·지역 이름·형제 지역·사용자 지역의 하위 지역으로 관련성을 추정하지 않는다. 여러 코드가 일치하거나 중복되어도 0.5점 한 번만 준다.
- 사용자 미입력은 점수 0·빈 태그다. 현행 코드끼리 다른 지역이면 점수 0·빈 태그로 유지한다(T-09). 정책 NULL·빈 목록·폐지·미확인·빈 토큰은 `REGION_REVIEW`와 점수 0으로 보류한다(T-11). 미확인 값이 섞여 있어도 확인된 관련 코드가 있으면 관련 가점을 우선한다. 사용자가 현행 5자리 코드가 아닌 값을 내부에서 넘기면 `RangeError`로 드러낸다.
- 조회표의 부모 누락·순환 참조는 무한 반복이나 관계 추측 대신 확인 필요로 반환하되, 이미 확인된 코드와의 일치는 유지한다. 총점·다른 항목과의 태그 조합은 예정된 Step 37에서 처리한다. 기존 나이·취업·학력·메타 조회 코드는 변경하지 않았다.
- API·DB·Migration·패키지·공용 타입·SPEC 변경 없이 PLAN 완료 표시와 SUMMARY를 갱신했다. SPEC_SUMMARY 파일은 없다.

### 실행 방법과 실제 검증

```bash
npm run test --workspace apps/api -- --runTestsByPath test/region-match.spec.ts test/region-seed.spec.ts test/school-match.spec.ts test/job-match.spec.ts test/age-match.spec.ts test/eligibility-codes.spec.ts test/youth-center-eligibility-transform.spec.ts test/policy-search-validation.spec.ts test/application-status.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
git diff --check
```

- 신규 지역 판정 테스트 **48개**, 관련 회귀를 포함해 **9개 모음·475개 모두 통과**. 실제 공식 현행·폐지 코드 스냅샷으로 동일 지역·상위 시·시도·불일치·형제·하위 지역·같은 이름의 폐지 코드·미확인 혼합·중복 가점 방지·미입력을 검증했다. 인위적인 부모 관계로 접두사 추정 금지와 부모 누락·순환 방어를 확인하고 실제 수집 변환 연결·입력 불변성도 검증했다. T-09~T-11의 함수 결과는 확인했으며 실제 검색 목록 유지 연결은 후속 Step에서 검증한다.
- 공용·API·웹 **타입 검사 통과**, API **빌드 통과**, `git diff --check` **통과**. DB·HTTP 변경이 없는 순수 함수 작업이므로 전체 DB·HTTP 통합 테스트와 운영 Docker 이미지 빌드·재배포는 수행하지 않았다. DB·운영 로그·컨테이너·볼륨은 변경하지 않았다.

핵심 코드 읽는 순서: `matching/region-match.ts` → `region-match.spec.ts` → 기존 `meta/repositories/region.repository.ts`의 `findActive`.

## 42. Step 37 구현·검증 결과

사용자 요청으로 Step 36의 코드·테스트·문서 4개 파일을 `94bfc17` (`feat: 정책 지역 연관성 판단 구현`)로 먼저 커밋했다. 사용자가 다듬은 지역 판정 주석도 그대로 포함했다. 작업 규칙·PLAN Step 37·SPEC 7.1~7.3과 T-02~T-11·선행 완료 상태·실제 항목별 순수 함수와 경량 정책 후보를 대조했고 충돌이나 선행 누락은 없었다. Step 37만 진행했으며 이번 변경은 커밋하지 않았다.

### 구현과 실제 결정사항

- `matching/evaluate-policy.ts`에 `evaluatePolicy(policy, conditions, activeRegions)`를 추가했다. 기존 나이·취업·학력·지역 판정 함수를 실제 호출해 `{ excluded, score, tags }`를 반환하는 순수 함수다. 입력은 경량 정책 후보와 호환되는 자격 조건·`hasExtraText`, 공용 `UserConditions`, 기존 현행 지역 조회표다. 긴 추가 설명 원문을 다시 읽거나 DB·외부 API·시각에 접근하지 않는다.
- 나이·취업·학력 중 하나라도 `EXCLUDED`이고 `hasExtraText=false`면 최종 제외한다. 추가 자격·참여 제한 설명이 있다는 기존 Repository의 `hasExtraText=true`면 제외를 보류하고 `EXTRA_REVIEW`와 불일치 항목의 `AGE_REVIEW`·`JOB_REVIEW`·`SCHOOL_REVIEW`를 반환한다. 해당 설명은 존재 여부만 사용하며 내용을 임의 해석하지 않는다.
- 명확한 `MATCHED`만 나이·취업·학력 각 1점을 주고 지역 함수의 0/0.5점을 합산한다. 점수 범위는 0~3.5점이다. 미입력·제한 없음·확인 필요에는 가점이나 감점이 없고, 추가 설명이나 다른 항목의 확인 필요가 있어도 이미 확인된 부합 점수는 유지한다. 제한 없음은 부합 태그도 만들지 않는다.
- 태그는 나이·취업·학력 부합 → 추가 조건 → 나이·취업·학력 확인 → 지역 순서로 일정하게 조합한다. 사용자 조건이 없거나 모든 필드가 `undefined`면 정책의 추가 설명·불명확한 조건과 무관하게 `excluded=false`, `score=0`, `tags=[]`다. 지역만 입력한 경우 다른 항목을 점수·확인 태그에 포함하지 않는다.
- 기존 항목별 검증 오류는 숨기지 않고 그대로 전달한다. 함수는 정책·사용자 조건·지역 조회표를 수정하지 않으며 호출마다 새로운 결과와 태그 배열을 만든다. API·DB·Migration·패키지·공용 타입·SPEC 변경 없이 PLAN과 SUMMARY를 갱신했다. SPEC_SUMMARY 파일은 없다.

### 실행 방법과 실제 검증

```bash
npm run test --workspace apps/api -- --runTestsByPath test/evaluate-policy.spec.ts test/region-match.spec.ts test/region-seed.spec.ts test/school-match.spec.ts test/job-match.spec.ts test/age-match.spec.ts test/eligibility-codes.spec.ts test/youth-center-eligibility-transform.spec.ts test/policy-search-validation.spec.ts test/application-status.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
git diff --check
```

- 신규 종합 판정 테스트 **33개**, 관련 회귀를 포함해 **10개 모음·508개 모두 통과**. T-02~T-11의 종합 결과, 최대 3.5점, 항목 간 AND 제외, 추가 설명에 따른 여러 불일치의 확인 전환, 확인된 가점 유지, 제한 없음·누락·미입력, 조건별 점수·태그, 검증 오류 전달, 입력 불변성과 결과 배열의 독립성을 확인했다. 실제 검색 목록의 제외 반영은 후속 Step에서 연결한다.
- 공용·API·웹 **타입 검사 통과**, API **빌드 통과**, `git diff --check` **통과**. DB·HTTP 변경이 없는 순수 함수 조합이므로 전체 DB·HTTP 통합 테스트와 운영 Docker 이미지 빌드·재배포는 수행하지 않았다. DB·운영 로그·컨테이너·볼륨은 변경하지 않았다.

핵심 코드 읽는 순서: `matching/evaluate-policy.ts` → `evaluate-policy.spec.ts` → 기존 항목별 `age-match.ts`·`job-match.ts`·`school-match.ts`·`region-match.ts`.

## 43. Step 38 구현·검증 결과

사용자 요청으로 Step 37의 코드·테스트·문서 4개 파일을 `06dc2e7` (`feat: 정책 조건 종합 판단과 일치 점수 계산`)로 먼저 커밋했다. 사용자가 다듬은 종합 판정 주석과 타입 표현도 그대로 포함했다. 작업 규칙·PLAN Step 38·SPEC 8.2와 T-16·T-17·선행 완료 상태·경량 정책 후보의 날짜·조회수 타입을 대조했고 충돌이나 선행 누락은 없었다. Step 38만 진행했으며 이번 변경은 커밋하지 않았다.

### 구현과 실제 결정사항

- `matching/sort-policies.ts`에 `sortPolicies(policies, sort)` 순수 함수를 추가했다. 경량 후보와 호환되는 정렬 필드에 검색 시점의 `applicationStatus`·`score`를 받은 뒤 새 배열로 정렬한다. 제네릭 타입으로 제목·태그 등 추가 필드도 유지하며 원본 배열·정책·Date 객체를 수정하지 않는다. DB·외부 API·현재 시각에 접근하지 않는다.
- 맞춤순은 점수 DESC → `CLOSING_SOON` 우선 → 조회수 DESC, 인기순은 조회수 DESC, 최신순은 원본 최초 등록일 DESC를 적용한다. 점수·상태·조회수가 다른 정렬의 우선순위를 침범하지 않는다. 기본 정렬 선택과 조건 없는 맞춤순의 인기순 전환은 계획된 Step 40의 책임으로 남겼다.
- 마감순은 `OPEN`·`CLOSING_SOON`을 같은 그룹으로 묶어 종료일 ASC → `UPCOMING` 시작일 ASC → `ALWAYS_OPEN` → `UNKNOWN` → `CLOSED` 순서다. 접수 중은 마감 임박 여부를 별도로 우선하지 않고, 나머지 그룹에 남아 있는 날짜로 추가 순위를 추정하지 않는다. 유효한 `YYYY-MM-DD` 문자열을 그대로 비교하며 상태는 호출자가 검색 날짜로 계산해 전달한다.
- 모든 정렬의 공통 동점 기준은 원본 최초 등록일 DESC → `externalId` ASC → `id` ASC다. 조회수·등록일이 NULL이면 해당 비교에서 뒤로 보낸다. 마감순의 비교 날짜가 NULL이어도 같은 그룹의 날짜가 있는 정책 뒤로 보내며 이후 공통 동점 기준을 유지한다. ID는 앞자리 0을 유지한 문자열 순서로 비교한다.
- API·DB·Migration·패키지·공용 타입·SPEC 변경 없이 PLAN 완료 표시와 SUMMARY를 갱신했다. 정렬 전 후보 필터 조합(Step 39), 정렬 후 페이지네이션(Step 40), 검색 API 연결은 진행하지 않았다. SPEC_SUMMARY 파일은 없다.

### 실행 방법과 실제 검증

```bash
npm run test --workspace apps/api -- --runTestsByPath test/sort-policies.spec.ts test/application-status.spec.ts test/evaluate-policy.spec.ts test/region-match.spec.ts test/school-match.spec.ts test/job-match.spec.ts test/age-match.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
git diff --check
```

- 신규 정렬 테스트 **38개**, 신청 상태·종합 판정·항목별 판정 회귀를 포함해 **7개 모음·364개 모두 통과**. 네 정렬의 우선순위, T-16·T-17, 마감순 상태 그룹·비교 날짜, NULL 조회수·등록일·날짜, 원본 등록일·외부 ID·내부 ID의 동점 해소, 입력 순서 독립성, 빈 배열·단일 정책·추가 필드 보존과 입력 불변성을 확인했다. 실제 상태 계산 함수를 날짜별로 호출해 검색 시점에 따라 맞춤순의 마감 임박 우선순위가 바뀌는 것도 검증했다.
- 공용·API·웹 **타입 검사 통과**, API **빌드 통과**, `git diff --check` **통과**. DB·HTTP 변경이 없는 순수 함수 작업이므로 전체 DB·HTTP 통합 테스트와 운영 Docker 이미지 빌드·재배포는 수행하지 않았다. DB·운영 로그·컨테이너·볼륨은 변경하지 않았다.

핵심 코드 읽는 순서: `matching/sort-policies.ts` → `sort-policies.spec.ts` → 기존 `policies/application-status.ts`와 `matching/evaluate-policy.ts`.

## 44. Step 39 구현·검증 결과

사용자 요청으로 Step 38의 코드·테스트·문서 4개 파일을 `0f0d1c6` (`feat: 정책 맞춤 인기 마감 최신 정렬 구현`)로 먼저 커밋했다. 작업 규칙·PLAN Step 39·SPEC 1장·4.1·6~8장·선행 완료 상태·경량 후보 조회와 기존 상태·종합 판정 함수를 대조했고 충돌이나 선행 누락은 없었다. Step 39만 진행했으며 이번 변경은 커밋하지 않았다.

### 구현과 실제 결정사항

- `policies/policy-search-candidates.ts`에 `buildSearchCandidates(candidates, request, today, activeRegions)`를 추가했다. 기존 Repository에서 조회한 `PolicyCandidate[]`와 검증된 검색 요청, 요청에서 한 번 정한 한국 오늘 날짜, 현행 지역 조회표를 받는 순수 조합 함수다. 기존 신청 상태·종합 판정 함수를 실제 호출하며 DB 조회를 중복하거나 사용자 조건을 저장·기록하지 않는다.
- 각 후보에 신청 상태 계산 → 분야 정확 일치 및 마감 필터 → 종합 판정 → 명확한 불일치 제외 → 상태·점수·태그를 붙인 새 후보 반환 순서로 처리한다. 분야가 생략되거나 빈 문자열이면 전체이며 다른 문자열은 공백·문장 부호까지 원래 값 그대로 비교한다. 분야·마감 필터를 통과하지 못한 정책에는 사용자 조건 판정을 실행하지 않는다.
- 기본 목록은 `CLOSED`만 제외한다. `includeClosed=true`면 마감도 자격 판정 대상으로 포함하되 다른 필터·명확한 자격 불일치는 그대로 적용한다. 예정·상시·기간 확인 필요는 기본 목록에서도 남고, 지역 불일치·폐지 지역은 기존 규칙대로 제외 없이 가점·태그만 반영한다. 추가 설명이 있는 구조화 조건 불일치도 확인 태그와 함께 유지한다.
- 반환 타입 `MatchedPolicyCandidate`는 경량 후보에 `applicationStatus`·`score`·`tags`를 붙인 서버 내부 자료다. 제외된 후보와 `excluded` 플래그는 반환하지 않는다. 입력 후보·요청·조회표는 변경하지 않고 새 객체와 독립된 태그 배열을 만든다. 상태·판정 오류는 빈 정상 결과로 숨기지 않는다.
- 정렬이나 페이지 분리는 하지 않고 통과한 전체 후보를 입력 순서대로 반환한다. DB 조회·API 호출의 실제 진입점 연결은 후속 단계에 남겼다. 기존 모듈·Repository·순수 함수, API 계약·DB·Migration·패키지·공용 타입·SPEC 변경 없이 PLAN과 SUMMARY를 갱신했다. SPEC_SUMMARY 파일은 없다.

### 실행 방법과 실제 검증

```bash
npm run test --workspace apps/api -- --runTestsByPath test/policy-search-candidates.spec.ts test/sort-policies.spec.ts test/application-status.spec.ts test/evaluate-policy.spec.ts test/region-match.spec.ts test/school-match.spec.ts test/job-match.spec.ts test/age-match.spec.ts test/policy-search-validation.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
git diff --check
```

- 신규 후보·필터 조합 테스트 **25개**, 관련 회귀를 포함해 **9개 모음·449개 모두 통과**. 기본 마감 제외·마감 포함·미래 날짜의 명시적 마감, 나머지 다섯 상태 유지, 분야 정확 일치·빈 분야·없는 분야, 상태 계산과 사전 필터 후 종합 판정 순서, 추가 설명·확인 필요·제한 없음·지역 불일치 유지, 마감 포함 시 자격 제외 유지, 한국 자정의 상태 변경을 확인했다. 55개 후보를 정렬·페이지 분리 없이 유지하고 빈 결과·입력 불변성·태그 배열 독립성·오류 전달도 검증했다.
- 공용·API·웹 **타입 검사 통과**, API **빌드 통과**, `git diff --check` **통과**. DB·HTTP 변경이 없는 순수 함수 조합이므로 전체 DB·HTTP 통합 테스트와 운영 Docker 이미지 빌드·재배포는 수행하지 않았다. DB·운영 로그·컨테이너·볼륨은 변경하지 않았다.

핵심 코드 읽는 순서: `policies/policy-search-candidates.ts` → `policy-search-candidates.spec.ts` → 기존 `policies/application-status.ts`·`matching/evaluate-policy.ts`.

## 45. Step 40 구현·검증 결과

사용자 요청으로 Step 39의 코드·테스트·문서 4개 파일을 `962ae81` (`feat: 정책 검색 필터와 매칭 처리 연결`)로 먼저 커밋했다. 작업 규칙·PLAN Step 40·SPEC 3장·4.1·8.1~8.2와 T-01·T-22·선행 완료 상태·실제 후보 필터와 정렬 함수를 대조했고 충돌이나 선행 누락은 없었다. Step 40만 진행했으며 이번 변경은 커밋하지 않았다.

### 구현과 실제 결정사항

- `policies/policy-search-response.ts`에 `buildPolicySearchResponse(candidates, request)`를 추가했다. Step 39에서 필터·판정을 통과한 전체 후보와 검증된 요청을 받아 기존 `sortPolicies`로 모두 정렬한 다음 페이지를 나누고 공용 `PolicySearchResponse`를 반환하는 순수 함수다. DB·외부 API·현재 시각에 접근하거나 입력을 수정하지 않는다.
- 사용자 나이·취업·학력·지역 중 하나라도 입력되면 기본 `recommended`, 없으면 `popular`다. 분야만 지정하거나 마감 포함만 지정한 경우·빈 조건 객체·모든 조건 필드가 `undefined`인 경우는 조건 없음이다. 조건 없는 맞춤순 요청은 `popular`로 전환하고 실제 적용값을 `appliedSort`에 반영한다. 수동 인기순·마감순·최신순은 조건 유무와 무관하게 유지한다.
- 페이지 기본값은 1, 크기는 20이며 최대 50이다. 전체 필터·정렬 후 총건수와 `Math.ceil(total / limit)`로 페이지 수를 계산한다. 결과 0건이면 `totalPages=0`, 초과 페이지는 요청 페이지·총건수를 유지한 빈 목록이다. 초과 여부를 먼저 확인해 매우 큰 유효 페이지 번호에서도 불필요한 오프셋 곱셈을 피한다. 잘못된 내부 페이지·크기는 임의 보정하지 않고 `RangeError`로 드러낸다.
- 카드 필드는 명시적으로 옮겨 내부 외부 ID·조건·추가 설명 플래그를 응답에 섞지 않는다. 신청기간 원문은 `applicationPeriodText`에 그대로, 누락된 지원 요약은 공용 문자열 타입에 맞춰 빈 문자열로 반환한다. 기간 원문 NULL은 유지한다. 태그 배열도 복사해 응답 변경이 입력 후보에 영향을 주지 않게 했다.
- API·DB·Migration·패키지·공용 타입·SPEC 변경 없이 PLAN 완료 표시와 SUMMARY를 갱신했다. 실제 요청 검증·DB 후보 조회·검색 HTTP 진입점 연결은 예정된 Step 41에 남겼다. SPEC_SUMMARY 파일은 없다.

### 실행 방법과 실제 검증

```bash
npm run test --workspace apps/api -- --runTestsByPath test/policy-search-response.spec.ts test/policy-search-candidates.spec.ts test/sort-policies.spec.ts test/application-status.spec.ts test/evaluate-policy.spec.ts test/region-match.spec.ts test/school-match.spec.ts test/job-match.spec.ts test/age-match.spec.ts test/policy-search-validation.spec.ts
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
git diff --check
```

- 신규 응답 조립 테스트 **38개**, 관련 회귀를 포함해 **10개 모음·487개 모두 통과**. T-01의 조건별 기본 정렬과 인기순 전환, 수동 정렬 유지, 기본 20건·크기 1/50 경계·마지막 페이지·배수 건수·0건·큰 초과 페이지를 확인했다. T-22는 실제 후보 필터·점수·정렬을 연결해 분야·마감·나이로 제외한 뒤 전역 정렬의 21~40번째를 반환하는지 검증했다. 카드 필드·NULL·태그 보존, 잘못된 페이지 검증, 입력 불변성과 태그 배열 독립성도 확인했다.
- 공용·API·웹 **타입 검사 통과**, API **빌드 통과**, `git diff --check` **통과**. DB·HTTP 변경이 없는 순수 함수 조합이므로 전체 DB·HTTP 통합 테스트와 운영 Docker 이미지 빌드·재배포는 수행하지 않았다. DB·운영 로그·컨테이너·볼륨은 변경하지 않았다.

핵심 코드 읽는 순서: `policies/policy-search-response.ts` → `policy-search-response.spec.ts` → 기존 `policies/policy-search-candidates.ts`·`matching/sort-policies.ts`.

## 46. Step 41 구현·검증 결과

사용자 요청으로 Step 40의 코드·테스트·문서 4개 파일을 `b2a3fc0` (`feat: 정렬 후 정책 페이지네이션 결과 구성`)로 먼저 커밋했다. 작업 규칙·PLAN Step 41·SPEC 3~4장·기존 검증기·모듈 의존 관계·지역 및 정책 Repository를 확인했고 선행 누락이나 명세 충돌은 없었다. Step 41만 진행했으며 이번 변경은 커밋하지 않았다. 작업 중 사용자가 수정한 후보 조합·응답 조립 파일의 주석은 그대로 보존했다.

### 구현과 실제 결정사항

- `policies/controllers/policies.controller.ts`와 `policies/services/policies-search.service.ts`를 추가했다. `POST /api/v1/policies/search`는 생성 작업의 기본 201 대신 명시적 200으로 공용 `PolicySearchResponse`를 반환한다. 기존 상태·필터·종합 판정·정렬·페이지 조립 함수를 연결했으며 이 규칙들을 중복 구현하지 않았다.
- 요청 시작 시 한국 오늘 날짜를 한 번 정하고 `RegionRepository.findActive`로 현행 지역·부모 관계를 한 번 읽는다. 같은 조회 결과로 공용 `createPolicySearchSchema`의 지역 허용 목록과 매칭용 조회표를 준비한다. 취업·학력은 기존 공식 코드표를 사용한다. 공통 `ZodValidationPipe`를 재사용해 자료형·범위·폐지 지역·미확인 코드 검증 실패를 고정된 400으로 반환하며 이때 정책 후보는 조회하지 않는다. 지역 허용 목록이 필요하므로 입력 검증 전 지역 SELECT는 수행한다.
- 검증 성공 시 `PolicyRepository.findCandidates`로 경량 후보를 한 번 읽고 순수 함수 흐름을 실행한다. 정상 검색의 SQL은 후보 수와 무관하게 지역 SELECT 1회·정책 SELECT 1회이며 조건 원문을 DB나 로그에 저장하지 않는다. 서비스가 요청·메타 자료를 인스턴스 필드에 보관하거나 캐시하지 않는다. DB 연결 오류·내부 오류는 기존 공통 필터의 503·500으로 전달한다.
- `PoliciesModule`이 기존 `MetaModule`에서 내보낸 지역 저장소를 사용하도록 연결했다. 메타 분야 조회의 기존 역방향 참조는 양쪽 `forwardRef`로 지연 등록하고 Repository는 원래 소유 모듈에 한 번씩 등록한다. 모듈 경계·새 패키지·DB·Migration·공용 응답 계약 변경은 없다. ARCHITECTURE의 메타 분야 조회 설명을 실제 Repository 사용과 맞추고 검색의 지역 조회·모듈 연결을 기록했다. SPEC과 SPEC_SUMMARY는 변경하지 않았다(SPEC_SUMMARY 파일 없음).

### 실행 환경과 실제 검증

처음에는 Docker Desktop이 꺼져 Docker 명령을 사용할 수 없었다. 로컬 PostgreSQL 18 임시 기동도 실행 환경의 소켓 제한으로 실패했고 제품 DB로 사용하지 않았다. 사용자가 Docker Desktop을 켠 후 기존 `youth-kkultong-db-1` PostgreSQL 17 컨테이너만 `docker start`로 시작했다. DB 설정·볼륨·DBeaver 포트는 바꾸지 않았다. 기존 테스트 이미지와 소스 읽기 전용 마운트를 사용하며 테스트 로그는 별도 `/tmp/youth-kkultong-step41-test-logs`에 격리했다.

새 통합 테스트는 실제 `AppModule`을 사용하고 DB 연결만 `step41_test_<임의값>` 스키마로 교체한다. 테스트 스키마에만 Migration·공식 지역 시드·정책을 저장하며 종료 시 앱·연결·스키마를 정리한다.

```bash
docker compose -f compose.yaml -f compose.local.yaml -f /tmp/youth-kkultong-step41-test.compose.yaml run --rm --no-deps --pull never --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" --volume "$PWD/packages/shared/src:/app/packages/shared/src:ro" api npm test
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
git diff --check
```

- 신규 DB·HTTP 통합 테스트 **32개**, 전체 회귀 **46개 모음·1,261개 모두 통과**. 정상 200·3.5점과 공용 카드, 분야·마감·자격 필터, 추가 자격·참여 제한 설명의 제외 보류와 공백 처리, 지역 불일치 유지, DB 지역 폐지의 다음 요청 반영, 전체 정렬 후 페이지 분리, 조건 없는 맞춤순 전환을 확인했다. 잘못된 자료형·범위·코드·JSON은 공통 400이고 정책 조회가 없으며 잘못된 접두사·방식은 404다. 실제 연결 종료 503과 내부 오류 500도 검증했다.
- 사용자 조건 미저장은 검색 중 실제 SQL이 SELECT뿐인 것, SQL·매개변수에 입력 표식이 없는 것, 정책 전체 행 지문 불변, 수집 파일 로그 호출 없음·파일 내용 불변, 기본 Logger 호출 없음으로 확인했다. 초기 개인정보 검사 테스트의 ORM 순환 참조 직렬화 오류는 검사 대상을 SQL·매개변수로 한정해 수정한 뒤 전체 회귀에서 통과했다.
- 공용·API·웹 **타입 검사 통과**, API **빌드 통과**, `git diff --check` **통과**. 운영 Docker 이미지 재빌드·API 및 웹 재배포는 하지 않았다. 기존 VM Modules·고아 컨테이너 안내는 변경하지 않았다.
- 테스트 전후 `public.policies` **3,390건**·전체 행 JSON MD5 **`02575d9d37be7670ec17d32181b1f902`**, `public.regions` **537건**·전체 행 JSON MD5 **`9321528ac6944aff3cfb0c706feebd70`**로 모두 동일했다. `step41_test_%` 임시 스키마 **0개**를 별도 SQL로 확인했다. 운영 로그·볼륨은 변경하지 않았고 기존 DB 컨테이너는 실행 상태로 유지했다.

핵심 코드 읽는 순서: `policies/controllers/policies.controller.ts` → `policies/services/policies-search.service.ts` → `policy-search.integration.spec.ts` → `policies.module.ts`·`meta.module.ts`.

## 47. Step 42 구현·검증 결과

사용자 요청으로 Step 41의 코드·사용자 주석 수정·통합 테스트·문서 10개 파일을 `5ec8ac1` (`feat: 정책 검색 API 제공`)로 먼저 커밋했다. 작업 규칙·PLAN Step 42·SPEC 3장·4.2·7.2와 T-23·선행 완료 상태·기존 상세 Repository 및 공용 타입을 대조했고 충돌이나 선행 누락은 없었다. Step 42만 진행했으며 이번 변경은 커밋하지 않았다.

### 구현과 실제 결정사항

- 기존 `PoliciesController`에 `GET /api/v1/policies/:id`를 추가하고 `PoliciesDetailService`를 등록했다. 공통 Zod 검증기로 UUID를 검사해 DB 접근 전에 400, 기존 `PolicyRepository.findById`가 정책을 찾지 못하면 404를 반환한다. 정상 결과는 공용 `PolicyDetail`이며 원본 JSON·해시·내부 저장 시각은 응답에 섞지 않는다.
- 요청 시점의 한국 날짜로 신청 상태를 계산한다. 상세 GET은 사용자 조건을 받지 않으므로 점수 0·빈 태그를 반환하고, 마감이나 검색 조건 불일치로 상세 접근을 막지 않는다. 긴 설명·지원 본문·신청기간 원문·추가 자격·참여 제한의 줄바꿈과 공백을 보존한다.
- 나이는 저장된 최소·최대 수치로 표시하고 양쪽 NULL이면 NULL, 한쪽 누락은 빈 쪽을 유지한다. `0~0`·역전 등을 제한 없음으로 바꾸지 않는다. 취업·학력은 공식 코드표의 명칭, 지역은 DB의 공식 명칭으로 표시하며 미확인 코드는 그대로 둔다. `RegionRepository.findByCodes`를 추가해 필요한 지역을 한 번에 조회하며 과거 정책의 폐지 코드 명칭도 보존한다. 지역 정보가 없으면 해당 조회는 생략한다.
- 신청·참고 1·참고 2의 원래 순서로 HTTP(S) 절대 URL만 반환한다. 앞뒤 공백은 제거하고 비 HTTP(S)·빈 값·형식 오류·내부 공백/제어문자는 제외한다. 링크를 실제 호출하지 않으며 모두 빠지면 `links=[]`다(T-23).
- 목록과 상세에서 실제로 공유하는 카드 변환을 `policies/policy-card.ts`의 `toPolicyCard`로 분리하고 기존 검색 응답도 같은 변환을 사용하도록 연결했다. 상세 지원 요약은 PostgreSQL `LEFT(..., 200)`과 동일한 유니코드 문자 단위로 잘라 이모지에서도 목록·상세가 일치한다. 누락된 요약은 빈 문자열이다.
- 새 상세 경로로 `GET /policies/search`도 `:id` 검증에 들어가므로 UUID 오류 400으로 검증한다. 기존 검색 통합 테스트의 해당 기대값을 이 경로 동작과 SPEC의 UUID 규칙에 맞춰 수정했다. 검색 POST 계약과 동작은 유지했다.
- DB·Migration·패키지·공용 응답 타입·모듈 경계 변경은 없다. SPEC 4.2에 기존 상세 필드의 표시 방식·사용자 조건 미입력·요약 문자 기준을 구체화하고 PLAN·SUMMARY를 갱신했다. SPEC_SUMMARY 파일은 없다.

### 실행 환경과 실제 검증

기존 PostgreSQL 17 컨테이너와 Step 41의 테스트 이미지·로그 격리를 재사용했다. 신규 통합 테스트는 실제 앱을 실행하고 DB만 `step42_test_<임의값>` 스키마로 교체한다. 해당 스키마에만 Migration·지역 시드·검증 정책을 저장하고 종료 시 앱·연결·스키마를 정리한다.

```bash
docker compose -f compose.yaml -f compose.local.yaml -f /tmp/youth-kkultong-step41-test.compose.yaml run --rm --no-deps --pull never --volume "$PWD/apps/api/src:/app/apps/api/src:ro" --volume "$PWD/apps/api/test:/app/apps/api/test:ro" --volume "$PWD/packages/shared/src:/app/packages/shared/src:ro" api npm test
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
git diff --check
```

- 신규 상세 DB·HTTP 통합 테스트 **30개**, 전체 회귀 **47개 모음·1,291개 모두 통과**. 정상 상세 계약·원문 보존, UUID 400과 DB 미접근, 없는 정책 404, 마감·나이 불일치 정책 직접 조회, 모호한 기간, 공식·미확인·폐지 코드 표시, 누락 정보와 링크 없음, 14가지 부적절한 링크 및 유효 링크 혼합을 검증했다. 단일·묶음 조회 횟수, SQL SELECT만 실행, Unicode 요약과 전체 본문, 요청 날짜에 따른 상태 변경, 조회수·저장 시각 불변, 내부 오류 500·실제 연결 종료 503도 확인했다.
- 공용·API·웹 **타입 검사 통과**, API **빌드 통과**, `git diff --check` **통과**. 운영 이미지 재빌드·API 및 웹 재배포는 하지 않았다.
- 테스트 전후 기존 `public.policies` **3,390건**·전체 행 JSON MD5 **`02575d9d37be7670ec17d32181b1f902`**, `public.regions` **537건**·전체 행 JSON MD5 **`9321528ac6944aff3cfb0c706feebd70`**로 모두 동일했다. `step42_test_%` 임시 스키마 **0개**를 별도 SQL로 확인했다. 기존 DB 컨테이너·설정·볼륨·운영 로그는 변경하지 않았다.

핵심 코드 읽는 순서: `policies/controllers/policies.controller.ts`의 `detail` → `policies/services/policies-detail.service.ts` → `policies/policy-card.ts` → `policy-detail.integration.spec.ts`.

## 48. Step 43 구현·검증 결과

작업 규칙·PLAN Step 43·SPEC 3~4장·8.3·T-01·T-28·Step 42 완료 기록과 실제 웹·API 코드를 확인했다. 선행 누락이나 명세 충돌은 없었으며, 깨끗한 작업 트리에서 Step 43만 진행했다. 이번 변경은 커밋하지 않았다.

### 구현과 실제 결정사항

- `/policies`를 브라우저 동작 컴포넌트로 연결해 기존 Next.js `rewrites` 경로인 `/api/v1/policies/search`로 POST 요청을 보낸다. 공용 `PolicySearchRequest`·`PolicySearchResponse` 타입을 사용한다.
- 요청은 `page=1`, `limit=20`, `includeClosed=false`이며 사용자 조건과 정렬을 보내지 않는다. API의 기존 기본값에 따라 마감 제외·인기순 첫 페이지를 받고 정책 제목·지원 요약·전체 건수·현재/전체 페이지를 표시한다. 점수·일치 태그를 강조하지 않으며 입력 조건을 저장하거나 기록하지 않는다.
- 로딩·정상 응답·오류를 별도 상태로 관리한다. 정상 0건일 때만 빈 결과를 표시하며 HTTP 오류·네트워크 실패·JSON 해석 실패·15초 응답 지연에는 오류 안내와 다시 시도 버튼을 표시한다. 오류 응답 원문을 노출하지 않는다. 페이지를 떠나거나 요청을 교체하면 타이머와 요청을 정리하고 이전 응답으로 화면을 바꾸지 않는다.
- 기존 화면 스타일을 유지하며 목록과 다시 시도 버튼에 필요한 스타일을 추가했다. 긴 제목 줄바꿈·빈 지원 요약 대체 문구·공식 신청처 확인 안내를 제공한다. 완성된 카드 컴포넌트·상태/태그·상세 이동·필터·정렬/페이지 이동 UI는 각각 후속 Step 범위다.
- API 계약·DB·Migration·공용 타입·패키지·인프라·SPEC 변경은 없다. PLAN 완료 표시와 SUMMARY를 갱신했다. SPEC_SUMMARY 파일은 없다.

### 실행 환경과 실제 검증

기존 DB 컨테이너와 Step 41 테스트 이미지에 이번 API 빌드 결과를 읽기 전용으로 연결해 검증용 API를 실행했다. 웹은 이번 프로덕션 빌드를 임시 실행했으며 기존 운영 이미지를 재빌드하거나 재배포하지 않았다. 새 브라우저 검증 파일은 Node.js 기본 테스트 실행기와 이미 설치된 Playwright를 사용한다. 프로젝트에 테스트 패키지를 추가하지 않았으며 `PLAYWRIGHT_MODULE`로 기존 설치 경로를 지정했다.

```bash
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
npm run build --workspace apps/api
NEXT_TELEMETRY_DISABLED=1 npm run build --workspace apps/web
LD_LIBRARY_PATH=/tmp/youth-step43-browser-libs/root/usr/lib/x86_64-linux-gnu PLAYWRIGHT_MODULE=/home/leenohoon/youth-kkultong-before/node_modules/.pnpm/playwright@1.64.0/node_modules/playwright/index.mjs node --test apps/web/test/policies-list.e2e.mjs
git diff --check
```

- 공용·API·웹 **타입 검사 통과**, API·웹 **빌드 통과**, Chromium 브라우저 테스트 **9개 모두 통과**. 실제 DB 검색 결과와 화면의 첫 20건·순서·전체 건수·페이지 수를 대조하고 `/` → `/policies`, 기본 요청 본문·마감 제외·점수 0을 확인했다. 로딩·정상 0건, HTTP 400/500/503·내부 메시지 비노출, 연결 실패 후 재시도, 깨진 JSON, 15초 시간 초과, 모바일 긴 제목·빈 요약·HTML 텍스트 비실행도 검증했다.
- 초기 웹 빌드는 샌드박스 내 TypeScript 하위 프로세스 출력 해석에서 실패했으며 같은 명령을 샌드박스 밖에서 실행해 통과했다. Chromium의 시스템 라이브러리 3개가 없어 Ubuntu 패키지를 `/tmp/youth-step43-browser-libs`에 다운로드·추출하고 해당 실행에만 라이브러리 경로를 지정했다. 시스템 설치나 프로젝트 의존성 변경은 없다.
- 최초 브라우저 테스트는 Next.js 자체 접근성 알림까지 오류 요소로 선택해 실패했다. 선택 범위를 `main` 내부로 한정해 실제 목록 오류만 검사하도록 수정한 뒤 전체 9개를 통과했다.
- 테스트 전후 기존 `public.policies` **3,390건**, 전체 행·시각의 MD5 지문 **`46a965ded0407e47a7af9816cd3e7b6e`**로 동일했다. 읽기 전용 검색만 호출했으며 실제 외부 수집 API·Migration·시드·DB 데이터 변경은 실행하지 않았다. 검증용 API·웹은 종료하고 기존 DB 컨테이너·포트·볼륨은 유지했다.

핵심 코드 읽는 순서: `apps/web/app/policies/page.tsx`의 조회/상태 처리 → 같은 파일의 목록 렌더링 → `apps/web/test/policies-list.e2e.mjs` → `apps/web/app/globals.css`.

## 49. Step 44 구현·검증 결과

사용자 요청으로 검증된 Step 43의 코드·테스트·문서 5개 파일을 `20e4e71` (`feat: 정책 목록 화면과 검색 API 연결`)로 먼저 커밋했다. 작업 규칙·PLAN Step 44·SPEC 3~4장·6장·7.3·8.3과 선행 완료 기록·공용 타입·목록 화면을 대조했고 명세 충돌이나 선행 누락은 없었다. Step 44만 진행했으며 이번 변경은 커밋하지 않았다.

### 구현과 실제 결정사항

- `apps/web/app/policies/policy-card.tsx`에 공용 `PolicyCard` 데이터를 받는 표시 컴포넌트를 추가하고 목록에서 사용한다. 분야·중분류·정책명·지원 요약·신청 상태·신청기간·조회수를 카드 하나에 표시한다. 신청 상태 6종과 일치/확인 태그 9종은 API 코드와 한국어 표시 문구를 분리했다.
- 지원 요약은 HTML 표시·스크립트/스타일 본문·불필요한 공백을 정리하고 유니코드 문자 기준 120자 이내(생략 기호 포함)로 표시한다. 빈 혜택·분야·기간·NULL 조회수에는 확인 문구를 보여주며 조회수 0은 `0회`로 구분한다. 카드와 원문은 React의 텍스트 출력으로 표시하며 HTML을 실행하지 않는다.
- 기간은 API 기간 원문을 우선하며 줄바꿈을 보존한다. 원문이 없으면 확인된 종료일, 상시 상태, 확인 필요 안내 순서로 표시한다. `UNKNOWN` 상태와 복수 기간 원문도 함께 보여주고 브라우저에서 날짜·자격·점수를 다시 판정하지 않는다.
- API가 반환한 일치·확인 태그를 각각 다른 표시로 보여준다. 사용자 조건 입력 UI는 후속 Step 범위이며 이번 검증에서는 검색 응답으로 받은 태그의 표시를 확인했다. 점수 강조·신청 자격 확정 문구는 추가하지 않았고 카드마다 공식 신청처 확인 안내를 한 번 표시한다.
- 카드 본문을 하나의 Next.js 링크로 구성해 제목·본문 클릭과 키보드 선택으로 `/policies/[id]`에 이동한다. 상세 화면은 예정된 Step 51 범위라 경로 연결까지만 구현·검증했으며 현재 그 경로의 본문은 404다. 미구현 상세 화면의 사전 요청은 끈다.
- 긴 제목·분야·기간과 여러 태그가 좁은 화면에서도 줄바꿈되도록 카드 스타일을 추가했다. API 계약·DB·Migration·패키지·공용 타입·모듈 경계·SPEC 변경은 없고 PLAN과 SUMMARY를 갱신했다. SPEC_SUMMARY 파일은 없다.

### 실행 환경과 실제 검증

사용자가 실행한 기존 API·웹·DB 컨테이너는 유지하고, 이번 웹 빌드만 `127.0.0.1:3001`에 임시 실행해 기존 4000 포트 API와 연결했다. Step 43의 Playwright·임시 Chromium 라이브러리를 재사용했다. 검증 브라우저의 한글 글꼴 누락은 `/tmp/youth-step44-fonts.conf`를 통해 Windows의 기존 글꼴을 해당 프로세스에서만 읽도록 해결했으며 프로젝트·시스템 글꼴 설치는 변경하지 않았다.

```bash
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
NEXT_TELEMETRY_DISABLED=1 npm run build --workspace apps/web
NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next start apps/web --hostname 127.0.0.1 --port 3001
FONTCONFIG_FILE=/tmp/youth-step44-fonts.conf WEB_TEST_URL=http://127.0.0.1:3001 LD_LIBRARY_PATH=/tmp/youth-step43-browser-libs/root/usr/lib/x86_64-linux-gnu PLAYWRIGHT_MODULE=/home/leenohoon/youth-kkultong-before/node_modules/.pnpm/playwright@1.64.0/node_modules/playwright/index.mjs node --test apps/web/test/policies-list.e2e.mjs
git diff --check
```

- 공용·API·웹 **타입 검사 통과**, 웹 프로덕션 **빌드 통과**. 기존 브라우저 검증 9개와 카드 검증 6개를 합친 **15개 모두 통과**. 실제 DB 첫 페이지·기본 요청·오류/재시도 회귀, 상태 6종·태그 9종·점수 비강조, 빈 값·조회수 0, 모호한 기간 원문, HTML·공백 정리·이모지 120자 요약, 긴 문구/태그의 모바일 너비, 키보드 상세 경로 이동을 검증했다.
- 한글 글꼴을 적용한 실제 정책 목록을 데스크톱 1280px·모바일 375px에서 캡처해 확인했다. 해당 환경에서도 15개 테스트가 모두 통과했다. 이미지와 글꼴 설정은 `/tmp`에만 두었다.
- 읽기 전용 SQL로 검증 전후 기존 `public.policies` **3,390건**, 전체 행·시각 MD5 **`46a965ded0407e47a7af9816cd3e7b6e`**가 동일함을 확인했다. 외부 수집 API·DB 쓰기·Migration·시드는 실행하지 않았다. 이번 3001 포트 검증용 웹은 종료하고 사용자 실행 컨테이너는 유지했다. 운영 이미지 재빌드·재배포는 하지 않았다.

핵심 코드 읽는 순서: `apps/web/app/policies/policy-card.tsx` → `apps/web/app/policies/page.tsx`의 카드 사용 → `apps/web/app/globals.css` → `apps/web/test/policies-list.e2e.mjs`의 카드 검증.

## 50. Step 45 구현·검증 결과

사용자 요청으로 Step 44의 코드·테스트·문서 6개 파일을 `823f3a5` (`feat: 정책 카드와 조건 확인 태그 표시`)로 먼저 커밋했다. 작업 규칙·PLAN Step 45·SPEC 3~4장·8.1과 실제 메타 API·목록 화면을 대조했고 명세 충돌이나 선행 누락은 없었다. Step 45만 진행했으며 이번 변경은 커밋하지 않았다.

### 구현과 실제 결정사항

- `/policies`에서 `GET /api/v1/meta/categories`로 실제 분야를 받아 '전체'와 함께 선택할 수 있다. `금융･복지･문화` 같은 묶음 분야명을 나누거나 바꾸지 않고 API의 문자열 그대로 표시·전송한다. 전체 선택은 요청의 `category`를 생략한다.
- 기본값이 꺼진 `마감 포함` 체크박스를 추가했다. 분야·마감 포함이 바뀌면 현재 값을 POST 본문에 넣어 `page=1`, `limit=20`으로 다시 검색한다. 사용자 조건·정렬은 보내지 않아 기존 인기순 기본값을 유지한다. 실제 페이지 이동 컨트롤은 Step 50 범위다.
- 선택지 조회 상태를 목록과 분리했다. 로딩 중 분야 선택은 비활성화하고, HTTP·네트워크·응답 형식 오류나 15초 지연에는 분야 오류와 별도 재시도를 제공한다. 이때 전체 목록과 마감 포함 필터는 계속 사용할 수 있다. 정상 빈 분야 배열이면 '전체'만 제공한다.
- 검색 실패 후 재시도에도 선택한 필터를 유지한다. 필터 변경 시 로딩으로 전환하며 기존 요청·타이머를 정리하고 늦게 끝난 이전 응답이 최신 선택을 덮어쓰지 않게 한다. API 오류 원문은 화면에 노출하지 않는다.
- 필터는 이름이 연결된 기본 select·checkbox로 구현하고 포커스 표시·좁은 화면 줄바꿈을 추가했다. API 계약·DB·Migration·공용 타입·패키지·SPEC 변경은 없다. PLAN·SUMMARY를 갱신하고, 사용자의 지속 요청인 **웹 변경 Step 완료 시 기존 웹 컨테이너를 새 빌드로 재생성해 실행 상태로 유지**하는 규칙을 `AGENT_RULES.md` 11장에 기록했다.

### 실행 환경과 실제 검증

```bash
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
docker compose -f compose.yaml -f compose.local.yaml build web
docker compose -f compose.yaml -f compose.local.yaml up -d --no-deps --force-recreate --wait --wait-timeout 60 web
FONTCONFIG_FILE=/tmp/youth-step44-fonts.conf LD_LIBRARY_PATH=/tmp/youth-step43-browser-libs/root/usr/lib/x86_64-linux-gnu PLAYWRIGHT_MODULE=/home/leenohoon/youth-kkultong-before/node_modules/.pnpm/playwright@1.64.0/node_modules/playwright/index.mjs node --test apps/web/test/policies-list.e2e.mjs
git diff --check
```

- 공용·API·웹 **타입 검사 통과**, Docker 웹 프로덕션 **빌드 통과**, 새 웹 컨테이너 **healthy**. 기존 API·DB 컨테이너는 재생성하지 않았다. `http://localhost:3000/policies`에서 바로 이번 화면을 확인할 수 있는 상태로 유지했다.
- 새 컨테이너에서 브라우저 테스트 **21개 모두 통과**. 기존 목록·카드 회귀와 실제 분야 목록·필터 결과·전체 건수/순서를 대조했다. 실제 마감 정책이 있는 분야에서 기본 제외·포함 후 마감 표시·다시 해제를 확인했다. 묶음 분야명·전체 복귀·모든 변경의 1페이지 요청·메타 실패/재시도·빈 선택지/잘못된 자료형·검색 재시도 필터 유지·늦은 이전 응답 방어도 검증했다.
- 최초 회귀의 시간 초과 테스트는 '다시 시도'가 새 '분야 다시 시도' 버튼까지 선택해 실패했다. 정확한 버튼 이름으로 선택하도록 테스트를 수정한 후 전체 21개가 통과했다. 데스크톱 1280px·모바일 375px의 실제 필터 화면도 캡처해 배치를 확인했다.
- 검증 전후 기존 `public.policies` **3,390건**, 전체 행·시각 MD5 **`46a965ded0407e47a7af9816cd3e7b6e`**로 동일했다. 외부 수집 API·DB 쓰기·Migration·시드는 실행하지 않았고 API·DB·기존 포트·볼륨을 유지했다. 기존 Compose 고아 컨테이너 안내는 이번 범위에서 변경하지 않았다.

핵심 코드 읽는 순서: `apps/web/app/policies/page.tsx`의 분야 조회 → 필터 포함 검색 요청 → 필터 컨트롤 → `apps/web/test/policies-list.e2e.mjs`의 필터 검증 → `apps/web/app/globals.css`.

## 51. Step 46 구현·검증 결과

사용자 요청으로 Step 45의 코드·테스트·작업 규칙·문서 6개 파일을 `b4a9128` (`feat: 정책 분야와 마감 포함 필터 추가`)로 먼저 커밋했다. 작업 규칙·PLAN Step 46·SPEC 3장·4.1·7장·8.1과 실제 요청 타입·기본 정렬·목록 화면을 대조했고 명세 충돌이나 선행 누락은 없었다. Step 46만 진행했으며 이번 변경은 커밋하지 않았다.

### 구현과 실제 결정사항

- `/policies`에 선택적 만 나이 입력과 '나이 지우기' 버튼을 추가했다. 잘못된 입력도 지워지지 않고 오류를 확인할 수 있도록 text 입력과 모바일 숫자 키패드를 사용한다. 빈 입력은 조건 없음, 숫자만 입력한 1~120 정수는 유효한 나이, 나머지는 입력 오류로 구분한다. 소수·지수·부호·문자를 정수로 잘라 전송하지 않는다.
- 유효한 나이만 POST 본문의 `conditions.age`에 숫자로 넣어 `page=1`로 조회한다. 입력을 지우면 `conditions`도 생략하고 기존 분야·마감 포함 필터는 유지한다. 같은 숫자인 `28` → `028` 변경은 불필요하게 다시 조회하지 않는다.
- 입력 오류에는 연결된 안내 문구와 `aria-invalid`를 표시하고 요청을 보내지 않는다. 이때 이전 결과를 숨겨 현재 입력으로 조회한 결과처럼 보이지 않게 하며, 올바르게 고치거나 지우면 다시 조회한다. 진행 중인 이전 요청·타이머는 정리하고 검색 재시도에도 나이 조건을 유지한다.
- 정렬 문구를 고정 인기순에서 API의 실제 `appliedSort` 표시로 바꿨다. 정렬을 직접 지정하지 않아 나이가 있으면 맞춤순, 지우면 인기순이라는 기존 API 동작을 그대로 따른다. 카드에는 API가 반환한 나이 태그를 표시하며 브라우저에서 판정·점수를 재계산하지 않는다.
- 나이는 컴포넌트 메모리와 요청 본문에만 사용하며 URL·브라우저 저장소에 기록하지 않는다. 세션 유지는 Step 52 범위다. API 계약·DB·Migration·공용 타입·패키지·SPEC 변경 없이 PLAN·SUMMARY를 갱신했다.

### 실행 환경과 실제 검증

착수 당시 DB·API·웹 컨테이너가 정지 상태여서 기존 이미지·볼륨으로 DB·API를 먼저 재기동했다. 웹은 이번 이미지로 재생성해 실행 상태로 두었다. 기존 `/tmp` 브라우저 라이브러리가 정리된 상태라 Step 43과 같은 방법으로 `/tmp/youth-step46-browser-libs`에 필수 라이브러리만 다운로드·추출했다. Windows 기존 한글 글꼴도 검증 프로세스에만 연결했으며 시스템 설치·프로젝트 의존성을 변경하지 않았다.

```bash
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
docker compose -f compose.yaml -f compose.local.yaml up -d --no-build --wait --wait-timeout 60 db api
docker compose -f compose.yaml -f compose.local.yaml build web
docker compose -f compose.yaml -f compose.local.yaml up -d --no-deps --force-recreate --wait --wait-timeout 60 web
FONTCONFIG_FILE=/tmp/youth-step46-fonts.conf LD_LIBRARY_PATH=/tmp/youth-step46-browser-libs/root/usr/lib/x86_64-linux-gnu PLAYWRIGHT_MODULE=/home/leenohoon/youth-kkultong-before/node_modules/.pnpm/playwright@1.64.0/node_modules/playwright/index.mjs node --test apps/web/test/policies-list.e2e.mjs
git diff --check
```

- 공용·API·웹 **타입 검사 통과**, Docker 웹 프로덕션 **빌드 통과**, 브라우저 테스트 **27개 모두 통과**. 실제 DB의 28세 맞춤 결과·태그·건수·순서와 삭제 후 인기순 복귀를 대조했다. 경계 1/120·숫자 전송·동일 나이 변경·오류 입력 10종의 미전송과 안내·올바른 값으로 복구·분야/마감 필터 유지·1페이지 요청·오류 후 재시도·지연 응답 중 나이 삭제도 검증했다. URL query와 sessionStorage/localStorage에 나이가 저장되지 않는 것도 확인했다.
- 초기 타입 검사에서 비동기 함수 내부의 나이가 nullable 타입으로 남는 문제를 확인하고 요청 구성 시 숫자 타입을 명시적으로 확인하도록 수정한 뒤 최종 타입 검사를 통과했다. 데스크톱 1280px·모바일 375px에서 실제 맞춤 목록과 입력 오류 화면을 캡처해 배치·가로 넘침 없음을 확인했다.
- 검증 전후 기존 `public.policies` **3,390건**, 전체 행·시각 MD5 **`46a965ded0407e47a7af9816cd3e7b6e`**로 동일했다. 외부 수집 API·DB 쓰기·Migration·시드는 실행하지 않았다. API·DB는 재생성 없이 기존 컨테이너를 기동했고 기존 포트·볼륨을 유지했다. 최종 웹·API·DB 모두 **healthy**, `http://localhost:3000/policies`에서 바로 확인할 수 있다.

핵심 코드 읽는 순서: `apps/web/app/policies/page.tsx`의 `parseAgeInput` → 나이를 포함한 검색 요청 → 나이 입력/오류와 적용 정렬 표시 → `apps/web/test/policies-list.e2e.mjs`의 나이 검증 → `apps/web/app/globals.css`.

## 52. Step 47 구현·검증 결과

사용자가 Step 47~51의 순차 구현·검증·단계별 커밋을 승인했다. PLAN·SPEC의 관련 계약과 선행 구현을 대조하고 Step 47 범위만 진행했다.

- 공식 `/meta/eligibility-codes`의 코드·표시명으로 취업·학력 드롭다운을 제공한다. 미선택·선택·해제에 따라 나이와 조합해 POST 본문을 구성하고 1페이지에서 재조회한다. 목록 태그·점수 계산은 기존 API가 담당한다.
- 확인된 선택지의 코드만 전달하고 코드표를 브라우저에 중복 정의하지 않는다. 로딩·오류·재시도는 분야와 독립적이며 조회 실패 중에도 다른 필터를 사용할 수 있다.
- 분야와 자격 조회에서 실제로 공유하는 검증·15초 제한·요청 정리·재시도를 `use-meta-options.ts`로 분리했다. `eligibility-filters.tsx`는 선택지 표시, `page.tsx`는 검색 조건 조합을 담당한다.
- 실제 API의 단일·복수 조건 결과와 태그, 해제 후 인기순, 실패 후 재시도·미확인 코드 방어를 검증했다. 기존 27개와 신규 2개가 모두 통과했다. 선택 조건을 URL·브라우저 저장소에 보관하지 않는다.
- 읽는 순서: `eligibility-filters.tsx` → `use-meta-options.ts` → `page.tsx`의 조건 조합 → `policy-exploration.e2e.mjs`.

검증: `NEXT_TELEMETRY_DISABLED=1 npm run typecheck` 통과. `docker compose -f compose.yaml -f compose.local.yaml build web`의 프로덕션 빌드 통과 후 `up -d --no-deps --force-recreate --wait --wait-timeout 60 web`으로 웹을 재생성했다. 기존 Playwright·임시 Chromium 라이브러리·Windows 한글 글꼴 환경으로 `node --test apps/web/test/*.e2e.mjs`를 실행해 **29개 모두 통과**했다. `git diff --check` 통과. API·DB 스키마·Migration·공용 계약·패키지 변경은 없으며 웹을 3000 포트에서 실행 상태로 유지했다.

## 53. Step 48 구현·검증 결과

사용자가 Step 47~51의 순차 구현·검증·단계별 커밋을 승인했다. PLAN·SPEC의 관련 계약과 선행 구현을 대조하고 Step 48 범위만 진행했다.

- `/meta/regions`의 현행 코드만 `parentCode` 관계로 시·도/시·군·구/하위 구 단계에 표시한다. 코드 접두사로 관계를 추정하지 않으며 상위 선택 변경은 아래 선택을 함께 정리한다. 하위 전체 선택은 선택한 상위 코드로 조회한다.
- `region-filter.tsx`는 선택 UI와 응답 검증을 맡고 페이지는 최종 코드를 다른 조건과 조합해 1페이지를 검색한다. 지역이 달라도 목록에서 제외하지 않고 서버의 지역 관련 태그와 가점만 반영한다. 로딩·실패·재시도도 제공한다.
- 실제 현행 284개 메타 자료·수원시/장안구 선택·상위 변경·선택 해제·오류 복구를 검증했다. 지역을 선택해도 전체 건수가 유지되며 관련 태그와 0.5점이 있는 실제 응답을 확인했다. 서버의 부모 지역 가점(T-10)·폐지 코드 등 지역 판정 단위 테스트도 48개 모두 통과했다 (`npm test --workspace apps/api -- --runTestsByPath test/region-match.spec.ts`).
- 읽는 순서: `region-filter.tsx` → `page.tsx` 조건 조합 → `policy-exploration.e2e.mjs` 지역 검증.

검증: `NEXT_TELEMETRY_DISABLED=1 npm run typecheck` 통과. `docker compose -f compose.yaml -f compose.local.yaml build web`의 프로덕션 빌드 통과 후 `up -d --no-deps --force-recreate --wait --wait-timeout 60 web`으로 웹을 재생성했다. 기존 Playwright·임시 Chromium 라이브러리·Windows 한글 글꼴 환경으로 `node --test apps/web/test/*.e2e.mjs`를 실행해 **31개 모두 통과**했다. `git diff --check` 통과. API·DB 스키마·Migration·공용 계약·패키지 변경은 없으며 웹을 3000 포트에서 실행 상태로 유지했다.

## 54. Step 49 구현·검증 결과

사용자가 Step 47~51의 순차 구현·검증·단계별 커밋을 승인했다. PLAN·SPEC의 관련 계약과 선행 구현을 대조하고 Step 49 범위만 진행했다.

- 맞춤순·인기순·마감순·최신순을 선택하고 실제 API `appliedSort`를 화면에 표시한다. 초기에는 조건 유무에 따른 서버 기본 정렬을 사용하며 수동 선택한 정렬만 요청에 명시한다.
- 조건 없는 맞춤순은 비활성화하고, 마지막 조건을 지우면 맞춤순을 인기순으로 바꾼다. 인기·마감·최신순 수동 선택은 조건 추가·삭제에도 유지한다. 조건 제거 시 상태 전환 때문에 같은 검색이 중복 전송되지 않게 실제 요청 정렬값을 기준으로 조회한다.
- 실제 DB의 네 정렬 결과·순서·선택값과 조건 추가·삭제 시의 자동/수동 정렬 동작을 검증했다. 읽는 순서: `page.tsx`의 정렬 상태/실제 요청값 → 정렬 컨트롤 → `policy-exploration.e2e.mjs`.

검증: `NEXT_TELEMETRY_DISABLED=1 npm run typecheck` 통과. `docker compose -f compose.yaml -f compose.local.yaml build web`의 프로덕션 빌드 통과 후 `up -d --no-deps --force-recreate --wait --wait-timeout 60 web`으로 웹을 재생성했다. 기존 Playwright·임시 Chromium 라이브러리·Windows 한글 글꼴 환경으로 `node --test apps/web/test/*.e2e.mjs`를 실행해 **32개 모두 통과**했다. `git diff --check` 통과. API·DB 스키마·Migration·공용 계약·패키지 변경은 없으며 웹을 3000 포트에서 실행 상태로 유지했다.

## 55. Step 50 구현·검증 결과

사용자가 Step 47~51의 순차 구현·검증·단계별 커밋을 승인했다. PLAN·SPEC의 관련 계약과 선행 구현을 대조하고 Step 50 범위만 진행했다.

- `pagination.tsx`로 처음·이전·주변 최대 5개 번호·다음·마지막 컨트롤을 제공한다. 현재 페이지에는 aria-current를 표시하고 처음/끝 경계를 비활성화한다. 0건에는 컨트롤을 숨긴다.
- 페이지 이동은 분야·마감 포함·나이·취업·학력·지역·수동 정렬을 유지한다. 각 필터/정렬 변경은 1페이지로 돌아가며 페이지 요청 실패 후 재시도는 요청 페이지를 유지한다.
- 실제 DB의 1/2/마지막 페이지를 비교해 순서·중복 없음·경계를 확인했다. 모든 필터별 페이지 초기화와 0/1페이지·2페이지 오류 재시도를 브라우저에서 검증했다.
- 읽는 순서: `page.tsx`의 페이지 상태/필터 초기화 → `pagination.tsx` → `policy-exploration.e2e.mjs` 페이지 검증.

검증: `NEXT_TELEMETRY_DISABLED=1 npm run typecheck` 통과. `docker compose -f compose.yaml -f compose.local.yaml build web`의 프로덕션 빌드 통과 후 `up -d --no-deps --force-recreate --wait --wait-timeout 60 web`으로 웹을 재생성했다. 기존 Playwright·임시 Chromium 라이브러리·Windows 한글 글꼴 환경으로 `node --test apps/web/test/*.e2e.mjs`를 실행해 **36개 모두 통과**했다. `git diff --check` 통과. API·DB 스키마·Migration·공용 계약·패키지 변경은 없으며 웹을 3000 포트에서 실행 상태로 유지했다.

## 56. Step 51 구현·검증 결과

사용자가 Step 47~51의 순차 구현·검증·단계별 커밋을 승인했다. PLAN·SPEC의 관련 계약과 선행 구현을 대조하고 Step 51 범위만 진행했다.

- `/policies/[id]`에서 상세 API를 조회해 정책명·분야·상태·조회수·지원 내용·설명·나이/취업/학력/지역 자격·추가 자격·참여 제한·신청기간·신청/참고 링크를 구분해 표시한다. 원문 줄바꿈과 텍스트를 보존하고 HTML로 실행하지 않는다.
- 카드와 상세의 신청 상태 문구를 `policy-labels.ts`에서 공유한다. 없는 정책/잘못된 UUID는 찾을 수 없음 안내, 통신 오류·JSON 오류·15초 지연은 오류와 재시도, 누락 자료는 확인 문구, 링크가 없으면 '링크 없음'으로 표시한다.
- HTTP(S) 절대 URL만 화면에 연결하고 `target=_blank`, `rel=noopener noreferrer`로 새 탭을 연다. 공식 신청처 확인 안내는 상세에 한 번 표시한다. 사용자 조건을 상세 GET에 전달하지 않는다.
- 실제 목록→상세→목록 흐름과 API 원문/자격을 대조하고, 모바일 긴 원문·줄바꿈·악성 링크 제외·없는 정책·오류/재시도·새 탭 opener 차단을 검증했다. 외부 링크 검증은 네트워크를 대체해 실제 신청처는 호출하지 않았다.
- 읽는 순서: `policies/[id]/page.tsx`의 조회 상태 → 상세 구획/링크 → `policy-labels.ts` → `policy-exploration.e2e.mjs`의 상세 검증. 입력의 새로고침/상세 복귀 유지 기능은 계획대로 Step 52에 남긴다.
- 최종 목록·상세를 1280px/375px에서 캡처해 배치와 가로 넘침 없음을 확인했다. 일련의 작업 전후 `public.policies`는 3,390건, 전체 행·시각 MD5 `46a965ded0407e47a7af9816cd3e7b6e`로 동일하다. 외부 수집 API·Migration·시드·DB 쓰기를 실행하지 않았고 API·DB 컨테이너와 볼륨을 유지했다. 최종 웹·API·DB가 모두 healthy다.

검증: `NEXT_TELEMETRY_DISABLED=1 npm run typecheck` 통과. `docker compose -f compose.yaml -f compose.local.yaml build web`의 프로덕션 빌드 통과 후 `up -d --no-deps --force-recreate --wait --wait-timeout 60 web`으로 웹을 재생성했다. 기존 Playwright·임시 Chromium 라이브러리·Windows 한글 글꼴 환경으로 `node --test apps/web/test/*.e2e.mjs`를 실행해 **41개 모두 통과**했다. `git diff --check` 통과. API·DB 스키마·Migration·공용 계약·패키지 변경은 없으며 웹을 3000 포트에서 실행 상태로 유지했다.

## 57. 정책 상세 화면 가독성 개선 (2026-10-22 사용자 요청)

- 사용자 검수에 따라 정책 상세 화면만 재구성했다. 제목 영역은 유지하고, 본문을 PC 18px·모바일 17px와 넉넉한 줄 간격으로 키웠다. 지원 혜택은 따뜻한 배경으로 강조하고 소개·자격은 구분선과 제목으로 나눠 모든 항목이 같은 네모 상자로 보이지 않게 했다.
- 긴 지원 내용·설명·추가 자격·참여 제한은 원문 앞부분만 먼저 표시하고 더보기/접기로 전체 원문을 제공한다. 지원 내용은 최대 240자·원문 4줄을 우선 표시하며 지원금·자격을 새로 해석하거나 자동 요약하지 않는다.
- 신청기간·신청/참고 링크는 PC 우측 상단에 고정하고, 모바일에서는 제목 바로 아래로 배치했다. 공식 신청 링크와 참고 링크를 구분하고 기존 HTTP(S) 검사·새 탭 안전 속성을 유지했다.
- 긴 지역 이름은 시·도별 접기/펼치기로 바꿨다. 첫 6개 묶음 뒤에는 지역 목록 더보기를 제공하며 검색은 접힌 지역까지 전체에서 수행한다. 미확인 이름도 기타 지역으로 보존하고, 많은 지역이 있다는 이유로 전국 대상이라고 추정하지 않는다.
- 공용 계산·API·DB·목록 화면은 변경하지 않았다. 사용자 승인된 표시 방식을 SPEC 8.3과 이 기록에 반영했다. Step 52는 시작하지 않았다. 이번 수정은 검수용으로 커밋하지 않았다.
- 타입 검사와 Docker 웹 빌드 통과 후 웹 컨테이너를 재생성했다. 기존 회귀와 원문 펼침/접기·지역 검색/더보기·PC/모바일 배치 검증을 포함해 브라우저 테스트 **43개 모두 통과**했다. 테스트는 `node --test apps/web/test/*.e2e.mjs`를 기존 Playwright와 `/tmp/youth-step46-browser-libs`, 한글 글꼴 설정으로 실행했다.
- 사용자가 제시한 '청년 주택드림 디딤돌 대출'의 실제 251개 지역 자료로 PC·모바일 화면을 직접 확인했다. 변경 전후 정책 3,390건과 전체 행·시각 MD5 `46a965ded0407e47a7af9816cd3e7b6e`가 동일하다. API·DB는 유지하고 웹은 3000 포트에서 바로 확인할 수 있도록 실행 중이다.
- 읽는 순서: `policies/[id]/page.tsx`의 정보 배치 → `policies/[id]/detail-content.tsx`의 미리보기·지역 그룹 → `globals.css`의 상세 전용 스타일 → `policy-exploration.e2e.mjs`의 상세 검증.

## 58. 정책 상세 배치 추가 개선 (2026-10-22 사용자 검수 반영)

- 우측 고정 신청 카드를 제거하고 최대 1080px의 단일 본문과 적당한 좌우 여백으로 바꿨다. 신청기간과 링크 버튼은 제목 아래 가로 영역에 통합하고 모바일에서는 자연스럽게 줄바꿈한다. '신청 안내'·'신청·참고 링크'처럼 버튼과 중복되는 표시 문구는 제거했다.
- 카테고리를 제목 위의 작은 배지로 표시한다. 본문 순서는 정책 소개 → 지원 혜택 → 신청 대상으로 조정했다. 정책 소개에는 옅은 배경을 추가하고 '정책 소개'·'지원 혜택' 자체를 큰 제목으로 표시해 작은 분류명과 큰 설명 제목의 중복을 없앴다.
- 지역 목록은 PC·모바일 모두 한 줄에 한 묶음씩 표시하고 초기 노출을 3개로 줄였다. 지역 목록 더보기/접기, 전체 지역명 검색, 원문 더보기는 유지했다.
- 상세 전용 JSX·CSS와 지역 초기 노출 수만 수정했다. API·DB·목록·매칭 계산은 변경하지 않았다. SPEC 8.3을 새 배치와 동기화했다. 이전 가독성 개선과 이번 수정 모두 커밋 전 검수 상태다.
- `npm run typecheck`, Docker 웹 빌드, `node --test apps/web/test/*.e2e.mjs` 브라우저 **43개 모두 통과**, `git diff --check` 통과. 새 배치·문구 제거·소개/혜택 순서·분류 배지·지역 3개/한 줄 배치를 검증했다. 실제 디딤돌 대출 정책을 1440px PC·390px 모바일로 캡처해 확인하고 웹 컨테이너를 갱신했다.
- 읽는 순서: `policies/[id]/page.tsx`의 소개/신청 영역 배치 → `detail-content.tsx`의 지역 초기 노출 → `globals.css`의 상세 전용 스타일 → `policy-exploration.e2e.mjs` 배치 검증.

## 59. 상세 날짜 표시 개선 및 검수 반영 마무리 (2026-10-22)

- 사용자 요청으로 날짜 표시만 추가 정리했다. 상세의 `20261006 ~ 20261023`은 `2026.10.06 ~ 2026.10.23`처럼 표시하고, 단일 날짜와 종료일 대체 문구에도 같은 구분점을 적용한다.
- 날짜를 UTC의 실제 연·월·일과 대조해 윤년을 포함한 유효한 단일 날짜/범위만 표시 형식을 바꾼다. 존재하지 않는 날짜·역전 범위·복수 기간·상시/설명 문구는 원문을 유지한다. API·DB 원문과 신청 상태 판정은 변경하지 않는다.
- 타입 검사·Docker 웹 빌드·브라우저 **44개 모두 통과**, `git diff --check` 통과. 날짜 형식·윤년·잘못된 날짜·역전/복수 기간·원문 보존·모바일 너비를 검증했고 실제 정책의 `20260101 ~ 20261231`이 `2026.01.01 ~ 2026.12.31`로 보이는 것도 확인했다.
- 웹 컨테이너를 새 이미지로 재생성했다. 사용자가 승인한 앞선 상세 가독성·배치 수정과 이번 날짜 표시를 하나의 상세 UI 개선 커밋으로 묶는다. 핵심 추가 코드는 `detail-content.tsx`의 `formatApplicationPeriod` → `page.tsx`의 신청기간 표시 → `policy-exploration.e2e.mjs`의 날짜 검증이다.

## 60. 정책 목록 가독성 개선 (2026-10-22 사용자 요청)

- 분야·나이·취업·학력 필터를 짧은 입력 너비로 정돈하고 선택 화살표와 오른쪽 가장자리 사이에 14px 여백을 뒀다. 지역은 별도 행으로 묶고 정렬은 결과 건수 옆에 배치했다. 모바일에서는 입력을 화면 너비에 맞춰 재배치한다.
- 카드 제목 아래에 혜택 대신 정책 소개를 최대 100자·2줄로 표시한다. HTML 표시·앞쪽 장식 기호·반복 공백을 정리하며 원문과 자격 판정은 바꾸지 않는다. 분야는 배지로 강조하고 상태는 우측 상단, 기간·조회수는 우측 하단에 배치했다. 모바일은 카드 하단 한 줄로 기간·조회수를 표시한다. 반복하던 공식 신청처 확인 문구는 목록 위에 한 번만 표시한다.
- 카드별 상세 요청 없이 소개를 제공하도록 공용 `PolicyCard`에 `descriptionPreview`를 추가했다. 기존 후보 조회 SQL에서 description 앞 200자를 함께 조회하며 null은 빈 문자열로 반환한다. 상세 응답에도 같은 미리보기를 제공하고 기존 benefitPreview를 유지한다. DB 스키마·Migration·패키지는 변경하지 않았다. PRD와 SPEC의 목록 표시·API 계약을 실제 구현에 맞췄다.
- 상세에서 쓰던 유효 날짜 표시 함수를 `policies/policy-period.ts`로 옮겨 목록에서도 공유한다. 상세 화면의 배치·신청 상태 계산은 유지한다.
- 타입 검사·API 및 웹 Docker 빌드 통과. DB·HTTP 통합 검증을 포함한 API 47개 스위트 **1,291개**, 실제 탐색·기존 상세·신규 카드 배치를 포함한 브라우저 **45개**가 통과했다. 실제 1440px PC·375px 모바일 화면을 확인했다. 기존 정책 3,390건과 전체 행 MD5 `46a965ded0407e47a7af9816cd3e7b6e`가 동일하다.
- API와 웹을 새 이미지로 재생성하고 바로 확인할 수 있도록 실행 상태로 뒀다. 사용자 검수 후 명시적인 요청에 따라 목록 UI 변경을 하나의 커밋으로 묶는다. Step 52는 진행하지 않았다.
- 읽는 순서: `policies/page.tsx` 필터/정렬 배치 → `policy-card.tsx` 소개/카드 → `globals.css` 목록 스타일 → API `policy.repository.ts`/`policy-card.ts`의 소개 미리보기 → 브라우저·API 회귀 테스트.

## 61. Step 52 선택 조건 세션 유지 (2026-10-22)

작업 규칙 → PLAN Step 52 → SPEC 1장·3~4장·8.1·T-24 → 선행 완료 기록과 실제 목록/상세 코드를 확인했다. Step 51과 추가 검수 변경은 완료되어 있었고 명세 충돌은 없었다. Step 52만 구현했으며 커밋은 실행하지 않았다.

- `use-session-conditions.ts`에서 나이·지역·취업·학력만 `sessionStorage`의 `youth-kkultong:conditions`에 보관한다. 최초 복원 전에 빈 초기값으로 덮어쓰거나 기본 검색을 먼저 보내지 않는다. 새로고침·상세의 목록 링크·브라우저 뒤로가기 후 네 조건과 맞춤 결과를 복원한다.
- 유효한 1~120 정수 나이와 코드 형태만 읽고, 추가 필드·손상된 JSON·잘못된 자료형을 제거한다. 오류 상태의 나이 입력 문구는 저장하지 않는다. 선택을 해제하면 해당 필드를 삭제하고 모든 조건을 해제하면 전용 키를 제거한다. 다른 저장소 키에는 접근하지 않는다.
- 취업·학력·지역 메타 조회를 목록 페이지에서 공유하고 기존 필터는 전달받은 조회 상태·재시도를 사용한다. 복원된 코드도 현재 메타 선택지와 대조한 뒤 검색에 넣는다. 폐지·미확인 코드는 메타 조회 성공 후 제거하며, 조회 실패 때는 저장값을 보존하되 검색에서 제외하고 재시도 성공 시 복원한다.
- 저장소 읽기·쓰기·삭제 차단과 저장 공간 부족에도 메모리에서 조건 선택·해제·검색을 계속한다. 이때 새로고침 후 유지 여부는 브라우저 저장소 사용 가능 여부에 따른다. 저장소 오류나 개인 조건 원문을 로그로 출력하지 않는다.
- 개인 조건의 네트워크 전달은 기존 검색 POST 본문에만 한정한다. URL query·상세 GET·localStorage·서버 DB·파일 로그에는 보관하지 않는다. 분야·마감 포함·수동 정렬·페이지는 이번 세션 저장 범위에 넣지 않았다. API 계약·DB 스키마·Migration·패키지·SPEC 변경은 없고 PLAN·SUMMARY만 갱신했다.

### 검증

```bash
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
docker compose -f compose.yaml -f compose.local.yaml build web
docker compose -f compose.yaml -f compose.local.yaml up -d --no-deps --force-recreate --wait --wait-timeout 60 web
FONTCONFIG_FILE=/tmp/youth-step46-fonts.conf LD_LIBRARY_PATH=/tmp/youth-step46-browser-libs/root/usr/lib/x86_64-linux-gnu PLAYWRIGHT_MODULE=/home/leenohoon/youth-kkultong-before/node_modules/.pnpm/playwright@1.64.0/node_modules/playwright/index.mjs node --test apps/web/test/*.e2e.mjs
npm test --workspace apps/api -- --runTestsByPath test/policy-search.integration.spec.ts
git diff --check
```

- 공용·API·웹 타입 검사, Docker 웹 프로덕션 빌드, 브라우저 **49개**, 검색 API 통합 **32개**, diff 검사가 모두 통과했다. 기존 45개 브라우저 회귀에 조건 저장/복원/해제·독립 탭·손상 자료/미확인 코드·저장소 차단·메타 실패/재시도 4개 시나리오를 추가했다. 네 조건 복원 후 최초 검색부터 올바른 POST 본문을 보내고 URL query와 상세 GET에 조건을 전달하지 않는 것도 확인했다.
- 최초 브라우저 실행에서는 추가 탭을 만들 수 없는 Playwright 단축 컨텍스트 사용으로 테스트 하나가 실패했다. 명시적인 `browser.newContext()`로 테스트 환경을 수정한 뒤 전체 49개가 통과했다.
- API 실행 이미지는 개발용 TypeScript·Jest가 없어 컨테이너 안 테스트 실행이 실패했다. 이후 호스트의 개발 의존성과 공개된 로컬 DB 포트 5433으로 실행했다. Node 스크립트에서 `.env`의 `POSTGRES_PASSWORD`를 읽어 접속 URL을 메모리에서 구성하고 환경변수로만 전달했으며 비밀값은 출력하지 않았다. 테스트용 임시 스키마에서만 데이터를 만들고 정리했으며, 사용자 조건 미저장(T-24) 검증을 포함한 32개가 통과했다.
- 검증 후 기존 `public.policies`는 **3,390건**, 남은 `step41_test_%` 임시 스키마는 **0개**다. 외부 수집·운영 스키마 Migration·시드는 실행하지 않았다. API·DB 컨테이너는 유지하고 웹만 새 이미지로 재생성해 `http://localhost:3000/policies`에서 확인할 수 있도록 실행 상태로 두었다.

핵심 코드 읽는 순서: `use-session-conditions.ts`의 복원/저장 → `page.tsx`의 현행 코드 확인/검색 요청 → `eligibility-filters.tsx`·`region-filter.tsx`의 메타 상태 전달 → `policy-exploration.e2e.mjs`의 세션 검증.

## 62. Step 52 세션 유지 범위 확장 (2026-10-22 사용자 승인)

사용자가 제안된 확장안을 승인해 Step 52에 분야·마감 포함·수동 정렬 유지 기능을 추가했다. 앞 절의 '네 조건만 저장'·'목록 필터/정렬 제외' 결정은 이번 승인으로 아래와 같이 변경한다. Step 53은 진행하지 않는다.

- 훅 이름을 `use-session-exploration.ts` / `useSessionExploration`으로 정리하고 기존 저장 키를 유지해 앞선 네 조건 저장값도 읽을 수 있게 했다. 개인 조건과 분야·마감 포함·직접 선택한 정렬을 하나의 세션 상태로 관리한다. 페이지는 저장하지 않아 새로고침·상세 복귀 시 1페이지로 시작한다.
- 자동 정렬은 세션에 쓰지 않는다. 복원한 유효 개인 조건이 있으면 맞춤순, 없으면 인기순이다. 직접 선택한 인기순·마감순·최신순은 유지하며, 저장된 맞춤순은 조건 검증 후 유효 조건이 없으면 인기순으로 바꾸고 저장값도 정리한다. 분야와 마감 포함은 맞춤 조건 수에 포함하지 않는다.
- 복원한 분야도 현재 메타 선택지와 대조한다. 더 이상 없는 분야는 삭제해 '전체'로 표시한다. 메타 로딩 중에는 첫 검색을 기다리고, 실패 시 저장값을 보존하되 해당 필터는 검색에서 제외한다. 재시도 성공 시 검증·복원한다. 지역·자격 메타 로딩 중에는 맞춤순을 성급하게 인기순으로 덮어쓰지 않는다.
- 마감 포함은 실제 boolean만 읽고 기본 `false`는 생략한다. 알 수 없는 정렬·분야 자료형·추가 필드·페이지는 복원하지 않는다. 분야 '전체'·마감 해제도 세션에 반영한다. URL·localStorage·서버 DB·로그에 개인 조건을 기록하지 않는 기존 경계는 유지한다.
- API·DB·Migration·패키지 변경은 없다. 승인된 세션 동작을 PRD 4.2·ARCHITECTURE 4장·SPEC 8.1·PLAN Step 52에 동기화했다. SPEC_SUMMARY는 없다. 커밋은 실행하지 않았다.

검증: `NEXT_TELEMETRY_DISABLED=1 npm run typecheck`, `docker compose -f compose.yaml -f compose.local.yaml build web`, `git diff --check` 통과. 이어 `up -d --no-deps --force-recreate --wait --wait-timeout 60 web`으로 웹을 갱신했다. 기존과 같은 Playwright·임시 Chromium 라이브러리·글꼴 환경에서 `node --test apps/web/test/*.e2e.mjs`를 실행해 기존 49개와 신규 4개, **53개 모두 통과**했다.

- 실제 API를 대상으로 분야·마감 포함·수동 정렬의 새로고침/상세 복귀 유지, 2페이지 이후 1페이지 복원, 필터 해제 유지, 첫 검색부터 복원 상태 전송을 확인했다. 잘못된 정렬/boolean/분야 자료형·페이지 제거, 조건 없는 맞춤순의 저장값 정리, 조건 있는 맞춤순·다른 수동 정렬 유지, 자동 정렬 미저장, 메타 지연/실패/재시도를 검증했다.
- API·DB 소스와 스키마는 변경하지 않았고 외부 수집·Migration·시드는 실행하지 않았다. API·DB 컨테이너는 재생성하지 않았다. 최종 웹·API·DB 모두 healthy이며 `http://localhost:3000/policies`에서 바로 확인할 수 있다. 이번 확장의 미해결 문제는 없다.

핵심 코드 읽는 순서: `use-session-exploration.ts` → `page.tsx`의 필터 검증·정렬 복원 → `policy-exploration.e2e.mjs`의 탐색 상태 복원 테스트.

## 63. Step 53 목록·상세 예외 UI와 접근성 (2026-10-22)

사용자 요청으로 Step 52 전체 변경을 `3b91f5c` (`feat: 정책 탐색 조건과 필터 정렬 탭 세션 유지`)로 먼저 커밋했다. 작업 규칙·PLAN Step 53·SPEC 8.3·선행 완료 기록과 목록/상세/페이지 이동/공통 스타일을 대조했고 충돌은 없었다. Step 53만 진행하며 이번 변경은 커밋하지 않았다.

- 목록·상세 로딩을 배경과 여백이 있는 상태 안내로 표시한다. 목록의 정상 0건은 오류와 구분하고, 선택 조건이 있을 때는 분야/조건을 줄이거나 마감 포함으로 재탐색하도록 안내한다. 전체 건수는 있지만 현재 페이지가 빈 경우에는 다른 페이지 이동을 안내한다. 목록 빈 결과와 상세의 없는 정책도 상태 안내로 표시한다.
- 신청기간이 불명확한 상세에는 원문과 함께 공식 신청처에서 접수 여부를 확인하도록 설명한다. 링크가 없으면 기존 '링크 없음' 표시와 함께 제공된 신청/참고 링크가 없음을 설명한다. 원문·상태 판정·HTTP(S) 검사·새 탭 안전 속성은 유지한다.
- 목록 페이지 이동·검색 재시도 후에는 결과 요약 또는 오류 제목으로 키보드 초점을 옮긴다. 페이지 버튼·재시도 버튼이 사라져 초점이 본문 밖으로 빠지는 문제를 막으며, 일반 필터 입력 중에는 초점을 빼앗지 않는다. 상세 재시도 후에도 정책 제목이나 오류·없는 정책 안내 제목으로 초점을 옮긴다.
- 목록·상세 본문을 프로그램으로 초점 받을 수 있게 해 본문 건너뛰기 링크가 실제 본문으로 이동하도록 한다. 상세 로딩 중에도 화면 제목을 스크린리더에 제공한다. 결과 요약은 변경 내용을 한 번에 알리며 지역 펼침과 프로그램으로 이동한 제목/본문에도 초점 테두리를 제공한다.
- 작은 보조 문구의 글자색을 진하게 하고 페이지·나이 지우기·더보기·지역 펼침·마감 포함의 조작 영역을 최소 44px 높이로 확보한다. 좁은 화면에서 자격·신청 링크를 한 열로 표시하고 빈 결과/오류 문구가 줄바꿈되도록 한다. 목록·상세의 기존 정보 순서와 사용자 조건 세션 기능을 유지한다.
- API·DB 스키마·Migration·패키지·제품 판정 규칙 변경은 없다. 이번 Step은 기존 SPEC의 표시·예외·접근성 범위 안의 보완이므로 PLAN·SUMMARY에 구현 결과를 기록한다.

### 검증

```bash
NEXT_TELEMETRY_DISABLED=1 npm run typecheck
docker compose -f compose.yaml -f compose.local.yaml build web
docker compose -f compose.yaml -f compose.local.yaml up -d --no-deps --force-recreate --wait --wait-timeout 60 web
FONTCONFIG_FILE=/tmp/youth-step46-fonts.conf LD_LIBRARY_PATH=/tmp/youth-step46-browser-libs/root/usr/lib/x86_64-linux-gnu PLAYWRIGHT_MODULE=/home/leenohoon/youth-kkultong-before/node_modules/.pnpm/playwright@1.64.0/node_modules/playwright/index.mjs node --test apps/web/test/*.e2e.mjs
FONTCONFIG_FILE=/tmp/youth-step46-fonts.conf LD_LIBRARY_PATH=/tmp/youth-step46-browser-libs/root/usr/lib/x86_64-linux-gnu PLAYWRIGHT_MODULE=/home/leenohoon/youth-kkultong-before/node_modules/.pnpm/playwright@1.64.0/node_modules/playwright/index.mjs node --test apps/web/test/policy-accessibility.e2e.mjs
git diff --check
```

- 공용·API·웹 타입 검사와 Docker 웹 빌드 통과. 기존 53개에 접근성/예외 시나리오 5개를 추가해 전체 브라우저 **58개 모두 통과**했다. 이후 상세 연속 실패·없는 정책 응답의 초점 처리까지 보완한 최종 빌드로 웹을 재생성하고, 연속 실패→재시도 성공을 포함한 접근성 **5개를 다시 실행해 모두 통과**했다.
- 실제 키보드 Tab/Enter 입력으로 본문 건너뛰기, 필터 입력 중 초점 유지, 페이지 오류/재시도/성공의 초점 이동, 상세 재시도와 원문·지역 펼침을 검증했다. 느린 목록/상세 로딩과 필터 결과 0건의 안내도 확인했다. 320px·640px에서 주요 조작 영역 높이와 가로 넘침 없음을 검사하고 320px의 실제 목록·상세 캡처를 직접 확인했다. 실제 스크린리더 음성 출력과 모바일 기기의 실기 검증은 수행하지 않았다.
- 최초 상세 지연 테스트는 대체 URL 패턴이 웹 문서까지 가로채 `page.goto`가 시간 초과됐다. API 경로만 대체하도록 수정한 뒤 전체 58개가 통과했다. 테스트 통과를 위한 요구사항 변경은 없다.
- 외부 수집·DB 쓰기·Migration·시드를 실행하지 않았고 기존 정책은 **3,390건**이다. API·DB 컨테이너는 유지했다. 웹은 최종 새 이미지로 갱신해 `http://localhost:3000/policies`에서 확인할 수 있다.

핵심 코드 읽는 순서: `policies/page.tsx`의 검색 후 초점/빈 결과 → `policies/[id]/page.tsx`의 상세 재시도/기간·링크 안내 → `globals.css`의 접근성·모바일 보완 → `policy-accessibility.e2e.mjs`.

## 64. 다음 작업을 위한 상태

다음 단계 대상은 **Step 54: 공개 API 보안·요청 보호 점검**이다. Step 54~57은 미착수다. Step 53의 미해결 문제는 없으며 다음 단계는 별도 요청을 기다린다.
