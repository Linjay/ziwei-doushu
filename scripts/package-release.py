"""Create a source archive and a local Git bundle, without touching this checkout's index.

Usage: python scripts/package-release.py 20261101-mobile
Requires Python 3 and Git; uploads/deployment are separate operations.
"""
import hashlib,json,pathlib,re,shutil,subprocess,sys,tarfile
from datetime import datetime,timezone

root=pathlib.Path(__file__).resolve().parents[1]
version=sys.argv[1] if len(sys.argv)==2 else ''
if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}',version):raise SystemExit('Provide a safe release version.')
output=root/'.codex-local/releases'/version
if output.exists():raise SystemExit('Release already exists; use another version, never overwrite an archived release.')
output.mkdir(parents=True)
files=sorted(set(subprocess.check_output(['git','ls-files','-z','-c','-o','--exclude-standard'],cwd=root).decode('utf8').split('\0'))-{''})
snapshot=output/'source';snapshot.mkdir()
included=[];hashes={}
for name in files:
    file=root/name
    if not file.is_file() or name.startswith(('.codex-local/','data/','.git/','.next/','node_modules/','knowledge/','codex/')):continue
    if (name.startswith('.env') and name!='.env.example') or file.name in ('runtime.env','auth.json') or file.suffix=='.sqlite':continue
    if not file.resolve().is_relative_to(root):raise SystemExit('Refusing an external source link: '+name)
    target=snapshot/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(file,target)
    included.append(name);hashes[name]=hashlib.sha256(file.read_bytes()).hexdigest()
archive=output/'source.tar.gz'
with tarfile.open(archive,'w:gz') as tar:
    for name in included:tar.add(snapshot/name,arcname=name,recursive=False)
def git(*args):return subprocess.check_output(['git','-C',str(snapshot),*args],stderr=subprocess.STDOUT).decode('utf8').strip()
git('init','--initial-branch=main');git('add','--all')
git('-c','user.name=Mingli Release','-c','user.email=release@localhost','commit','-m','release: '+version)
git('tag',version);commit=git('rev-parse','HEAD');git('bundle','create',str(output/'source.bundle'),'--all')
manifest={'version':version,'createdAt':datetime.now(timezone.utc).isoformat(),'baseCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'snapshotCommit':commit,'archiveBytes':archive.stat().st_size,'archiveSHA256':hashlib.sha256(archive.read_bytes()).hexdigest(),'bundleSHA256':hashlib.sha256((output/'source.bundle').read_bytes()).hexdigest(),'files':hashes}
(output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
assert not git('remote'), 'Snapshot must have no remote.'
print(json.dumps({key:value for key,value in manifest.items() if key!='files'},ensure_ascii=False))
