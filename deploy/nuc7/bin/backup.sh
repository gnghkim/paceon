#!/usr/bin/env bash
# 매일 DB 전체와 Storage 파일을 age로 암호화해 R2에 올린다. 복호화 키는 이 서버에 없다.
# 행 수 파일(counts.csv)은 암호화하지 않고 함께 올린다. 월간 복원 연습이 이것과 비교한다.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
: "${BACKUP_REMOTE:?}" "${BACKUP_AGE_RECIPIENT:?}" "${PACEON_DATA:?}"
day="$(TZ=Asia/Seoul date +%F)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

counts() { "$here/compose" exec -T db psql -U supabase_admin -h localhost -X -At -v ON_ERROR_STOP=1 -f - < "$here/../migrate/counts.sql"; }
# 행 수 파일은 덤프와 같은 순간의 것이어야 복원 연습이 맞는다. 덤프 전후가 다르면(그사이 쓰기) 조금 기다려 다시 뜬다.
for attempt in 1 2 3; do
  counts > "$work/counts.csv"
  "$here/compose" exec -T db pg_dump -U supabase_admin -h localhost -Fc postgres > "$work/db.dump"
  counts > "$work/counts.after.csv"
  cmp -s "$work/counts.csv" "$work/counts.after.csv" && break
  if [ "$attempt" = 3 ]; then echo "백업하는 동안 DB가 계속 바뀌었습니다. 나중에 다시 하세요." >&2; exit 1; fi
  sleep 20
done
rm -f "$work/counts.after.csv"
"$here/compose" exec -T db pg_restore --list < "$work/db.dump" > /dev/null
tar -C "$PACEON_DATA" -cf "$work/storage.tar" storage
tar -tf "$work/storage.tar" > /dev/null

age -r "$BACKUP_AGE_RECIPIENT" -o "$work/db.dump.age" "$work/db.dump"
age -r "$BACKUP_AGE_RECIPIENT" -o "$work/storage.tar.age" "$work/storage.tar"
rm -f "$work/db.dump" "$work/storage.tar"

rclone copy "$work" "$BACKUP_REMOTE/daily/$day"
if [ "$(TZ=Asia/Seoul date +%d)" = "01" ]; then rclone copy "$work" "$BACKUP_REMOTE/monthly/$(TZ=Asia/Seoul date +%Y-%m)"; fi
if [ -n "${HC_BACKUP_URL:-}" ]; then curl -fsS -m 10 --retry 3 "$HC_BACKUP_URL" >/dev/null; fi
echo "백업 완료: $BACKUP_REMOTE/daily/$day"
