#!/usr/bin/env bash
# Frontend-only publication: keep the game process, live rooms and old hashed assets.
set -Eeuo pipefail
umask 077
sha=${1:?reviewed SHA required}
stage=${2:?tested release directory required}
expected=${3:?expected production HEAD required}
repo=/opt/codenames-acg
[[ "$sha" =~ ^[0-9a-f]{40}$ && "$expected" =~ ^[0-9a-f]{40}$ ]]
[[ "$stage" = /opt/codenames-releases/staged-draft-${sha:0:12}-* && -d "$stage/apps/web/dist/assets" ]]
[[ "$(git -C "$repo" rev-parse HEAD)" = "$expected" ]]
[[ -z "$(git -C "$repo" status --porcelain --untracked-files=no)" ]]
git -C "$repo" merge-base --is-ancestor "$expected" "$sha"
[[ -z "$(git -C "$repo" diff "$expected" "$sha" -- apps/server packages/shared package.json package-lock.json)" ]] || { echo 'Runtime source changed; frontend-only release refused'; exit 3; }
[[ -f "$stage/ARTIFACT_SHA256" ]]
(cd "$stage" && sha256sum -c ARTIFACT_SHA256 >/dev/null)
# Verify that the tested backend and shared artifacts are byte-for-byte the live version.
(cd "$stage" && find apps/server/dist packages/shared/dist -type f -print0 | sort -z | xargs -0 sha256sum) > "$stage/RUNTIME_SHA256"
(cd "$repo" && sha256sum -c "$stage/RUNTIME_SHA256" >/dev/null)
[[ ! -L "$repo/apps/web/dist" && -z "$(find "$stage/apps/web/dist" -type l -print -quit)" ]]
pid=$(systemctl show codenames.service -p MainPID --value)
[[ "$pid" -gt 1 && "$(readlink /proc/$pid/cwd)" = "$repo/apps/server" ]]
backup=/opt/codenames-backups/web-${sha:0:12}-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$backup"
cp "$repo/release.json" "$backup/release.json.before"
cp "$repo/apps/web/dist/index.html" "$backup/index.html.before"
cp "$stage/RUNTIME_SHA256" "$backup/RUNTIME_SHA256"
(cd "$repo" && tar -czf "$backup/web-before.tar.gz" apps/web/dist)
(cd "$repo" && sha256sum apps/server/.env) > "$backup/CONFIG_SHA256"
curl -fsS http://127.0.0.1:3001/rooms > "$backup/rooms-before.json"
printf '%s\n' "$expected" > "$backup/previous-sha.txt"
changed=0
rollback(){
 code=$?
 trap - ERR
 if [[ "$changed" = 1 ]]; then
  cp "$backup/index.html.before" "$repo/apps/web/dist/index.html.rollback"
  mv -f "$repo/apps/web/dist/index.html.rollback" "$repo/apps/web/dist/index.html"
  cp "$backup/release.json.before" "$repo/release.json"
  git -C "$repo" checkout --detach "$expected"
  echo 'Frontend rolled back; service was not restarted'
 fi
 exit "$code"
}
trap rollback ERR
# Publish assets first, retaining old filenames for browsers already in a game.
rsync -a --exclude=index.html "$stage/apps/web/dist/" "$repo/apps/web/dist/"
chmod -R a+rX "$repo/apps/web/dist"
changed=1
git -C "$repo" checkout --detach "$sha"
cp "$stage/apps/web/dist/index.html" "$repo/apps/web/dist/index.html.pending"
chmod 644 "$repo/apps/web/dist/index.html.pending"
mv -f "$repo/apps/web/dist/index.html.pending" "$repo/apps/web/dist/index.html"
python3 - "$repo" "$stage" "$sha" "$backup" "$pid" <<'PY'
import datetime,hashlib,json,pathlib,re,subprocess,sys,urllib.request
repo,stage,sha,backup,pid=sys.argv[1:]
root=pathlib.Path(repo)
assert subprocess.check_output(['systemctl','show','codenames.service','-p','MainPID','--value'],text=True).strip()==pid
subprocess.run(['sha256sum','-c',str(pathlib.Path(backup,'RUNTIME_SHA256'))],cwd=repo,check=True,stdout=subprocess.DEVNULL)
subprocess.run(['sha256sum','-c',str(pathlib.Path(backup,'CONFIG_SHA256'))],cwd=repo,check=True,stdout=subprocess.DEVNULL)
def get(path):
 return urllib.request.urlopen(urllib.request.Request('http://127.0.0.1'+path,headers={'Host':'182.61.136.105'}),timeout=15).read()
index=get('/');assert index==(root/'apps/web/dist/index.html').read_bytes()
assets={}
for path in re.findall(r'(?:src|href)="(/assets/[^\"]+)"',index.decode()):
 live=get(path);assert live==(pathlib.Path(stage,'apps/web/dist')/path.lstrip('/')).read_bytes()
 assets[path]=hashlib.sha256(live).hexdigest()
assert assets
assert json.load(urllib.request.urlopen('http://127.0.0.1:3001/health'))['ok']
rooms=json.load(urllib.request.urlopen('http://127.0.0.1:3001/rooms'))
previous=json.loads((root/'release.json').read_text())
audit={'sha':sha,'frontendSha':sha,'serverRuntimeSha':previous.get('serverRuntimeSha',previous['sha']),'deployedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'deployment':'frontend-only','serviceRestarted':False,'mainPid':int(pid),'backupPath':backup,'stagePath':stage,'assetHashes':assets,'runtimeArtifactsUnchanged':True,'configUnchanged':True,'activeRooms':[{'id':r['id'],'phase':r['phase'],'round':r['roundNumber'],'players':r['playerCount']} for r in rooms]}
(root/'release.json').write_text(json.dumps(audit,indent=2)+'\n')
pathlib.Path(backup,'audit.json').write_text(json.dumps(audit,indent=2)+'\n')
print(json.dumps(audit,indent=2))
PY
(cd "$backup" && sha256sum web-before.tar.gz release.json.before index.html.before RUNTIME_SHA256 CONFIG_SHA256 > SHA256SUMS)
trap - ERR
echo "FRONTEND_DEPLOYED_SHA=$sha"
echo "BACKUP=$backup"
