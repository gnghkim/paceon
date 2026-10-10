#!/usr/bin/env bash
# dump.sh의 결과를 대상 DB에 한 트랜잭션으로 넣는다. 트리거를 꺼서(replica) 옮기는 행이 바뀌지 않게 한다.
# 대상에 이미 행이 있으면 멈춘다. 리허설을 지우고 다시 넣을 때만 --reset을 준다.
# 사용법: TARGET_PSQL="<psql 명령>" deploy/nuc7/migrate/restore.sh <dump-dir> [--reset]
#   nuc7:  TARGET_PSQL="ssh nuc7 /opt/paceon/src/deploy/nuc7/bin/compose exec -T db psql -U supabase_admin -h localhost"
set -euo pipefail
dir="${1:?덤프 폴더를 주세요}"; reset="${2:-}"
: "${TARGET_PSQL:?TARGET_PSQL을 정하세요}"
here="$(cd "$(dirname "$0")" && pwd)"
target() { $TARGET_PSQL -X -q -v ON_ERROR_STOP=1 "$@"; }

filled=$(target -At -f - < "$here/counts.sql" | awk -F, '$2 > 0' | wc -l)
if [ "$filled" -gt 0 ] && [ "$reset" != "--reset" ]; then
  echo "대상에 행이 있는 테이블이 ${filled}개 있습니다. 리허설 데이터를 지우고 다시 넣으려면 --reset을 주세요." >&2
  exit 1
fi
# 덤프 파일이 끝에서 세션 설정을 되돌릴 수 있으므로(RESET ALL 등) 파일마다 앞에 다시 끈다.
{
  echo "set session_replication_role = replica;"
  if [ "$reset" = "--reset" ]; then cat "$here/reset.sql"; fi
  cat "$dir/auth.sql"
  echo "set session_replication_role = replica;"
  cat "$dir/app.sql"
} | target -1 -f -
target -At -f - < "$here/counts.sql" > "$dir/counts.target.csv"
node "$here/verify-counts.mjs" "$dir/counts.csv" "$dir/counts.target.csv"
