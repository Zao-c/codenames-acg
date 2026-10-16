import { useEffect, useState, type ReactNode } from 'react';
import { TEAM_LABELS, type AnimeWork, type PublicNextPlan, type Team } from '@acg-codenames/shared';
import { DraftTile, type DropAction, type DropAllow } from './DraftTile';
import { Cover } from './AnimeBoard';

type Props={plan:PublicNextPlan;team?:Team;time:number;remaining:number;controls:ReactNode;works:AnimeWork[];query:string;setQuery:(s:string)=>void;typeFilter:string;setTypeFilter:(s:string)=>void;claimFilter:string;setClaimFilter:(s:string)=>void;onlyBookmarks:boolean;setOnlyBookmarks:(b:boolean)=>void;onDrop:(w:AnimeWork,action:DropAction,replaceId?:number)=>void;onPreview:(w:AnimeWork)=>void;onBookmark?: (w:AnimeWork)=>void;replacement?:number;onChooseReplacement?:(id?:number)=>void};
export function DraftWorkspace(p:Props) {
 const [mobilePane,setMobilePane]=useState<'pool'|'controls'>('pool');
 const [selectionTeam,setSelectionTeam]=useState<'own'|'other'>('own');
 const {plan,team}=p;const claims=plan.captainView?.claims??{};
 useEffect(()=>{if(p.replacement!==undefined)setMobilePane('pool');},[p.replacement]);
 const editable=!!team&&plan.stage==='draft';
 const selected=plan.candidates.filter(w=>claims[w.id]&&(selectionTeam==='own'?claims[w.id].team===team:claims[w.id].team!==team));
 const allow=(w:AnimeWork):DropAllow=>{const claim=claims[w.id];return{
  take:editable&&(!claim||(claim.kind!=='interference'&&claim.team!==team)),
  release:editable&&claim?.team===team&&claim.kind==='manual',
  interfere:editable&&!claim&&p.remaining>20,
  replace:editable&&(!claim||(claim.kind!=='interference'&&claim.team!==team)),
 };};
 if(plan.variant!=='anime')return <div className="plan-controls">{p.controls}</div>;
 return <div className={`draft-workspace stage-${plan.stage} draft-pane-${mobilePane}`}>
  <header className="draft-workspace-heading"><div><p className="eyebrow">{plan.stage==='planning'?'私人提前预选':plan.stage==='guide'?'浏览与确认':plan.stage==='sealed'?'棋盘已封存':'正式组牌'}</p><h3>{plan.poolName}</h3><span className="hint-text">{plan.candidates.length} 部候选 · {plan.settings.boardMode}</span></div>{plan.stage==='draft'&&<div className={`draft-clock ${p.remaining<=20?'draft-clock-final':''}`} role="timer"><strong>{String(Math.floor(p.remaining/60)).padStart(2,'0')}:{String(p.remaining%60).padStart(2,'0')}</strong><span>{p.remaining<=20?'最后 20 秒 · 禁抢 / 禁改干扰':'180 秒组牌 · 服务器同步'}</span></div>}</header>
  {plan.stage!=='sealed'&&<div className="draft-mobile-tabs"><button className={mobilePane==='pool'?'selected':''} onClick={()=>setMobilePane('pool')}>候选池</button><button className={mobilePane==='controls'?'selected':''} onClick={()=>setMobilePane('controls')}>{team?'选牌与操作':'准备信息'}</button></div>}
  {plan.stage!=='sealed'&&<div className="draft-pool">
   {p.replacement!==undefined&&<div className="draft-replacement-banner" role="status">正在更换《{plan.candidates.find(w=>w.id===p.replacement)?.title}》，点选一部新作品<button onClick={()=>p.onChooseReplacement?.()}>取消更换</button></div>}
   <div className="draft-filters"><input aria-label="搜索候选动画" placeholder="搜索作品或别名" value={p.query} onChange={e=>p.setQuery(e.target.value)}/><select aria-label="筛选动画类型" value={p.typeFilter} onChange={e=>p.setTypeFilter(e.target.value)}><option value="all">全部类型</option>{[...new Set(plan.candidates.map(w=>w.type))].map(t=><option key={t}>{t}</option>)}</select>
   {team&&<><label className="bookmark-filter"><input type="checkbox" checked={p.onlyBookmarks} onChange={e=>p.setOnlyBookmarks(e.target.checked)}/>私人书签</label>{plan.captainView&&<select aria-label="筛选选牌归属" value={p.claimFilter} onChange={e=>p.setClaimFilter(e.target.value)}><option value="all">全部候选</option><option value="own">我方已选</option><option value="other">对方已选</option></select>}</>}
   <span className="hint-text">{p.works.length} / {plan.candidates.length}</span></div>
   <div className="draft-candidates" aria-label="动画候选池" data-drop="release">{p.works.map(w=><DraftTile key={w.id} work={w} claim={claims[w.id]} time={p.time} bookmark={plan.myBookmarks?.includes(w.id)} canEdit={editable} allow={allow(w)} onPreview={()=>p.onPreview(w)} onBookmark={p.onBookmark?()=>p.onBookmark!(w):undefined} onDrop={p.onDrop}/>)}</div>
   {p.works.length===0&&<p className="empty-text">没有符合条件的作品，试试其他筛选。</p>}
  </div>}
  <aside className="draft-control-panel">
   {team&&plan.captainView&&<section className="draft-selected-panel" data-drop={editable?'take':undefined}><div className="selection-grid"><button className={selectionTeam==='own'?'selected':''} onClick={()=>setSelectionTeam('own')}>我方已选</button><button className={selectionTeam==='other'?'selected':''} onClick={()=>setSelectionTeam('other')}>对方已选</button></div><p className="hint-text">{selectionTeam==='own'?TEAM_LABELS[team]:TEAM_LABELS[team==='red'?'blue':'red']} · {selected.length} 部（含干扰牌）</p><div className="draft-selected-list">{selected.map(w=><div key={w.id}><DraftTile compact work={w} claim={claims[w.id]} time={p.time} canEdit={editable&&claims[w.id]?.team===team&&claims[w.id]?.kind==='manual'} allow={allow(w)} onPreview={()=>p.onPreview(w)} onDrop={p.onDrop}/>{editable&&claims[w.id]?.team===team&&claims[w.id]?.kind==='manual'&&<button className="draft-replace-choice" onClick={()=>p.onChooseReplacement?.(w.id)}>更换这张</button>}</div>)}{!selected.length&&<p className="empty-text">选中的作品将在这里显示</p>}</div></section>}
   {editable&&<div className="draft-drop-zones"><div data-drop="take"><strong>领取 / 抢夺</strong><span>拖到阵容区或此处</span></div><div data-drop="release"><strong>撤回</strong><span>拖回候选池亦可</span></div><div data-drop="interfere"><strong>干扰</strong><span>空闲作品 · 需再次确认</span></div></div>}
   {!team&&<p className="hint-text">你正在浏览固定候选池。队长正在准备，选牌进度仅队长可见。</p>}
   <div className="plan-controls">{p.controls}</div>
  </aside>
  {editable&&<div className="draft-dock" aria-hidden="true"><div data-drop="take">领取 / 抢夺</div><div data-drop="release">撤回</div><div data-drop="interfere">干扰</div></div>}
 </div>;
}
