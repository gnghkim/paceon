#!/usr/bin/env bash
# 개발 PC에서 최신(또는 지정한 날짜의) 백업을 내려받아 복호화하고, 운영과 같은 Postgres 이미지에 복원해 행 수와 내용을 비교한다.
# 설정: ~/.paceon/restore-check.env 에 BACKUP_REMOTE(읽기 전용 rclone 원격), AGE_IDENTITY(age 비밀키 파일), HC_RESTORE_URL.
set -euo pipefail
set -a
# shellcheck source=/dev/null
. "${RESTORE_CHECK_ENV:-$HOME/.paceon/restore-check.env}"
set +a
here="$(cd "$(dirname "$0")" && pwd)"
day="${1:-$(rclone lsf --dirs-only "$BACKUP_REMOTE/daily/" | sort | tail -n 1 | tr -d '/')}"
work="$(mktemp -d)"
name="paceon-restore-check"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

rclone copy "$BACKUP_REMOTE/daily/$day" "$work"
age -d -i "$AGE_IDENTITY" -o "$work/db.dump" "$work/db.dump.age"
# Storage 묶음도 풀리는지 본다. 파일 수를 적어 두면 전달과 비교할 수 있다.
files=$(age -d -i "$AGE_IDENTITY" "$work/storage.tar.age" | tar -tf - | grep -vc '/$' || true)
echo "Storage 묶음: 파일 ${files}개"
docker run -d --name "$name" -e POSTGRES_PASSWORD=restore-check supabase/postgres:17.6.1.136 \
  postgres -c config_file=/etc/postgresql/postgresql.conf >/dev/null
for _ in $(seq 60); do docker exec "$name" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break; sleep 2; done
# 이미지가 만든 Supabase 내부 객체와 겹치는 오류는 예상된다. 성공 여부는 마지막 비교가 정한다.
docker exec -i -e PGPASSWORD=restore-check "$name" pg_restore -U supabase_admin -h localhost --clean --if-exists -d postgres < "$work/db.dump" > "$work/restore.log" 2>&1 || true
docker exec -i -e PGPASSWORD=restore-check "$name" psql -U supabase_admin -h localhost -d postgres -X -At -f - < "$here/../migrate/counts.sql" > "$work/restored.csv"
node "$here/../migrate/verify-counts.mjs" "$work/counts.csv" "$work/restored.csv"
if [ -n "${HC_RESTORE_URL:-}" ]; then curl -fsS -m 10 --retry 3 "$HC_RESTORE_URL" >/dev/null; fi
echo "복원 연습 통과: $day"
