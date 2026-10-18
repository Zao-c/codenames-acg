import { useEffect, useState, type ReactNode } from 'react';
import { BOARD_MODE_CONFIG, draftQuota, TEAM_LABELS, type AnimeWork, type PublicNextPlan, type Team } from '@acg-codenames/shared';
import { DraftTile, type DropAction, type DropAllow } from './DraftTile';
import { Cover } from './AnimeBoard';

type Props={plan:PublicNextPlan;team?:Team;time:number;remaining:number;controls:ReactNode;works:AnimeWork[];query:string;setQuery:(s:string)=>void;typeFilter:string;setTypeFilter:(s:string)=>void;claimFilter:string;setClaimFilter:(s:string)=>void;onlyBookmarks:boolean;setOnlyBookmarks:(b:boolean)=>void;onDrop:(w:AnimeWork,action:DropAction,replaceId?:number)=>void;onPreview:(w:AnimeWork)=>void;onBookmark?: (w:AnimeWork)=>void;replacement?:number;onChooseReplacement?:(id?:number)=>void};
export function DraftWorkspace(p:Props) {
 const [mobilePane,setMobilePane]=useState<'pool'|'public'|'controls'>('pool');
 const [selectionTeam,setSelectionTeam]=useState<'own'|'other'>('own');
 const [publicExpanded,setPublicExpanded]=useState(()=>window.matchMedia('(min-width:761px)').matches);
 const {plan,team}=p;const claims=plan.captainView?.claims??{};
 const captainControls=!!team&&!!plan.captainView;
 useEffect(()=>{if(mobilePane==='public')setPublicExpanded(true);},[mobilePane]);
 useEffect(()=>{if(p.replacement!==undefined)setMobilePane('pool');},[p.replacement]);
 const editable=!!team&&!!plan.captainView&&plan.stage==='draft'&&p.remaining>0;
 const publicIds=plan.stage==='draft'?(plan.publicSelectedWorkIds??[]):[];
 const publicSet=new Set(publicIds);
 const publicWorks=publicIds.map(id=>plan.candidates.find(w=>w.id===id)).filter((w):w is AnimeWork=>!!w);
 const selected=plan.candidates.filter(w=>claims[w.id]&&(selectionTeam==='own'?claims[w.id].team===team:claims[w.id].team!==team));
 const allow=(w:AnimeWork):DropAllow=>{const claim=claims[w.id];const legal=editable&&(!claim||(claim.kind!=='interference'&&claim.team!==team&&p.remaining>20&&p.time>=claim.protectedUntil));const ownCount=Object.values(claims).filter(c=>c.team===team&&c.kind==='manual').length;const space=!!team&&ownCount<draftQuota(BOARD_MODE_CONFIG[plan.settings.boardMode].size,plan.startingTeam,team).manual;return{
  take:legal&&(space||p.replacement!==undefined),
  release:editable&&claim?.team===team&&claim.kind==='manual',
  interfere:editable&&!claim&&p.remaining>20,
  replace:legal,
  reason:p.remaining<=20?'最后 20 秒不能抢夺或更改干扰':claim?.kind==='interference'?'干扰牌不可抢夺或撤回':claim&&p.time<claim.protectedUntil?'保护期内不可抢夺':undefined,
 };};
 if(plan.variant!=='anime')return <div className="plan-controls">{p.controls}</div>;
 return <div className={`draft-workspace stage-${plan.stage} draft-pane-${mobilePane} ${captainControls?'has-captain-console':'observer-workspace'}`}>
  <header className="draft-workspace-heading"><div><p className="eyebrow">{plan.stage==='planning'?'私人提前预选':plan.stage==='guide'?'浏览与确认':plan.stage==='sealed'?'棋盘已封存':'正式组牌'}</p><h3>{plan.poolName}</h3><span className="hint-text">{plan.candidates.length} 部候选 · {plan.settings.boardMode}</span></div>{plan.stage==='draft'&&<div className={`draft-clock ${p.remaining<=20?'draft-clock-final':''}`} role="timer"><strong>{String(Math.floor(p.remaining/60)).padStart(2,'0')}:{String(p.remaining%60).padStart(2,'0')}</strong><span>{p.remaining<=20?'最后 20 秒 · 禁抢 / 禁改干扰':'180 秒组牌 · 服务器同步'}</span></div>}</header>
  {plan.stage!=='sealed'&&<div className="draft-mobile-tabs"><button className={mobilePane==='pool'?'selected':''} onClick={()=>setMobilePane('pool')}>候选池</button>{plan.stage==='draft'&&<button className={mobilePane==='public'?'selected':''} onClick={()=>setMobilePane('public')}>实时组牌 <span>{publicIds.length}</span></button>}<button className={mobilePane==='controls'?'selected':''} onClick={()=>setMobilePane('controls')}>{team?'选牌与操作':'准备信息'}</button></div>}
  <div className="draft-main">
  {plan.stage==='draft'&&<section className={`draft-public-panel ${publicExpanded?'is-expanded':''}`} aria-label="实时组牌公共已选">
    <div className="draft-public-head"><div><h4>公共已放入 · 实时组牌</h4><span className="hint-text">匿名 · 只读</span></div><strong>{publicIds.length}<small> 部</small></strong><button aria-expanded={publicExpanded} aria-controls={`public-works-${plan.id}`} onClick={()=>setPublicExpanded(v=>!v)}>{publicExpanded?'收起':'展开'}</button></div>
    {publicExpanded&&<div id={`public-works-${plan.id}`}><p className="hint-text">只展示普通手选作品，不显示队伍归属。</p>{publicWorks.length?<div className="draft-public-grid">{publicWorks.map(w=><div className="draft-public-item" key={w.id}><Cover work={w}/><span title={w.title}>{w.title}</span></div>)}</div>:<p className="draft-public-empty">等待队长放入作品</p>}</div>}
  </section>}
  {plan.stage!=='sealed'&&<div className="draft-pool">
   {p.replacement!==undefined&&<div className="draft-replacement-banner" role="status">正在更换《{plan.candidates.find(w=>w.id===p.replacement)?.title}》，点选一部新作品<button onClick={()=>p.onChooseReplacement?.()}>取消更换</button></div>}
   <div className="draft-filters"><input aria-label="搜索候选动画" placeholder="搜索作品或别名" value={p.query} onChange={e=>p.setQuery(e.target.value)}/><select aria-label="筛选动画类型" value={p.typeFilter} onChange={e=>p.setTypeFilter(e.target.value)}><option value="all">全部类型</option>{[...new Set(plan.candidates.map(w=>w.type))].map(t=><option key={t}>{t}</option>)}</select>
   {team&&<><label className="bookmark-filter"><input type="checkbox" checked={p.onlyBookmarks} onChange={e=>p.setOnlyBookmarks(e.target.checked)}/>私人书签</label>{plan.captainView&&<select aria-label="筛选选牌归属" value={p.claimFilter} onChange={e=>p.setClaimFilter(e.target.value)}><option value="all">全部候选</option><option value="own">我方已选</option><option value="other">对方已选</option></select>}</>}
   <span className="hint-text">{p.works.length} / {plan.candidates.length}</span></div>
   <div className="draft-candidates" aria-label="动画候选池" data-drop="release">{p.works.map(w=><DraftTile key={w.id} work={w} claim={claims[w.id]} time={p.time} bookmark={plan.myBookmarks?.includes(w.id)} canEdit={editable} allow={allow(w)} onPreview={()=>p.onPreview(w)} onBookmark={p.onBookmark?()=>p.onBookmark!(w):undefined} onDrop={p.onDrop} publicSelected={!claims[w.id]&&publicSet.has(w.id)}/>)}</div>
   {p.works.length===0&&<p className="empty-text">没有符合条件的作品，试试其他筛选。</p>}
  </div>}
  </div>
  {captainControls?<aside className="draft-control-panel" aria-label="队长控制台">
   <h4 className="draft-console-title">队长控制台 <span>{team&&TEAM_LABELS[team]}</span></h4>
   {team&&plan.captainView&&<section className="draft-selected-panel" data-drop={editable?'take':undefined}><div className="selection-grid"><button className={selectionTeam==='own'?'selected':''} onClick={()=>setSelectionTeam('own')}>我方已选</button><button className={selectionTeam==='other'?'selected':''} onClick={()=>setSelectionTeam('other')}>对方已选</button></div><p className="hint-text">{selectionTeam==='own'?TEAM_LABELS[team]:TEAM_LABELS[team==='red'?'blue':'red']} · {selected.length} 部（含干扰牌）</p><div className="draft-selected-list">{selected.map(w=><div key={w.id}><DraftTile compact work={w} claim={claims[w.id]} time={p.time} canEdit={editable&&claims[w.id]?.team===team&&claims[w.id]?.kind==='manual'} allow={allow(w)} onPreview={()=>p.onPreview(w)} onDrop={p.onDrop}/></div>)}{!selected.length&&<p className="empty-text">选中的作品将在这里显示</p>}</div></section>}
   {editable&&<div className="draft-drop-zones"><div data-drop="take"><strong>领取 / 抢夺</strong><span>拖到阵容区领取</span></div><div data-drop="release"><strong>撤回</strong><span>拖回候选池撤回</span></div><div data-drop="interfere"><strong>干扰</strong><span>空闲作品 · 需再次确认</span></div></div>}
   <div className="plan-controls">{p.controls}</div>
  </aside>:<div className="draft-observer-info"><p className="hint-text">{plan.stage==='draft'?'双方同时组牌中。你可以浏览公共已选和候选作品，也可以切换至聊天。':'你可以浏览候选作品，等待双方队长准备。'}</p><div className="plan-controls">{p.controls}</div></div>}
  {editable&&<div className="draft-dock" aria-hidden="true"><div data-drop="take">领取 / 抢夺</div><div data-drop="release">撤回</div><div data-drop="interfere">干扰</div></div>}
 </div>;
}
