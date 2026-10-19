import { memo, useMemo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { TEAM_LABELS, type AnimeWork, type DraftClaim } from '@acg-codenames/shared';
import { Cover } from './AnimeBoard';

export type DropAction = 'take' | 'release' | 'interfere' | 'replace';
export type DropAllow = Record<DropAction, boolean> & { reason?: string };

// Only one tile gesture may run at a time so ghost, highlight and drop stay consistent.
let gestureActive = false;

type TileProps = {
  work: AnimeWork; claim?: DraftClaim; time: number; bookmark?: boolean; canEdit: boolean; allow: DropAllow;
  onPreview: () => void; onBookmark?: () => void; onDrop: (work: AnimeWork, action: DropAction, replaceId?:number) => void; compact?:boolean; publicSelected?:boolean;
};
export function DraftTile(props: TileProps) {
  const latest=useRef(props);latest.current=props;
  const handlers=useMemo(()=>({onDrop:(...args:Parameters<TileProps['onDrop']>)=>latest.current.onDrop(...args),onPreview:()=>latest.current.onPreview(),onBookmark:()=>latest.current.onBookmark?.()}),[]);
  return <MemoDraftTile {...props} onDrop={handlers.onDrop} onPreview={handlers.onPreview} onBookmark={props.onBookmark?handlers.onBookmark:undefined}/>;
}
function DraftTileView({work,claim,time,bookmark,canEdit,allow,onPreview,onBookmark,onDrop,compact=false,publicSelected=false}:TileProps) {
  const [star,setStar]=useState(!!bookmark);
  const [bookmarkStatus,setBookmarkStatus]=useState('');
  const [dropStatus,setDropStatus]=useState('');
  const current=useRef({allow,onDrop});current.current={allow,onDrop};
  const refreshHighlight=useRef<()=>void>(()=>{});
  useEffect(()=>refreshHighlight.current(),[allow.take,allow.release,allow.interfere,allow.replace]);
  const actualBookmark=useRef(!!bookmark);actualBookmark.current=!!bookmark;
  const bookmarkTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useEffect(()=>{setStar(!!bookmark);setBookmarkStatus('');clearTimeout(bookmarkTimer.current);},[bookmark]);
  useEffect(()=>()=>clearTimeout(bookmarkTimer.current),[]);
  const [ghost, setGhost] = useState<{ x: number; y: number; width:number;cover:string } | null>(null);
  const suppress = useRef(false);
  const cleanup = useRef<() => void>(() => {});
  useEffect(() => () => cleanup.current(), []);

  const handlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>,immediate=false) => {
    suppress.current = false;
    if (!canEdit || gestureActive || (e.pointerType === 'mouse' && e.button !== 0)) return;
    gestureActive = true;
    const touch = e.pointerType !== 'mouse';
    const source=e.currentTarget.closest('.draft-tile')!,bounds=source.getBoundingClientRect();
    const cover=source.querySelector<HTMLImageElement>('img');
    const imageSource=cover?.currentSrc||cover?.src||work.cover;
    const width=Math.max(96,Math.min(170,bounds.width));
    const capture=e.currentTarget;
    try{capture.setPointerCapture(e.pointerId);}catch{/* Older browsers still use window listeners. */}
    const startX = e.clientX, startY = e.clientY;
    let lastX = startX, lastY = startY;
    let dragging = false, frame = 0, done = false, zone: HTMLElement | null = null;

    const highlight = () => {
      if(!dragging||done)return;
      const next = (document.elementFromPoint(lastX, lastY) as HTMLElement | null)?.closest<HTMLElement>('[data-drop]') ?? null;
      const active = next && current.current.allow[next.getAttribute('data-drop') as DropAction] ? next : null;
      if (active === zone) return;
      zone?.classList.remove('drop-hot');
      active?.classList.add('drop-hot');
      zone = active;
    };
    refreshHighlight.current=highlight;
    const begin = () => {
      if (dragging || done) return;
      dragging = true; suppress.current = true;
      document.body.classList.add('draft-drag-active');
      document.addEventListener('touchmove', blockScroll, { passive: false });
      setGhost({ x: lastX, y: lastY,width,cover:imageSource });
    };
    const blockScroll = (ev: TouchEvent) => ev.preventDefault();
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId || done) return;
      lastX = ev.clientX; lastY = ev.clientY;
      if (!dragging) {
        if (Math.hypot(lastX - startX, lastY - startY) <= (touch ? 8 : 6)) return;
        if (touch) { suppress.current=true;stop(); return; } // 长按前滑动记为页面滚动
        begin();
      }
      if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; setGhost({ x: lastX, y: lastY,width,cover:imageSource }); highlight(); });
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId || done) return;
      const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-drop]') ?? null;
      const action = el?.getAttribute('data-drop') as DropAction | null;
      const moved = Math.hypot(ev.clientX - startX, ev.clientY - startY) > 12;
      const wasDragging = dragging;
      stop();
      if (wasDragging && moved && action && current.current.allow[action]) current.current.onDrop(work, action, Number(el?.getAttribute('data-replace-id'))||undefined);
      else if(wasDragging&&moved&&action)setDropStatus(current.current.allow.reason??'当前不能放入此处，请检查额度或组牌阶段');
    };
    const cancel = (ev: PointerEvent) => { if (ev.pointerId === e.pointerId) stop(); };
    const onBlur = () => stop();
    const onVisibility = () => { if (document.visibilityState === 'hidden') stop(); };
    function stop() {
      if (done) return;
      done = true; gestureActive = false;
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('touchmove', blockScroll);
      if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
      zone?.classList.remove('drop-hot'); zone = null;
      document.body.classList.remove('draft-drag-active');
      try{if(capture.hasPointerCapture(e.pointerId))capture.releasePointerCapture(e.pointerId);}catch{}
      setGhost(null);
      cleanup.current = () => {};
      refreshHighlight.current=()=>{};
    }
    const timer = touch&&!immediate ? window.setTimeout(begin, 350) : 0;
    cleanup.current = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    if(immediate)begin();
  };

  return <article className={`draft-tile ${compact?'draft-tile-compact':''} role-${claim?.team ?? 'hidden'} ${ghost ? 'is-dragging' : ''} ${publicSelected ? 'is-public-selected' : ''}`} data-drop={compact&&canEdit&&claim?.kind==='manual'?'replace':undefined} data-replace-id={work.id}>
    <button type="button" className="draft-tile-main" aria-haspopup="dialog"
      onPointerDown={handlePointerDown} onContextMenu={e => e.preventDefault()} onDragStart={e => e.preventDefault()}
      onClick={() => { if (suppress.current) { suppress.current = false; return; } onPreview(); }} aria-label={work.title}>
      <Cover work={work}/><span>{work.title}</span>
      {publicSelected && <span className="draft-public-badge">已选入</span>}
      {claim && <small>{TEAM_LABELS[claim.team]}{claim.kind === 'interference' ? ' · 干扰' : ''}{claim.protectedUntil > time ? ` · 保护 ${Math.ceil((claim.protectedUntil-time)/1000)}s` : ''}</small>}
    </button>
    {canEdit&&<button type="button" className="draft-grab" aria-label={`拖动《${work.title}》`} onPointerDown={e=>handlePointerDown(e,true)} onClick={e=>e.preventDefault()} onContextMenu={e=>e.preventDefault()}>⠿<span>拖动</span></button>}
    {onBookmark && <button type="button" className={`draft-star ${star ? 'is-on' : ''}`} aria-pressed={star}
      aria-label={`${star ? '取消' : '添加'}书签 ${work.title}`} onClick={() => {const next=!star;setStar(next);setBookmarkStatus(next?'已收藏 · 私人书签':'已取消收藏');onBookmark();clearTimeout(bookmarkTimer.current);bookmarkTimer.current=setTimeout(()=>{if(actualBookmark.current!==next){setStar(actualBookmark.current);setBookmarkStatus('收藏未同步，请重试');}},3000);}}>{star ? '★' : '☆'}</button>}
    {bookmarkStatus&&<span className="draft-bookmark-status" role="status">{bookmarkStatus}</span>}
    {dropStatus&&<span className="draft-bookmark-status" role="status">{dropStatus}</span>}
    {ghost && createPortal(<div className="draft-drag-ghost" style={{ left: ghost.x, top: ghost.y,width:ghost.width }} aria-hidden="true"><img src={ghost.cover} alt="" draggable={false} referrerPolicy="no-referrer"/><span>{work.title}</span></div>, document.body)}
  </article>;
}

const MemoDraftTile=memo(DraftTileView,(a,b)=>
  a.work===b.work&&a.bookmark===b.bookmark&&a.canEdit===b.canEdit&&a.compact===b.compact&&a.publicSelected===b.publicSelected&&
  a.onDrop===b.onDrop&&a.onPreview===b.onPreview&&a.onBookmark===b.onBookmark&&
  JSON.stringify(a.claim)===JSON.stringify(b.claim)&&
  Math.max(0,Math.ceil(((a.claim?.protectedUntil??0)-a.time)/1000))===Math.max(0,Math.ceil(((b.claim?.protectedUntil??0)-b.time)/1000))&&
  a.allow.take===b.allow.take&&a.allow.release===b.allow.release&&a.allow.interfere===b.allow.interfere&&a.allow.replace===b.allow.replace&&a.allow.reason===b.allow.reason);
