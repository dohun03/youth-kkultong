# MVP2 검수 데이터 백업과 복원 지침

기준: SPEC 2.4, 5.5 및 T2-49. 저장소 루트의 Bash에서 실행한다. 실제 결과는 SUMMARY 45장에 기록한다. 초기 설치와 일반 재기동은 [MVP1 운영 지침](../mvp-1/OPERATIONS.md), 자동 수집의 활성화와 장애 확인은 SUMMARY 44장을 따른다.

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
