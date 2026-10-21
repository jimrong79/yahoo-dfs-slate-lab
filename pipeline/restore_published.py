"""Recover last published public snapshots so a failed refresh keeps honest ages."""
import json
from pathlib import Path
import re
from urllib.request import urlopen

BASE='https://jimrong79.github.io/yahoo-dfs-slate-lab/data/'
DEST=Path(__file__).resolve().parents[1]/'public/data'

def download(name):
    with urlopen(BASE+name,timeout=20) as response:
        content=response.read(5_000_001)
    if len(content)>5_000_000:raise ValueError('Unexpectedly large public snapshot')
    return json.loads(content)

def main():
    try:
        catalog=download('catalog.json')
        if catalog.get('schemaVersion')!=1:raise ValueError('Unsupported public schema')
        local=DEST/'catalog.json'
        previous=json.loads(local.read_text()) if local.exists() else {}
        if catalog.get('updatedAt','')<=previous.get('updatedAt',''):return
        snapshots={}
        for item in catalog['slates']:
            filename=item['file']
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}-\d+\.json',filename):raise ValueError('Invalid public filename')
            snapshot=download(filename)
            if snapshot.get('id')!=item['seriesId']:raise ValueError('Public snapshot identity mismatch')
            snapshots[filename]=snapshot
        DEST.mkdir(parents=True,exist_ok=True)
        for filename,snapshot in snapshots.items():(DEST/filename).write_text(json.dumps(snapshot)+'\n')
        local.write_text(json.dumps(catalog,indent=2)+'\n')
        print('Recovered the previous public snapshot; successful timestamps preserved.')
    except Exception as exc:
        print(f'Previous deployment could not be recovered: {exc}. Keeping bundled fallback data.')

if __name__=='__main__':main()
