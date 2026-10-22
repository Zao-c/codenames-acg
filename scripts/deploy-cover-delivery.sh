#!/usr/bin/env bash
# Publish the tested web/cover worker without replacing or restarting GameService.
set -Eeuo pipefail
umask 077
sha=${1:?reviewed SHA required}
stage=${2:?tested immutable release directory required}
expected=${3:?expected production source HEAD required}
repo=/opt/codenames-acg
cache=/opt/codenames-cover-cache
private_env=/etc/codenames-covers.env
nginx_conf=/etc/nginx/sites-available/codenames
unit=/etc/systemd/system/codenames-covers.service
[[ "$sha" =~ ^[0-9a-f]{40}$ && "$expected" =~ ^[0-9a-f]{40}$ && "$stage" = /opt/codenames-releases/cover-${sha:0:12}-* ]]
[[ "$(git -C "$repo" rev-parse HEAD)" = "$expected" && -z "$(git -C "$repo" status --porcelain --untracked-files=no)" ]]
git -C "$repo" merge-base --is-ancestor "$expected" "$sha"
(cd "$stage" && sha256sum -c ARTIFACT_SHA256 >/dev/null)
[[ -f "$stage/apps/server/dist/apps/server/src/cover-server.js" && ! -L "$repo/apps/web/dist" ]]
backup=/opt/codenames-backups/covers-${sha:0:12}-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$backup" "$cache"
chmod 700 "$cache"
(cd "$repo" && find apps/server/dist packages/shared/dist -type f -print0 | sort -z | xargs -0 sha256sum) > "$backup/GAME_RUNTIME_SHA256"
# Every previously deployed game/shared file must be identical in the reviewed release.
(cd "$stage" && sha256sum -c "$backup/GAME_RUNTIME_SHA256" >/dev/null)
main_pid=$(systemctl show codenames.service -p MainPID --value)
[[ "$main_pid" -gt 1 && "$(readlink /proc/$main_pid/cwd)" = "$repo/apps/server" ]]
cp "$repo/release.json" "$backup/release.json.before"
cp "$repo/apps/web/dist/index.html" "$backup/index.html.before"
cp "$nginx_conf" "$backup/nginx.before"
(cd "$repo" && sha256sum apps/server/.env) > "$backup/GAME_CONFIG_SHA256"
(cd "$repo" && tar -czf "$backup/web-before.tar.gz" apps/web/dist)
old_worker=0
if [[ -f "$unit" ]]; then old_worker=1;cp "$unit" "$backup/worker.before";fi
if [[ -f "$private_env" ]]; then cp "$private_env" "$backup/cover-env.before";fi
if [[ "$old_worker" = 0 ]] && ss -ltnH 'sport = :3003' | grep -q .; then echo 'Image port is occupied by another process';exit 3;fi
changed=0
rollback(){
 code=$?
 trap - ERR
 if [[ "$changed" = 1 ]]; then
  cp "$backup/index.html.before" "$repo/apps/web/dist/index.html.rollback"
  mv -f "$repo/apps/web/dist/index.html.rollback" "$repo/apps/web/dist/index.html"
  cp "$backup/nginx.before" "$nginx_conf"
  nginx -t && systemctl reload nginx
  if [[ "$old_worker" = 1 ]]; then cp "$backup/worker.before" "$unit";[[ ! -f "$backup/cover-env.before" ]] || cp "$backup/cover-env.before" "$private_env";systemctl daemon-reload;systemctl restart codenames-covers.service;
  else systemctl disable --now codenames-covers.service || true;fi
  cp "$backup/release.json.before" "$repo/release.json"
  git -C "$repo" checkout --detach "$expected"
  echo 'Web/cover publication rolled back; GameService was not restarted'
 fi
 exit "$code"
}
trap rollback ERR
changed=1
cd "$stage"
node scripts/configure-cover-worker.mjs --from /opt/Animatch/animatch/.env.production --to "$private_env" --cache "$cache" --port 3003
node scripts/sync-cos-cover-manifest.mjs --env "$private_env"
# Reuse only completed, regenerable public thumbnail files from the reviewed run.
test_cache=/opt/codenames-test-runs/$(basename "$stage")/cache
if [[ -d "$test_cache" && ! -L "$test_cache" ]]; then rsync -a --include='cover-*.webp' --exclude='*' "$test_cache/" "$cache/";fi
cat > "$unit" <<UNIT
[Unit]
Description=Cipai isolated public cover cache
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
WorkingDirectory=$stage/apps/server
Environment=NODE_ENV=production
EnvironmentFile=$private_env
ExecStart=/usr/bin/node --max-old-space-size=192 $stage/apps/server/dist/apps/server/src/cover-server.js
Restart=always
RestartSec=3
Nice=10
CPUQuota=50%
MemoryMax=384M
TasksMax=64
LimitNOFILE=512
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=$cache
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now codenames-covers.service
if [[ "$old_worker" = 1 ]];then systemctl restart codenames-covers.service;fi
for n in $(seq 1 30);do if curl -fsS http://127.0.0.1:3003/health > "$backup/cover-health.json";then break;fi;sleep 1;done
curl -fsS http://127.0.0.1:3003/health >/dev/null
python3 - "$nginx_conf" <<'PY'
import pathlib,re,sys
p=pathlib.Path(sys.argv[1]);s=p.read_text()
s=re.sub(r'\n\s*# BEGIN CIPAI COVERS[\s\S]*?# END CIPAI COVERS\n','\n',s)
block='''
    # BEGIN CIPAI COVERS
    location = /api/anime/cover-locations {
        proxy_pass http://127.0.0.1:3003;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_connect_timeout 1s;
        proxy_read_timeout 3s;
    }
    location ^~ /api/anime/cover/ {
        proxy_pass http://127.0.0.1:3003;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_connect_timeout 1s;
        proxy_read_timeout 3s;
    }
    # END CIPAI COVERS
'''
assert s.count('    location /api/ {')==1
s=s.replace('    location /api/ {',block+'\n    location /api/ {')
p.write_text(s)
PY
nginx -t
systemctl reload nginx
# Hashed assets first; keep previous assets for already-open game tabs.
rsync -a --exclude=index.html "$stage/apps/web/dist/" "$repo/apps/web/dist/"
chmod -R a+rX "$repo/apps/web/dist"
git -C "$repo" checkout --detach "$sha"
cp "$stage/apps/web/dist/index.html" "$repo/apps/web/dist/index.html.pending"
chmod 644 "$repo/apps/web/dist/index.html.pending"
mv -f "$repo/apps/web/dist/index.html.pending" "$repo/apps/web/dist/index.html"
python3 - "$repo" "$stage" "$sha" "$backup" "$main_pid" <<'PY'
import datetime,hashlib,json,pathlib,re,subprocess,sys,urllib.request
repo,stage,sha,backup,pid=sys.argv[1:];root=pathlib.Path(repo)
assert subprocess.check_output(['systemctl','show','codenames.service','-p','MainPID','--value'],text=True).strip()==pid
for filename in ['GAME_RUNTIME_SHA256','GAME_CONFIG_SHA256']:subprocess.run(['sha256sum','-c',str(pathlib.Path(backup,filename))],cwd=repo,check=True,stdout=subprocess.DEVNULL)
def get(p):return urllib.request.urlopen(urllib.request.Request('http://127.0.0.1'+p,headers={'Host':'182.61.136.105'}),timeout=10).read()
index=get('/');assert index==(root/'apps/web/dist/index.html').read_bytes();assets={}
for p in re.findall(r'(?:src|href)="(/assets/[^\"]+)"',index.decode()):
 data=get(p);assert data==(pathlib.Path(stage,'apps/web/dist')/p.lstrip('/')).read_bytes();assets[p]=hashlib.sha256(data).hexdigest()
