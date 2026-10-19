import {useEffect,useRef,useState} from 'react';
import {TEAM_LABELS,type AnimeWork,type PlanAction,type PublicRoomState} from '@acg-codenames/shared';
import {useGame} from '../context/GameContext';
import {getInterferencePool} from '../lib/api';
import {planActionEnvelope} from '../lib/plan-action';
import {Cover} from './Cover';
import {DraftWorkspace} from './DraftWorkspace';
import {Dialog} from './UI';
import {useServerTime} from './AnimePlay';

/** The server phase changes, while the drafting layout and card gestures stay shared. */
export function InterferenceWorkspace({room}:{room:PublicRoomState}){
 const {socket,connectionState}=useGame(),plan=room.nextPlan!,team=plan.myTeam,claims=plan.captainView?.claims??{};
 const time=useServerTime(room),remaining=plan.endsAt===undefined?null:Math.max(0,Math.ceil((plan.endsAt-time)/1000));
 const [q,setQ]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(1),[works,setWorks]=useState<AnimeWork[]>([]),[total,setTotal]=useState(0);
 const [loading,setLoading]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),[choice,setChoice]=useState<AnimeWork>(),[preview,setPreview]=useState<AnimeWork>();
 const live=useRef(true);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const current=useRef(room);current.current=room;
 const captain=!!team&&!!plan.captainView,ready=!!team&&!!plan.captainView?.done[team],disabled=pending||connectionState!=='ready';
 const canChoose=captain&&!disabled&&!ready&&!plan.interferenceClosed;
 useEffect(()=>{const timer=setTimeout(()=>{setQuery(q.trim());setPage(1);},250);return()=>clearTimeout(timer);},[q]);
 const claimKey=JSON.stringify(claims);
 useEffect(()=>{
  if(!captain||plan.interferenceClosed)return;
  let active=true;setLoading(true);setError('');
  getInterferencePool(room.id,plan.id,plan.stageVersion??0,query,page).then(value=>{if(active){setWorks(value.works);setTotal(value.total);}}).catch(e=>{if(active){setWorks([]);setError(e.message);}}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[room.id,plan.id,plan.stageVersion,captain,query,page,claimKey,retry,plan.interferenceClosed]);
 useEffect(()=>{if(!canChoose)setChoice(undefined);},[canChoose]);
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
 const needsManual=captain&&!Object.values(claims).some(c=>c.kind==='manual'&&c.team===team);
 const outgoing=Object.entries(claims).find(([,c])=>c.kind==='interference'&&c.from===team),selected=outgoing?byId.get(Number(outgoing[0])):undefined;
 const choose=(w:AnimeWork)=>{if(canChoose&&!claims[w.id]&&!loading)setChoice(w);else setPreview(w);};
 const finish=captain?<div className="draft-finish-controls"><strong>{selected?`干扰牌 · ${selected.title}`:'选择一张干扰牌'}</strong><button className="primary-button" disabled={disabled||needsManual||!selected||ready} onClick={()=>void send({kind:'confirm-interference'})}>{ready?'已准备':'准备成牌'}</button>{ready&&!plan.interferenceClosed&&<button disabled={disabled} onClick={()=>void send({kind:'unready'})}>取消准备</button>}</div>:undefined;
 const controls=<>{finish}{needsManual&&<section className="interference-repair" role="status"><h4>补选一张普通牌</h4><div>{plan.candidates.filter(w=>!claims[w.id]&&!Object.keys(claims).some(id=>byId.get(Number(id))?.seriesId===w.seriesId)).slice(0,12).map(w=><button key={w.id} disabled={disabled} onClick={()=>void send({kind:'take',workId:w.id})}>补选《{w.title}》</button>)}</div></section>}{captain&&<p className="hint-text">红队{plan.captainView?.done.red?'已准备':'选择中'} · 蓝队{plan.captainView?.done.blue?'已准备':'选择中'}</p>}{room.viewer?.isHost&&<button className="danger-button" disabled={disabled} onClick={()=>{if(window.confirm('取消准备并返回房间？当前普通选牌和干扰将清空。'))void send({kind:'cancel'});}}>取消本次准备</button>}</>;
 const noop=()=>{};
 return <section className="panel next-match-panel has-anime-plan" aria-label="独立干扰阶段">
  <DraftWorkspace plan={plan} team={team} time={time} remaining={remaining??0} controls={controls} finishControl={finish}
   works={captain?works:plan.candidates.filter(w=>!q||[w.title,w.fullTitle,...w.aliases].some(s=>s.toLowerCase().includes(q.toLowerCase())))} query={q} setQuery={setQ}
   typeFilter="all" setTypeFilter={noop} claimFilter="all" setClaimFilter={noop} onlyBookmarks={false} setOnlyBookmarks={noop}
   onPreview={choose} onDrop={(w,action)=>{if(action==='interfere'&&canChoose&&!loading&&!claims[w.id])setChoice(w);}}
   interference={{clock:plan.interferenceClosed?'已截止':remaining===null?'不限时':`${remaining} 秒`,total:captain?total:plan.candidates.length,canChoose,loading:captain&&loading,
    status:<>{loading&&captain&&<p role="status">正在读取作品…</p>}{error&&<p role="alert" className="error-text">{error}<button onClick={()=>setRetry(n=>n+1)}>重试</button></p>}</>,
    footer:captain?<nav className="draft-pool-pagination" aria-label="干扰作品分页"><button disabled={page<=1||loading||!!plan.interferenceClosed} onClick={()=>setPage(n=>n-1)}>上一页</button><span>{page} / {Math.max(1,Math.ceil(total/60))}</span><button disabled={page*60>=total||loading||!!plan.interferenceClosed} onClick={()=>setPage(n=>n+1)}>下一页</button></nav>:null}}/>
  {preview&&<Dialog title={preview.title} close={()=>setPreview(undefined)}><div className="interference-preview"><Cover work={preview}/></div></Dialog>}
  {choice&&canChoose&&<Dialog title="确认干扰作品" close={()=>setChoice(undefined)}><div className="interference-preview"><Cover work={choice}/></div><p>将《{choice.title}》投给{team&&TEAM_LABELS[team==='red'?'blue':'red']}？</p><button className="primary-button" disabled={disabled} onClick={()=>{void send({kind:'interfere',workId:choice.id});setChoice(undefined);}}>确认投放</button><button onClick={()=>setChoice(undefined)}>返回挑选</button></Dialog>}
 </section>;
}
