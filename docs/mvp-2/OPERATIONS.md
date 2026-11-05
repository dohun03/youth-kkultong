# MVP2 검수 데이터 백업과 복원 및 이관 재현 지침

기준: SPEC 2.4, 5.5 및 T2-01, T2-03~05, T2-49. 저장소 루트의 Bash에서 실행한다. 백업과 복원 결과는 SUMMARY 45장, 실제 수집과 이관 재현 결과는 48장에 기록한다. 초기 설치와 일반 재기동은 [MVP1 운영 지침](../mvp-1/OPERATIONS.md), 자동 수집의 활성화와 장애 확인은 SUMMARY 44장을 따른다.

## 1. 백업 대상과 쓰기 중단

| 대상 | 보존 내용 |
| --- | --- |
| `policies` | 공개 UUID, 승인 본문, 원본 JSON, 내용 해시, 조회수 |
| `source_policies` | 원본 UUID와 최신 내용, 최초/최근 실제 수집 시각, 누락 횟수 |
| `policy_reviews` | 검수 UUID와 상태, 기준/변경 스냅샷과 해시, 처리자와 시각, 거절/대체 사유 |
| `regions`, `migrations` | 지역 전체, 적용된 Migration과 시퀀스 |
| DB 스키마 | 테이블, 외래키, CHECK, 일반/부분/유일 인덱스 |
| `/app/logs` | `ingestion_logs` 볼륨의 수집 결과 파일 전체 |

관리자 자격과 서명 키는 DB에 없다. `.env` 및 비밀 저장소에서 별도로 보관하고 복원 API 실행 시 주입한다. DB 백업에는 정책 원문과 검수 사유가 있으므로 디렉터리 `700`, 파일 `600`으로 관리하고 Git에 추가하지 않는다. `backups/`는 기존 Git 및 Docker 빌드 제외 대상이다. 매일 운영 백업과 변경 전 백업을 수행하며, 이 단계에서는 자동 백업이나 보관 기한 삭제 작업을 등록하지 않는다. 완료된 백업은 별도 저장소에도 보관해야 호스트 장애에서 복구할 수 있다.

DB dump 자체는 일관된 읽기 시점을 제공하지만 로그와 같은 시점의 백업을 만들려면 쓰기를 멈춰야 한다. 진행 중인 수집과 검수 처리를 먼저 마치고, 수동 CLI와 Migration, 시드를 새로 실행하지 않는 유지보수 구간을 잡는다. API를 중지하면 자동 수집과 관리자 쓰기도 멈춘다. 기존 DB와 볼륨은 유지한다.

```bash
dc=(docker compose -p youth-kkultong -f compose.yaml -f compose.local.yaml)
"${dc[@]}" stop -t 120 api
"${dc[@]}" up -d --no-deps --wait db
"${dc[@]}" exec -T db psql -X -v ON_ERROR_STOP=1 -U youth_kkultong -d youth_kkultong -Atc \
  "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state<>'idle';"
```

결과는 `0`이어야 한다. API와 CLI를 여러 환경에서 실행 중이라면 같은 DB에 쓰는 모든 프로세스를 중지한다. DB·로그 백업 완료 뒤 원본 API를 다시 시작할 수 있다. 아래 자동 검증기는 검증 종료까지 원본 API 중지를 요구한다. 실패했을 때도 원인을 확인하고 원래의 실행 상태를 복구한다. 서비스 재시작은 누락된 수집을 자동 보충하지 않는다.

## 2. 백업부터 별도 빈 DB 복원까지 자동 검증

현재 저장소의 API 빌드, Docker 접근 권한, 원본 DB의 `127.0.0.1:5433` 포트와 PostgreSQL 17 이미지가 필요하다. API가 중지되어 있어도 API 컨테이너의 설정과 로그 볼륨을 읽을 수 있다. 실제 관리자 비밀번호를 읽거나 기존 인증 설정을 바꾸지 않는다.

