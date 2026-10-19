import {useEffect,useRef,useState} from 'react';
import {TEAM_LABELS,type AnimeWork,type PlanAction,type PublicRoomState} from '@acg-codenames/shared';
import {useGame} from '../context/GameContext';
import {getInterferencePool} from '../lib/api';
import {planActionEnvelope} from '../lib/plan-action';
import {Cover} from './Cover';
import {Dialog} from './UI';
import {useServerTime} from './AnimePlay';

export function InterferenceWorkspace({room}:{room:PublicRoomState}){
 const {socket,connectionState}=useGame(),plan=room.nextPlan!,team=plan.myTeam,claims=plan.captainView?.claims??{};
 const time=useServerTime(room),remaining=plan.endsAt===undefined?null:Math.max(0,Math.ceil((plan.endsAt-time)/1000));
 const [q,setQ]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(1),[works,setWorks]=useState<AnimeWork[]>([]),[total,setTotal]=useState(0);
 const [loading,setLoading]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),[choice,setChoice]=useState<AnimeWork>();
 const live=useRef(true);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const current=useRef(room);current.current=room;
 useEffect(()=>{const timer=setTimeout(()=>{setQuery(q.trim());setPage(1);},250);return()=>clearTimeout(timer);},[q]);
 const claimKey=JSON.stringify(claims);
 useEffect(()=>{
  if(!team||!plan.captainView||plan.interferenceClosed)return;
  let active=true;setLoading(true);setError('');
  getInterferencePool(room.id,plan.id,plan.stageVersion??0,query,page).then(value=>{if(active){setWorks(value.works);setTotal(value.total);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[room.id,plan.id,plan.stageVersion,team,query,page,claimKey,retry]);
 const send=async(action:Omit<PlanAction,'roomId'|'version'>)=>{
  if(pending||!socket.connected)return;
  setPending(true);setError('');const payload=planActionEnvelope(room,action);
  try{await new Promise<void>((resolve,reject)=>{
   let finished=false;const stop=(error?:Error)=>{if(finished)return;finished=true;clearTimeout(retryTimer);clearTimeout(deadline);error?reject(error):resolve();};
   const emit=()=>socket.emit('plan_action',payload,(r)=>r.ok?stop():stop(new Error(r.message??'服务器拒绝操作')));
   const retryTimer=setTimeout(()=>{if(live.current&&current.current.id===room.id&&current.current.nextPlan?.id===plan.id)emit();},4000);
   const deadline=setTimeout(()=>stop(new Error('尚未收到确认，请等待同步后重试')),8000);emit();
  });}catch(e){if(live.current)setError((e as Error).message);}finally{if(live.current)setPending(false);}
 };
 const all=[...plan.candidates,...(plan.captainView?.interferenceWorks??[])],byId=new Map(all.map(w=>[w.id,w]));
 const manual=Object.entries(claims).filter(([,c])=>c.kind==='manual'&&c.team===team),needsManual=!!team&&manual.length===0;
 const outgoing=Object.entries(claims).find(([,c])=>c.kind==='interference'&&c.from===team),selected=outgoing?byId.get(Number(outgoing[0])):undefined;
 const ready=!!team&&!!plan.captainView?.done[team],disabled=pending||connectionState!=='ready';
 const publicWorks=(plan.publicSelectedWorkIds??[]).map(id=>byId.get(id)).filter((w):w is AnimeWork=>!!w);
 return <section className="panel interference-workspace" aria-label="独立干扰阶段">
  <header className="interference-heading"><div><p className="eyebrow">组牌 · 第二阶段</p><h2>给对方留一张难题</h2><p>普通选牌已锁定。双方准备后，各随机互换一张普通手选牌，再成牌开局。</p></div><div className="interference-clock" role="timer">{plan.interferenceClosed?'干扰已截止':remaining===null?'不限时':`${remaining} 秒`}<small>独立干扰阶段</small></div></header>
  {team&&plan.captainView?<>
   <div className="interference-hands">{(['red','blue'] as const).map(t=><section key={t} className={`team-${t}`}><h3>{TEAM_LABELS[t]} · 冻结的普通手选</h3><div className="interference-hand-cards">{Object.entries(claims).filter(([,c])=>c.team===t&&c.kind==='manual').map(([id])=>{const w=byId.get(Number(id));return w?<figure key={id}><Cover work={w}/><figcaption>{w.title}</figcaption></figure>:null;})}</div></section>)}</div>
   {needsManual&&<section className="interference-repair" role="status"><h3>请先补选一张普通牌</h3><p>互换必须使用手选牌。这里只能从空闲候选中补一张，不能抢走对方的牌。</p><div>{plan.candidates.filter(w=>!claims[w.id]&&!Object.keys(claims).some(id=>byId.get(Number(id))?.seriesId===w.seriesId)).slice(0,12).map(w=><button key={w.id} disabled={disabled} onClick={()=>void send({kind:'take',workId:w.id})}>补选《{w.title}》</button>)}</div></section>}
   <section className="interference-current"><div><h3>投给{TEAM_LABELS[team==='red'?'blue':'red']}的干扰牌</h3>{selected?<p>《{selected.title}》</p>:<p>从本局完整作品池中挑选一部，干扰牌不参与随机互换。</p>}</div><div><button className="primary-button" disabled={disabled||needsManual||!selected||ready} onClick={()=>void send({kind:'confirm-interference'})}>{ready?'已准备，等待成牌':'准备成牌'}</button>{ready&&!plan.interferenceClosed&&<button disabled={disabled} onClick={()=>void send({kind:'unready'})}>取消准备</button>}</div></section>
   {!plan.interferenceClosed&&!ready&&<section className="interference-picker"><div className="anime-toolbar"><label>搜索本局作品池<input aria-label="搜索干扰作品" placeholder="作品名或别名" value={q} onChange={e=>setQ(e.target.value)}/></label><span>{total} 部可选 · 已排除上场作品、重复系列与历史轮换</span></div>{loading&&<p role="status">正在读取作品…</p>}<div className="interference-grid">{works.map(w=><button disabled={disabled||loading} key={w.id} onClick={()=>setChoice(w)} aria-label={`投放干扰《${w.title}》`}><Cover work={w}/><strong>{w.title}</strong></button>)}</div><nav aria-label="干扰作品分页"><button disabled={page<=1||loading} onClick={()=>setPage(n=>n-1)}>上一页</button><span>{page} / {Math.max(1,Math.ceil(total/60))}</span><button disabled={page*60>=total||loading} onClick={()=>setPage(n=>n+1)}>下一页</button></nav></section>}
   <p className="hint-text">红队{plan.captainView.done.red?'已准备':'选择中'} · 蓝队{plan.captainView.done.blue?'已准备':'选择中'}。限时结束会为未投放的一方随机补一张并自动准备；零手选队伍仍须补选普通牌。</p>
  </>:<><p>双方队长正在独立选择干扰牌。普通选牌只展示匿名作品，干扰内容仅双方队长可见。</p><div className="interference-public">{publicWorks.map(w=><span key={w.id}>{w.title}</span>)}</div></>}
  {error&&<p role="alert" className="error-text">{error}<button onClick={()=>setRetry(n=>n+1)}>重新读取</button></p>}
  {room.viewer?.isHost&&<button className="danger-button" onClick={()=>{if(window.confirm('取消准备并返回房间？当前普通选牌和干扰将清空。'))void send({kind:'cancel'});}}>取消本次准备</button>}
  {choice&&<Dialog title="确认干扰作品" close={()=>setChoice(undefined)}><p>将《{choice.title}》塞给{team==='red'?'蓝队':'红队'}？</p><p>干扰占对方原有随机补位，不占普通手选额度，也不参与随机互换。</p><button className="primary-button" disabled={disabled} onClick={()=>{void send({kind:'interfere',workId:choice.id});setChoice(undefined);}}>确认投放</button><button onClick={()=>setChoice(undefined)}>返回挑选</button></Dialog>}
 </section>;
}
