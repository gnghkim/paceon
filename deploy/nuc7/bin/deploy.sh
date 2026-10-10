#!/usr/bin/env bash
# 5분마다 새 main 이미지를 당겨 오고, 이미지가 바뀐 컨테이너만 다시 만든다. compose·Envoy 설정은 바꾸지 않는다.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
services=(web)
if [ "${PACEON_WORKER:-off}" = "on" ]; then services+=(ai-worker); fi
"$here/compose" pull --quiet "${services[@]}"
"$here/compose" up -d --no-deps "${services[@]}"
docker image prune -f --filter "until=168h" >/dev/null
# 공개 주소로 Tunnel·Envoy·Auth까지 닿을 때만 신호를 보낸다. 신호가 끊기면 healthchecks.io가 메일을 보낸다.
curl -fsS -m 10 -H "apikey: ${ANON_KEY:?}" "${SUPABASE_PUBLIC_URL:?}/auth/v1/health" >/dev/null
if [ -n "${HC_DEPLOY_URL:-}" ]; then curl -fsS -m 10 --retry 3 "$HC_DEPLOY_URL" >/dev/null; fi