```bash
npm run build --workspace apps/api
node --test apps/api/test/backup-restore.live.cjs
```

선택 환경변수는 `BACKUP_SOURCE_DB`와 `BACKUP_SOURCE_API`(기본 `youth-kkultong-db-1`, `youth-kkultong-api-1`), `BACKUP_DIRECTORY`(기본 `backups/mvp2-step37-<시각>-<임의값>`)다. 컨테이너 설정을 전체 출력하거나 비밀값을 명령 인자에 적지 않는다. 백업 디렉터리는 새 이름이어야 하며 기존 디렉터리에는 덮어쓰지 않는다.

검증기는 다음을 실제 수행한다.

1. 원본 API 중지와 다른 DB 작업 없음을 확인하고 공통 수집 Advisory Lock을 유지한다. 원본 DB 연결은 읽기 전용이다.
2. PostgreSQL 17 컨테이너의 `pg_dump -Fc --no-owner --no-acl`로 전체 DB를 저장한다. 로그 볼륨을 읽기 전용으로 연결해 tar로 보관한다. 성공한 `.partial`만 최종 파일명으로 바꾸고 `SHA256SUMS`를 확인한다.
3. 새 임시 PostgreSQL 컨테이너의 **빈 DB**를 확인한 뒤 `pg_restore --exit-on-error --single-transaction --no-owner --no-acl`로 복원한다. 검증 DB는 임시 메모리 디스크를 사용하며 기존 볼륨을 연결하지 않는다.
4. 5개 테이블의 행 수와 정렬된 전체 행 체크섬, 검수 상태, 제약과 인덱스, Migration 시퀀스를 대조한다. 전체 행 체크섬에는 UUID와 해시, NULL, 스냅샷, 시각과 처리 정보가 모두 포함된다. 공개/원본/검수 변경본/검수 기준본의 내용 해시도 재계산한다.
5. 실제 NestJS HTTP 서버 두 개를 순차 실행해 원본 DB와 복원 DB의 공개 검색, 정책 상세, 지역, 분야, 관리자 대기/처리 이력/누락 목록 및 상태별 대표 상세 응답이 같은지 확인한다. 검증용 임시 관리자 자격을 메모리에서 만들고 모든 업무 조회 연결을 읽기 전용으로 설정한다. 무인증 관리자 요청의 401과 정상 로그인도 확인한다.
6. 미적용 Migration과 ORM 스키마 차이가 없는지 확인한다. CHECK는 복원 시 동등한 배열 형변환 표기가 달라질 수 있어 이름·종류·적용 상태로 비교한다. 대기가 있는 백업에서는 잘못된 누락 횟수, 상태, 해시, JSON, 처리 정보, 외래키 및 중복 대기 입력이 거부되는지 복원 DB에서 검사하고 모두 롤백한다.
7. 로그를 새 임시 폴더에 추출해 원본 파일별 SHA-256과 대조하고 원본 DB 및 로그가 검증 전후 동일한지 확인한다. 연결과 수집 잠금을 반환하고 이번에 만든 임시 컨테이너와 추출 폴더를 정리한다. 백업은 보관한다.

결과 파일은 `production.dump`, `ingestion-logs.tar`, `source.json`, `SHA256SUMS`, 성공 시 `verification.json`이다. `source.json`에는 원문 대신 건수·체크섬·스키마 비교 기준이 있으며, `verification.json`에는 상태별 건수·API 확인 범위·로그별 해시가 있다. 종료 코드 `0`과 `status=PASS`를 확인한다. `.partial`이나 `verification.json`이 없는 묶음을 복원 검증 완료로 취급하지 않는다. 테스트 실행에 실패하면 남긴 백업으로 원인을 확인하고 새 디렉터리에서 다시 실행한다.

```bash
# 검증 출력에 나온 실제 경로로 지정
backup_dir='backups/<확인한 백업 디렉터리>'
(cd "$backup_dir" && sha256sum -c SHA256SUMS)
"${dc[@]}" start api
"${dc[@]}" ps
curl --fail --silent http://localhost:4000/api/v1/health
```

