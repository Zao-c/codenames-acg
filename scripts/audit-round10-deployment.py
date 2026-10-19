"""Read-only post-release audit; never print user data or environment values."""
import hashlib
import json
import os
import pathlib
import re
import subprocess
import tarfile
import urllib.request

repo = pathlib.Path('/opt/codenames-acg')
release = json.loads((repo / 'release.json').read_text())
backup = pathlib.Path(release['backupPath'])
assert backup.parent == pathlib.Path('/opt/codenames-backups')
sha = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
assert sha == release['sha']
subprocess.run(['systemctl', 'is-active', '--quiet', 'codenames.service'], check=True)
subprocess.run(['sha256sum', '-c', 'SHA256SUMS'], cwd=backup, check=True, stdout=subprocess.DEVNULL)
pid = int(subprocess.check_output(['systemctl', 'show', 'codenames.service', '-p', 'MainPID', '--value'], text=True))
assert pathlib.Path(os.readlink(f'/proc/{pid}/cwd')) == repo / 'apps/server'
assert b'dist/apps/server/src/index.js' in pathlib.Path(f'/proc/{pid}/cmdline').read_bytes()

def get(url, host=None):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'Host': host} if host else {}), timeout=15).read()

health = json.loads(get('http://127.0.0.1:3001/health'))
assert health['ok'] is True
rooms = json.loads(get('http://127.0.0.1:3001/rooms'))
index = get('http://127.0.0.1/', '182.61.136.105').decode()
assets = re.findall(r'(?:src|href)="(/assets/[^\"]+)"', index)
assert assets
asset_hashes = {}
for asset in assets:
    live = get('http://127.0.0.1' + asset, '182.61.136.105')
    built = (repo / 'apps/web/dist' / asset.lstrip('/')).read_bytes()
    assert live == built
    asset_hashes[asset] = hashlib.sha256(live).hexdigest()
paths = json.loads((backup / 'durable-paths.json').read_text())
with tarfile.open(backup / 'app-before.tar.gz') as archive:
    names = {n.removeprefix('./').rstrip('/') for n in archive.getnames()}
    assert all(str(pathlib.Path(p).relative_to(repo)) in names for p in paths.values())
    config = 'apps/server/.env'
    assert archive.extractfile('./' + config).read() == (repo / config).read_bytes()
    archive_entries = len(names)
verified = (backup / 'data-verified.txt').read_text().splitlines()
assert verified and all(line.endswith(': OK') for line in verified)
artifacts = (backup / 'artifacts-verified.txt').read_text().splitlines()
assert artifacts and all(line.endswith(': OK') for line in artifacts)
tracked_clean = not subprocess.check_output(['git', '-C', str(repo), 'status', '--porcelain', '--untracked-files=no'], text=True).strip()
assert tracked_clean
print(json.dumps({
    'passed': True, 'gitSha': sha, 'runtimeSha': release['sha'], 'release': release,
    'mainPid': pid, 'node': subprocess.check_output(['node', '--version'], text=True).strip(),
    'health': health, 'roomCount': len(rooms), 'trackedClean': tracked_clean,
    'publicAssets': asset_hashes, 'configurationUnchanged': True,
    'backupVerified': True, 'backupEntries': archive_entries,
    'backupArchives': {n: (backup / n).stat().st_size for n in ['app-before.tar.gz', 'system-before.tar.gz']},
    'dataFilesVerifiedBeforeRestart': len(verified), 'compiledFilesVerified': len(artifacts),
    'durablePaths': paths, 'isolatedLinuxSmokeHealth': json.loads((backup / 'linux-smoke-health.json').read_text()),
}, indent=2))
