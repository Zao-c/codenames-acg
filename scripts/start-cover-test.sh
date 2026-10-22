#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
stage=${1:?absolute immutable compiled release required}
[[ "$stage" = /opt/codenames-releases/cover-* && -f "$stage/ARTIFACT_SHA256" ]]
(cd "$stage" && sha256sum -c ARTIFACT_SHA256 >/dev/null)
for port in 3195 3196 5395; do if ss -ltnH "sport = :$port" | grep -q .; then echo "Port $port occupied";exit 3;fi;done
run=/opt/codenames-test-runs/$(basename "$stage")
[[ ! -e "$run" ]]
mkdir -p "$run/data"
cp /opt/codenames-acg/apps/server/data/anime-imports.json "$run/data/imports.json"
cp "$stage/ARTIFACT_SHA256" "$run/ARTIFACT_SHA256.before"
cd "$stage"
node scripts/configure-cover-worker.mjs --from /opt/Animatch/animatch/.env.production --to "$run/cover.env" --cache "$run/cache" --port 3196 --resource "$stage/apps/server/resources/anime-catalog.json" --imports "$run/data/imports.json"
node scripts/sync-cos-cover-manifest.mjs --env "$run/cover.env"
server_pid='';cover_pid='';proxy_pid='';ready=0
cleanup(){ if [[ "$ready" = 0 ]]; then for p in "$server_pid" "$cover_pid" "$proxy_pid"; do [[ -z "$p" ]] || kill "$p" 2>/dev/null || true; done; fi; }
trap cleanup EXIT
cd "$stage/apps/server"
nohup env -i PATH=/usr/local/bin:/usr/bin:/bin NODE_ENV=production PORT=3195 CLIENT_ORIGIN=http://127.0.0.1:5395 USE_MEMORY_STORE=1 REDIS_URL='' ENABLE_ANIME_DRAFT=1 ENABLE_MATCH_ANALYSIS=1 ENABLE_PREDICTIONS=1 ENABLE_ANIME_COMMUNITY=1 SOAK_SERVER_METRICS="$run/server-metrics.jsonl" USER_STORE_FILE="$run/data/users.json" ANIME_POOL_STORE_FILE="$run/data/pools.json" ANIME_IMPORT_FILE="$run/data/imports.json" MANUAL_WORK_STORE_FILE="$run/data/manual.json" ANIME_COVER_DIR="$run/data/covers" REVEAL_IMAGE_DIR="$run/data/images" node --max-old-space-size=384 --import "$stage/scripts/soak-metrics.mjs" dist/apps/server/src/index.js > "$run/server.log" 2>&1 < /dev/null &
server_pid=$!;printf '%s\n' "$server_pid" > "$run/server.pid"
nohup env -i PATH=/usr/local/bin:/usr/bin:/bin NODE_ENV=production COVER_ENV_FILE="$run/cover.env" SOAK_SERVER_METRICS="$run/cover-metrics.jsonl" nice -n 10 node --max-old-space-size=192 --import "$stage/scripts/soak-metrics.mjs" dist/apps/server/src/cover-server.js > "$run/cover.log" 2>&1 < /dev/null &
cover_pid=$!;printf '%s\n' "$cover_pid" > "$run/cover.pid"
cd "$stage"
nohup env -i PATH=/usr/local/bin:/usr/bin:/bin SOAK_BACKEND_PORT=3195 SOAK_COVER_PORT=3196 SOAK_WEB_PORT=5395 node scripts/soak-static-proxy.mjs > "$run/proxy.log" 2>&1 < /dev/null &
proxy_pid=$!;printf '%s\n' "$proxy_pid" > "$run/proxy.pid"
for n in $(seq 1 60); do kill -0 "$server_pid" "$cover_pid" "$proxy_pid";if curl -fsS http://127.0.0.1:3195/health > "$run/health.json" && curl -fsS http://127.0.0.1:3196/health > "$run/cover-health.json" && curl -fsS http://127.0.0.1:5395/ >/dev/null;then ready=1;break;fi;sleep 1;done
[[ "$ready" = 1 ]]
echo "RUN=$run SERVER_PID=$server_pid COVER_PID=$cover_pid PROXY_PID=$proxy_pid"
