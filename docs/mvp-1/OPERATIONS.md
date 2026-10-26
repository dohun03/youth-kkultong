# MVP1 실행·백업·복원 지침

기준: `ARCHITECTURE.md` 7장, `SPEC.md` 2·4·5장. 아래 명령은 저장소 루트의 Bash에서 실행한다. 실제 검증 결과는 `SUMMARY.md`의 Step 56 기록을 참고한다.

## 1. 환경 준비와 최초 실행

Docker Engine와 Docker Compose가 필요하다. 호스트에 Node.js·PostgreSQL을 설치하지 않아도 컨테이너에서 빌드·Migration·수집을 실행할 수 있다.

- `.env`가 없다면 `.env.example`을 복사하고 `POSTGRES_PASSWORD`와 실제 `YOUTH_CENTER_API_KEY`를 편집기로 입력한다. 기존 `.env`는 덮어쓰지 않는다. 비밀번호는 예시 설명대로 URL에 사용할 수 있는 영문·숫자로 설정한다.
- 조회·Migration·지역 시드는 인증키 없이 실행할 수 있지만 실제 수집에는 제품용 인증키가 필요하다. `.env`는 권한 `600`으로 보관하고 Git에 추가하지 않는다.
- 아래 `dc` 배열은 기존 프로젝트명과 볼륨을 유지한다. DBeaver 접속도 필요하면 배열 마지막에 `-f compose.local.yaml`을 추가한다. 이 경우 DB 접속 주소는 `127.0.0.1:5433`이다. 모든 후속 명령에 같은 배열을 사용한다.

```bash
chmod 600 .env
dc=(docker compose -p youth-kkultong -f compose.yaml)
"${dc[@]}" build api web
"${dc[@]}" up -d --wait --wait-timeout 60 db
"${dc[@]}" run --rm --no-deps api npm run migration:run --workspace apps/api
"${dc[@]}" run --rm --no-deps api npm run seed:regions --workspace apps/api
"${dc[@]}" up -d --wait --wait-timeout 60
"${dc[@]}" exec -T api npm run migration:show --workspace apps/api
```

정상 기준은 `web`·`api`·`db` 모두 `healthy`, Migration 2개 `[X]`, 공식 지역 537개다. API health만으로 테이블·시드 준비 상태까지 확인할 수 없으므로 마이그레이션·지역 시드를 생략한 채 health만으로 준비 완료를 판단하지 않는다. `synchronize=false`, `migrationsRun=false`이므로 테이블은 명시적 명령으로 준비한다.

```bash
"${dc[@]}" ps --format '{{.Service}} {{.State}} {{.Health}}'
curl --fail --silent http://localhost:4000/api/v1/health
curl --fail --silent -H 'Content-Type: application/json' \
  -d '{}' http://localhost:3000/api/v1/policies/search
```

최초 빈 DB는 검색 200·`items=[]`·`total=0`이 정상이다. 웹은 `http://localhost:3000/policies`에서 확인한다.

## 2. 실제 수집과 재기동

```bash
"${dc[@]}" exec -T api npm run import:policies --workspace apps/api
```

수집은 첫 페이지부터 전체를 순차 호출하므로 수 분 걸릴 수 있다. 설정된 페이지 크기·호출 간격·재시도 한도를 유지한다. 종료 코드 `0`은 성공, `1`은 실패, `2`는 이미 다른 수집이 진행 중임을 뜻한다. 실패하면 로그의 단계·원인을 먼저 확인한다. 성공 여부와 저장 여부는 `/app/logs/policies-import.jsonl`의 마지막 해당 실행 `RUN_FINISHED`에서 `status=SUCCESS`, `saved=true`로 확인한다. `NEW/CHANGED/UNCHANGED` 합계는 이번 수집 응답 건수이며 수집 밖 기존 정책은 삭제하지 않는다. 수집 실패/복구 규칙은 SPEC 5장을 따른다.

```bash
"${dc[@]}" exec -T api tail -n 1 /app/logs/policies-import.jsonl
"${dc[@]}" exec -T db psql -U youth_kkultong -d youth_kkultong -Atc \
  'SELECT count(*) FROM policies; SELECT count(*) FROM (SELECT source,external_id FROM policies GROUP BY source,external_id HAVING count(*)>1) d;'
curl --fail --silent -H 'Content-Type: application/json' \
  -d '{"conditions":{"age":28,"regionCode":"11000"}}' \
  http://localhost:3000/api/v1/policies/search
```

재기동은 백업 후 아래처럼 컨테이너만 재생성한다. 기존 `youth-kkultong_db_data`와 `youth-kkultong_ingestion_logs` 볼륨은 같은 프로젝트명으로 다시 연결된다. `down`도 기본적으로 명명 볼륨은 유지하지만 **운영 프로젝트에 `down --volumes`나 `down -v`를 사용하지 않는다.** 볼륨 삭제·초기화는 재기동 절차가 아니다.

