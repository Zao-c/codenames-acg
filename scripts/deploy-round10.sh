#!/usr/bin/env bash
# Run as root on the configured server after local review/tests and bundle upload.
set -Eeuo pipefail
umask 077
sha=${1:?commit SHA required}
bundle=${2:?absolute bundle path required}
expected=${3:-59f2bd1aad922bad41d42b63ca0857b0102ad0b1}
[[ "$sha" =~ ^[0-9a-f]{40}$ && "$expected" =~ ^[0-9a-f]{40}$ && "$bundle" = /opt/* ]] || exit 2
repo=/opt/codenames-acg
stage=/opt/codenames-releases/round10-${sha:0:12}-$(date -u +%Y%m%dT%H%M%SZ)
backup=/opt/codenames-backups/round10-$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:12}
old=$(git -C "$repo" rev-parse HEAD)
[[ "$old" = "$expected" ]] || { echo 'Production HEAD changed; refusing overwrite'; exit 3; }
[[ -z "$(git -C "$repo" status --porcelain --untracked-files=no)" ]] || { echo 'Tracked production changes exist'; exit 3; }
git -C "$repo" bundle verify "$bundle"
git -C "$repo" fetch "$bundle" "refs/heads/codex/cipai-round10-v2:refs/remotes/round10-review/head"
[[ "$(git -C "$repo" rev-parse refs/remotes/round10-review/head)" = "$sha" ]]
git -C "$repo" merge-base --is-ancestor "$old" "$sha"
[[ ! -e "$stage" ]]
mkdir -p "$stage" "$backup"
chmod 755 "$stage"
git -C "$repo" archive "$sha" | tar -x -C "$stage"
cmp "$repo/package-lock.json" "$stage/package-lock.json"
cp -a "$repo/node_modules" "$stage/node_modules"
for name in shared server web; do
  link="$stage/node_modules/@acg-codenames/$name"
  [[ -L "$link" ]]
  if [[ "$name" = shared ]]; then target=../../packages/shared; else target=../../apps/$name; fi
  ln -sfn "$target" "$link"
done
(cd "$stage" && env -u VITE_SERVER_URL npm run build > build.log 2>&1 && node --check apps/server/dist/index.js && find apps/server/dist apps/web/dist packages/shared/dist -type f -print0 | sort -z | xargs -0 sha256sum > ARTIFACT_SHA256)
chmod -R a+rX "$stage/apps/web/dist" "$stage/apps/server/dist" "$stage/packages/shared/dist"
# Prepare code-only rollback before stopping, even if a later data backup fails.
cp "$repo/release.json" "$backup/release.json.before"
printf '%s\n' "$old" > "$backup/previous-sha.txt"
mkdir -p "$backup/code"
for part in apps/server/dist apps/web/dist packages/shared/dist; do mkdir -p "$backup/code/$(dirname "$part")"; cp -a "$repo/$part" "$backup/code/$part"; done
python3 - "$repo" "$backup" <<'PY'
import os,pathlib,json,subprocess,sys
repo,backup=sys.argv[1:]
pid=subprocess.check_output(['systemctl','show','codenames.service','-p','MainPID','--value'],text=True).strip()
cwd=os.readlink('/proc/'+pid+'/cwd')
values=dict(item.decode().split('=',1) for item in pathlib.Path('/proc/'+pid+'/environ').read_bytes().split(b'\0') if b'=' in item)
for line in pathlib.Path(cwd,'.env').read_text().splitlines():
 if '=' in line and not line.lstrip().startswith('#'):
  k,v=line.split('=',1);values.setdefault(k.strip(),v.strip().strip('"\''))
defaults={'USER_STORE_FILE':'apps/server/data/users.json','ANIME_POOL_STORE_FILE':'apps/server/data/anime-pools.json','ANIME_IMPORT_FILE':'apps/server/data/anime-imports.json','MANUAL_WORK_STORE_FILE':'apps/server/data/manual-works.json','ANIME_COVER_DIR':'apps/server/data/anime-covers','REVEAL_IMAGE_DIR':'apps/server/data/reveal-images'}
paths={k:os.path.realpath(os.path.join(cwd,values.get(k,v))) for k,v in defaults.items()}
assert all(os.path.commonpath([repo,v])==repo for v in paths.values()), 'External data path requires extending the backup before deployment'
pathlib.Path(backup,'durable-paths.json').write_text(json.dumps(paths,indent=2)+'\n')
PY
smoke_pid=''; stopped=0; complete=0
rollback(){
  code=$?
  trap - ERR EXIT
  if [[ -n "$smoke_pid" ]]; then kill "$smoke_pid" 2>/dev/null || true; wait "$smoke_pid" 2>/dev/null || true; fi
  if [[ "$stopped" = 1 && "$complete" = 0 ]]; then
    systemctl stop codenames.service || true
    git -C "$repo" checkout --detach "$old"
    for part in apps/server/dist apps/web/dist packages/shared/dist; do
      [[ -d "$backup/code/$part" && ! -L "$repo/$part" ]]
      rsync -a --delete "$backup/code/$part/" "$repo/$part/"
    done
    cp "$backup/release.json.before" "$repo/release.json"
    systemctl start codenames.service
    echo "Code rollback to $old; user data was not restored from an old snapshot"
  fi
  exit "$code"
}
trap rollback ERR EXIT
mkdir -p "$stage/smoke-data"
(cd "$stage" && PORT=3199 USE_MEMORY_STORE=1 REDIS_URL='' ENABLE_ANIME_DRAFT=1 ENABLE_MATCH_ANALYSIS=1 USER_STORE_FILE="$stage/smoke-data/users.json" ANIME_POOL_STORE_FILE="$stage/smoke-data/pools.json" ANIME_IMPORT_FILE="$stage/smoke-data/imports.json" MANUAL_WORK_STORE_FILE="$stage/smoke-data/manual.json" ANIME_COVER_DIR="$stage/smoke-data/covers" REVEAL_IMAGE_DIR="$stage/smoke-data/images" exec node apps/server/dist/index.js) > "$stage/smoke.log" 2>&1 &
smoke_pid=$!
for n in $(seq 1 60); do kill -0 "$smoke_pid"; if curl -fsS http://127.0.0.1:3199/health > /dev/null; then break; fi; sleep 1; done
curl -fsS http://127.0.0.1:3199/health > "$backup/linux-smoke-health.json"
kill "$smoke_pid"; wait "$smoke_pid" || true; smoke_pid=''
# Recheck immediately before stopping; never clear a live real room.
python3 - <<'PY'
import json,urllib.request
assert json.load(urllib.request.urlopen('http://127.0.0.1:3001/rooms'))==[], 'Active rooms: deployment refused'
PY
[[ "$(git -C "$repo" rev-parse HEAD)" = "$old" ]]
[[ -z "$(git -C "$repo" status --porcelain --untracked-files=no)" ]]
stopped=1
systemctl stop codenames.service
tar -czf "$backup/app-before.tar.gz" --exclude='./.git' --exclude='./node_modules' -C "$repo" .
tar -tzf "$backup/app-before.tar.gz" > "$backup/archive-contents.txt"
system_paths=(etc/systemd/system/codenames.service etc/nginx)
if [[ -d /etc/systemd/system/codenames.service.d ]]; then system_paths+=(etc/systemd/system/codenames.service.d); fi
tar -czf "$backup/system-before.tar.gz" -C / "${system_paths[@]}"
(cd "$backup" && sha256sum app-before.tar.gz system-before.tar.gz > SHA256SUMS && sha256sum -c SHA256SUMS)
(cd "$repo" && find apps/server/data apps/server/apps/server/data -type f -print0 | sort -z | xargs -0 sha256sum > "$backup/data-before.sha256")
git -C "$repo" checkout --detach "$sha"
for part in apps/server/dist apps/web/dist packages/shared/dist; do
  [[ -d "$stage/$part" && ! -L "$repo/$part" ]]
  rsync -a --delete "$stage/$part/" "$repo/$part/"
done
(cd "$repo" && sha256sum -c "$backup/data-before.sha256" > "$backup/data-verified.txt" && sha256sum -c "$stage/ARTIFACT_SHA256" > "$backup/artifacts-verified.txt")
python3 - "$repo" "$sha" "$old" "$backup" <<'PY'
import json,sys,datetime,pathlib
repo,sha,old,backup=sys.argv[1:]
pathlib.Path(repo,'release.json').write_text(json.dumps({'sha':sha,'branch':'detached','sourceBranch':'codex/cipai-round10-v2','previousSha':old,'backupPath':backup,'deployedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'feature':'round10-v2-lobby-settings-uniform-reveals','memoryRoomsCleared':False},indent=2)+'\n')
PY
curl -fsS -H 'Host: 182.61.136.105' http://127.0.0.1/ > "$backup/index-after.html"
python3 - "$repo" "$backup" <<'PY'
import sys,re,pathlib,urllib.request
repo,backup=sys.argv[1:]
page=pathlib.Path(backup,'index-after.html').read_text()
assets=re.findall(r'(?:src|href)="(/assets/[^\"]+)"',page)
assert assets and '<title>' in page, 'Production HTML did not reference the staged assets'
for asset in assets:
 assert pathlib.Path(repo,'apps/web/dist',asset.lstrip('/')).is_file()
 assert urllib.request.urlopen(urllib.request.Request('http://127.0.0.1'+asset,headers={'Host':'182.61.136.105'})).status==200
PY
systemctl start codenames.service
for n in $(seq 1 40); do if curl -fsS http://127.0.0.1:3001/health > "$backup/health-after.json"; then break; fi; sleep 1; done
systemctl is-active --quiet codenames.service
curl -fsS http://127.0.0.1:3001/health > "$backup/health-after.json"
complete=1
echo "DEPLOYED_SHA=$sha"
echo "BACKUP=$backup"
echo "MAIN_PID=$(systemctl show codenames.service -p MainPID --value)"
