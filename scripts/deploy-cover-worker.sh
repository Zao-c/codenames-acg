#!/usr/bin/env bash
# Replace only the isolated image worker. The web, game, nginx and env stay intact.
set -Eeuo pipefail
umask 077
sha=${1:?reviewed worker SHA required}
stage=${2:?immutable compiled worker release required}
repo=/opt/codenames-acg
unit=/etc/systemd/system/codenames-covers.service
[[ "$sha" =~ ^[0-9a-f]{40}$ && "$stage" = /opt/codenames-releases/cover-${sha:0:12}-* ]]
(cd "$stage" && sha256sum -c ARTIFACT_SHA256 >/dev/null)
backup=/opt/codenames-backups/worker-${sha:0:12}-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$backup"
cp "$repo/release.json" "$backup/release.before.json"
cp "$unit" "$backup/worker.before"
main_pid=$(systemctl show codenames.service -p MainPID --value)
[[ "$main_pid" -gt 1 && "$(readlink /proc/$main_pid/cwd)" = "$repo/apps/server" ]]
(cd "$repo" && find apps/server/dist packages/shared/dist apps/web/dist -type f -print0 | sort -z | xargs -0 sha256sum) > "$backup/UNCHANGED_SHA256"
(cd "$repo" && sha256sum apps/server/.env) > "$backup/CONFIG_SHA256"
(cd "$repo" && find apps/server/dist packages/shared/dist -type f -print0 | sort -z | xargs -0 sha256sum) > "$backup/GAME_RUNTIME_SHA256"
(cd "$stage" && sha256sum -c "$backup/GAME_RUNTIME_SHA256" >/dev/null)
cd "$stage"
node scripts/sync-cos-cover-manifest.mjs --env /etc/codenames-covers.env --output "$backup/manifest.next.json"
changed=0
rollback(){
 code=$?;trap - ERR
 if [[ "$changed" = 1 ]]; then
  cp "$backup/worker.before" "$unit"
  systemctl daemon-reload
  systemctl restart codenames-covers.service
  cp "$backup/release.before.json" "$repo/release.json"
 fi
 exit "$code"
}
trap rollback ERR
python3 - "$unit" "$stage" "$backup" <<'PY'
import json,pathlib,sys
unit,stage,backup=sys.argv[1:]
previous=json.loads(pathlib.Path(backup,'release.before.json').read_text())
old=previous.get('coverWorkerStagePath',previous['stagePath'])
assert old.startswith('/opt/codenames-releases/cover-')
text=pathlib.Path(unit).read_text()
assert text.count(old)==2
pathlib.Path(backup,'worker.next').write_text(text.replace(old,stage))
PY
changed=1
systemctl stop codenames-covers.service
python3 - "$backup" <<'PY'
import json,pathlib,os,sys
backup=pathlib.Path(sys.argv[1]);manifest=pathlib.Path('/opt/codenames-cover-cache/manifest.json')
old=json.loads(manifest.read_text());new=json.loads((backup/'manifest.next.json').read_text())
entries={entry['source']:entry for entry in old['entries']+new['entries']}
temp=manifest.with_suffix('.next');temp.write_text(json.dumps({**new,'entries':list(entries.values())}));temp.chmod(0o600);os.replace(temp,manifest)
PY
cp "$backup/worker.next" "$unit"
systemctl daemon-reload
systemctl start codenames-covers.service
for n in $(seq 1 30);do if curl -fsS http://127.0.0.1:3003/health > "$backup/cover-health.json";then break;fi;sleep 1;done
curl -fsS http://127.0.0.1:3003/health >/dev/null
[[ "$(systemctl show codenames.service -p MainPID --value)" = "$main_pid" ]]
(cd "$repo" && sha256sum -c "$backup/UNCHANGED_SHA256" >/dev/null && sha256sum -c "$backup/CONFIG_SHA256" >/dev/null)
python3 - "$repo" "$stage" "$sha" "$backup" "$main_pid" <<'PY'
import datetime,json,pathlib,subprocess,sys
repo,stage,sha,backup,pid=sys.argv[1:]
audit=json.loads(pathlib.Path(backup,'release.before.json').read_text())
audit.update(coverWorkerSha=sha,coverWorkerStagePath=stage,coverWorkerPid=int(subprocess.check_output(['systemctl','show','codenames-covers.service','-p','MainPID','--value'],text=True)),coverWorkerDeployedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),deployment='isolated-cover-worker-only',serviceRestarted=False,mainPid=int(pid),gameArtifactsUnchanged=True,gameConfigUnchanged=True,webArtifactsUnchanged=True,coverWorkerBackupPath=backup)
audit['coverHealth']=json.loads(pathlib.Path(backup,'cover-health.json').read_text())
audit['coverHealthMeasuredAt']=audit['coverWorkerDeployedAt']
pathlib.Path(repo,'release.json').write_text(json.dumps(audit,indent=2)+'\n')
pathlib.Path(backup,'audit.json').write_text(json.dumps(audit,indent=2)+'\n')
print(json.dumps(audit))
PY
trap - ERR
echo "DEPLOYED_WORKER_SHA=$sha BACKUP=$backup"