```bash
"${dc[@]}" up -d --no-build --force-recreate --wait --wait-timeout 60
"${dc[@]}" exec -T api npm run migration:run --workspace apps/api
```

이미 적용된 Migration은 `No migrations are pending`으로 끝나야 한다. 재생성 전후에는 정책·지역 건수와 전체 행 체크섬, 로그 SHA-256을 비교한다. 수집이나 다른 쓰기 작업이 없는 동안 아래 쿼리를 사용한다.

```bash
"${dc[@]}" exec -T db psql -U youth_kkultong -d youth_kkultong -Atc \
  "SELECT count(*),md5(string_agg(row_to_json(p)::text,'' ORDER BY id)) FROM policies p; SELECT count(*),md5(string_agg(row_to_json(r)::text,'' ORDER BY code)) FROM regions r;"
"${dc[@]}" exec -T api sha256sum /app/logs/policies-import.jsonl
```

## 3. DB·수집 로그 백업

기본 보관 경로는 호스트의 `backups/<한국 날짜와 시각>/`이다. 수집·Migration이 끝난 뒤 매일 운영 백업과 변경 전 백업을 수행한다. 자동 스케줄·보관 기한은 아직 구성하지 않았으며 아래는 수동 실행 절차다. 호스트 장애에도 복구하려면 완료된 백업 묶음을 별도 저장소에도 보관해야 한다. 이번 Step은 로컬 파일 생성·복원까지 검증했다.

아래 명령은 하나씩 성공 여부를 확인한 뒤 다음 명령을 실행한다.

DB는 PostgreSQL 17 컨테이너의 `pg_dump` custom 형식으로 전체 스키마·데이터·Migration 이력을 저장한다. `/app/logs`는 `ingestion_logs` 볼륨에 있으므로 별도 tar로 보관한다. 인증키·비밀번호·`.env`는 백업 묶음에 넣지 않고 별도로 관리한다.

```bash
umask 077
backup_dir="backups/$(TZ=Asia/Seoul date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
"${dc[@]}" exec -T db pg_dump -U youth_kkultong -d youth_kkultong \
  -Fc --no-owner --no-acl > "$backup_dir/production.dump.partial" && \
  mv "$backup_dir/production.dump.partial" "$backup_dir/production.dump"
"${dc[@]}" exec -T api tar -C /app/logs -cf - . > "$backup_dir/ingestion-logs.tar.partial" && \
  mv "$backup_dir/ingestion-logs.tar.partial" "$backup_dir/ingestion-logs.tar"
(cd "$backup_dir" && sha256sum production.dump ingestion-logs.tar > SHA256SUMS)
(cd "$backup_dir" && sha256sum -c SHA256SUMS)
"${dc[@]}" exec -T db pg_restore --list < "$backup_dir/production.dump"
```

실패한 `.partial`은 복원에 사용하지 않는다. `pg_restore --list`와 파일 해시 확인만으로 복원 가능성이 증명되지는 않으므로 4장의 별도 DB 복원·조회까지 확인한다. `backups/`와 `logs/`는 Git 및 Docker 빌드 컨텍스트에서 제외된다.

## 4. 깨끗한 환경과 복원 검증

운영 컨테이너·볼륨을 초기화하지 않고 별도 프로젝트 `youth-kkultong-step56`을 사용한다. 같은 이름의 검증 프로젝트가 이미 있으면 먼저 용도·데이터를 확인하고 다른 새 프로젝트명을 선택한다. 포트 `3300`·`4400`도 비어 있어야 한다. Compose의 `!override`를 지원하는 버전이 필요하며 이번 검증은 Compose 5.4.0을 사용했다.

아래 파일에는 비밀값을 직접 적지 않는다. 별도 프로젝트의 기본 이미지 이름이 달라지므로 1장에서 빌드한 이미지 이름을 명시한다.

```bash
cat > /tmp/step56-compose.yaml <<'YAML'
services:
  web:
    image: youth-kkultong-web:latest
    ports: !override
      - "127.0.0.1:3300:3000"
  api:
    image: youth-kkultong-api:latest
    ports: !override
      - "127.0.0.1:4400:4000"
    environment:
      API_CORS_ORIGINS: http://localhost:3300,http://127.0.0.1:3300
YAML
check=(docker compose --env-file "$PWD/.env" -p youth-kkultong-step56 \
  -f "$PWD/compose.yaml" -f /tmp/step56-compose.yaml)
"${check[@]}" up -d --no-build --wait --wait-timeout 60 db
"${check[@]}" run --rm --no-deps api npm run migration:run --workspace apps/api
"${check[@]}" run --rm --no-deps api npm run seed:regions --workspace apps/api
"${check[@]}" up -d --no-build --wait --wait-timeout 60
"${check[@]}" exec -T api npm run import:policies --workspace apps/api
```

