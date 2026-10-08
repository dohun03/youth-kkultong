## Step 0. MVP0 인수 확인

### 완료 내용

- MVP1에서 재사용할 Entity를 확인했다. `PolicyEntity`, `PolicySourceEntity`, `RegionEntity`, `MedianIncomeEntity`가 각각 정책, 출처, 행정구역, 기준 중위소득 테이블에 대응한다.
- `@kkultong/contracts`의 `PolicyConditions`, `BenefitAmount`, `PolicyImportInput`은 정책 Entity와 import CLI가 공통으로 사용한다.
- `data/policies/policies.json`은 외부 식별자가 중복되지 않는 정책 30건을 포함한다.
- 별도 임시 PostgreSQL 16 컨테이너에서 실제 명령 흐름을 검증했다. migration 적용, 기준 데이터 seed, 정책 30건 import가 모두 성공했고 최종 행 수는 `regions` 284건, `median_income_table` 8건, `policy_sources` 1건, `policies` 30건이다. 임시 컨테이너는 검증 직후 삭제했다.
- MVP0 production 코드는 수정하거나 리팩터링하지 않았다.

### 검증

- `corepack pnpm --filter @kkultong/contracts typecheck` 성공
- `corepack pnpm --filter @kkultong/contracts build` 성공
- `corepack pnpm --filter @kkultong/server typecheck` 성공
- `corepack pnpm server:test` 성공: 6개 suite, 23개 test. PostgreSQL 16 Testcontainers 통합 테스트를 포함한다.
- `corepack pnpm --filter @kkultong/server build` 성공
- 임시 PostgreSQL에서 `db:migrate` → `db:seed` → `policy:import` 성공

### 인수 결과 및 주의사항

- MVP1 구현을 막는 코드 구조 충돌은 없다. Step 1은 기존 `@kkultong/contracts` 공개 진입점에 API 계약을 추가하는 방식으로 진행할 수 있다.
- 기존 개발 Compose DB에는 MVP0 migration 이력이 있으나 정책 행은 0건이고, named volume의 기존 비밀번호가 현재 `docker-compose.yml`의 예시와 달라 애플리케이션의 TCP 연결 인증에 실패한다. 이번 Step에서는 기존 개발 DB를 수정하지 않았다. 다음 로컬 실행 전에는 개발 DB의 연결 설정을 정리한 뒤 seed와 정책 import를 다시 수행해야 한다.
