"""Refresh public Bangumi metadata, slowly; existing cache survives any failed fetch."""
import json, re, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'apps/server/resources/anime-catalog.json'
UA = 'Zao-c/codenames-acg/2.0 (https://github.com/Zao-c/codenames-acg)'

def fetch(year, offset=0):
    payload = {'keyword': '', 'sort': 'match', 'filter': {'type': [2], 'air_date': [f'>={year}-01-01', f'<{year+1}-01-01'], 'nsfw': False}}
    for attempt in range(3):
        try:
            request = urllib.request.Request(f'https://api.bgm.tv/v0/search/subjects?limit=20&offset={offset}', data=json.dumps(payload).encode(), headers={'Content-Type':'application/json', 'User-Agent':UA})
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)['data']
        except Exception:
            if attempt == 2: raise
            time.sleep(2 ** attempt)

def series(title):
    # Only explicit season/cour suffixes; never collapse a whole franchise universe.
    value = re.sub(r'\s*(第[一二三四五六七八九十0-9]+[季期部]|Season\s*\d+|\d+(?:st|nd|rd|th)\s+Season|Part\s*\d+|[上下]半部).*$', '', title, flags=re.I)
    return 'title:' + re.sub(r'[\s·・：:!！?？]', '', value).casefold()

works = {}
for year in range(1995, 2027):
    entries = []
    for offset in range(0, 100, 20):
        entries.extend(fetch(year, offset))
        time.sleep(0.4)
    count = 0
    for entry in entries:
        platform = entry.get('platform')
        if platform not in ['TV','OVA','WEB','剧场版','电影'] or entry.get('nsfw'): continue
        if not entry.get('date', '').startswith(str(year)): continue
        title = entry.get('name_cn') or entry.get('name')
        if not title: continue
        ident = entry['id']
        works[ident] = {'id':ident, 'title':title[:32], 'fullTitle':title, 'aliases':list(dict.fromkeys([entry.get('name',''), title])), 'cover':entry.get('images',{}).get('common',''), 'type':{'WEB':'ONA','剧场版':'电影'}.get(platform,platform), 'seriesId':series(title), 'airDate':entry.get('date','')}
        count += 1
        if count >= 60: break
    print(f'{year}: {count}, total {len(works)}', flush=True)
    time.sleep(0.6)
if len(works) < 1000: raise RuntimeError('Insufficient valid entries; keeping existing catalog')
temporary = OUT.with_suffix('.tmp')
temporary.write_text(json.dumps({'source':'https://api.bgm.tv/v0/search/subjects','generatedAt':'2026-10-15','works':list(works.values())},ensure_ascii=False,indent=2),encoding='utf-8')
temporary.replace(OUT)
print(f'Saved {len(works)} works')