`start`는 기존 컨테이너의 설정과 볼륨을 유지한다. 설정이나 이미지가 바뀐 배포에서는 기존 프로젝트명으로 `up -d --no-deps --wait api`를 사용한다. 자동 수집의 최종 활성화는 Step 41 범위다.

## 3. 보관한 백업을 새 복원 환경에서 사용

아래는 보관용 볼륨을 가진 별도 Compose 프로젝트에 복원하는 절차다. 자동 검증기의 임시 DB는 검증 후 삭제되므로 장기 확인에는 이 절차를 사용한다. 백업에 맞는 코드/이미지와 PostgreSQL 17을 준비한다. 새 프로젝트명과 `4400` 포트가 기존 작업과 겹치지 않는지 확인한다. Compose의 `!override`를 지원하는 버전이 필요하다.

```bash
umask 077
cat > /tmp/mvp2-restore.yaml <<'YAML'
services:
  api:
    image: youth-kkultong-api:latest
    ports: !override
      - "127.0.0.1:4400:4000"
    environment:
      DATABASE_URL: "postgresql://youth_kkultong:${POSTGRES_PASSWORD:?비밀번호 필요}@db:5432/youth_restore"
      POLICY_SCHEDULE_ENABLED: "false"
      YOUTH_CENTER_API_KEY: ""
  db:
    environment:
      POSTGRES_DB: youth_restore
YAML
restore=(docker compose --env-file "$PWD/.env" -p youth-kkultong-restore37 \
  -f "$PWD/compose.yaml" -f /tmp/mvp2-restore.yaml)
"${restore[@]}" up -d --no-build --wait db
"${restore[@]}" exec -T db psql -X -v ON_ERROR_STOP=1 -U youth_kkultong -d youth_restore -Atc \
  "SELECT count(*) FROM pg_tables WHERE schemaname='public';"
```

테이블 수가 반드시 `0`인지 확인한다. 기존 데이터가 있는 DB를 복원 대상으로 사용하지 않는다.

```bash
(cd "$backup_dir" && sha256sum -c SHA256SUMS)
"${restore[@]}" exec -T db pg_restore --list < "$backup_dir/production.dump"
"${restore[@]}" exec -T db pg_restore -U youth_kkultong -d youth_restore \
  --exit-on-error --single-transaction --no-owner --no-acl < "$backup_dir/production.dump"
```

복원 전에 Migration·시드를 실행하지 않는다. 실패하면 부분 복원을 사용하지 않고 새 빈 DB에서 원인을 해결한 뒤 재시도한다. 기존 DB에 `--clean`이나 자동 역이관을 적용하지 않는다. 같은 프로젝트명으로 다시 실행했을 때 이미 테이블이 있으면 덮어쓰지 않고 새 프로젝트명을 선택한다.

로그도 **새 프로젝트의 로그 볼륨**에 복원한다. 아래 명령은 API 서버를 시작하지 않는 일회성 컨테이너이며, `test -z` 실패는 로그 볼륨이 비어 있지 않다는 뜻이므로 덮어쓰지 않는다. 관리자 설정은 `.env`나 별도 비밀 설정에서 준비한다. 명령의 로그에 자격을 출력하지 않는다.

```bash
"${restore[@]}" run --rm --no-deps -T --entrypoint sh api -c \
  'test -z "$(ls -A /app/logs)" && tar -C /app/logs -xf -' < "$backup_dir/ingestion-logs.tar"
"${restore[@]}" up -d --no-build --wait api
"${restore[@]}" exec -T api npm run migration:show --workspace apps/api
curl --fail --silent http://localhost:4400/api/v1/health
curl --fail --silent -H 'Content-Type: application/json' \
  -d '{}' http://localhost:4400/api/v1/policies/search
```

