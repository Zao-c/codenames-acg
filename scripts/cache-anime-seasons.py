"""Enrich the shipped catalog with usable quarterly pools; reuse prior metadata."""
import importlib.util, json, time, urllib.request, re
from pathlib import Path
root=Path(__file__).resolve().parents[1]
output=root/'apps/server/resources/anime-catalog.json'
data=json.loads(output.read_text(encoding='utf-8'))
counts={}
works={}
for w in data['works']:
    year=w['airDate'][:4]
    counts[year]=counts.get(year,0)+1
    if counts[year]<=50: works[w['id']]=w
for quarter in range(1,5):
    month=(quarter-1)*3+1
    end=f'2026-{month+3:02d}-01' if quarter<4 else '2027-01-01'
    added=0
    for offset in range(0,160,20):
        body={'keyword':'','sort':'match','filter':{'type':[2],'air_date':[f'>=2026-{month:02d}-01',f'<{end}'],'nsfw':False}}
        request=urllib.request.Request(f'https://api.bgm.tv/v0/search/subjects?limit=20&offset={offset}',data=json.dumps(body).encode(),headers={'Content-Type':'application/json','User-Agent':'Zao-c/codenames-acg/2.0 (https://github.com/Zao-c/codenames-acg)'})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request,timeout=30) as response: entries=json.load(response)['data']
                break
            except Exception:
                if attempt==2: raise
                time.sleep(2**attempt)
        for e in entries:
            if e.get('platform') not in ['TV','OVA','WEB','剧场版','电影'] or e.get('nsfw'):continue
            title=e.get('name_cn') or e.get('name')
            if not title: continue
            key=re.sub(r'\s*(第[一二三四五六七八九十0-9]+[季期部]|Season\s*\d+|\d+(?:st|nd|rd|th)\s+Season|Part\s*\d+|[上下]半部).*$', '',title,flags=re.I)
            works[e['id']]={'id':e['id'],'title':title[:32],'fullTitle':title,'aliases':list(dict.fromkeys([e.get('name',''),title])),'cover':e.get('images',{}).get('common',''),'type':{'WEB':'ONA','剧场版':'电影'}.get(e['platform'],e['platform']),'seriesId':'title:'+re.sub(r'[\s·・：:!！?？]','',key).casefold(),'airDate':e.get('date','')}
            added+=1
            if added>=65:break
        if added>=65:break
        time.sleep(.6)
    print(f'2026 Q{quarter}: {added}',flush=True)
data['works']=list(works.values())
output.with_suffix('.tmp').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
output.with_suffix('.tmp').replace(output)
print('catalog',len(works),flush=True)
