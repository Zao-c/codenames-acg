import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { TEAM_LABELS, type AnimeWork, type DraftClaim } from '@acg-codenames/shared';
import { Cover } from './AnimeBoard';

export type DropAction = 'take' | 'release' | 'interfere' | 'replace';
export type DropAllow = Record<DropAction, boolean>;

// Only one tile gesture may run at a time so ghost, highlight and drop stay consistent.
let gestureActive = false;

export function DraftTile({ work, claim, time, bookmark, canEdit, allow, onPreview, onBookmark, onDrop, compact=false }: {
  work: AnimeWork; claim?: DraftClaim; time: number; bookmark?: boolean; canEdit: boolean; allow: DropAllow;
  onPreview: () => void; onBookmark?: () => void; onDrop: (work: AnimeWork, action: DropAction, replaceId?:number) => void; compact?:boolean;
}) {
  const [star,setStar]=useState(!!bookmark);
  const [bookmarkStatus,setBookmarkStatus]=useState('');
  const actualBookmark=useRef(!!bookmark);actualBookmark.current=!!bookmark;
  const bookmarkTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useEffect(()=>{setStar(!!bookmark);setBookmarkStatus('');clearTimeout(bookmarkTimer.current);},[bookmark]);
  useEffect(()=>()=>clearTimeout(bookmarkTimer.current),[]);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const suppress = useRef(false);
  const cleanup = useRef<() => void>(() => {});
  useEffect(() => () => cleanup.current(), []);

  const handlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    suppress.current = false;
    if (!canEdit || gestureActive || (e.pointerType === 'mouse' && e.button !== 0)) return;
    gestureActive = true;
    const touch = e.pointerType !== 'mouse';
    const startX = e.clientX, startY = e.clientY;
    let lastX = startX, lastY = startY;
    let dragging = false, frame = 0, done = false, zone: HTMLElement | null = null;

    const highlight = () => {
      const next = (document.elementFromPoint(lastX, lastY) as HTMLElement | null)?.closest<HTMLElement>('[data-drop]') ?? null;
      const active = next && allow[next.getAttribute('data-drop') as DropAction] ? next : null;
      if (active === zone) return;
      zone?.classList.remove('drop-hot');
      active?.classList.add('drop-hot');
      zone = active;
    };
    const begin = () => {
      if (dragging || done) return;
      dragging = true; suppress.current = true;
      document.body.classList.add('draft-drag-active');
      document.addEventListener('touchmove', blockScroll, { passive: false });
      setGhost({ x: lastX, y: lastY });
    };
    const blockScroll = (ev: TouchEvent) => ev.preventDefault();
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId || done) return;
      lastX = ev.clientX; lastY = ev.clientY;
      if (!dragging) {
        if (Math.hypot(lastX - startX, lastY - startY) <= (touch ? 8 : 6)) return;
        if (touch) { stop(); return; } // 长按前滑动记为页面滚动
        begin();
      }
      if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; setGhost({ x: lastX, y: lastY }); highlight(); });
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId || done) return;
      const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-drop]') ?? null;
      const action = el?.getAttribute('data-drop') as DropAction | null;
      const moved = Math.hypot(ev.clientX - startX, ev.clientY - startY) > 12;
      const wasDragging = dragging;
      stop();
      if (wasDragging && moved && action && allow[action]) onDrop(work, action, Number(el?.getAttribute('data-replace-id'))||undefined);
    };
    const cancel = (ev: PointerEvent) => { if (ev.pointerId === e.pointerId) stop(); };
    function stop() {
      if (done) return;
      done = true; gestureActive = false;
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      document.removeEventListener('touchmove', blockScroll);
      if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
      zone?.classList.remove('drop-hot'); zone = null;
      document.body.classList.remove('draft-drag-active');
      setGhost(null);
      cleanup.current = () => {};
    }
    const timer = touch ? window.setTimeout(begin, 350) : 0;
    cleanup.current = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  return <article className={`draft-tile ${compact?'draft-tile-compact':''} role-${claim?.team ?? 'hidden'} ${ghost ? 'is-dragging' : ''}`} data-drop={compact&&canEdit&&claim?.kind==='manual'?'replace':undefined} data-replace-id={work.id}>
    <button type="button" className="draft-tile-main" aria-haspopup="dialog"
      onPointerDown={handlePointerDown} onContextMenu={e => e.preventDefault()} onDragStart={e => e.preventDefault()}
      onClick={() => { if (suppress.current) { suppress.current = false; return; } onPreview(); }} aria-label={work.title}>
      <Cover work={work}/><span>{work.title}</span>
      {claim && <small>{TEAM_LABELS[claim.team]}{claim.kind === 'interference' ? ' · 干扰' : ''}{claim.protectedUntil > time ? ` · 保护 ${Math.ceil((claim.protectedUntil-time)/1000)}s` : ''}</small>}
    </button>
    {onBookmark && <button type="button" className={`draft-star ${star ? 'is-on' : ''}`} aria-pressed={star}
      aria-label={`${star ? '取消' : '添加'}书签 ${work.title}`} onClick={() => {const next=!star;setStar(next);setBookmarkStatus(next?'已收藏 · 私人书签':'已取消收藏');onBookmark();clearTimeout(bookmarkTimer.current);bookmarkTimer.current=setTimeout(()=>{if(actualBookmark.current!==next){setStar(actualBookmark.current);setBookmarkStatus('收藏未同步，请重试');}},3000);}}>{star ? '★' : '☆'}</button>}
    {bookmarkStatus&&<span className="draft-bookmark-status" role="status">{bookmarkStatus}</span>}
    {ghost && createPortal(<div className="draft-drag-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true"><Cover work={work}/><span>{work.title}</span></div>, document.body)}
  </article>;
}
