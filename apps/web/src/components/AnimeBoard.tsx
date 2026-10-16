import { useEffect, useRef, useState } from 'react';
import { BOARD_MODE_CONFIG, type AnimeWork, type PublicCard, type PublicRoomState } from '@acg-codenames/shared';
import { useGame } from '../context/GameContext';
import { Dialog } from './UI';
import { AssociationBoard } from './AssociationBoard';
import { SpectatorPredictions } from './SpectatorPredictions';
import { privateIdentityKey } from '../lib/private-identity';
export function Cover({ work }: { work: AnimeWork }) {
  const [failed, setFailed] = useState(false);
  return !failed && work.cover ? <img src={work.cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="anime-cover-fallback">{work.title}</span>;
}
export function Preview({ work, close, children }: { work: AnimeWork; close: () => void; children?: React.ReactNode }) {
  return <Dialog title={work.fullTitle} close={close}><section className="anime-modal">
    <Cover work={work}/><h2>{work.fullTitle}</h2><p>{work.type} · {work.airDate}</p><p>{work.aliases.join(' / ')}</p>
    <a className="anime-bgm-link" href={`https://bgm.tv/subject/${work.id}`} target="_blank" rel="noopener noreferrer">在 Bangumi 查看</a>{children}
  </section></Dialog>;
}

export function AnimeBoard({ room }: { room: PublicRoomState }) {
  const { guessCard } = useGame();
  const [text, setText] = useState(() => localStorage.getItem('anime-text-view') === '1');
  const [zoom, setZoom] = useState(1);
  const [preview, setPreview] = useState<PublicCard | null>(null);
  const [confirm, setConfirm] = useState(false);
  const markKey=`cipai.personal-marks:${room.id}:${room.matchId??room.roundNumber}:${room.viewer?.participantId}:${privateIdentityKey()}`;
  const [marks,setMarks]=useState<Record<string,string>>({});
  const [markTarget,setMarkTarget]=useState<PublicCard|null>(null);
  const held=useRef<{x:number;y:number;ready:boolean;timer:ReturnType<typeof setTimeout>}|null>(null);
  const suppress=useRef(false);
  const touchStarted=useRef(0),markReadyAt=useRef(0);
  useEffect(()=>{try{setMarks(JSON.parse(localStorage.getItem(markKey)||'{}'));}catch{setMarks({});}setMarkTarget(null);},[markKey]);
  useEffect(()=>()=>{if(held.current)clearTimeout(held.current.timer);},[]);
  const cancelHold=()=>{if(held.current)clearTimeout(held.current.timer);held.current=null;};
  const scroll = useRef<HTMLDivElement>(null);
  const selected = room.board.find(card => card.id === preview?.id);
  const cols = BOARD_MODE_CONFIG[room.settings.boardMode].columns;
  return <section className="panel anime-board-panel" data-analysis={room.analysis ? 'true' : undefined}>
    <div className="anime-toolbar"><strong>封面棋盘 · {room.settings.boardMode}</strong>
      <button onClick={() => { setText(!text); localStorage.setItem('anime-text-view', text ? '0':'1'); }}>{text ? '封面显示' : '纯文字显示'}</button>
      <button aria-label="缩小棋盘" disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1,z-.25))}>−</button>
      <button aria-label="放大棋盘" disabled={zoom >= 2} onClick={() => setZoom(z => Math.min(2,z+.25))}>＋</button>
      <button onClick={() => { setZoom(1); scroll.current?.scrollTo(0,0); }}>重置视图</button>
      <AssociationBoard key={room.matchId} room={room}/>
      <SpectatorPredictions key={`predictions-${room.matchId}`} room={room}/>
    </div><p className="hint-text">点卡片查看作品；猜牌需要再次确认。放大后可滑动浏览。</p>
    <div className="anime-board-scroll" ref={scroll}><div className={`anime-board ${text ? "anime-board-text" : ""}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, width: `${zoom*100}%` }}>
      {room.board.map(card => <button key={card.id} className={`anime-board-card role-${card.role ?? 'hidden'} ${card.revealed ? 'is-revealed':''}`} aria-label={`${card.word}${card.revealed ? ' 已翻开':''}`} data-personal-mark={marks[card.id]||undefined}
        onContextMenu={e=>{e.preventDefault();if(held.current||Date.now()-touchStarted.current<1500)return;suppress.current=true;markReadyAt.current=0;setMarkTarget(card);}}
        onPointerDown={e=>{suppress.current=false;if(e.pointerType==='mouse')return;touchStarted.current=Date.now();const {clientX:x,clientY:y}=e;e.currentTarget.setPointerCapture(e.pointerId);held.current={x,y,ready:false,timer:setTimeout(()=>{if(held.current)held.current.ready=true;suppress.current=true;},500)};}}
        onPointerMove={e=>{if(held.current&&Math.hypot(e.clientX-held.current.x,e.clientY-held.current.y)>8)cancelHold();}}
        onPointerUp={()=>{const ready=held.current?.ready;cancelHold();if(ready){suppress.current=true;markReadyAt.current=Date.now()+180;setMarkTarget(card);}}} onPointerCancel={cancelHold}
        onClick={() => { if(suppress.current){suppress.current=false;return;}setPreview(card); setConfirm(false); }}>
        {!text && card.anime && <Cover work={card.anime} />}<span>{card.word}</span>{card.role && <b>{card.role === 'red' ? '红' : card.role === 'blue' ? '蓝' : card.role === 'neutral' ? '中立' : '刺客'}</b>}
        {marks[card.id]&&<i className={`personal-mark mark-${marks[card.id]}`}>预判 · {({red:'红',blue:'蓝',neutral:'中立',assassin:'刺客'} as Record<string,string>)[marks[card.id]]}</i>}
      </button>)}
    </div></div>
    {markTarget&&<Dialog title="个人预判" close={()=>{if(Date.now()>=markReadyAt.current)setMarkTarget(null);}}><p>《{markTarget.word}》 · 仅你可见，不会翻牌。</p><div className="personal-mark-choices">{(['red','blue','neutral','assassin',''] as const).map((value,i)=><button key={value} onClick={()=>{if(Date.now()<markReadyAt.current)return;setMarks(previous=>{const next={...previous};if(value)next[markTarget.id]=value;else delete next[markTarget.id];localStorage.setItem(markKey,JSON.stringify(next));return next;});setMarkTarget(null);}}>{['标记红队','标记蓝队','标记中立','标记刺客','清除预判'][i]}</button>)}</div></Dialog>}
    {preview?.anime && <Preview work={preview.anime} close={() => setPreview(null)}>
      {room.viewer?.canGuess && selected && !selected.revealed && <div className="anime-confirm">
        {confirm ? <><p>确认猜「{preview.word}」？</p><button className="primary-button" onClick={() => { guessCard(preview.id); setPreview(null); }}>确认猜牌</button><button onClick={() => setConfirm(false)}>再想一下</button></> : <button className="primary-button" onClick={() => setConfirm(true)}>猜牌</button>}
      </div>}
    </Preview>}
  </section>;
}