assert assets
# Check actual secret values in memory, without printing or writing them to reports.
values={}
for line in pathlib.Path('/etc/codenames-covers.env').read_text().splitlines():
 if '=' in line:
  k,v=line.split('=',1)
  if k in ['COS_SECRET_ID','COS_SECRET_KEY']:values[k]=json.loads(v)
for f in pathlib.Path(stage,'apps/web/dist').rglob('*'):
 if f.is_file():
  data=f.read_bytes();assert not any(v.encode() in data for v in values.values() if v),'Credential found in public build'
health=json.load(urllib.request.urlopen('http://127.0.0.1:3001/health'));assert health['ok']
cover_health=json.load(urllib.request.urlopen('http://127.0.0.1:3003/health'));assert cover_health['ok']
locations=json.loads(get('/api/anime/cover-locations?ids=524123,485936,1262'));assert 'works' in locations
previous=json.loads(pathlib.Path(backup,'release.json.before').read_text())
rooms=json.load(urllib.request.urlopen('http://127.0.0.1:3001/rooms'))
audit={'sha':sha,'frontendSha':sha,'coverWorkerSha':sha,'serverRuntimeSha':previous.get('serverRuntimeSha',previous['sha']),'deployedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'deployment':'web-and-isolated-cover-worker','serviceRestarted':False,'mainPid':int(pid),'coverWorkerPid':int(subprocess.check_output(['systemctl','show','codenames-covers.service','-p','MainPID','--value'],text=True)),'gameArtifactsUnchanged':True,'gameConfigUnchanged':True,'credentialsAbsentFromPublicArtifacts':True,'assetHashes':assets,'coverHealth':cover_health,'backupPath':backup,'stagePath':stage,'activeRooms':[{'id':r['id'],'phase':r['phase'],'round':r['roundNumber'],'players':r['playerCount']} for r in rooms]}
(root/'release.json').write_text(json.dumps(audit,indent=2)+'\n');pathlib.Path(backup,'audit.json').write_text(json.dumps(audit,indent=2)+'\n');print(json.dumps(audit,indent=2))
PY
(cd "$backup" && sha256sum web-before.tar.gz release.json.before index.html.before nginx.before GAME_RUNTIME_SHA256 GAME_CONFIG_SHA256 > SHA256SUMS)
trap - ERR
echo "DEPLOYED_COVER_SHA=$sha BACKUP=$backup"
