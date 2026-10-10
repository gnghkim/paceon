#!/usr/bin/env bash
# 원본 Supabase에서 PaceOn이 지키는 데이터만 덤프한다: 앱 스키마 전부와 auth의 사용자·연결 정보.
# 세션과 토큰은 옛 JWT secret으로 서명되어 쓸 수 없으니 옮기지 않는다.
# 사용법: deploy/nuc7/migrate/dump.sh --linked <out-dir>
#         deploy/nuc7/migrate/dump.sh --local <out-dir>
#         deploy/nuc7/migrate/dump.sh --db-url <url> <out-dir>   (되돌릴 때 nuc7을 원본으로, ssh 터널)
set -euo pipefail
usage() { echo "사용법: dump.sh --linked|--local <out-dir> 또는 dump.sh --db-url <url> <out-dir>" >&2; exit 2; }
case "${1:-}" in
  --linked|--local) source=("$1"); out="${2:-}" ;;
  --db-url) source=(--db-url "${2:-}"); out="${3:-}" ;;
  *) usage ;;
esac
[ -n "$out" ] || usage
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$out"

counts() { supabase db query "${source[@]}" -o csv -f "$here/counts.sql"; }
counts > "$out/counts.csv"

exclude=$(supabase db query "${source[@]}" -o csv "select string_agg('auth.' || tablename, ',' order by tablename) as t from pg_tables where schemaname = 'auth' and tablename not in ('users', 'identities')" | tail -n 1 | tr -d '"\r')
[[ "$exclude" =~ ^auth\.[a-z_]+(,auth\.[a-z_]+)*$ ]] || { echo "auth 제외 목록을 읽지 못했습니다." >&2; exit 1; }

supabase db dump "${source[@]}" --data-only --use-copy -s auth -x "$exclude" -f "$out/auth.sql"
supabase db dump "${source[@]}" --data-only --use-copy -s public,private,learning_private -f "$out/app.sql"
supabase db query "${source[@]}" -o csv "select bucket_id, name, owner::text as owner, owner_id from storage.objects order by bucket_id, name" > "$out/objects.csv"

counts > "$out/counts.after.csv"
node "$here/verify-counts.mjs" "$out/counts.csv" "$out/counts.after.csv" >/dev/null \
  || { echo "덤프하는 동안 원본이 바뀌었습니다. 원본을 쓰는 것(Worker, 앱)을 멈추고 다시 덤프하세요." >&2; exit 1; }
grep -q 'COPY "auth"."users"\|COPY auth.users' "$out/auth.sql" || { echo "auth.sql에 사용자 행이 없습니다." >&2; exit 1; }
files=$(( $(grep -c . "$out/objects.csv" || true) - 1 )); [ "$files" -lt 0 ] && files=0
echo "덤프 완료: $out (테이블 $(( $(grep -c . "$out/counts.csv") - 1 ))개, Storage 파일 ${files}개)"
