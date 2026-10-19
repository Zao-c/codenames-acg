#!/usr/bin/env bash
# An isolated instance of the exact deployed compiled artifacts. No production
# accounts, room store, uploads, environment file or service are used or changed.
set -Eeuo pipefail
umask 077
stage=${1:?absolute immutable release directory required}
[[ "$stage" = /opt/codenames-releases/staged-draft-* && -d "$stage" && ! -f "$stage/apps/server/.env" ]]
[[ -f "$stage/ARTIFACT_SHA256" && -f "$stage/scripts/soak-metrics.mjs" ]]
(cd "$stage" && sha256sum -c ARTIFACT_SHA256 >/dev/null)
for port in 3194 5394; do
  if ss -ltnH "sport = :$port" | grep -q .; then echo "Test port $port is occupied"; exit 3; fi
done
run=/opt/codenames-test-runs/$(basename "$stage")
[[ ! -e "$run" ]]
mkdir -p "$run/data"
printf '%s\n' "$stage" > "$run/release-directory.txt"
cp "$stage/ARTIFACT_SHA256" "$run/ARTIFACT_SHA256.before"
server_pid=''; proxy_pid=''; ready=0
cleanup(){
  if [[ "$ready" = 0 ]]; then
    [[ -z "$server_pid" ]] || kill "$server_pid" 2>/dev/null || true
    [[ -z "$proxy_pid" ]] || kill "$proxy_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
cd "$stage/apps/server"
nohup env -i PATH=/usr/local/bin:/usr/bin:/bin NODE_ENV=production PORT=3194 CLIENT_ORIGIN=http://127.0.0.1:5394 USE_MEMORY_STORE=1 REDIS_URL='' ENABLE_ANIME_DRAFT=1 ENABLE_MATCH_ANALYSIS=1 ENABLE_PREDICTIONS=1 ENABLE_ANIME_COMMUNITY=1 SOAK_SERVER_METRICS="$run/server-metrics.jsonl" USER_STORE_FILE="$run/data/users.json" ANIME_POOL_STORE_FILE="$run/data/pools.json" ANIME_IMPORT_FILE="$run/data/imports.json" MANUAL_WORK_STORE_FILE="$run/data/manual.json" ANIME_COVER_DIR="$run/data/covers" REVEAL_IMAGE_DIR="$run/data/images" node --max-old-space-size=384 --import "$stage/scripts/soak-metrics.mjs" dist/apps/server/src/index.js > "$run/server.log" 2>&1 < /dev/null &
server_pid=$!; printf '%s\n' "$server_pid" > "$run/server.pid"
cd "$stage"
nohup env -i PATH=/usr/local/bin:/usr/bin:/bin SOAK_BACKEND_PORT=3194 SOAK_WEB_PORT=5394 node scripts/soak-static-proxy.mjs > "$run/proxy.log" 2>&1 < /dev/null &
proxy_pid=$!; printf '%s\n' "$proxy_pid" > "$run/proxy.pid"
for n in $(seq 1 40); do
  kill -0 "$server_pid" "$proxy_pid"
  if curl -fsS http://127.0.0.1:3194/health > "$run/health.json" && curl -fsS http://127.0.0.1:5394/ > "$run/index.html"; then ready=1; break; fi
  sleep 1
done
[[ "$ready" = 1 ]]
echo "ISOLATED_RUN=$run"
echo "SERVER_PID=$server_pid PROXY_PID=$proxy_pid"