복원 API는 환경변수의 유효한 관리자 네 설정이 필요하다. `ADMIN_WEB_ORIGIN`은 실제 요청 출처를 유지하고, 관리자 로그인 및 상태 변경 요청에 동일한 `Origin`을 보낸다. 실제 비밀번호는 명령 이력·보고에 넣지 않는다. 브라우저에서 검수할 때는 별도 웹 인스턴스의 프록시가 이 복원 API를 가리키도록 준비한다.

건수만으로 복원을 판정하지 않는다. 자동 검증에서 사용한 아래 전체 행 체크섬을 `source.json`과 비교한다. 각 테이블의 체크섬이 같으면 UUID, 해시와 스냅샷을 포함한 행 값도 동일하다.

```bash
"${restore[@]}" exec -T db psql -X -v ON_ERROR_STOP=1 -U youth_kkultong -d youth_restore -Atc \
  "SELECT 'policies',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) FROM policies t
   UNION ALL SELECT 'source_policies',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) FROM source_policies t
   UNION ALL SELECT 'policy_reviews',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) FROM policy_reviews t
   UNION ALL SELECT 'regions',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY code),'')) FROM regions t
   UNION ALL SELECT 'migrations',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) FROM migrations t;
   SELECT status,count(*) FROM policy_reviews GROUP BY status ORDER BY status;"
"${restore[@]}" exec -T api sh -c 'cd /app/logs && find . -type f -exec sha256sum {} \;'
```

로그 해시도 `verification.json`과 일치하는지 확인한다.

복원 후 원래 DB를 유지하면서 공개 검색과 상세, 관리자 대기·이력·누락 및 상태별 상세를 확인한다. 검증에 합격한 뒤 서비스 접속 대상 전환을 판단한다. 이번 검증에서는 원래 서비스의 접속 대상을 바꾸거나 자동 수집을 활성화하지 않는다.

검증 환경 종료에는 `"${restore[@]}" down`을 사용하며 볼륨은 남긴다. 운영·검증 프로젝트 모두에서 `down -v`를 복구 명령으로 사용하지 않는다. 기존 `youth-kkultong_db_data`와 `youth-kkultong_ingestion_logs`, 원래 서비스의 접속 대상은 유지한다.

## 4. 이관 전 백업에서 실제 수집과 관리자 검수 재현

Step 40은 **이관 전 MVP1 백업**을 새 빈 PostgreSQL 17에 복원해 최신 코드로 전환하는 검증이다. 검수 데이터가 이미 포함된 MVP2 백업으로 이관을 대체하거나 기존 DB에서 역이관하지 않는다. 원래 API와 웹은 그대로 유지하고 복원 환경의 옛 API와 CLI를 시작하지 않는다. 복원 DB에 다른 연결이 없는지 확인하고 공통 수집 잠금을 유지한 상태에서 Migration을 실행한다. 실제 대상 환경을 전환할 때는 1절의 쓰기 중단과 최신 백업을 먼저 수행한다.

다음 명령은 Docker 접근과 실제 온통청년 API 키가 설정된 기존 API 컨테이너가 필요하다. 기본 백업은 `backups/mvp2-step4-20261028225754/`이며, `SHA256SUMS`, `production.dump`, `ingestion-logs.tar`, `baseline.json`이 있어야 한다. 기본 원본 컨테이너는 `youth-kkultong-db-1`, `youth-kkultong-api-1`이다. `REHEARSAL_BACKUP`, `REHEARSAL_SOURCE_DB`, `REHEARSAL_SOURCE_API`로 변경할 수 있다. 기존 API의 자동 수집은 false여야 하며 실행 중 수동 수집과 관리자 쓰기를 추가하지 않는다.

```bash
npm run build --workspace apps/api
node --test apps/api/test/migration-collection.live.cjs
```

검증기는 아래 순서로 실행하며 기존 컨테이너의 비밀 설정을 출력하거나 수정하지 않는다.

