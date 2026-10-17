import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { AssociationGraph, GraphNode, GraphOperation, PublicCard, ClueRoundRecord } from '@acg-codenames/shared';

const W=900,H=540;
const id=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
type Gesture={kind:'node'|'edge'|'pan';id?:string;x:number;y:number;startX:number;startY:number;panX:number;panY:number;pointer:number};

/** The canvas only sends existing GraphOperation messages; the server owns every revision. */
export function GraphCanvas({graph,cards,clues=[],editable,send:onSave,error}:{graph:AssociationGraph;cards:PublicCard[];clues?:ClueRoundRecord[];editable:boolean;send:(op:GraphOperation)=>Promise<void>;error?:string}) {
  const frame=useRef<HTMLDivElement>(null);
  const lock=useRef(false);
  const [pending,setPending]=useState(false),[status,setStatus]=useState(''),[saveError,setSaveError]=useState('');
  const send=(op:GraphOperation)=>{
    if(lock.current||!editable)return;
    lock.current=true;setPending(true);setStatus('正在同步…');setSaveError('');
    void onSave(op).then(()=>setStatus('已同步到服务器')).catch(e=>{setStatus('');setSaveError((e as Error).message);setPositions({});}).finally(()=>{lock.current=false;setPending(false);});
  };
  const gesture=useRef<Gesture|null>(null);
  const pointers=useRef(new Map<number,{x:number;y:number}>());
  const pinch=useRef<{distance:number;zoom:number}|null>(null);
  const [zoom,setZoom]=useState(1),[pan,setPan]=useState({x:20,y:20});
  const [positions,setPositions]=useState<Record<string,{x:number;y:number}>>({});
  const [wire,setWire]=useState<{from:string;x:number;y:number}|null>(null);
  const [connect,setConnect]=useState<string|null>(null);
  const [selected,setSelected]=useState<{kind:'node'|'edge';id:string}|null>(null);
  const [text,setText]=useState('');
  const [adding,setAdding]=useState<'clue'|'work'|null>(null),[note,setNote]=useState('');
  const [query,setQuery]=useState('');
  const selectedNode=graph.nodes.find(n=>selected?.kind==='node'&&n.id===selected.id);
  const selectedEdge=graph.edges.find(e=>selected?.kind==='edge'&&e.id===selected.id);
  const node=(n:GraphNode)=>({...n,...positions[n.id]});
  const name=(n:GraphNode)=>n.text||(n.cardId?cards.find(c=>c.id===n.cardId)?.word??'作品':'');
  const choose=(kind:'node'|'edge',value:string)=>{setAdding(null);setSelected({kind,id:value});setText(kind==='node'?graph.nodes.find(n=>n.id===value)?.text??'':graph.edges.find(e=>e.id===value)?.text??'');};
  const reset=()=>{setZoom((frame.current?.clientWidth??900)<600?Math.min(.62,((frame.current?.clientWidth??360)-25)/(W*.65)):Math.min(1,((frame.current?.clientWidth??940)-40)/W));setPan({x:20,y:20});};
  useEffect(()=>{reset();},[]);
  useEffect(()=>{if(!gesture.current)setPositions({});},[graph.revision,error]);
  useEffect(()=>{const el=frame.current;if(!el)return;const wheel=(e:WheelEvent)=>{e.preventDefault();const rect=el.getBoundingClientRect();setZoom(previous=>{const next=clamp(previous*(e.deltaY<0?1.1:.9),.3,2.5);setPan(p=>({x:e.clientX-rect.left-(e.clientX-rect.left-p.x)*next/previous,y:e.clientY-rect.top-(e.clientY-rect.top-p.y)*next/previous}));return next;});};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);},[]);
  const coords=(x:number,y:number)=>{const r=frame.current!.getBoundingClientRect();return {x:(x-r.left-pan.x)/zoom,y:(y-r.top-pan.y)/zoom};};
  const start=(e:ReactPointerEvent,kind:Gesture['kind'],n?:GraphNode)=>{
    if(e.button!==0||pending)return;
    e.stopPropagation();pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});frame.current?.setPointerCapture(e.pointerId);
    if(pointers.current.size===2){const [a,b]=[...pointers.current.values()];pinch.current={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom};gesture.current=null;return;}
    if(n&&kind==='node')choose('node',n.id);
    if(n&&kind==='node'&&connect&&editable){link(connect,n.id);setConnect(null);return;}
    if(kind==='edge'&&n){setConnect(n.id);const p=node(n);setWire({from:n.id,x:p.x*W,y:p.y*H});}
    if((kind==='node'||kind==='edge')&&!editable)return;
    gesture.current={kind,id:n?.id,x:e.clientX,y:e.clientY,startX:n?.x??0,startY:n?.y??0,panX:pan.x,panY:pan.y,pointer:e.pointerId};
  };
  const link=(from:string,to:string)=>{if(from===to)return;const existing=graph.edges.find(e=>e.from===from&&e.to===to||e.from===to&&e.to===from);if(existing){choose('edge',existing.id);return;}send({kind:'edge',edge:{id:id(),from,to,text:''}});};
  const move=(e:ReactPointerEvent)=>{
    if(!pointers.current.has(e.pointerId))return;pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pinch.current&&pointers.current.size===2){const [a,b]=[...pointers.current.values()];setZoom(clamp(pinch.current.zoom*Math.hypot(a.x-b.x,a.y-b.y)/pinch.current.distance,.3,2.5));return;}
    const g=gesture.current;if(!g||g.pointer!==e.pointerId)return;
    if(g.kind==='pan')setPan({x:g.panX+e.clientX-g.x,y:g.panY+e.clientY-g.y});
    if(g.kind==='node'&&g.id)setPositions(p=>({...p,[g.id!]:{x:clamp(g.startX+(e.clientX-g.x)/zoom/W,.08,.92),y:clamp(g.startY+(e.clientY-g.y)/zoom/H,.1,.9)}}));
    if(g.kind==='edge'&&g.id){const p=coords(e.clientX,e.clientY);setWire({from:g.id,...p});}
  };
  const finish=(e:ReactPointerEvent,cancel=false)=>{
    pointers.current.delete(e.pointerId);if(pointers.current.size<2)pinch.current=null;
    const g=gesture.current;if(g?.pointer!==e.pointerId)return;gesture.current=null;setWire(null);
    if(cancel){setPositions({});setConnect(null);return;}
    if(g.kind==='node'&&g.id&&Math.hypot(e.clientX-g.x,e.clientY-g.y)>4){const n=graph.nodes.find(n=>n.id===g.id);if(n)send({kind:'node',node:node(n)});}
    if(g.kind==='edge'&&g.id){const target=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;if(target&&target!==g.id){link(g.id,target);setConnect(null);}}
  };
  const add=(card?:PublicCard,clue?:ClueRoundRecord)=>{send({kind:'node',node:{id:id(),...(card?{cardId:card.id}:clue?{clueId:clue.clueId}:{}),text:card?'':clue?.word??note.trim(),x:.2+(graph.nodes.length%3)*.28,y:.2+(Math.floor(graph.nodes.length/3)%3)*.28}});setAdding(null);setNote('');};
  return <div className={`graph-workspace ${!adding&&!selectedNode&&!selectedEdge?'no-inspector':''}`} aria-busy={pending}>
    <section className="graph-main"><div className="graph-toolbar"><button className="primary-button" disabled={!editable} onClick={()=>{setAdding('clue');setSelected(null);setConnect(null);}}>＋线索</button><button disabled={!editable} onClick={()=>{setAdding('work');setSelected(null);setConnect(null);}}>＋动画</button><button aria-label="放大画布" onClick={()=>setZoom(z=>clamp(z+.15,.3,2.5))}>放大 ＋</button><button aria-label="缩小画布" onClick={()=>setZoom(z=>clamp(z-.15,.3,2.5))}>缩小 −</button><button onClick={reset}>重置视图</button><span className="hint-text">{Math.round(zoom*100)}%</span></div>
      <div ref={frame} className="graph-canvas-frame" aria-label="关联画布" onPointerDown={e=>start(e,'pan')} onPointerMove={move} onPointerUp={e=>finish(e)} onPointerCancel={e=>finish(e,true)}>
        <div className="graph-world" style={{width:W,height:H,transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})`}}>
          <svg className="graph-wires" width={W} height={H}>{graph.edges.map(edge=>{const a=graph.nodes.find(n=>n.id===edge.from),b=graph.nodes.find(n=>n.id===edge.to);if(!a||!b)return null;const p=node(a),q=node(b);const d=`M ${p.x*W} ${p.y*H} L ${q.x*W} ${q.y*H}`;return <g key={edge.id} data-edge-id={edge.id}><path className={`graph-wire ${selectedEdge?.id===edge.id?'selected':''}`} d={d}/><path className="graph-wire-hit" d={d} tabIndex={0} role="button" aria-label={`关联 ${name(a)} 到 ${name(b)}`} onPointerDown={e=>e.stopPropagation()} onClick={()=>choose('edge',edge.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose('edge',edge.id);}}}/><text x={(p.x+q.x)*W/2} y={(p.y+q.y)*H/2-10} style={{fontSize:Math.min(32,13/zoom)}}>{edge.text}</text></g>;})}{wire&&(()=>{const n=graph.nodes.find(n=>n.id===wire.from);if(!n)return null;const p=node(n);return <line className="graph-wire pending" x1={p.x*W} y1={p.y*H} x2={wire.x} y2={wire.y}/>;})()}</svg>
          {graph.nodes.map(n=>{const p=node(n);return <div key={n.id} role="button" tabIndex={0} aria-label={`${n.cardId?'作品':'线索'}节点 ${name(n)}`} data-node-id={n.id} className={`graph-node ${n.cardId?'work':'clue'} ${selectedNode?.id===n.id?'selected':''} ${connect===n.id?'connecting':''}`} style={{left:p.x*W,top:p.y*H}} onPointerDown={e=>start(e,'node',n)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(connect&&editable){link(connect,n.id);setConnect(null);}else choose('node',n.id);}if(editable&&e.key.startsWith('Arrow')){e.preventDefault();send({kind:'node',node:{...n,x:clamp(n.x+(e.key==='ArrowRight'?.025:e.key==='ArrowLeft'?-.025:0),.08,.92),y:clamp(n.y+(e.key==='ArrowDown'?.025:e.key==='ArrowUp'?-.025:0),.1,.9)}});}}}><span className="graph-node-title" style={{fontSize:Math.min(38,14/zoom)}} title={name(n)}>{n.clueId&&<small style={{fontSize:Math.min(32,12/zoom)}}>{clues.find(c=>c.clueId===n.clueId)?.team==='red'?'红队':'蓝队'} · 第 {clues.findIndex(c=>c.clueId===n.clueId)+1} 回合</small>}{name(n)}{n.clueId&&` ×${clues.find(c=>c.clueId===n.clueId)?.count??''}`}</span>{editable&&<button className="graph-port"  aria-label={`从 ${name(n)} 连线`} onPointerDown={e=>start(e,'edge',n)} onClick={e=>{e.stopPropagation();setConnect(n.id);}}/>}</div>;})}
        </div>{!graph.nodes.length&&<div className="graph-empty">{editable?'添加一条线索或本局作品，开始记录联想。':'还没有关联。队员的笔记会实时显示在这里。'}</div>}
      </div><p className="hint-text" role="status">{connect?'请点击目标节点完成连线。':'拖动节点移动；选中后可连接。空白处平移，滚轮或双指缩放。'}{!editable?' 当前只读。':''}{status&&` · ${status}`}{connect&&<button onClick={()=>setConnect(null)}>取消连接</button>}</p>{(saveError||error)&&<p role="alert">{saveError||error}</p>}
    </section>
    {(adding||selectedNode||selectedEdge)&&<aside className="graph-inspector" aria-label="关联板编辑面板">
      <div className="graph-inspector-heading"><h3>{adding==='clue'?'添加线索':adding==='work'?'添加动画':selectedNode?'节点详情':'连线详情'}</h3><button aria-label="关闭编辑面板" onClick={()=>{setAdding(null);setSelected(null);setConnect(null);}}>✕</button></div>
      {adding==='clue'?<><p className="hint-text">本局已提交的公开线索</p><div className="graph-clue-picker">{clues.map((c,i)=><button key={c.clueId} disabled={pending} onClick={()=>add(undefined,c)}><small>{c.team==='red'?'红队':'蓝队'} · 第 {i+1} 回合</small><strong>{c.word} ×{c.count}</strong></button>)}{!clues.length&&<p className="hint-text">还没有已提交的线索。</p>}</div><form onSubmit={e=>{e.preventDefault();add();}}><label>自定义想法<input autoFocus aria-label="线索内容" maxLength={200} value={note} onChange={e=>setNote(e.target.value)}/></label><button className="primary-button" disabled={pending||!note.trim()}>添加线索节点</button></form></>:adding==='work'?<><input aria-label="搜索本局作品" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索本局作品"/><div className="graph-work-picker">{cards.filter(c=>!graph.nodes.some(n=>n.cardId===c.id)&&c.word.toLowerCase().includes(query.toLowerCase())).map(c=><button key={c.id} disabled={pending} onClick={()=>add(c)}>{c.word}</button>)}</div></>:<form onSubmit={e=>{e.preventDefault();if(selectedNode)send({kind:'node',node:{...selectedNode,text}});if(selectedEdge)send({kind:'edge',edge:{...selectedEdge,text}});}}>
        {selectedNode?.clueId&&<p className="hint-text">原始比赛线索：{clues.find(c=>c.clueId===selectedNode.clueId)?.word}。编辑仅修改此节点说明。</p>}
        <label>{selectedNode?'节点文字':'连线内容'}<input aria-label={selectedNode?'节点文字':'连线内容'} value={text} maxLength={200} disabled={!editable||pending} onChange={e=>setText(e.target.value)}/></label>
        {editable&&<div className="graph-inspector-actions"><button type="submit" disabled={pending||!!selectedNode&&!selectedNode.cardId&&!text.trim()}>保存编辑</button>{selectedNode&&<button type="button" disabled={pending} onClick={()=>{setConnect(selectedNode.id);setSelected(null);}}>连接到…</button>}<button type="button" disabled={pending} className="danger-button" onClick={()=>{send({kind:selectedNode?'remove-node':'remove-edge',id:(selectedNode??selectedEdge)!.id});setSelected(null);}}>删除{selectedNode?'节点':'连线'}</button></div>}
      </form>}
    </aside>}
  </div>;
}
