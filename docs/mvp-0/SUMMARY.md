## Phase 0. Workspace / 프로젝트 기반

### 완료 내용

- pnpm workspace를 구성해 `apps/*`, `packages/*`를 패키지 범위로 등록했다.
- `apps/server`에 NestJS 11 및 TypeScript strict 기반을 만들었다. 현재는 서버 부팅에 필요한 최소 `AppModule`, `main.ts`만 포함하며, DB·API 기능은 이후 Phase에서 추가한다.
- `packages/contracts`에 `@kkultong/contracts` 패키지와 typecheck 설정을 추가했다. 정책 enum과 Zod schema는 Phase 2 범위이므로 아직 정의하지 않았다.
- 루트에 `server:dev`, `server:test`, `db:migrate`, `db:revert`, `db:seed`, `policy:validate`, `policy:import` 명령 진입점을 구성했다. DB 및 policy 명령의 실제 구현은 해당 Phase에서 연결한다.
- `node_modules`, 빌드 결과물, 환경 파일이 Git에 포함되지 않도록 `.gitignore`를 구성했다.

### 주요 파일

- `package.json`: workspace 공통 스크립트와 pnpm 버전 선언
- `pnpm-workspace.yaml`: pnpm workspace 범위
- `apps/server/src/main.ts`, `apps/server/src/app.module.ts`: NestJS 최소 실행 기반
- `apps/server/tsconfig.json`, `apps/server/jest.config.cjs`: 엄격한 TypeScript 및 Jest 설정
- `packages/contracts/src/index.ts`: 향후 공유 계약의 공개 진입점

### 검증

- `corepack pnpm install` 성공
- `corepack pnpm --filter @kkultong/server build` 성공
- `corepack pnpm --filter @kkultong/contracts typecheck` 성공
- `corepack pnpm server:test` 성공 (Phase 0에는 테스트 대상이 없어 `--passWithNoTests` 적용)