1. 백업 SHA-256을 확인하고 원래 5개 테이블 전체 행 체크섬과 로그별 해시를 기록한다. 기존 DB에는 읽기 전용 쿼리만 보낸다.
2. 기존 볼륨과 분리된 임시 PostgreSQL의 빈 DB에 단일 트랜잭션으로 복원한다. 복원 DB의 쓰기 연결 없음과 수집 잠금을 확인하고 최신 빌드의 실제 Migration CLI를 실행한다. 공개 전체 행과 UUID, 지역 보존, 원본 대응, NULL 수집 시각과 후보 0건, 스키마 일치와 재이관 없음도 확인한다.
3. 백업의 동일 원문을 공통 수집 저장 서비스에 재입력해 UNCHANGED와 후보 0건을 확인한다. 이 재입력은 외부 API 호출과 구분해 기록한다.
4. 최신 수집 CLI로 **실제 온통청년 전체 페이지**를 50건씩, 요청 간 3초로 조회한다. 응답을 가짜 자료로 대체하지 않는다. 원본 해시로 신규/변경/동일/누락을 다시 계산해 CLI 로그 및 DB 결과와 대조한다. 후보 스냅샷과 공개 기준본, 미승인 공개 본문과 UUID 보존 및 조회수 갱신을 확인한다. 확정 전 실패는 복원 DB의 전체 행 체크섬도 대조해 무반영을 확인하고 실패 로그를 보관한다.
5. 실제 수집 원문을 같은 저장 서비스에 재입력해 후보 중복 생성 없이 유지되는지 확인한다. 이 정상 전체 재입력도 누락 횟수를 1 늘리므로 실제 외부 호출의 결과와 따로 기록한다.
6. 별도 포트의 최신 NestJS API에서 합성 관리자 자격으로 로그인한다. 실제 신규/변경 후보를 각각 승인·거절하고 공개 상세와 처리 이력을 조회한다. 변경 승인은 기존 공개 UUID와 생성 시각을 유지하고, 거절은 공개 행 전체를 보존해야 한다.
7. 원래 DB와 로그의 전후 일치를 확인하고 이번에 만든 연결·API·임시 DB 컨테이너·프로젝트만 정리한다. 원래 서비스의 접속 대상과 자동 수집 설정은 유지한다.

증거는 새 `backups/mvp2-step40-<시각>-<임의값>/`에 보관한다. Migration·CLI 출력, 복원 로그에 이어 기록한 실제 수집 로그, 실제 수집 원문, 기존 DB/로그 전후 체크섬, `verification.json`, `SHA256SUMS`를 포함한다. 원문과 로그는 디렉터리 700·파일 600 및 Git 제외를 유지한다. 검증용 합성 관리자 비밀번호와 서명 키는 저장하지 않는다.

종료 코드 0, `verification.json`의 `status=PASS`, `originalUnchanged=true`, `cleanupSucceeded=true`와 SHA-256을 확인한다. 외부 자료가 달라 실제 신규/변경/동일 사례 또는 승인·거절에 필요한 후보가 부족하면 해당 근거를 확인하지 못한 실패로 기록한다. 실패한 실행을 완료로 사용하지 않고 원인을 확인한 뒤 새 환경에서 다시 실행한다. 자동 수집 활성화와 대상 환경 전환의 최종 확인은 Step 41에서 수행한다.

### 실제 수집 성공본으로 검수 이어서 재현

실제 호출이 성공한 뒤 검수 시험에서 실패했거나 후속 호출이 중복 ID 등으로 중단되면, 보관한 정상 수집 원문으로 새 복원 환경에서 검수를 재현할 수 있다. 다음 선택 설정을 사용한다.

```bash
REHEARSAL_CAPTURE='backups/<실제 수집 성공 원문과 로그를 보관한 폴더>' \
  node --test apps/api/test/migration-collection.live.cjs
```

