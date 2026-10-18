import { useState } from 'react';
import type { PublicRoomState } from '@acg-codenames/shared';
import { Dialog } from './UI';
import { RoundHistory } from './RoundHistory';

export function RecentClues({room}:{room:PublicRoomState}) {
  const [open,setOpen]=useState(false);
  const records=room.clueRecords??[];
  return <section className="recent-clues panel" aria-label="最近线索"><header><strong>本局线索</strong><button onClick={()=>setOpen(true)}>全部 {records.length}</button></header>{records.slice(-3).reverse().map(r=><button className={`recent-clue team-${r.team}`} key={r.clueId} onClick={()=>setOpen(true)}><small>{r.team==='red'?'红队':'蓝队'} · 第 {records.indexOf(r)+1} 回合</small><strong>{r.word} ×{r.count}</strong></button>)}{!records.length&&<p className="hint-text">等待第一条线索</p>}{open&&<Dialog title="全部线索" close={()=>setOpen(false)} wide><RoundHistory records={records}/></Dialog>}</section>;
}