빈 DB의 초기 실행을 확인한 뒤, 백업을 같은 검증용 PostgreSQL의 **새로운 빈 DB**에 복원한다.

```bash
# backup_dir は3章で作成した、確認済みのバックアップディレクトリを指定する。
(cd "$backup_dir" && sha256sum -c SHA256SUMS)
"${check[@]}" exec -T db createdb -U youth_kkultong -T template0 youth_kkultong_restore56
"${check[@]}" exec -T db pg_restore -U youth_kkultong -d youth_kkultong_restore56 \
  --exit-on-error --no-owner --no-acl < "$backup_dir/production.dump"
```

`createdb`가 기존 DB 때문에 실패하면 덮어쓰지 않고 다른 새 이름을 사용한다. 이 절차는 `--clean`·`dropdb`를 사용하지 않는다. 백업에 테이블이 포함되므로 복원 전에 Migration·시드를 실행하지 않는다.

```bash
cat > /tmp/step56-recovery.yaml <<'YAML'
services:
  api:
    environment:
      DATABASE_URL: "postgresql://youth_kkultong:${POSTGRES_PASSWORD:?비밀번호 필요}@db:5432/youth_kkultong_restore56"
YAML
recovery=("${check[@]}" -f /tmp/step56-recovery.yaml)
"${recovery[@]}" up -d --no-build --no-deps --force-recreate --wait --wait-timeout 60 api web
"${recovery[@]}" exec -T api npm run migration:show --workspace apps/api
"${recovery[@]}" exec -T db psql -U youth_kkultong -d youth_kkultong_restore56 -Atc \
  "SELECT count(*),md5(string_agg(row_to_json(p)::text,'' ORDER BY id)) FROM policies p; SELECT count(*),md5(string_agg(row_to_json(r)::text,'' ORDER BY code)) FROM regions r;"
curl --fail --silent -H 'Content-Type: application/json' \
  -d '{"conditions":{"age":28,"regionCode":"11000"}}' \
  http://localhost:3300/api/v1/policies/search
```

복원 전 백업 원본과 정책·지역·Migration 이력의 건수/전체 행 체크섬이 같아야 한다. 중복 `(source, external_id)`는 0건이어야 한다. 웹 `http://localhost:3300/policies`, API 직접 주소 `http://localhost:4400`에서 목록·지역 맞춤순·정책 상세 200도 확인한다. 정상 복구를 확인한 뒤에만 실제 서비스의 복구 대상을 결정한다. 이 검증 절차는 운영 DB 접속 대상을 바꾸지 않는다.

로그는 원본 로그를 덮어쓰지 않고 별도 폴더에 먼저 추출해 원본 파일의 해시와 비교한다.

```bash
"${check[@]}" exec -T api sh -c 'mkdir -p /app/logs/restore-check && tar -C /app/logs/restore-check -xf -' \
  < "$backup_dir/ingestion-logs.tar"
"${check[@]}" exec -T api sha256sum /app/logs/restore-check/policies-import.jsonl
```

검증이 끝나면 `"${check[@]}" down`으로 검증 컨테이너를 정리한다. 검증 볼륨은 운영 볼륨과 이름이 다르며, 이번 실행에서 만든 테스트 데이터만 있는지 확인한 후 별도로 삭제할 수 있다. 백업 파일은 삭제하지 않는다.

## 5. 로그·비밀값 점검과 장애 확인

- 수집 로그는 `/app/logs/policies-import.jsonl`, 볼륨은 `<프로젝트명>_ingestion_logs`다. 일반 API 출력은 `docker compose logs`로 확인한다. 원본 정책 응답·사용자 검색 조건·인증키·DB URL을 로그에 추가하지 않는다.
- 키는 런타임 환경변수로만 주입하며 Docker 빌드 인자·이미지 ENV·소스 파일에 넣지 않는다. `.env`, `.aws`, `.codex`, 백업은 빌드 컨텍스트에서 제외한다. `docker compose config`, 컨테이너 `inspect`/`env` 전체 출력에는 런타임 비밀값이 포함될 수 있으므로 채팅·문서·로그에 복사하지 않는다. Docker 관리자 권한은 환경변수를 읽을 수 있다.
- API 200만이 아니라 검색·지역 메타·상세 응답을 확인한다. DB 연결 실패는 DB healthy 여부와 설정, 검색 테이블 오류는 `migration:show`, 지역 목록이 비어 있으면 시드 완료 여부를 확인한다.
- 수집 실패 시 임의로 DB나 볼륨을 지우지 않는다. 마지막 실행의 로그 단계·페이지·시도 횟수·저장 여부를 확인하고 원인을 해결한 뒤 재실행한다. 세부 실패·잠금 해제 규칙은 SPEC 5.4를 따른다.