이 모드는 원본 폴더의 SHA-256, 같은 이관 dump, `actualCollection.result`의 `SUCCESS`·`saved=true`·`COMMITTED`, 원래 데이터 보존과 정리 성공을 확인한다. 원문을 현재 공통 저장 서비스에 재입력해 최초 수집의 판정 건수와 원본/후보/공개 결과를 대조하고 실제 관리자 HTTP API로 승인·거절을 검증한다. 재입력에서 파생된 폴더를 최초 외부 호출 근거로 다시 사용하는 것은 거부한다.

수집 뒤 다른 검사가 실패한 원본 폴더는 전체 `FAIL` 상태를 유지한다. 새 보고서는 `mode=CAPTURE_REPLAY`, `networkExecutedThisRun=false`, 원본 폴더의 상태와 실제 외부 호출의 실행 ID를 명시한다. 최초 성공 로그는 `captured-network.jsonl`로 별도 복사한다. 이 모드의 PASS는 보관 원문 재입력과 관리자 검수 범위이며, 실제 외부 호출 성공은 원본 폴더의 실행 ID와 로그에서 따로 확인한다. 새 외부 호출까지 모두 통과한 검증으로 해석하지 않는다.

## 5. 사용자가 사이트에서 검수할 복원 DB 연결

2026-11-05 사용자 요청으로 기존 PostgreSQL 안에 `youth_mvp2_preview_20261105_bd3479` DB를 별도로 만들고, MVP2 이전 백업을 복원해 현재 Migration을 적용했다. 같은 서버의 기존 `youth_kkultong` DB와 `db_data` 볼륨은 보존한다. 현재 연결은 `.env`의 `POSTGRES_DB`와 호스트 직접 실행용 `DATABASE_URL`에 반영하고 API 컨테이너만 재생성했다. 웹 주소는 `http://localhost:3000`이며 기존 관리자 계정과 로그 볼륨을 사용한다. 자동 수집은 false다. 실제 수동 수집 결과와 검수 대기 건수는 SUMMARY 50절을 확인한다.

전환 직전 DB와 로그의 백업은 `backups/site-preview-1793881085877-47feac/current-state/`에 보관한다. 이 백업을 별도 빈 DB에 실제 복원하고 행·해시·관리자/공개 API 및 로그의 동일성까지 검증했다. 같은 상위 폴더에 `environment-before.env`, 이관·빌드·수집 로그와 `operation.json`을 보관한다. 환경 백업에는 비밀값이 있으므로 파일 600·디렉터리 700 및 Git 제외를 유지한다.

현재 자료를 직접 확인할 화면은 `/admin/reviews`(검수 대기), `/admin/history`(처리 이력), `/admin/missing`(누락 정책)이다. 수집만으로 신규·변경 원문이 공개되지는 않으며 사용자가 비교 후 승인·거절한다. 이 전환 작업에서는 승인·거절 요청을 보내지 않는다.

기존 DB로 돌아가려면 현재 `.env`의 추가 변경을 먼저 보관하고 `POSTGRES_DB`를 `youth_kkultong`으로, `DATABASE_URL`의 마지막 DB 이름도 `youth_kkultong`으로 맞춘다. 자동 수집은 false로 유지한 뒤 아래 명령으로 API만 재생성한다. 접속 대상을 바꾸는 작업이므로 기존 DB를 초기화하거나 dump를 덮어쓸 필요가 없다. 복원 DB도 계속 보관한다.

```bash
docker compose -p youth-kkultong -f compose.yaml -f compose.local.yaml \
  up -d --no-deps --no-build --wait --wait-timeout 90 api
```

DB 컨테이너는 이 전환에서 재생성하지 않았다. 컨테이너의 초기 `POSTGRES_DB` 설정은 기존 값일 수 있지만, API의 실제 접속 대상은 전달된 `DATABASE_URL`로 결정된다. 두 데이터베이스는 같은 PostgreSQL의 기존 영구 볼륨 안에 유지된다. Step 41의 일일 자동 수집 활성화는 별도 요청 전까지 수행하지 않는다.
